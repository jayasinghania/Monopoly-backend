const express = require("express");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 4000;

// ============================================================
// GAME TOKENS
// ============================================================
const AVAILABLE_TOKENS = ["car", "hat", "dog", "iron", "ship", "boot"];

// ============================================================
// ROOM MANAGEMENT
// ============================================================
const rooms = new Map();
const clients = new Map(); // ws -> { id, roomCode, playerIndex }

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateRoomCode() : code;
}

function makePlayer(id, name) {
  return {
    id,
    name,
    token: null,
    ready: false,
    connected: true,
    money: 1500,
    position: 0,
    inJail: false,
    jailTurns: 0,
    hasGetOutOfJailCard: false,
    bankrupt: false,
    hasRolled: false,
    rolledDoubles: false,
    pendingAction: null,
  };
}

function createRoom(hostId, hostName) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,
    state: "lobby",
    players: [],
    currentTurn: 0,
    doublesCount: 0,
    diceRoll: null,
    properties: {},
    chanceDeck: [],
    communityDeck: [],
    pendingTrade: null,
    logs: [],
    bankruptPlayers: [],
  };
  rooms.set(code, room);
  return room;
}

// ============================================================
// COMMUNICATION
// ============================================================
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastState(room) {
  const state = sanitizeRoom(room);
  for (const [ws, client] of clients) {
    if (client.roomCode === room.code) {
      send(ws, { type: "state", state, yourIndex: client.playerIndex });
    }
  }
}

function broadcastLog(room, message) {
  room.logs.push({ text: message, timestamp: Date.now() });
  if (room.logs.length > 100) room.logs.shift();
  for (const [ws, client] of clients) {
    if (client.roomCode === room.code) {
      send(ws, { type: "log", message });
    }
  }
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      token: p.token,
      ready: p.ready,
      connected: p.connected,
      money: p.money,
      position: p.position,
      inJail: p.inJail,
      jailTurns: p.jailTurns,
      hasGetOutOfJailCard: p.hasGetOutOfJailCard,
      bankrupt: p.bankrupt,
      hasRolled: p.hasRolled,
      pendingAction: p.pendingAction,
    })),
    currentTurn: room.currentTurn,
    diceRoll: room.diceRoll,
    properties: room.properties,
    pendingTrade: room.pendingTrade,
    logs: room.logs.slice(-30),
    bankruptPlayers: room.bankruptPlayers,
  };
}

// ============================================================
// WEBSOCKET HANDLERS
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
    handleMessage(ws, msg);
  });

  ws.on("close", () => {
    const client = clients.get(ws);
    if (client?.roomCode) {
      const room = rooms.get(client.roomCode);
      if (room) {
        const player = room.players.find((p) => p.id === client.id);
        if (player) {
          player.connected = false;
          broadcastState(room);
          broadcastLog(room, `${player.name} disconnected.`);
        }
      }
    }
    clients.delete(ws);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
});

// Heartbeat interval
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(heartbeat));

// ============================================================
// MESSAGE ROUTER
// ============================================================
function handleMessage(ws, msg) {
  const client = clients.get(ws);
  if (!client) return;

  const handlers = {
    createRoom: handleCreateRoom,
    joinRoom: handleJoinRoom,
    selectToken: handleSelectToken,
    toggleReady: handleToggleReady,
    startGame: handleStartGame,
    // Phase 2+ handlers will be added here
  };

  const handler = handlers[msg.type];
  if (handler) {
    handler(ws, client, msg);
  }
}

// ============================================================
// LOBBY HANDLERS
// ============================================================
function handleCreateRoom(ws, client, msg) {
  const name = (msg.name || "").trim().slice(0, 20);
  if (!name) return send(ws, { type: "error", message: "Name is required" });

  const room = createRoom(client.id, name);
  const player = makePlayer(client.id, name);
  room.players.push(player);

  client.roomCode = room.code;
  client.playerIndex = 0;

  send(ws, { type: "roomCreated", code: room.code });
  broadcastLog(room, `${name} created the room.`);
  broadcastState(room);
}

function handleJoinRoom(ws, client, msg) {
  const code = (msg.code || "").toUpperCase().trim();
  const name = (msg.name || "").trim().slice(0, 20);

  if (!name) return send(ws, { type: "error", message: "Name is required" });
  if (!code) return send(ws, { type: "error", message: "Room code is required" });

  const room = rooms.get(code);
  if (!room) return send(ws, { type: "error", message: "Room not found" });
  if (room.state !== "lobby") {
    // Check if reconnecting
    const existing = room.players.find((p) => p.name === name && !p.connected);
    if (existing) {
      existing.connected = true;
      existing.id = client.id;
      client.roomCode = code;
      client.playerIndex = room.players.indexOf(existing);
      broadcastLog(room, `${name} reconnected!`);
      broadcastState(room);
      return;
    }
    return send(ws, { type: "error", message: "Game already in progress" });
  }
  if (room.players.length >= 6) return send(ws, { type: "error", message: "Room full (max 6)" });
  if (room.players.some((p) => p.name === name)) return send(ws, { type: "error", message: "Name already taken" });

  const player = makePlayer(client.id, name);
  room.players.push(player);

  client.roomCode = code;
  client.playerIndex = room.players.length - 1;

  send(ws, { type: "roomJoined", code });
  broadcastLog(room, `${name} joined the room.`);
  broadcastState(room);
}

function handleSelectToken(ws, client, msg) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;

  const token = msg.token;
  if (!AVAILABLE_TOKENS.includes(token)) return send(ws, { type: "error", message: "Invalid token" });

  const taken = room.players.some((p, i) => i !== client.playerIndex && p.token === token);
  if (taken) return send(ws, { type: "error", message: "Token already taken" });

  room.players[client.playerIndex].token = token;
  broadcastState(room);
}

function handleToggleReady(ws, client) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;

  const player = room.players[client.playerIndex];
  if (!player.token) return send(ws, { type: "error", message: "Select a token first" });

  player.ready = !player.ready;
  broadcastState(room);
}

function handleStartGame(ws, client) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;
  if (client.id !== room.hostId) return send(ws, { type: "error", message: "Only host can start" });
  if (room.players.length < 2) return send(ws, { type: "error", message: "Need at least 2 players" });
  if (!room.players.every((p) => p.ready)) return send(ws, { type: "error", message: "Not all players ready" });

  room.state = "playing";
  room.currentTurn = 0;
  room.players.forEach((p) => {
    p.money = 1500;
    p.position = 0;
  });

  broadcastLog(room, `Game started! ${room.players[0].name}'s turn.`);
  broadcastState(room);
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    rooms: rooms.size,
    connections: clients.size,
  });
});

// ============================================================
// START
// ============================================================
server.listen(PORT, () => {
  console.log(`🎩 Monopoly server running on port ${PORT}`);
});
