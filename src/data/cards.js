// ============================================================
// CHANCE CARDS — 16 cards
// ============================================================

const CHANCE_CARDS = [
  { text: "Advance to GO. Collect $200.", action: "moveTo", dest: 0 },
  { text: "Advance to Illinois Avenue.", action: "moveTo", dest: 24 },
  { text: "Advance to St. Charles Place.", action: "moveTo", dest: 11 },
  { text: "Advance to nearest Railroad. Pay owner twice.", action: "nearestRailroad" },
  { text: "Advance to nearest Utility. Pay 10× dice.", action: "nearestUtility" },
  { text: "Bank pays you dividend of $50.", action: "receive", amount: 50 },
  { text: "Get Out of Jail Free.", action: "getOutOfJail" },
  { text: "Go back 3 spaces.", action: "moveBack", spaces: 3 },
  { text: "Go to Jail. Do not pass GO.", action: "goToJail" },
  { text: "Repairs: $25/house, $100/hotel.", action: "repairs", perHouse: 25, perHotel: 100 },
  { text: "Pay poor tax of $15.", action: "pay", amount: 15 },
  { text: "Take a trip to Reading Railroad.", action: "moveTo", dest: 5 },
  { text: "Advance to Boardwalk.", action: "moveTo", dest: 39 },
  { text: "Chairman of the Board. Pay each player $50.", action: "payEach", amount: 50 },
  { text: "Building loan matures. Collect $150.", action: "receive", amount: 150 },
  { text: "You won a crossword competition. Collect $100.", action: "receive", amount: 100 },
];

// ============================================================
// COMMUNITY CHEST CARDS — 16 cards
// ============================================================

const COMMUNITY_CARDS = [
  { text: "Advance to GO. Collect $200.", action: "moveTo", dest: 0 },
  { text: "Bank error in your favor. Collect $200.", action: "receive", amount: 200 },
  { text: "Doctor's fee. Pay $50.", action: "pay", amount: 50 },
  { text: "From sale of stock you get $50.", action: "receive", amount: 50 },
  { text: "Get Out of Jail Free.", action: "getOutOfJail" },
  { text: "Go to Jail. Do not pass GO.", action: "goToJail" },
  { text: "Holiday fund matures. Receive $100.", action: "receive", amount: 100 },
  { text: "Income tax refund. Collect $20.", action: "receive", amount: 20 },
  { text: "It's your birthday. Collect $10 from each player.", action: "collectEach", amount: 10 },
  { text: "Life insurance matures. Collect $100.", action: "receive", amount: 100 },
  { text: "Hospital fees. Pay $100.", action: "pay", amount: 100 },
  { text: "School fees. Pay $50.", action: "pay", amount: 50 },
  { text: "Consultancy fee. Receive $25.", action: "receive", amount: 25 },
  { text: "Street repairs: $40/house, $115/hotel.", action: "repairs", perHouse: 40, perHotel: 115 },
  { text: "Second prize in beauty contest. Collect $10.", action: "receive", amount: 10 },
  { text: "You inherit $100.", action: "receive", amount: 100 },
];

module.exports = { CHANCE_CARDS, COMMUNITY_CARDS };
