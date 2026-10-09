// Rules engine. Code owns every number and every die; the AI only proposes and names things.
// All randomness is seeded from the game id, the turn and a label, so a retried or resumed turn gets identical results.
import { STATS, slugify } from "./schema.js";

export const MAX_LEVEL = 10;
export const XP_PER_LEVEL = 20; // total XP to reach level n is XP_PER_LEVEL * (n - 1)
export const LEVEL_HP = 4;
const XP_SUCCESS = 3, XP_FAIL = 1, XP_NO_ROLL = 1, XP_AI_MAX = 4;
const DC_CAP = 20;
export const WOUNDED = "Wounded";

// ---- seeded randomness ----

function hash32(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

// Returns a function giving floats in [0, 1). Same seed text, same sequence.
export function rng(seedText) {
  let a = hash32(seedText);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const turnRng = (save, label) => rng(`${save.id}:${save.turn}:${label}`);

// ---- location danger (0-2, set by code when a location is created, never by the AI) ----

export function rollDanger(save, locationId) {
  const r = rng(`${save.id}:danger:${locationId}`)();
  return r < 0.6 ? 0 : r < 0.9 ? 1 : 2;
}

export const dangerOf = (save, locationId) => save.ledger.entities[locationId]?.danger ?? 0;

// ---- difficulty clamp ----

export function difficultyBand(level, danger = 0) {
  const lo = 8 + Math.round(((Math.min(level, MAX_LEVEL) - 1) * 7) / 9);
  return [Math.min(DC_CAP, lo + danger), Math.min(DC_CAP, lo + 3 + danger)];
}

export const clampDifficulty = (proposed, level, danger = 0) => {
  const [lo, hi] = difficultyBand(level, danger);
  return Math.min(hi, Math.max(lo, Math.round(Number(proposed) || lo)));
};

// ---- equipment ----

// Base items: the first word match in an item name decides slot and which stat the item helps.
const BASES = [
  { re: /\b(dagger|knife|dirk|stiletto)\b/, slot: "weapon", stat: "wits" },
  { re: /\b(bow|crossbow|sling)\b/, slot: "weapon", stat: "wits" },
  { re: /\b(sword|blade|saber|sabre|cutlass|rapier)\b/, slot: "weapon", stat: "might" },
  { re: /\b(axe|hatchet|cleaver)\b/, slot: "weapon", stat: "might" },
  { re: /\b(mace|club|hammer|cudgel|staff|flail)\b/, slot: "weapon", stat: "might" },
  { re: /\b(spear|pike|halberd|lance)\b/, slot: "weapon", stat: "might" },
  { re: /\b(shield|buckler)\b/, slot: "armor", stat: "grit" },
  { re: /\b(helm|helmet|cap)\b/, slot: "armor", stat: "grit" },
  { re: /\b(armor|armour|mail|hauberk|breastplate|cuirass|plate)\b/, slot: "armor", stat: "grit" },
  { re: /\b(coat|jerkin|vest|tunic|leathers|gambeson)\b/, slot: "armor", stat: "grit" },
  { re: /\b(cloak|cape|hood|mantle)\b/, slot: "armor", stat: "wits" },
  { re: /\b(gauntlets?|gloves?|bracers?|boots?)\b/, slot: "armor", stat: "might" },
];
const RARITIES = [
  { id: "common", weight: 70, damage: 3, mult: 1.0, defense: 1 },
  { id: "fine", weight: 25, damage: 4, mult: 1.1, defense: 2 },
  { id: "rare", weight: 5, damage: 6, mult: 1.25, defense: 3 },
];

const baseFor = (name) => BASES.find((b) => b.re.test(String(name).toLowerCase())) || null;

function makeGear(name, base, rarity) {
  const r = RARITIES.find((x) => x.id === rarity) || RARITIES[0];
  const item = { id: `item-${slugify(name)}`, name, slot: base.slot, rarity: r.id, bonus_stat: base.stat };
  if (base.slot === "weapon") Object.assign(item, { damage: r.damage, mult: r.mult });
  else item.defense = r.defense;
  return item;
}

// Fill in stats for an equipped item that predates the rules engine (schema v1).
export function ensureGearStats(item, slot) {
  if (!item || item.rarity) return item;
  const base = baseFor(item.name) || { slot, stat: slot === "weapon" ? "might" : "grit" };
  const id = item.id;
  Object.assign(item, makeGear(item.name, { ...base, slot }, "common"));
  if (id) item.id = id;
  return item;
}

const gearScore = (g) => (g.slot === "weapon" ? (g.damage || 0) * (g.mult || 1) : g.defense || 0);

// ---- rolling ----

// One d20 per turn: picking a different option on the same turn cannot reroll it either.
export function turnDie(save) {
  return 1 + Math.floor(turnRng(save, "d20")() * 20);
}

export function rollOption(save, option) {
  const a = save.actors[save.party[0]];
  const danger = dangerOf(save, save.scene.location_id);
  const dc = clampDifficulty(option.difficulty, a.level, danger);
  const parts = [];
  let mod = a.stats[option.stat] || 0;
  const gear = Object.values(a.equipment).find((g) => g && g.bonus_stat === option.stat);
  if (gear) { mod += 1; parts.push(`+1 ${gear.name}`); }
  if (a.conditions.includes(WOUNDED)) { mod -= 1; parts.push("-1 wounded"); }
  if (dc !== option.difficulty) parts.push(`difficulty ${option.difficulty} adjusted to ${dc}`);
  const die = turnDie(save);
  return {
    die, mod, dc, dc_proposed: option.difficulty,
    label: option.stat[0].toUpperCase() + option.stat.slice(1),
    success: die + mod >= dc,
    note: parts.join(", "),
  };
}

// ---- XP and levels ----

export const xpForLevel = (level) => XP_PER_LEVEL * (level - 1);

export function gainXp(actor, amount, events) {
  if (amount <= 0 || actor.level >= MAX_LEVEL) return;
  actor.xp += amount;
  events.push(`+${amount} XP`);
  while (actor.level < MAX_LEVEL && actor.xp >= xpForLevel(actor.level + 1)) {
    actor.level++;
    actor.hp_max += LEVEL_HP;
    const stat = [...STATS].sort((x, y) => actor.stats[x] - actor.stats[y])[0]; // lowest stat; ties go in STATS order
    actor.stats[stat]++;
    events.push(`Level ${actor.level}! Max HP +${LEVEL_HP}, ${stat[0].toUpperCase() + stat.slice(1)} +1`);
  }
}

// ---- applying the AI's proposed state changes ----

function addInventory(actor, name, qty) {
  const have = actor.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase() && !i.gear);
  if (have) have.qty = Math.min(999, have.qty + qty);
  else actor.inventory.push({ id: `item-${slugify(name)}`, name, qty, note: "" });
}

function addItem(save, actor, name, qty, events) {
  const base = baseFor(name);
  if (!base) { addInventory(actor, name, qty); events.push(`Got ${name}${qty > 1 ? ` x${qty}` : ""}`); return "added"; }
  // Gear: rarity and numbers come from the table; the AI only supplied the name.
  const r = turnRng(save, `loot:${slugify(name)}`)() * 100;
  let acc = 0;
  const rarity = RARITIES.find((x) => (acc += x.weight) > r) || RARITIES[0];
  const item = makeGear(name, base, rarity.id);
  const worn = actor.equipment[item.slot];
  if (!worn || gearScore(item) > gearScore(worn)) {
    if (worn) actor.inventory.push({ id: worn.id, name: worn.name, qty: 1, note: "", gear: worn });
    actor.equipment[item.slot] = item;
    events.push(`Found ${item.name} (${item.rarity}), equipped`);
    return "equipped";
  }
  actor.inventory.push({ id: item.id, name: item.name, qty: 1, note: "", gear: item });
  events.push(`Found ${item.name} (${item.rarity}), kept in the pack`);
  return "stored";
}

function removeItem(actor, name, qty) {
  const key = name.toLowerCase();
  const stack = actor.inventory.find((i) => i.name.toLowerCase() === key);
  if (stack) {
    stack.qty -= qty;
    if (stack.qty <= 0) actor.inventory.splice(actor.inventory.indexOf(stack), 1);
    return "removed";
  }
  return "not_found";
}

// Keep an actor above 0 until Phase 6 adds combat and permanent death.
export function settleWounded(actor) {
  const wounded = actor.conditions.includes(WOUNDED);
  if (actor.hp <= 1 && !wounded) actor.conditions.push(WOUNDED);
  else if (wounded && actor.hp >= Math.ceil(actor.hp_max / 2)) actor.conditions = actor.conditions.filter((c) => c !== WOUNDED);
}

// Returns { changes, events }. `move` is handled by the caller (it needs the ledger); everything else is validated here.
export function applyChanges(save, proposed, dice, events = []) {
  const changes = [];
  const player = save.actors[save.party[0]];
  gainXp(player, dice ? (dice.success ? XP_SUCCESS : XP_FAIL) : XP_NO_ROLL, events);
  for (const c of proposed) {
    const a = save.actors[c.actor] || player;
    if (c.kind === "move") { changes.push(c); continue; }
    let result = "applied";
    if (c.kind === "hp") {
      const delta = Math.max(-Math.ceil(a.hp_max / 2), Math.min(Math.ceil(a.hp_max / 4), c.amount));
      const before = a.hp;
      a.hp = Math.max(1, Math.min(a.hp_max, a.hp + delta));
      if (a.hp !== before + delta) result = "clamped";
    } else if (c.kind === "xp") {
      if (a === player) gainXp(a, Math.max(0, Math.min(XP_AI_MAX, c.amount)), events);
      else result = "ignored";
    } else if (c.kind === "item_add") {
      if (c.text) result = addItem(save, a, c.text, Math.max(1, Math.min(99, c.amount || 1)), events);
      else result = "ignored";
    } else if (c.kind === "item_remove") {
      result = c.text ? removeItem(a, c.text, Math.max(1, c.amount || 1)) : "ignored";
    } else if (c.kind === "condition_add" || c.kind === "condition_remove") {
      const name = c.text.trim();
      if (!name || name.toLowerCase() === WOUNDED.toLowerCase()) result = "ignored"; // Wounded belongs to code
      else if (c.kind === "condition_add") { if (!a.conditions.includes(name) && a.conditions.length < 5) a.conditions.push(name); else result = "ignored"; }
      else a.conditions = a.conditions.filter((x) => x.toLowerCase() !== name.toLowerCase());
    }
    changes.push({ ...c, applied: result !== "ignored" && result !== "not_found", result });
  }
  for (const id of save.party) settleWounded(save.actors[id]);
  return { changes, events };
}

// Count the final difficulty of each roll so drift between proposed and used values stays visible.
export function logDifficulty(save, dice) {
  if (!dice) return;
  const c = save.counters;
  c.dc[dice.dc] = (c.dc[dice.dc] || 0) + 1;
  if (dice.dc !== dice.dc_proposed) c.dc_clamped++;
}
