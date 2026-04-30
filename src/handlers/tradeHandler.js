const { send, broadcastState, broadcastLog } = require("../utils/broadcast");

// ============================================================
// TRADE HANDLERS
// Player-to-player trading: properties and/or money.
// Will be implemented in Phase 5.
// ============================================================

function handleProposeTrade(ws, client, msg, rooms, clients) {
  // TODO: Phase 5
  send(ws, { type: "error", message: "Trading not yet implemented" });
}

function handleAcceptTrade(ws, client, msg, rooms, clients) {
  // TODO: Phase 5
}

function handleRejectTrade(ws, client, msg, rooms, clients) {
  // TODO: Phase 5
}

function handleCancelTrade(ws, client, msg, rooms, clients) {
  // TODO: Phase 5
}

module.exports = {
  handleProposeTrade,
  handleAcceptTrade,
  handleRejectTrade,
  handleCancelTrade,
};
