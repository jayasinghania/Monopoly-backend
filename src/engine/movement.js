const { BOARD } = require("../data/board");
const { GO_SALARY } = require("../data/constants");
const { calculateRent } = require("./rent");
const { drawAndExecuteCard } = require("./cards");
const { checkBankruptcy } = require("./bankruptcy");

// ============================================================
// MOVEMENT ENGINE
// Handles player movement, GO detection, and space resolution.
// ============================================================

/**
 * Move player forward by `steps` spaces.
 * Handles passing GO.
 */
function movePlayer(room, player, steps, broadcast) {
  const oldPos = player.position;
  player.position = (oldPos + steps) % 40;

  if (player.position <= oldPos && steps > 0) {
    player.adjustMoney(GO_SALARY);
    broadcast.log(room, `${player.name} passed GO — collected $${GO_SALARY}`);
  }

  resolveSpace(room, player, broadcast);
}

/**
 * Move player to an absolute position.
 * Collects GO salary if passing (except when going to jail at pos 10).
 */
function movePlayerTo(room, player, dest, broadcast) {
  const oldPos = player.position;
  if (dest !== 10 && dest < oldPos) {
    player.adjustMoney(GO_SALARY);
    broadcast.log(room, `${player.name} passed GO — collected $${GO_SALARY}`);
  }
  player.position = dest;
  resolveSpace(room, player, broadcast);
}

/**
 * Resolve landing on a space — property, tax, jail, cards.
 */
function resolveSpace(room, player, broadcast) {
  const space = BOARD[player.position];

  switch (space.type) {
    case "property":
    case "railroad":
    case "utility":
      resolvePropertySpace(room, player, space, broadcast);
      break;

    case "tax":
      player.adjustMoney(-space.amount);
      broadcast.log(room, `${player.name} paid $${space.amount} — ${space.name}`);
      if (player.money < 0) checkBankruptcy(room, player, null, broadcast);
      break;

    case "goToJail":
      player.goToJail();
      broadcast.log(room, `${player.name} went to Jail!`);
      break;

    case "chance":
      drawAndExecuteCard(room, player, "chance", broadcast);
      break;

    case "community":
      drawAndExecuteCard(room, player, "community", broadcast);
      break;

    default:
      // go, jail (visiting), freeParking — no action
      break;
  }
}

/**
 * Handle landing on a property/railroad/utility.
 * If unowned, offer to buy. If owned by another, charge rent.
 */
function resolvePropertySpace(room, player, space, broadcast) {
  const prop = room.getProperty(space.id);
  const pi = room.getPlayerIndex(player);

  if (!prop) {
    // Unowned — offer to buy if affordable
    if (player.money >= space.price) {
      player.pendingAction = "buy";
    }
    return;
  }

  // Own property — no action
  if (prop.owner === pi) return;

  // Mortgaged — no rent
  if (prop.mortgaged) return;

  // Owner is bankrupt — no rent
  const owner = room.players[prop.owner];
  if (owner.bankrupt) return;

  // Charge rent
  const rent = calculateRent(room, space, prop);
  player.adjustMoney(-rent);
  owner.adjustMoney(rent);
  broadcast.log(room, `${player.name} paid $${rent} rent to ${owner.name} for ${space.name}`);

  if (player.money < 0) {
    checkBankruptcy(room, player, owner, broadcast);
  }
}

module.exports = { movePlayer, movePlayerTo, resolveSpace };
