// Content tables (hand-written numbers; Phase 5). Code owns every number; the AI only names and describes.
// No imports on purpose: rules.js, schema.js and character.js all read from here.

export const STAT_LABELS = { might: "Might", wits: "Wits", charm: "Charm", grit: "Grit" };
export const STAT_HELP = {
  might: "force, melee, feats of strength",
  wits: "notice, know, sneak, ranged, cunning",
  charm: "talk, deceive, lead",
  grit: "endure, nerve; sets HP and pack slots",
};

// The AI names a difficulty tier, never a number. Code adds the place's danger (0-2). Level is never used.
export const TIERS = { easy: 7, standard: 10, hard: 13, daunting: 16 };
export const tierFromNumber = (n) => (n <= 8 ? "easy" : n <= 11 ? "standard" : n <= 14 ? "hard" : "daunting");

// What the phone shows on each option (never the difficulty or an edge).
export const KIND_LABELS = { social: "Social", explore: "Explore", direct: "Direct", cautious: "Cautious", other: "" };

export const TALENT_COOLDOWN = 10; // turns before an active talent is ready again (Rest refreshes it from Phase 8)

// effect.type: bonus (+amount on checks matching stat and/or kind), slots (+pack slots), maxhp (passive);
// heal (pct of max HP), cleanse (all conditions but Wounded), edge (advantage on the next check, optionally of one kind) (active).
// Phase 6 maps each type to a combat effect.
export const TALENTS = {
  "second-wind": { name: "Second Wind", stat: "might", use: "active", effect: { type: "heal", pct: 33 }, text: "Recover a third of your max HP. Ready again after 10 turns." },
  "heavy-hand": { name: "Heavy Hand", stat: "might", use: "passive", effect: { type: "bonus", kind: "direct", amount: 1 }, text: "+1 on direct checks: force, a blow, a shove." },
  "pack-mule": { name: "Pack Mule", stat: "might", use: "passive", effect: { type: "slots", amount: 2 }, text: "+2 pack slots." },
  "keen-eye": { name: "Keen Eye", stat: "wits", use: "passive", effect: { type: "bonus", kind: "explore", amount: 1 }, text: "+1 on explore checks: searching, tracking, noticing." },
  "quick-study": { name: "Quick Study", stat: "wits", use: "active", effect: { type: "edge" }, text: "Your next check has advantage. Ready again after 10 turns." },
  "light-fingers": { name: "Light Fingers", stat: "wits", use: "passive", effect: { type: "bonus", kind: "cautious", amount: 1 }, text: "+1 on cautious checks: stealth, sleight, slipping away." },
  "silver-tongue": { name: "Silver Tongue", stat: "charm", use: "passive", effect: { type: "bonus", kind: "social", amount: 1 }, text: "+1 on social checks." },
  "commanding-presence": { name: "Commanding Presence", stat: "charm", use: "active", effect: { type: "edge", kind: "social" }, text: "Your next social check has advantage. Ready again after 10 turns." },
  "rousing-speech": { name: "Rousing Speech", stat: "charm", use: "active", effect: { type: "heal", pct: 25 }, text: "Steadying words recover a quarter of your max HP. Ready again after 10 turns." },
  "tough": { name: "Tough as Boots", stat: "grit", use: "passive", effect: { type: "maxhp", amount: 4 }, text: "+4 max HP." },
  "iron-will": { name: "Iron Will", stat: "grit", use: "active", effect: { type: "cleanse" }, text: "Shake off every condition except Wounded. Ready again after 10 turns." },
  "stubborn": { name: "Stubborn", stat: "grit", use: "passive", effect: { type: "bonus", stat: "grit", amount: 1 }, text: "+1 on every Grit check: endure, resist, keep your nerve." },
};

