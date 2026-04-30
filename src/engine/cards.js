const { BOARD, RAILROAD_IDS, UTILITY_IDS } = require("../data/board");
const { checkBankruptcy } = require("./bankruptcy");

// ============================================================
// CARD ENGINE
// Draws from shuffled decks and executes card actions.
// Card actions can trigger movement, payments, jail, repairs.
// ============================================================

/**
 * Draw a card from the appropriate deck and execute it.
 */
function drawAndExecuteCard(room, player, type, broadcast) {
  const card = type === "chance" ? room.drawChance() : room.drawCommunity();

  room.lastCard = { cardType: type, card };
  broadcast.log(room, `${player.name} drew ${type}: "${card.text}"`);
  broadcast.event(room, { type: "cardDrawn", cardType: type, card });

  executeCard(room, player, card, broadcast);
}

/**
 * Execute a card's action. This is the core dispatcher.
 *
 * Actions: moveTo, receive, pay, goToJail, getOutOfJail,
 *          moveBack, payEach, collectEach, repairs,
 *          nearestRailroad, nearestUtility
 */
function executeCard(room, player, card, broadcast) {
  const pi = room.getPlayerIndex(player);

  // Import movement lazily to avoid circular dependency
  const { movePlayerTo } = require("./movement");

  switch (card.action) {
    case "moveTo":
      movePlayerTo(room, player, card.dest, broadcast);
      break;

    case "receive":
      player.adjustMoney(card.amount);
      break;

    case "pay":
      player.adjustMoney(-card.amount);
      if (player.money < 0) checkBankruptcy(room, player, null, broadcast);
      break;

    case "goToJail":
      player.goToJail();
      broadcast.log(room, `${player.name} went to Jail!`);
      break;

    case "getOutOfJail":
      player.hasGetOutOfJailCard = true;
      break;

    case "moveBack":
      player.position = (player.position - card.spaces + 40) % 40;
      const { resolveSpace } = require("./movement");
      resolveSpace(room, player, broadcast);
      break;

    case "payEach":
      executePayEach(room, player, pi, card.amount, broadcast);
      break;

    case "collectEach":
      executeCollectEach(room, player, pi, card.amount, broadcast);
      break;

    case "repairs":
      executeRepairs(room, player, pi, card, broadcast);
      break;

    case "nearestRailroad":
      executeNearestRailroad(room, player, pi, broadcast);
      break;

    case "nearestUtility":
      executeNearestUtility(room, player, pi, broadcast);
      break;
  }
}

// ----------------------------------------------------------
// ACTION EXECUTORS
// ----------------------------------------------------------

function executePayEach(room, player, pi, amount, broadcast) {
  const others = room.players.filter((p, i) => !p.bankrupt && i !== pi);
  player.adjustMoney(-amount * others.length);
  others.forEach((p) => p.adjustMoney(amount));
  if (player.money < 0) checkBankruptcy(room, player, null, broadcast);
}

function executeCollectEach(room, player, pi, amount, broadcast) {
  const payers = room.players.filter((p, i) => !p.bankrupt && i !== pi);
  payers.forEach((p) => p.adjustMoney(-amount));
  player.adjustMoney(amount * payers.length);
}

function executeRepairs(room, player, pi, card, broadcast) {
  let cost = 0;
  for (const [propId, prop] of Object.entries(room.properties)) {
    if (prop.owner === pi) {
      cost += prop.houses === 5 ? card.perHotel : card.perHouse * prop.houses;
    }
  }
  player.adjustMoney(-cost);
  if (cost > 0) broadcast.log(room, `${player.name} paid $${cost} in repairs`);
  if (player.money < 0) checkBankruptcy(room, player, null, broadcast);
}

function executeNearestRailroad(room, player, pi, broadcast) {
  const nearest = RAILROAD_IDS.find((r) => r > player.position) || RAILROAD_IDS[0];
  const { movePlayerTo } = require("./movement");
  movePlayerTo(room, player, nearest, broadcast);

  const prop = room.getProperty(nearest);
  if (prop && prop.owner !== pi && !prop.mortgaged) {
    const owner = room.players[prop.owner];
    const owned = RAILROAD_IDS.filter(
      (id) => room.properties[id]?.owner === prop.owner
    ).length;
    const rent = 25 * Math.pow(2, owned - 1) * 2; // double rent
    player.adjustMoney(-rent);
    owner.adjustMoney(rent);
    broadcast.log(room, `${player.name} paid $${rent} (2×) to ${owner.name}`);
    if (player.money < 0) checkBankruptcy(room, player, owner, broadcast);
  }
}

function executeNearestUtility(room, player, pi, broadcast) {
  const nearest = UTILITY_IDS.find((u) => u > player.position) || UTILITY_IDS[0];
  const { movePlayerTo } = require("./movement");
  movePlayerTo(room, player, nearest, broadcast);

  const prop = room.getProperty(nearest);
  if (prop && prop.owner !== pi && !prop.mortgaged) {
    const owner = room.players[prop.owner];
    const dice = (room.diceRoll?.[0] || 0) + (room.diceRoll?.[1] || 0);
    const rent = dice * 10;
    player.adjustMoney(-rent);
    owner.adjustMoney(rent);
    broadcast.log(room, `${player.name} paid $${rent} to ${owner.name}`);
    if (player.money < 0) checkBankruptcy(room, player, owner, broadcast);
  }
}

module.exports = { drawAndExecuteCard, executeCard };
