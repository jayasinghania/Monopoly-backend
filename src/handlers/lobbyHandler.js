const Room = require("../models/Room");
const Player = require("../models/Player");
const { generateRoomCode } = require("../utils/helpers");
const { send, broadcastState, broadcastLog } = require("../utils/broadcast");
const { emitPlayerReconnected } = require("../utils/lifecycle");
const { AVAILABLE_TOKENS, MAX_PLAYERS, MIN_PLAYERS } = require("../data/constants");

// ============================================================
// LOBBY HANDLERS
// Manage room lifecycle before game starts.
// ============================================================

function handleCreateRoom(ws, client, msg, rooms, clients) {
  const name = (msg.name || "").trim().slice(0, 20);
  if (!name) return send(ws, { type: "error", message: "Name is required" });

  const code = generateRoomCode(rooms);
  const room = new Room(code, client.id);
  const player = new Player(client.id, name);
  room.players.push(player);
  rooms.set(code, room);

  client.roomCode = code;
  client.playerIndex = 0;

  send(ws, { type: "roomCreated", code });
  broadcastLog(room, clients, `${name} created the room.`);
  broadcastState(room, clients);
}

function handleJoinRoom(ws, client, msg, rooms, clients) {
  const code = (msg.code || "").toUpperCase().trim();
  const name = (msg.name || "").trim().slice(0, 20);
  if (!name) return send(ws, { type: "error", message: "Name is required" });
  if (!code) return send(ws, { type: "error", message: "Room code is required" });

  const room = rooms.get(code);
  if (!room) return send(ws, { type: "error", message: "Room not found" });

  // Handle reconnection (works in both lobby and in-game).
  // Match by name; allow rejoin even if old socket hasn't been marked disconnected yet
  // (fast reconnects can beat the close event), but only if the previous client is gone
  // or the player is flagged disconnected.
  const existing = room.players.find((p) => p.name === name);
  if (existing) {
    const oldClientStillActive = [...clients.values()].some(
      (c) => c.id === existing.id && c.roomCode === code
    );
    if (!oldClientStillActive || !existing.connected) {
      existing.connected = true;
      existing.id = client.id;
      client.roomCode = code;
      client.playerIndex = room.players.indexOf(existing);
      send(ws, { type: "roomJoined", code });
      broadcastLog(room, clients, `${name} reconnected!`);
      broadcastState(room, clients);
      emitPlayerReconnected(code, client.playerIndex);
      return;
    }
    return send(ws, { type: "error", message: "Name already taken" });
  }

  // New player joining — only allowed in lobby.
  if (room.state !== "lobby") {
    return send(ws, { type: "error", message: "Game already in progress" });
  }

  if (room.players.length >= MAX_PLAYERS) {
    return send(ws, { type: "error", message: `Room full (max ${MAX_PLAYERS})` });
  }

  const player = new Player(client.id, name);
  room.players.push(player);
  client.roomCode = code;
  client.playerIndex = room.players.length - 1;

  send(ws, { type: "roomJoined", code });
  broadcastLog(room, clients, `${name} joined the room.`);
  broadcastState(room, clients);
}

function handleSelectToken(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;

  const token = msg.token;
  if (!AVAILABLE_TOKENS.includes(token)) {
    return send(ws, { type: "error", message: "Invalid token" });
  }

  const taken = room.players.some(
    (p, i) => i !== client.playerIndex && p.token === token
  );
  if (taken) return send(ws, { type: "error", message: "Token already taken" });

  room.players[client.playerIndex].token = token;
  broadcastState(room, clients);
}

function handleToggleReady(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;

  const player = room.players[client.playerIndex];
  if (!player.token) {
    return send(ws, { type: "error", message: "Select a token first" });
  }

  player.ready = !player.ready;
  broadcastState(room, clients);
}

function handleStartGame(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "lobby") return;

  if (client.id !== room.hostId) {
    return send(ws, { type: "error", message: "Only host can start" });
  }
  if (room.players.length < MIN_PLAYERS) {
    return send(ws, { type: "error", message: `Need at least ${MIN_PLAYERS} players` });
  }
  if (!room.players.every((p) => p.ready)) {
    return send(ws, { type: "error", message: "Not all players ready" });
  }

  room.startGame();
  broadcastLog(room, clients, `Game started! ${room.players[0].name}'s turn.`);
  broadcastState(room, clients);
}

module.exports = {
  handleCreateRoom,
  handleJoinRoom,
  handleSelectToken,
  handleToggleReady,
  handleStartGame,
};