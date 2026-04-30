const { BOARD, RAILROAD_IDS, UTILITY_IDS } = require("../data/board");

// ============================================================
// RENT CALCULATION ENGINE
// Pure functions — no side effects, no state mutation.
// ============================================================

/**
 * Calculate rent for a given space.
 * @param {object} room - Room instance
 * @param {object} space - Board space data
 * @param {object} prop - Property ownership record { owner, houses, mortgaged }
 * @returns {number} Rent amount
 */
function calculateRent(room, space, prop) {
  switch (space.type) {
    case "railroad":
      return calculateRailroadRent(room, prop.owner);
    case "utility":
      return calculateUtilityRent(room, prop.owner);
    case "property":
      return calculatePropertyRent(room, space, prop);
    default:
      return 0;
  }
}

/**
 * Railroad rent scales with number owned: $25, $50, $100, $200
 */
function calculateRailroadRent(room, ownerIndex) {
  const ownedCount = RAILROAD_IDS.filter(
    (id) => room.properties[id]?.owner === ownerIndex && !room.properties[id]?.mortgaged
  ).length;
  return 25 * Math.pow(2, ownedCount - 1);
}

/**
 * Utility rent based on dice roll.
 * 1 utility: 4× dice, 2 utilities: 10× dice
 */
function calculateUtilityRent(room, ownerIndex) {
  const ownedCount = UTILITY_IDS.filter(
    (id) => room.properties[id]?.owner === ownerIndex && !room.properties[id]?.mortgaged
  ).length;
  const diceSum = (room.diceRoll?.[0] || 0) + (room.diceRoll?.[1] || 0);
  return ownedCount === 2 ? diceSum * 10 : diceSum * 4;
}

/**
 * Property rent: base, monopoly (2×), or house/hotel rent
 */
function calculatePropertyRent(room, space, prop) {
  // Houses/hotel override base rent
  if (prop.houses > 0) {
    return space.rent[prop.houses]; // rent[1..5] = 1H..hotel
  }

  // Check for monopoly (own all in group, no mortgages)
  const groupSpaces = BOARD.filter((s) => s.group === space.group);
  const ownsAll = groupSpaces.every(
    (s) => room.properties[s.id]?.owner === prop.owner
  );

  return ownsAll ? space.rent[0] * 2 : space.rent[0];
}

module.exports = { calculateRent, calculateRailroadRent, calculateUtilityRent };
