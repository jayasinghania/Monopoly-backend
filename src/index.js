const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

// Handlers
const lobby = require("./handlers/lobbyHandler");
const turn = require("./handlers/turnHandler");
const jail = require("./handlers/jailHandler");
const trade = require("./handlers/tradeHandler");
const property = require("./handlers/propertyHandler");

// Utils
const { send, broadcastState, broadcastLog } = require("./utils/broadcast");
const { onPlayerReconnected } = require("./utils/lifecycle");

// ============================================================
// TIMING CONSTANTS
// ============================================================

const HEARTBEAT_INTERVAL_MS = 10_000;          // ping clients every 10s (was 30s)
const DISCONNECT_GRACE_MS = 30_000;            // wait 30s before auto-skipping a disconnected player's turn
const FINISHED_ROOM_TTL_MS = 5 * 60_000;       // delete finished rooms after 5 minutes
const ABANDONED_ROOM_TTL_MS = 10 * 60_000;     // delete rooms where everyone has been gone this long
const ROOM_CLEANUP_INTERVAL_MS = 60_000;       // run cleanup sweep every minute

// ============================================================
// SERVER BOOTSTRAP
// ============================================================

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4000;

// ============================================================
// GLOBAL STATE
// ============================================================

const rooms = new Map();   // code -> Room
const clients = new Map(); // ws -> { id, roomCode, playerIndex }

// ============================================================
// MESSAGE ROUTER
// Maps message types to handler functions.
// All handlers receive: (ws, client, msg, rooms, clients)
// ============================================================

const MESSAGE_HANDLERS = {
  // Lobby
  createRoom:   lobby.handleCreateRoom,
  joinRoom:     lobby.handleJoinRoom,
  selectToken:  lobby.handleSelectToken,
  toggleReady:  lobby.handleToggleReady,
  startGame:    lobby.handleStartGame,

  // Turn actions
  rollDice:     turn.handleRollDice,
  buyProperty:  turn.handleBuyProperty,
  skipBuy:      turn.handleSkipBuy,
  endTurn:      turn.handleEndTurn,
  dismissCard:  turn.handleDismissCard,
  declareBankruptcy: turn.handleDeclareBankruptcy,

  // Jail
  payJailFine:  jail.handlePayJailFine,
  useJailCard:  jail.handleUseJailCard,

  // Property management
  buyHouse:     property.handleBuyHouse,
  sellHouse:    property.handleSellHouse,
  mortgage:     property.handleMortgage,
  unmortgage:   property.handleUnmortgage,

  // Trading
  proposeTrade: trade.handleProposeTrade,
  acceptTrade:  trade.handleAcceptTrade,
  rejectTrade:  trade.handleRejectTrade,
  cancelTrade:  trade.handleCancelTrade,
};

function routeMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  const handler = MESSAGE_HANDLERS[msg.type];
  if (!handler) return;

  try {
    handler(ws, client, msg, rooms, clients);
  } catch (err) {
    console.error(`Handler error for "${msg.type}":`, err);
    send(ws, { type: "error", message: "Server error processing your action" });
  }
}

// ============================================================
// WEBSOCKET CONNECTION LIFECYCLE
// ============================================================

wss.on("connection", (ws) => {
  const clientId = uuidv4();
  clients.set(ws, { id: clientId, roomCode: null, playerIndex: -1 });

  send(ws, { type: "connected", clientId });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    routeMessage(ws, msg);
  });

  ws.on("close", () => {
    handleDisconnect(ws);
    clients.delete(ws);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
});

// ============================================================
// DISCONNECT HANDLING
// Per-player grace timers: if a player drops, give them
// DISCONNECT_GRACE_MS to reconnect before we auto-skip their turn.
// ============================================================

// roomCode -> Map<playerIndex, Timeout>
const disconnectTimers = new Map();

function getRoomTimers(roomCode) {
  if (!disconnectTimers.has(roomCode)) {
    disconnectTimers.set(roomCode, new Map());
  }
  return disconnectTimers.get(roomCode);
}

function clearDisconnectTimer(roomCode, playerIndex) {
  const timers = disconnectTimers.get(roomCode);
  if (!timers) return;
  const t = timers.get(playerIndex);
  if (t) {
    clearTimeout(t);
    timers.delete(playerIndex);
  }
}

