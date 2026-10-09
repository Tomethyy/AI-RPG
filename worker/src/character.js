// Character creation: validate the player's picks and build the starting actor. Code owns every number.
import { BACKGROUNDS, DRIVES, FLAWS, ALIGN_START, FREE_POINTS, CREATION_STAT_MAX } from "./content.js";
import { STATS, newActor, slugify } from "./schema.js";
import { gearFromName, maxHpOf } from "./rules.js";

// Used when a save is created without the creation screen (first visit, tests).
export const DEFAULT_CHARACTER = { name: "Ash", background: "drover", drive: "prove", flaw: "proud", law: "neutral", good: "neutral", free: { wits: 1, charm: 1 }, talent: "pack-mule" };

const LAW = { lawful: ALIGN_START, neutral: 0, chaotic: -ALIGN_START };
const GOOD = { good: ALIGN_START, neutral: 0, evil: -ALIGN_START };

// Returns { character } with clean values, or { error } naming the first thing wrong.
export function validateCharacter(input) {
  const c = input && typeof input === "object" ? input : {};
  const name = String(c.name || "").replace(/\s+/g, " ").trim();
  // The name goes into the prompt, so it is letters, digits, spaces and a few marks only.
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '’-]{0,23}$/u.test(name)) return { error: "name" };
  const bg = BACKGROUNDS[c.background];
  if (!bg) return { error: "background" };
  if (!DRIVES[c.drive]) return { error: "drive" };
  if (!FLAWS[c.flaw]) return { error: "flaw" };
  if (!(c.law in LAW)) return { error: "law" };
  if (!(c.good in GOOD)) return { error: "good" };
  const free = {};
  let total = 0;
  for (const s of STATS) {
    const n = Number(c.free?.[s] || 0);
    if (!Number.isInteger(n) || n < 0 || n > FREE_POINTS) return { error: "free" };
    if (bg.stats[s] + n > CREATION_STAT_MAX) return { error: "free" };
    if (n) free[s] = n;
    total += n;
  }
  if (total !== FREE_POINTS) return { error: "free" };
  if (!bg.talents.includes(c.talent)) return { error: "talent" };
  return { character: { name, background: c.background, drive: c.drive, flaw: c.flaw, law: c.law, good: c.good, free, talent: c.talent } };
}

export function buildActor(character) {
  const bg = BACKGROUNDS[character.background];
  const stats = {};
  for (const s of STATS) stats[s] = bg.stats[s] + (character.free[s] || 0);
  const [weapon, armor] = bg.gear;
  const a = newActor("pc", "pc", {
    name: character.name,
    stats,
    equipment: { weapon: gearFromName(weapon, "weapon"), armor: gearFromName(armor, "armor") },
    inventory: bg.items.map(([name, qty]) => ({ id: `item-${slugify(name)}`, name, qty, note: "" })),
    bio: { background: character.background, drive: character.drive, flaw: character.flaw },
    align: { law: LAW[character.law], good: GOOD[character.good] },
    talents: [{ id: character.talent, ready_turn: 0 }],
  });
  a.hp_max = a.hp = maxHpOf(a);
  return a;
}
