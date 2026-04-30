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
  if (handler) {
    handler(ws, client, msg, rooms, clients);
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

/**
 * Handle client disconnect — mark player as disconnected.
 */
function handleDisconnect(ws) {
  const client = clients.get(ws);
  if (!client?.roomCode) return;

  const room = rooms.get(client.roomCode);
  if (!room) return;

  const player = room.players.find((p) => p.id === client.id);
  if (player) {
    player.connected = false;
    broadcastState(room, clients);
    broadcastLog(room, clients, `${player.name} disconnected.`);
  }
}

// ============================================================
// HEARTBEAT — detect dead connections
// ============================================================

const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeatInterval));

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
