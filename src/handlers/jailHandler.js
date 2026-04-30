const { JAIL_FINE } = require("../data/constants");
const { send, broadcastState, broadcastLog } = require("../utils/broadcast");

// ============================================================
// JAIL HANDLERS
// Actions a player can take to leave jail outside of rolling.
// ============================================================

function handlePayJailFine(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;
  if (client.playerIndex !== room.currentTurn) return;

  const player = room.players[client.playerIndex];
  if (!player.inJail) return;
  if (player.money < JAIL_FINE) {
    return send(ws, { type: "error", message: "Not enough money" });
  }

  player.adjustMoney(-JAIL_FINE);
  player.leaveJail();
  broadcastLog(room, clients, `${player.name} paid $${JAIL_FINE} bail`);
  broadcastState(room, clients);
}

function handleUseJailCard(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  if (!player.inJail || !player.hasGetOutOfJailCard) return;

  player.hasGetOutOfJailCard = false;
  player.leaveJail();
  broadcastLog(room, clients, `${player.name} used Get Out of Jail Free!`);
  broadcastState(room, clients);
}

module.exports = { handlePayJailFine, handleUseJailCard };
