// ============================================================
// GENERAL UTILITIES
// ============================================================

/**
 * Fisher-Yates shuffle — O(n) in-place
 */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a 5-char alphanumeric room code
 * Excludes ambiguous characters (0/O, 1/I/L)
 */
function generateRoomCode(existingCodes) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return existingCodes.has(code) ? generateRoomCode(existingCodes) : code;
}

module.exports = { shuffle, generateRoomCode };
