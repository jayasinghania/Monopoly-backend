const { send, broadcastState, broadcastLog } = require("../utils/broadcast");
const { BOARD } = require("../data/board");

// ============================================================
// TRADE HANDLERS
// Player-to-player trading of properties and/or money.
// Only one trade can be pending at a time per room.
//
// Trade structure:
// {
//   from: playerIndex,
//   to: playerIndex,
//   offerProperties: [propId, ...],
//   offerMoney: number,
//   requestProperties: [propId, ...],
//   requestMoney: number,
// }
// ============================================================

/**
 * Propose a trade to another player.
 * Validates ownership, no houses on traded properties, sufficient funds.
 */
function handleProposeTrade(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  if (room.pendingTrade) {
    return send(ws, { type: "error", message: "A trade is already pending" });
  }

  const fromIndex = client.playerIndex;
  const toIndex = msg.toPlayer;

  // Validate target player
  if (toIndex === fromIndex) {
    return send(ws, { type: "error", message: "Can't trade with yourself" });
  }
  if (!room.players[toIndex] || room.players[toIndex].bankrupt) {
    return send(ws, { type: "error", message: "Invalid player" });
  }

  const offerProperties = msg.offerProperties || [];
  const offerMoney = Math.max(0, parseInt(msg.offerMoney) || 0);
  const requestProperties = msg.requestProperties || [];
  const requestMoney = Math.max(0, parseInt(msg.requestMoney) || 0);

  // Must offer or request something
  if (
    offerProperties.length === 0 &&
    offerMoney === 0 &&
    requestProperties.length === 0 &&
    requestMoney === 0
  ) {
    return send(ws, { type: "error", message: "Trade must include something" });
  }

  // Validate offered properties
  for (const propId of offerProperties) {
    const prop = room.getProperty(propId);
    if (!prop || prop.owner !== fromIndex) {
      return send(ws, { type: "error", message: `You don't own property ${propId}` });
    }
    if (prop.houses > 0) {
      return send(ws, { type: "error", message: `Sell houses on ${BOARD[propId].name} before trading` });
    }
  }

  // Validate requested properties
  for (const propId of requestProperties) {
    const prop = room.getProperty(propId);
    if (!prop || prop.owner !== toIndex) {
      return send(ws, { type: "error", message: `Target doesn't own property ${propId}` });
    }
    if (prop.houses > 0) {
      return send(ws, { type: "error", message: `${BOARD[propId].name} has houses — can't trade` });
    }
  }

  // Validate money
  const fromPlayer = room.players[fromIndex];
  const toPlayer = room.players[toIndex];

  if (offerMoney > fromPlayer.money) {
    return send(ws, { type: "error", message: "You don't have enough money to offer" });
  }

  room.pendingTrade = {
    from: fromIndex,
    to: toIndex,
    offerProperties,
    offerMoney,
    requestProperties,
    requestMoney,
  };

  const fromName = fromPlayer.name;
  const toName = toPlayer.name;

  // Build a readable trade summary
  const offerParts = [];
  if (offerProperties.length > 0) {
    offerParts.push(offerProperties.map((id) => BOARD[id].name).join(", "));
  }
  if (offerMoney > 0) offerParts.push(`$${offerMoney}`);

  const requestParts = [];
  if (requestProperties.length > 0) {
    requestParts.push(requestProperties.map((id) => BOARD[id].name).join(", "));
  }
  if (requestMoney > 0) requestParts.push(`$${requestMoney}`);

  broadcastLog(
    room,
    clients,
    `${fromName} proposed a trade to ${toName}: offering ${offerParts.join(" + ") || "nothing"} for ${requestParts.join(" + ") || "nothing"}`
  );
  broadcastState(room, clients);
}

/**
 * Accept a pending trade. Only the target player can accept.
 */
function handleAcceptTrade(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || !room.pendingTrade) return;

  const trade = room.pendingTrade;
  if (client.playerIndex !== trade.to) {
    return send(ws, { type: "error", message: "This trade isn't for you" });
  }

  const fromPlayer = room.players[trade.from];
  const toPlayer = room.players[trade.to];

  // Re-validate money (could have changed since proposal)
  if (trade.offerMoney > fromPlayer.money) {
    broadcastLog(room, clients, `Trade failed — ${fromPlayer.name} can no longer afford it`);
    room.pendingTrade = null;
    broadcastState(room, clients);
    return;
  }
  if (trade.requestMoney > toPlayer.money) {
    broadcastLog(room, clients, `Trade failed — ${toPlayer.name} can no longer afford it`);
    room.pendingTrade = null;
    broadcastState(room, clients);
    return;
  }

  // Execute trade

  // Transfer money
  fromPlayer.adjustMoney(-trade.offerMoney + trade.requestMoney);
  toPlayer.adjustMoney(trade.offerMoney - trade.requestMoney);

  // Transfer offered properties (from → to)
  for (const propId of trade.offerProperties) {
    const prop = room.getProperty(propId);
    if (prop) prop.owner = trade.to;
  }

  // Transfer requested properties (to → from)
  for (const propId of trade.requestProperties) {
    const prop = room.getProperty(propId);
    if (prop) prop.owner = trade.from;
  }

  broadcastLog(room, clients, `✅ ${toPlayer.name} accepted the trade with ${fromPlayer.name}!`);
  room.pendingTrade = null;
  broadcastState(room, clients);
}

/**
 * Reject a pending trade. Only the target player can reject.
 */
function handleRejectTrade(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || !room.pendingTrade) return;

  if (client.playerIndex !== room.pendingTrade.to) {
    return send(ws, { type: "error", message: "This trade isn't for you" });
  }

  const toName = room.players[room.pendingTrade.to].name;
  broadcastLog(room, clients, `❌ ${toName} rejected the trade`);
  room.pendingTrade = null;
  broadcastState(room, clients);
}

/**
 * Cancel a pending trade. Only the proposer can cancel.
 */
function handleCancelTrade(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || !room.pendingTrade) return;

  if (client.playerIndex !== room.pendingTrade.from) {
    return send(ws, { type: "error", message: "Only the proposer can cancel" });
  }

  broadcastLog(room, clients, `Trade cancelled`);
  room.pendingTrade = null;
  broadcastState(room, clients);
}

module.exports = {
  handleProposeTrade,
  handleAcceptTrade,
  handleRejectTrade,
  handleCancelTrade,
};
