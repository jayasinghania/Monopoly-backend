// ============================================================
// LIFECYCLE EVENTS
// Shared callbacks between index.js and handlers, so handlers
// can notify the connection lifecycle (timers, cleanup, etc.)
// without circular require()s.
// ============================================================

const listeners = {
  playerReconnected: [],
};

function onPlayerReconnected(fn) {
  listeners.playerReconnected.push(fn);
}

function emitPlayerReconnected(roomCode, playerIndex) {
  for (const fn of listeners.playerReconnected) {
    try {
      fn(roomCode, playerIndex);
    } catch (err) {
      console.error("playerReconnected listener error:", err);
    }
  }
}

module.exports = { onPlayerReconnected, emitPlayerReconnected };