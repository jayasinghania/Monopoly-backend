const { shuffle } = require("../utils/helpers");
const { CHANCE_CARDS, COMMUNITY_CARDS } = require("../data/cards");
const { MAX_LOG_SIZE } = require("../data/constants");

// ============================================================
// ROOM MODEL
// State machine: lobby → playing → finished
// Manages players, decks, properties, and game progression.
// ============================================================

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;

    // State machine
    this.state = "lobby"; // lobby | playing | finished

    // Players
    this.players = [];

    // Turn management
    this.currentTurn = 0;
    this.doublesCount = 0;
    this.diceRoll = null;

    // Property ownership: { [spaceId]: { owner, houses, mortgaged } }
    this.properties = {};

    // Card decks (shuffled indices)
    this.chanceDeck = this._freshDeck(CHANCE_CARDS.length);
    this.communityDeck = this._freshDeck(COMMUNITY_CARDS.length);

    // Trading
    this.pendingTrade = null;

    // UI state
    this.lastCard = null;

    // Event log
    this.logs = [];
    this.bankruptPlayers = [];
  }

  // ----------------------------------------------------------
  // STATE TRANSITIONS
  // ----------------------------------------------------------

  startGame() {
    this.state = "playing";
    this.currentTurn = 0;
    this.players.forEach((p) => p.initForGame());
  }

  finishGame() {
    this.state = "finished";
  }

  // ----------------------------------------------------------
  // TURN MANAGEMENT
  // ----------------------------------------------------------

  getCurrentPlayer() {
    return this.players[this.currentTurn];
  }

  advanceTurn() {
    const current = this.getCurrentPlayer();
    current.resetTurnState();
    this.doublesCount = 0;
    this.lastCard = null;
    this.diceRoll = null;

    // Find next non-bankrupt player
    let next = (this.currentTurn + 1) % this.players.length;
    let guard = 0;
    while (this.players[next].bankrupt && guard < this.players.length) {
      next = (next + 1) % this.players.length;
      guard++;
    }
    this.currentTurn = next;
  }

  // ----------------------------------------------------------
  // DECK MANAGEMENT
  // ----------------------------------------------------------

  drawChance() {
    if (this.chanceDeck.length === 0) {
      this.chanceDeck = this._freshDeck(CHANCE_CARDS.length);
    }
    const idx = this.chanceDeck.shift();
    return CHANCE_CARDS[idx];
  }

  drawCommunity() {
    if (this.communityDeck.length === 0) {
      this.communityDeck = this._freshDeck(COMMUNITY_CARDS.length);
    }
    const idx = this.communityDeck.shift();
    return COMMUNITY_CARDS[idx];
  }

  _freshDeck(size) {
    return shuffle([...Array(size).keys()]);
  }

  // ----------------------------------------------------------
  // PROPERTY MANAGEMENT
  // ----------------------------------------------------------

  getProperty(spaceId) {
    return this.properties[spaceId] || null;
  }

  setProperty(spaceId, ownerIndex) {
    this.properties[spaceId] = {
      owner: ownerIndex,
      houses: 0,
      mortgaged: false,
    };
  }

  removeProperty(spaceId) {
    delete this.properties[spaceId];
  }

  /**
   * Get all properties owned by a player index
   */
  getPlayerProperties(playerIndex) {
    const result = [];
    for (const [id, prop] of Object.entries(this.properties)) {
      if (prop.owner === playerIndex) {
        result.push({ id: Number(id), ...prop });
      }
    }
    return result;
  }

  // ----------------------------------------------------------
  // LOGGING
  // ----------------------------------------------------------

  addLog(message) {
    this.logs.push({ text: message, timestamp: Date.now() });
    if (this.logs.length > MAX_LOG_SIZE) this.logs.shift();
  }

  // ----------------------------------------------------------
  // PLAYER LOOKUP
  // ----------------------------------------------------------

  getPlayerIndex(player) {
    return this.players.indexOf(player);
  }

  getActivePlayers() {
    return this.players.filter((p) => !p.bankrupt);
  }

  getActivePlayerCount() {
    return this.players.filter((p) => !p.bankrupt).length;
  }
}

module.exports = Room;
