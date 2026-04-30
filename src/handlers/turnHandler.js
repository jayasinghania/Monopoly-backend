const { BOARD } = require("../data/board");
const { MAX_DOUBLES_BEFORE_JAIL, JAIL_FINE, MAX_JAIL_TURNS } = require("../data/constants");
const { send, broadcastState, broadcastLog, broadcastEvent } = require("../utils/broadcast");
const { movePlayer } = require("../engine/movement");
const { checkBankruptcy } = require("../engine/bankruptcy");

// ============================================================
// TURN HANDLERS
// Manages the core turn loop: roll → resolve → buy/skip → end.
// ============================================================

/**
 * Create a broadcast context that handlers can pass around.
 * Avoids passing `clients` everywhere.
 */
function makeBroadcast(clients) {
  return {
    log: (room, msg) => broadcastLog(room, clients, msg),
    event: (room, evt) => broadcastEvent(room, clients, evt),
    state: (room) => broadcastState(room, clients),
  };
}

function handleRollDice(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;
  if (client.playerIndex !== room.currentTurn) {
    return send(ws, { type: "error", message: "Not your turn" });
  }

  const player = room.players[client.playerIndex];
  if (player.bankrupt) return;
  if (player.hasRolled && !player.rolledDoubles) {
    return send(ws, { type: "error", message: "Already rolled" });
  }
  if (player.pendingAction) {
    return send(ws, { type: "error", message: "Resolve current action first" });
  }

  const bc = makeBroadcast(clients);

  // Roll dice
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const isDoubles = d1 === d2;
  room.diceRoll = [d1, d2];

  bc.event(room, { type: "diceRolled", dice: [d1, d2], player: client.playerIndex });

  // --- JAIL PATH ---
  if (player.inJail) {
    handleJailRoll(room, player, d1, d2, isDoubles, bc);
    broadcastState(room, clients);
    return;
  }

  // --- DOUBLES TRACKING ---
  if (isDoubles) {
    room.doublesCount++;
    if (room.doublesCount >= MAX_DOUBLES_BEFORE_JAIL) {
      bc.log(room, `${player.name} rolled doubles 3 times — go to jail!`);
      player.goToJail();
      player.hasRolled = true;
      player.rolledDoubles = false;
      room.doublesCount = 0;
      broadcastState(room, clients);
      return;
    }
    player.rolledDoubles = true;
  } else {
    player.rolledDoubles = false;
    room.doublesCount = 0;
  }

  player.hasRolled = true;
  bc.log(room, `${player.name} rolled ${d1}+${d2} = ${d1 + d2}`);
  movePlayer(room, player, d1 + d2, bc);
  broadcastState(room, clients);
}

/**
 * Handle dice roll while in jail.
 * Doubles = escape. 3rd failed attempt = forced $50 fine.
 */
function handleJailRoll(room, player, d1, d2, isDoubles, bc) {
  if (isDoubles) {
    player.leaveJail();
    player.hasRolled = true;
    player.rolledDoubles = false;
    room.doublesCount = 0;
    bc.log(room, `${player.name} rolled doubles and escaped jail!`);
    movePlayer(room, player, d1 + d2, bc);
  } else {
    player.jailTurns++;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      player.adjustMoney(-JAIL_FINE);
      player.leaveJail();
      player.hasRolled = true;
      bc.log(room, `${player.name} paid $${JAIL_FINE} after ${MAX_JAIL_TURNS} turns in jail.`);
      if (player.money < 0) {
        checkBankruptcy(room, player, null, bc);
        return;
      }
      movePlayer(room, player, d1 + d2, bc);
    } else {
      player.hasRolled = true;
      bc.log(room, `${player.name} rolled ${d1}+${d2}. Still in jail. (Turn ${player.jailTurns}/${MAX_JAIL_TURNS})`);
    }
  }
}

function handleBuyProperty(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;
  if (client.playerIndex !== room.currentTurn) return;

  const player = room.players[client.playerIndex];
  const space = BOARD[player.position];

  if (!["property", "railroad", "utility"].includes(space.type)) return;
  if (room.getProperty(space.id)) return;
  if (player.money < space.price) {
    return send(ws, { type: "error", message: "Not enough money" });
  }

  player.adjustMoney(-space.price);
  room.setProperty(space.id, client.playerIndex);
  player.pendingAction = null;

  broadcastLog(room, clients, `${player.name} bought ${space.name} for $${space.price}`);
  broadcastState(room, clients);
}

function handleSkipBuy(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;
  if (client.playerIndex !== room.currentTurn) return;

  room.players[client.playerIndex].pendingAction = null;
  broadcastState(room, clients);
}

function handleEndTurn(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;
  if (client.playerIndex !== room.currentTurn) return;

  const player = room.players[client.playerIndex];

  // Doubles — player rolls again instead of ending
  if (player.rolledDoubles && !player.inJail) {
    player.hasRolled = false;
    player.rolledDoubles = false;
    player.pendingAction = null;
    broadcastLog(room, clients, `${player.name} rolled doubles — roll again!`);
    broadcastState(room, clients);
    return;
  }

  room.advanceTurn();
  broadcastLog(room, clients, `${room.getCurrentPlayer().name}'s turn`);
  broadcastState(room, clients);
}

function handleDismissCard(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room) return;
  room.lastCard = null;
  broadcastState(room, clients);
}

/**
 * Allow a player to voluntarily declare bankruptcy (forfeit).
 * Useful when a player is in debt and doesn't want to keep selling.
 */
function handleDeclareBankruptcy(ws, client, msg, rooms, clients) {
  const room = rooms.get(client.roomCode);
  if (!room || room.state !== "playing") return;

  const player = room.players[client.playerIndex];
  if (player.bankrupt) return;

  const bc = makeBroadcast(clients);
  const { checkBankruptcy, endGame } = require("../engine/bankruptcy");

  player.declareBankrupt();
  room.bankruptPlayers.push(client.playerIndex);
  bc.log(room, `🏳️ ${player.name} forfeited the game!`);

  // Return all properties to bank
  for (const [propId, prop] of Object.entries(room.properties)) {
    if (prop.owner === client.playerIndex) {
      room.removeProperty(propId);
    }
  }

  // If it was their turn, advance
  if (room.currentTurn === client.playerIndex) {
    room.advanceTurn();
    bc.log(room, `${room.getCurrentPlayer().name}'s turn`);
  }

  // Check if game is over
  if (room.getActivePlayerCount() <= 1) {
    endGame(room, bc);
  }

  broadcastState(room, clients);
}

module.exports = {
  handleRollDice,
  handleBuyProperty,
  handleSkipBuy,
  handleEndTurn,
  handleDismissCard,
  handleDeclareBankruptcy,
};
