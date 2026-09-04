// Scoring, straight from the Intel Economy doc's "Final scoring" table:
// banked Intel (earned minus sabotage spend) + a flat per-node-cleared
// bonus + a one-time bonus keyed to the order a team reached the vault
// (1st/2nd/3rd get their own tier, 4th-10th share a tier, 11th+ nothing).

const NODE_CLEARED_BONUS = 5;

function arrivalBonusForRank(rank) {
  if (!rank) return 0;
  if (rank === 1) return 50;
  if (rank === 2) return 35;
  if (rank === 3) return 25;
  if (rank <= 10) return 15;
  return 0;
}

module.exports = { NODE_CLEARED_BONUS, arrivalBonusForRank };
