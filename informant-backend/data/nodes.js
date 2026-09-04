// Node puzzle content and the pure helpers built on top of it — no
// Supabase, no Express, nothing but data and lookups. This is the "answer
// key" file: it never gets sent to the browser as-is (see routes/nodes.js,
// which strips answers before responding).
//
// NOTE: these are the FIXED example instances from the design doc — the
// doc calls for per-team randomization of the surface values (different
// target word for N1, different digit-sum targets for N2, etc.) before
// the real event, to stop teams sitting near each other from comparing
// answers. Shipping the fixed instances below is fine for a dry run /
// small event; revisit before a large one.

const VARIANT_COUNT = 8;

// Standard International Morse Code, letters only (every Node 6 answer is
// a plain word) - used to derive Node 6's blink pattern straight from its
// answer, so there's no separate audio asset to keep in sync with the
// answer key anymore. Same security property as the old .wav files: the
// browser gets dots/dashes, never the word itself, and turning one back
// into the other still takes the same manual decode work either way.
const MORSE_CODE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
  G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
  S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
};

// "DECOY" -> "-.. . -.-. --- -.--" (letters separated by a single space,
// so the frontend can pause longer between letters than between the dots
// and dashes inside one).
function wordToMorsePattern(word) {
  return String(word)
    .toUpperCase()
    .split("")
    .map((ch) => MORSE_CODE[ch] || "")
    .join(" ");
}

