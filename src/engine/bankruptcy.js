const { BOARD } = require("../data/board");

// ============================================================
// BANKRUPTCY ENGINE
// Determines if a player is truly bankrupt or can raise funds.
// Handles property transfer to creditor or bank.
// Triggers game-over when only 1 player remains.
// ============================================================

/**
 * Check if a player with negative money is bankrupt.
 * A player is bankrupt only if they cannot raise enough money
 * through selling houses and mortgaging properties.
 *
 * @param {Room} room
 * @param {Player} player - The player who may be bankrupt
 * @param {Player|null} creditor - Who they owe (null = bank)
 * @param {object} broadcast - { log, event, state }
 */
function checkBankruptcy(room, player, creditor, broadcast) {
  const pi = room.getPlayerIndex(player);
  const raisable = calculateRaisableFunds(room, pi);

  if (player.money + raisable >= 0) {
    broadcast.log(room, `⚠️ ${player.name} is low on funds! Sell/mortgage to stay alive.`);
    return;
  }

  // Truly bankrupt
  declareBankruptcy(room, player, pi, creditor, broadcast);
}

/**
 * Calculate how much money a player could raise by selling
 * all houses and mortgaging all properties.
 */
function calculateRaisableFunds(room, playerIndex) {
  let total = 0;
  for (const [propId, prop] of Object.entries(room.properties)) {
    if (prop.owner === playerIndex) {
      const space = BOARD[propId];
      if (prop.houses > 0) {
        total += prop.houses * Math.floor(space.houseCost / 2);
      }
      if (!prop.mortgaged) {
        total += Math.floor(space.price / 2);
      }
    }
  }
  return total;
}

/**
 * Execute bankruptcy — transfer assets and check for game end.
 */
function declareBankruptcy(room, player, pi, creditor, broadcast) {
  player.declareBankrupt();
  room.bankruptPlayers.push(pi);
  broadcast.log(room, `💀 ${player.name} went BANKRUPT!`);

  // Transfer properties
  for (const [propId, prop] of Object.entries(room.properties)) {
    if (prop.owner === pi) {
      if (creditor) {
        // Transfer to creditor, but remove houses
        prop.owner = room.getPlayerIndex(creditor);
        prop.houses = 0;
      } else {
        // Bank gets it — remove from game
        room.removeProperty(propId);
      }
    }
  }

  // Check if game is over
  if (room.getActivePlayerCount() <= 1) {
    endGame(room, broadcast);
  }
}

/**
 * End the game and calculate final scores.
 * Scores = cash + property values + house/hotel values.
 * Sorted: non-bankrupt first by net worth, then bankrupt.
 */
function endGame(room, broadcast) {
  room.finishGame();

  const scores = room.players.map((p, i) => {
    let netWorth = p.money;
    for (const [propId, prop] of Object.entries(room.properties)) {
      if (prop.owner === i) {
        netWorth += BOARD[propId].price;
        if (prop.houses > 0) {
          netWorth += prop.houses * (BOARD[propId].houseCost || 0);
        }
      }
    }
    return {
      index: i,
      name: p.name,
      token: p.token,
      money: p.money,
      netWorth,
      bankrupt: p.bankrupt,
    };
  });

  scores.sort((a, b) => {
    if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
    return b.netWorth - a.netWorth;
  });

  broadcast.log(room, `🏆 GAME OVER! Winner: ${scores[0].name} ($${scores[0].netWorth})`);
  if (scores[1]) {
    broadcast.log(room, `🥈 Runner-up: ${scores[1].name} ($${scores[1].netWorth})`);
  }
  broadcast.event(room, { type: "gameOver", scores });
}

module.exports = { checkBankruptcy, calculateRaisableFunds, endGame };
