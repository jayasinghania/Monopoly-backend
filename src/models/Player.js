const { STARTING_MONEY } = require("../data/constants");

// ============================================================
// PLAYER MODEL
// Encapsulates all player state. Game logic mutates via methods.
// ============================================================

class Player {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.token = null;
    this.ready = false;
    this.connected = true;

    // Game state
    this.money = STARTING_MONEY;
    this.position = 0;
    this.inJail = false;
    this.jailTurns = 0;
    this.hasGetOutOfJailCard = false;
    this.bankrupt = false;

    // Turn state
    this.hasRolled = false;
    this.rolledDoubles = false;
    this.pendingAction = null; // null | "buy"
  }

  /**
   * Reset for game start
   */
  initForGame() {
    this.money = STARTING_MONEY;
    this.position = 0;
    this.inJail = false;
    this.jailTurns = 0;
    this.hasGetOutOfJailCard = false;
    this.bankrupt = false;
    this.hasRolled = false;
    this.rolledDoubles = false;
    this.pendingAction = null;
  }

  /**
   * Reset turn-specific flags for next turn
   */
  resetTurnState() {
    this.hasRolled = false;
    this.rolledDoubles = false;
    this.pendingAction = null;
  }

  /**
   * Adjust money. Returns new balance (can be negative).
   */
  adjustMoney(amount) {
    this.money += amount;
    return this.money;
  }

  /**
   * Send player to jail
   */
  goToJail() {
    this.position = 10;
    this.inJail = true;
    this.jailTurns = 0;
    this.rolledDoubles = false;
  }

  /**
   * Release from jail
   */
  leaveJail() {
    this.inJail = false;
    this.jailTurns = 0;
  }

  /**
   * Mark as bankrupt
   */
  declareBankrupt() {
    this.bankrupt = true;
  }

  /**
   * Serialize for client — strips any server-only internals
   */
  serialize() {
    return {
      id: this.id,
      name: this.name,
      token: this.token,
      ready: this.ready,
      connected: this.connected,
      money: this.money,
      position: this.position,
      inJail: this.inJail,
      jailTurns: this.jailTurns,
      hasGetOutOfJailCard: this.hasGetOutOfJailCard,
      bankrupt: this.bankrupt,
      hasRolled: this.hasRolled,
      pendingAction: this.pendingAction,
    };
  }
}

module.exports = Player;