// Each background sets the stat spread (+3/+2/+1/0), the starting kit and three talents to pick one from.
export const BACKGROUNDS = {
  soldier: { name: "Soldier", text: "Served a lord's levy until it was disbanded.", stats: { might: 3, grit: 2, charm: 1, wits: 0 }, gear: ["Notched shortsword", "Gambeson"], items: [["Coins", 8], ["Trail rations", 2]], talents: ["second-wind", "heavy-hand", "iron-will"] },
  drover: { name: "Drover", text: "Walked cattle and carts along the river roads.", stats: { grit: 3, might: 2, wits: 1, charm: 0 }, gear: ["Hickory cudgel", "Oiled travel coat"], items: [["Coins", 10], ["Trail rations", 3], ["Coil of rope", 1]], talents: ["pack-mule", "tough", "stubborn"] },
  clerk: { name: "Clerk", text: "Kept ledgers for a guild house and learned who owes whom.", stats: { wits: 3, charm: 2, grit: 1, might: 0 }, gear: ["Letter dagger", "Travelling cloak"], items: [["Coins", 14], ["Trail rations", 2], ["Ink and quills", 1]], talents: ["quick-study", "keen-eye", "silver-tongue"] },
  hunter: { name: "Hunter", text: "Trapped and tracked in the Greywold's edge.", stats: { wits: 3, grit: 2, might: 1, charm: 0 }, gear: ["Hunting bow", "Hardened leathers"], items: [["Coins", 6], ["Trail rations", 3], ["Snare wire", 1]], talents: ["keen-eye", "light-fingers", "second-wind"] },
  pedlar: { name: "Pedlar", text: "Sold needles, rumors and trinkets from town to town.", stats: { charm: 3, wits: 2, grit: 1, might: 0 }, gear: ["Boot knife", "Patched pedlar's coat"], items: [["Coins", 20], ["Trail rations", 2], ["Tin trinkets", 1]], talents: ["silver-tongue", "commanding-presence", "light-fingers"] },
  novice: { name: "Lantern novice", text: "Left a Lantern Church hospice before taking vows.", stats: { grit: 3, charm: 2, wits: 1, might: 0 }, gear: ["Iron-shod staff", "Novice's robe"], items: [["Coins", 5], ["Trail rations", 2], ["Prayer cord", 1]], talents: ["rousing-speech", "iron-will", "commanding-presence"] },
};

export const DRIVES = {
  revenge: { name: "Revenge", text: "Someone wronged you and you mean to make them answer." },
  debt: { name: "A debt", text: "You owe a debt you must pay, in coin or in kind." },
  missing: { name: "Find someone", text: "Someone you love is missing and you will find them." },
  prove: { name: "Prove yourself", text: "You have something to prove, to others or to yourself." },
  past: { name: "Escape your past", text: "You are running from what you were, and someone knows it." },
};

export const FLAWS = {
  proud: { name: "Proud", text: "You hate to back down or ask for help." },
  reckless: { name: "Reckless", text: "You act first and count the cost later." },
  greedy: { name: "Greedy", text: "A glint of coin dulls your judgment." },
  distrustful: { name: "Distrustful", text: "You expect to be cheated, and it shows." },
  soft: { name: "Soft-hearted", text: "You cannot walk past someone in trouble." },
};

// Two quick questions set the starting alignment (hidden numbers; only the label is ever shown).
export const ALIGN_START = 4;
export const ALIGN_QUESTIONS = [
  { axis: "law", text: "When the rules and a friend's need collide, you…", answers: [{ id: "lawful", text: "Keep to the rules" }, { id: "neutral", text: "Weigh it each time" }, { id: "chaotic", text: "Break the rules" }] },
  { axis: "good", text: "A stranger in need cannot repay you. You…", answers: [{ id: "good", text: "Help them" }, { id: "neutral", text: "Help if it costs little" }, { id: "evil", text: "Look after yourself" }] },
];

export const FREE_POINTS = 2;
export const CREATION_STAT_MAX = 4;

// What the phone needs to draw the creation screen (public data, no secrets).
export function creationTables() {
  const list = (obj) => Object.entries(obj).map(([id, v]) => ({ id, ...v }));
  return {
    backgrounds: list(BACKGROUNDS).map((b) => ({ ...b, talents: b.talents.map((id) => ({ id, name: TALENTS[id].name, text: TALENTS[id].text })) })),
    drives: list(DRIVES),
    flaws: list(FLAWS),
    questions: ALIGN_QUESTIONS,
    stat_help: STAT_HELP,
    stats: Object.keys(STAT_LABELS),
    free_points: FREE_POINTS,
    stat_max: CREATION_STAT_MAX,
  };
}
