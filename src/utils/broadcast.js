const { WebSocket } = require("ws");

// ============================================================
// WEBSOCKET COMMUNICATION LAYER
// ============================================================

/**
 * Send a message to a single client
 */
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Broadcast serialized game state to all clients in a room.
 * Each client receives their own `yourIndex`.
 */
function broadcastState(room, clients) {
  const state = serializeRoom(room);
  for (const [ws, client] of clients) {
    if (client.roomCode === room.code) {
      send(ws, { type: "state", state, yourIndex: client.playerIndex });
    }
  }
}

/**
 * Append a log entry and broadcast to room
 */
function broadcastLog(room, clients, message) {
  room.addLog(message);
  for (const [ws, client] of clients) {
    if (client.roomCode === room.code) {
      send(ws, { type: "log", message });
    }
  }
}

/**
 * Broadcast an arbitrary event to all clients in a room
 */
function broadcastEvent(room, clients, event) {
  for (const [ws, client] of clients) {
    if (client.roomCode === room.code) {
      send(ws, event);
    }
  }
}

/**
 * Serialize room state for client consumption.
 * Strips internal-only fields.
 */
function serializeRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: room.players.map((p) => p.serialize()),
    currentTurn: room.currentTurn,
    diceRoll: room.diceRoll,
    properties: room.properties,
    pendingTrade: room.pendingTrade,
    logs: room.logs.slice(-30),
    bankruptPlayers: room.bankruptPlayers,
    lastCard: room.lastCard,
  };
}

module.exports = { send, broadcastState, broadcastLog, broadcastEvent };