/**
 * Called when a player has been disconnected past the grace period.
 * If it was their turn (and they haven't bankruptcied), auto-end the turn
 * so the game keeps moving. They can still reconnect later.
 */
function onGracePeriodExpired(roomCode, playerIndex) {
  const room = rooms.get(roomCode);
  if (!room) return;

  const timers = disconnectTimers.get(roomCode);
  if (timers) timers.delete(playerIndex);

  const player = room.players[playerIndex];
  if (!player || player.connected || player.bankrupt) return;

  // Only auto-skip if the game is still in progress and it's this player's turn.
  if (room.state !== "playing") return;
  if (room.currentTurn !== playerIndex) return;

  // Clear any pending action (e.g., if they were prompted to buy and walked away)
  // and any unresolved doubles state, then advance the turn.
  player.pendingAction = null;
  player.rolledDoubles = false;
  room.advanceTurn();

  broadcastLog(room, clients, `⏭️ ${player.name} was inactive — turn skipped.`);
  broadcastLog(room, clients, `${room.getCurrentPlayer().name}'s turn`);
  broadcastState(room, clients);
}

/**
 * Handle client disconnect — mark player as disconnected and start grace timer.
 */
function handleDisconnect(ws) {
  const client = clients.get(ws);
  if (!client?.roomCode) return;

  const room = rooms.get(client.roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.id === client.id);
  if (!player) return;

  player.connected = false;
  room.lastActivityAt = Date.now();
  broadcastLog(room, clients, `${player.name} disconnected.`);
  broadcastState(room, clients);

  // Start grace timer for this player
  const playerIndex = room.players.indexOf(player);
  const timers = getRoomTimers(client.roomCode);

  // Replace any existing timer for this player
  if (timers.has(playerIndex)) clearTimeout(timers.get(playerIndex));

  const timer = setTimeout(() => {
    onGracePeriodExpired(client.roomCode, playerIndex);
  }, DISCONNECT_GRACE_MS);
  timers.set(playerIndex, timer);
}

// Expose so lobbyHandler's rejoin logic can clear the timer.
function handlePlayerReconnected(roomCode, playerIndex) {
  clearDisconnectTimer(roomCode, playerIndex);
  const room = rooms.get(roomCode);
  if (room) room.lastActivityAt = Date.now();
}

onPlayerReconnected(handlePlayerReconnected);

// ============================================================
// HEARTBEAT — detect dead connections
// ============================================================

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeatInterval));

// ============================================================
// ROOM CLEANUP
// Periodically delete finished rooms and rooms that have been
// abandoned (no connected players for a while).
// ============================================================

const cleanupInterval = setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms) {
    const anyConnected = room.players.some((p) => p.connected);

    if (!anyConnected && !room.lastActivityAt) {
      // Track when the room first became fully empty
      room.lastActivityAt = now;
    }
    if (anyConnected) {
      room.lastActivityAt = now;
    }

    const idleFor = now - (room.lastActivityAt || now);

    let shouldDelete = false;
    if (room.state === "finished" && idleFor > FINISHED_ROOM_TTL_MS) {
      shouldDelete = true;
    } else if (!anyConnected && idleFor > ABANDONED_ROOM_TTL_MS) {
      shouldDelete = true;
    }

    if (shouldDelete) {
      // Clear any lingering disconnect timers for this room
      const timers = disconnectTimers.get(code);
      if (timers) {
        for (const t of timers.values()) clearTimeout(t);
        disconnectTimers.delete(code);
      }
      rooms.delete(code);
      console.log(`🧹 Cleaned up room ${code} (state=${room.state}, idle=${Math.round(idleFor / 1000)}s)`);
    }
  }
}, ROOM_CLEANUP_INTERVAL_MS);

wss.on("close", () => clearInterval(cleanupInterval));

// ============================================================
// REST ENDPOINTS
// ============================================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    rooms: rooms.size,
    connections: clients.size,
  });
});

// ============================================================
// START
// ============================================================

server.listen(PORT, () => {
  console.log(`🎩 Monopoly server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
});