// Nodes with a different puzzle per variant. Shard codes and intel stay
// fixed per node id across every variant — only the puzzle content and
// its answer change — since the vault only checks which node numbers a
// team cleared, never which specific instance they solved. 8 variants
// spreads ~30-40 teams into groups of 4-5 per version, enough that teams
// sitting near each other are unlikely to land on the same puzzle.
const VARIANT_NODES = {
  1: {
    shardCode: "H1", intel: 10, variants: [
      { answer: "HEIST", display: "Using A=1...Z=26, decode: 8 - 5 - 9 - 19 - 20" },
      { answer: "AGENT", display: "Using A=1...Z=26, decode: 1 - 7 - 5 - 14 - 20" },
      { answer: "VAULT", display: "Using A=1...Z=26, decode: 22 - 1 - 21 - 12 - 20" },
      { answer: "CIPHER", display: "Using A=1...Z=26, decode: 3 - 9 - 16 - 8 - 5 - 18" },
      { answer: "BROKER", display: "Using A=1...Z=26, decode: 2 - 18 - 15 - 11 - 5 - 18" },
      { answer: "SHADOW", display: "Using A=1...Z=26, decode: 19 - 8 - 1 - 4 - 15 - 23" },
      { answer: "SIGNAL", display: "Using A=1...Z=26, decode: 19 - 9 - 7 - 14 - 1 - 12" },
      { answer: "TARGET", display: "Using A=1...Z=26, decode: 20 - 1 - 18 - 7 - 5 - 20" },
    ]
  },
  2: {
    shardCode: "L2", intel: 15, variants: [
      { answer: "462", display: "Find the 3-digit code: even | digits sum to 12 | first digit = 2x last digit | no digit is zero | all three digits differ." },
      { answer: "612", display: "Find the 3-digit code: even | digits sum to 9 | first digit = 3x last digit | no digit is zero | all three digits differ." },
      { answer: "672", display: "Find the 3-digit code: even | digits sum to 15 | first digit = 3x last digit | no digit is zero | all three digits differ." },
      { answer: "812", display: "Find the 3-digit code: even | digits sum to 11 | first digit = 4x last digit | no digit is zero | all three digits differ." },
      { answer: "854", display: "Find the 3-digit code: even | digits sum to 17 | first digit = 2x last digit | no digit is zero | all three digits differ." },
      { answer: "832", display: "Find the 3-digit code: even | digits sum to 13 | first digit = 4x last digit | no digit is zero | all three digits differ." },
      { answer: "874", display: "Find the 3-digit code: even | digits sum to 19 | first digit = 2x last digit | no digit is zero | all three digits differ." },
      { answer: "682", display: "Find the 3-digit code: even | digits sum to 16 | first digit = 3x last digit | no digit is zero | all three digits differ." },
    ]
  },
  3: {
    shardCode: "P3", intel: 15, variants: [
      { answer: "JUP1207", display: "Format AAABBCC, no spaces: (A) largest planet - first 3 letters. (B) year the Titanic sank - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "MAR6907", display: "Format AAABBCC, no spaces: (A) the red planet - first 3 letters. (B) the year humans first walked on the Moon - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "SAT4507", display: "Format AAABBCC, no spaces: (A) the ringed planet - first 3 letters. (B) the year World War II ended - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "VEN4707", display: "Format AAABBCC, no spaces: (A) the second planet from the sun - first 3 letters. (B) the year India gained independence - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "NEP9107", display: "Format AAABBCC, no spaces: (A) the farthest planet from the sun - first 3 letters. (B) the year the Soviet Union dissolved - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "MER7607", display: "Format AAABBCC, no spaces: (A) the closest planet to the sun - first 3 letters. (B) the year the US Declaration of Independence was signed - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "URA8907", display: "Format AAABBCC, no spaces: (A) the planet that rotates on its side - first 3 letters. (B) the year the Berlin Wall fell - last 2 digits. (C) number of continents - 2 digits." },
      { answer: "EAR9207", display: "Format AAABBCC, no spaces: (A) the planet we're standing on - first 3 letters. (B) the year Columbus reached the Americas - last 2 digits. (C) number of continents - 2 digits." },
    ]
  },
  4: {
    shardCode: "C4", intel: 10, variants: [
      { answer: "CHARMINAR", display: "I stand on four minarets, built by a king who feared the plague. My name simply means 'four towers.' What am I? (one word, no spaces)" },
      { answer: "TAJMAHAL", display: "I am a marble tomb built for a queen, raised out of grief by the king who loved her. What am I? (one word, no spaces)" },
      { answer: "EIFFELTOWER", display: "I was built for a fair, nearly torn down after twenty years, and now no skyline is complete without my shadow. What am I? (one word, no spaces)" },
      { answer: "GREATWALL", display: "I stretch further than any single wall should, built to keep armies out, and I'm barely visible from space. What am I? (one word, no spaces)" },
      { answer: "COLOSSEUM", display: "I once held eighty thousand roaring voices watching combat for sport. My name may come from a giant statue that stood nearby. What am I? (one word, no spaces)" },
      { answer: "STATUEOFLIBERTY", display: "I hold a torch and a tablet, a gift from one nation to another, and I've welcomed millions arriving by sea. What am I? (one word, no spaces)" },
      { answer: "GATEWAYOFINDIA", display: "I was built to welcome a king arriving by sea, and later watched an empire's soldiers leave for the last time. What am I? (one word, no spaces)" },
      { answer: "REDFORT", display: "I am built from sandstone the color of my name, and every year a flag is raised from my ramparts on independence morning. What am I? (one word, no spaces)" },
    ]
  },
  // Placed last (node id 10, right before the vault) on purpose — this is
  // the hardest node in the game, and now that ALL 10 nodes are required
  // to reach the vault (see NEEDED_FOR_VAULT below), every team has to
  // clear it eventually anyway. Putting it last means it's the final gate
  // a team faces rather than something they stumble into mid-run and
  // stall out on early.
  // Intel bumped well above the doc's original 15 to match (still the
  // single richest node in the game) — decoding Morse by hand from the
  // reference table genuinely takes a long time.
  // morse: true - flags this node for the blink-pattern treatment below
  // (getNodeDef derives `pattern` from `answer` for any node with this
  // flag) instead of needing a pre-recorded audio file per variant. No
  // speaker dependency: the signal is a flashing light, not a sound.
  10: {
    shardCode: "S10", intel: 45, morse: true, variants: [
      { answer: "VAULT", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "DECOY", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "GHOST", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "TRACE", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "ECHO", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "PROBE", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "RAVEN", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
      { answer: "CODEX", display: "Watch the light below - it's a word in Morse code. Use the reference table under the player to decode it." },
    ]
  },
  8: {
    shardCode: "M8", intel: 10, variants: [
      { answer: "SECURITY", display: "Unscramble (guards keep it, thieves spend a lifetime trying to break it): URTYCISE" },
      { answer: "FIREWALL", display: "Unscramble (digital or literal, both are built to stop something dangerous getting through): ELRFWLAI" },
      { answer: "PASSCODE", display: "Unscramble (say the right thing and the door simply opens): SOSCADEP" },
      { answer: "STRONGBOX", display: "Unscramble (where the good stuff actually lives): RTSONBGOX" },
      { answer: "BLUEPRINT", display: "Unscramble (every heist starts with one of these): TNRUELIBP" },
      { answer: "SHADOWING", display: "Unscramble (what a good tail does without being noticed): OAHNGISWD" },
      { answer: "LOCKSMITH", display: "Unscramble (knows every tumbler by feel): CIOTHKMLS" },
      { answer: "ENCRYPTED", display: "Unscramble (turned to nonsense until you have the right key): NERCEPTYD" },
    ]
  },
  9: {
    shardCode: "B9", intel: 20, variants: [
      { answer: "2", display: "9 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "3", display: "27 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "4", display: "81 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "2", display: "9 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "3", display: "27 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "4", display: "81 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "2", display: "9 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
      { answer: "3", display: "27 gold bars and a balance scale with two pans. One bar is fake and slightly lighter than the rest. Minimum number of weighings to guarantee finding it?" },
    ]
  },
};

// Fixed nodes - one hardcoded instance for every team, no per-team variant
// (as opposed to VARIANT_NODES above). Nodes 7 and 6 are physical/in-person
// props (a volunteer in gold, a padlock) that can't reasonably be
// randomized the way a screen puzzle can. Node 5 is just a plain riddle
// with no variant - solved at the screen like any other node, nothing to
// walk to or say aloud.
const FIXED_NODES = {
  5: { answer: "KEYBOARD", shardCode: "D5", intel: 15, display: "Solve the riddle: \"I have keys but no locks, space but no room, and you can enter but never go outside. What am I?\"" },
  7: { answer: "TRUST", shardCode: "A7", intel: 20, display: "Find the agent wearing gold. Say the phrase: \"The vault remembers.\"" },
  6: { answer: "0628", shardCode: "V6", intel: 25, display: "Crack the physical padlock at the front of the lab: all four digits even, sum to 16, smallest digit first & largest last, second digit = 3x third digit, no digit repeats." },
};

// How many cleared nodes unlock the vault — mirrors NEEDED_FOR_VAULT in
// map.html. Keep both in sync if you change this.
//
// Set to ALL 10 nodes (computed, not hardcoded, so adding/removing a node
// id above automatically keeps this correct): a team must clear every
// single node before the vault opens, no partial-clear shortcut.
const NEEDED_FOR_VAULT = Object.keys(VARIANT_NODES).length + Object.keys(FIXED_NODES).length;

// A wrong guess locks that node (for that team) for this many seconds
// before the next attempt, correct or not — carried over from v1.
const WRONG_ANSWER_LOCKOUT_SECONDS = 20;

// Look up the answer/shard/intel a specific team's node submission is
// checked against, given that team's assigned variant index.
function getNodeDef(nodeId, variant) {
  if (FIXED_NODES[nodeId]) return FIXED_NODES[nodeId];
  const def = VARIANT_NODES[nodeId];
  if (!def) return null;
  const i = ((variant % def.variants.length) + def.variants.length) % def.variants.length;
  const v = def.variants[i];
  // Derived fresh from the answer every time, never stored — so the
  // pattern can't drift out of sync with the answer key the way a
  // hand-authored audio file could.
  const pattern = def.morse ? wordToMorsePattern(v.answer) : null;
  return { answer: v.answer, shardCode: def.shardCode, intel: def.intel, display: v.display, pattern };
}

// Public puzzle text for every node, for a given variant - safe to send
// to the browser since it never includes the answer (a Morse pattern is
// still just dots, dashes and spaces — decoding it back into a word
// takes the same manual work a team would do for an audio clip). `overrides`
// is a { [nodeId]: variantIndex } map from Reshuffle — a reshuffled node
// uses its override instead of the team's global variant; every other
// node is untouched, exactly like the doc's "already-banked nodes are
// untouched" (and here, every node besides the reshuffled one).
function getPuzzleDisplay(variant, overrides = {}) {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return ids.map((id) => {
    const effectiveVariant = overrides[id] !== undefined ? overrides[id] : variant;
    const def = getNodeDef(id, effectiveVariant);
    return { id, display: def.display, pattern: def.pattern || null };
  });
}

function normalizeAnswer(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Shard codes are fixed per node id regardless of variant (see the
// comment above VARIANT_NODES) — this pulls just that, without needing
// a variant index, for building/checking a team's vault code.
function getShardCode(nodeId) {
  if (FIXED_NODES[nodeId]) return FIXED_NODES[nodeId].shardCode;
  return VARIANT_NODES[nodeId] ? VARIANT_NODES[nodeId].shardCode : null;
}

module.exports = {
  VARIANT_COUNT,
  VARIANT_NODES,
  FIXED_NODES,
  NEEDED_FOR_VAULT,
  WRONG_ANSWER_LOCKOUT_SECONDS,
  getNodeDef,
  getPuzzleDisplay,
  normalizeAnswer,
  getShardCode,
  wordToMorsePattern,
};