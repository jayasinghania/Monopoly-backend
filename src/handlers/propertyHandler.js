const { BOARD } = require("../data/board");
const { send, broadcastState, broadcastLog } = require("../utils/broadcast");

// ============================================================
// PROPERTY MANAGEMENT HANDLERS
// Houses, hotels, mortgage/unmortgage with rule enforcement.
// ============================================================

/**
 * Buy a house on a property.
 * Rules enforced:
 *   - Must own all properties in the color group (monopoly)
 *   - Even build: can't be more than 1 house ahead of others in group
 *   - Max 5 houses (5 = hotel)
 *   - Property must not be mortgaged
 *   - No property in the group can be mortgaged
 */
function handleBuyHouse(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  const propId = msg.propertyId;
  const space = BOARD[propId];

  if (!space || space.type !== "property") {
    return send(ws, { type: "error", message: "Not a property" });
  }

  const prop = room.getProperty(propId);
  if (!prop || prop.owner !== client.playerIndex) {
    return send(ws, { type: "error", message: "You don't own this property" });
  }
  if (prop.mortgaged) {
    return send(ws, { type: "error", message: "Property is mortgaged" });
  }
  if (prop.houses >= 5) {
    return send(ws, { type: "error", message: "Already has a hotel" });
  }

  // Must own entire color group
  const groupSpaces = BOARD.filter((s) => s.group === space.group);
  const ownsAll = groupSpaces.every(
    (s) => room.properties[s.id]?.owner === client.playerIndex
  );
  if (!ownsAll) {
    return send(ws, { type: "error", message: "Must own all properties in the color group" });
  }

  // No mortgaged properties in the group
  const hasMortgaged = groupSpaces.some(
    (s) => room.properties[s.id]?.mortgaged
  );
  if (hasMortgaged) {
    return send(ws, { type: "error", message: "Unmortgage all properties in the group first" });
  }

  // Even build rule: this property can't have more houses than the minimum in the group
  const houseCounts = groupSpaces.map((s) => room.properties[s.id]?.houses || 0);
  const minHouses = Math.min(...houseCounts);
  if (prop.houses > minHouses) {
    return send(ws, { type: "error", message: "Must build evenly across the group" });
  }

  // Afford it?
  if (player.money < space.houseCost) {
    return send(ws, { type: "error", message: "Not enough money" });
  }

  // Build!
  player.adjustMoney(-space.houseCost);
  prop.houses++;

  const label = prop.houses === 5 ? "a hotel" : `house #${prop.houses}`;
  broadcastLog(room, clients, `${player.name} built ${label} on ${space.name} for $${space.houseCost}`);
  broadcastState(room, clients);
}

/**
 * Sell a house from a property.
 * Rules enforced:
 *   - Even sell: can't have fewer houses than others in group
 *   - Refund is half the house cost
 */
function handleSellHouse(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  const propId = msg.propertyId;
  const space = BOARD[propId];

  if (!space || space.type !== "property") return;

  const prop = room.getProperty(propId);
  if (!prop || prop.owner !== client.playerIndex) return;
  if (prop.houses <= 0) {
    return send(ws, { type: "error", message: "No houses to sell" });
  }

  // Even sell rule: can't sell if this property has fewer houses than the max in group
  const groupSpaces = BOARD.filter((s) => s.group === space.group);
  const houseCounts = groupSpaces.map((s) => room.properties[s.id]?.houses || 0);
  const maxHouses = Math.max(...houseCounts);
  if (prop.houses < maxHouses) {
    return send(ws, { type: "error", message: "Must sell evenly across the group" });
  }

  // Sell
  prop.houses--;
  const refund = Math.floor(space.houseCost / 2);
  player.adjustMoney(refund);

  broadcastLog(room, clients, `${player.name} sold a house on ${space.name} for $${refund}`);
  broadcastState(room, clients);
}

/**
 * Mortgage a property.
 * Rules: no houses on the property, receive half the property price.
 */
function handleMortgage(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  const propId = msg.propertyId;
  const space = BOARD[propId];

  if (!space) return;

  const prop = room.getProperty(propId);
  if (!prop || prop.owner !== client.playerIndex) {
    return send(ws, { type: "error", message: "You don't own this property" });
  }
  if (prop.mortgaged) {
    return send(ws, { type: "error", message: "Already mortgaged" });
  }
  if (prop.houses > 0) {
    return send(ws, { type: "error", message: "Sell all houses first" });
  }

  // Check if any property in the group has houses (can't mortgage if group has houses)
  if (space.type === "property") {
    const groupSpaces = BOARD.filter((s) => s.group === space.group);
    const groupHasHouses = groupSpaces.some(
      (s) => room.properties[s.id]?.houses > 0
    );
    if (groupHasHouses) {
      return send(ws, { type: "error", message: "Sell all houses in the color group first" });
    }
  }

  prop.mortgaged = true;
  const mortgageValue = Math.floor(space.price / 2);
  player.adjustMoney(mortgageValue);

  broadcastLog(room, clients, `${player.name} mortgaged ${space.name} for $${mortgageValue}`);
  broadcastState(room, clients);
}

/**
 * Unmortgage a property.
 * Cost: mortgage value + 10% interest.
 */
function handleUnmortgage(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  const propId = msg.propertyId;
  const space = BOARD[propId];

  if (!space) return;

  const prop = room.getProperty(propId);
  if (!prop || prop.owner !== client.playerIndex) {
    return send(ws, { type: "error", message: "You don't own this property" });
  }
  if (!prop.mortgaged) {
    return send(ws, { type: "error", message: "Property isn't mortgaged" });
  }

  const cost = Math.floor(space.price / 2 * 1.1); // 10% interest
  if (player.money < cost) {
    return send(ws, { type: "error", message: `Need $${cost} to unmortgage` });
  }

  prop.mortgaged = false;
  player.adjustMoney(-cost);

  broadcastLog(room, clients, `${player.name} unmortgaged ${space.name} for $${cost}`);
  broadcastState(room, clients);
}

module.exports = {
  handleBuyHouse,
  handleSellHouse,
  handleMortgage,
  handleUnmortgage,
};
