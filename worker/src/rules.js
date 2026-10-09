// Rules engine. Code owns every number and every die; the AI only proposes and names things.
// All randomness is seeded from the game id, the turn and a label, so a retried or resumed turn gets identical results.
import { STATS, slugify } from "./schema.js";
import { TIERS, tierFromNumber, TALENTS, TALENT_COOLDOWN } from "./content.js";

export const MAX_LEVEL = 10;
// Total XP needed to reach level n. Sized for a 150-250 turn game: about 2 XP a turn plus milestone XP lands on level 6-8.
export const XP_AT = [0, 0, 40, 100, 190, 310, 460, 640, 860, 1120, 1420];
export const xpForLevel = (level) => XP_AT[Math.max(1, Math.min(level, MAX_LEVEL))];
export const LEVEL_HP = 3;
export const STAT_MAX = 8;
export const ALIGN_MAX = 12;
// Where XP comes from: every roll pays a little (a failure teaches), the AI may add a small bonus for a notable moment,
// and quests pay the big amounts (awarded by the quest code in Phase 7 through awardQuestXp).
export const XP = { success: 2, cost: 2, failure: 1, none: 1, ai_max: 3, milestone: 25, side_quest: 10 };
export const WOUNDED = "Wounded";
const FAILED_KEEP = 4, FAILED_TURNS = 8;

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

// ---- talents, derived numbers ----

export const hasTalent = (a, id) => (a.talents || []).some((t) => t.id === id);
const talentEffects = (a, type) => (a.talents || []).map((t) => ({ t, e: TALENTS[t.id]?.effect })).filter((x) => x.e?.type === type);

export function maxHpOf(a) {
  return 16 + 2 * Math.max(0, a.stats.grit) + LEVEL_HP * (a.level - 1) + talentEffects(a, "maxhp").reduce((n, x) => n + x.e.amount, 0);
}

// Raise or lower max HP after a change to Grit, level or talents; the gain is healed, a loss only trims current HP to the new max.
export function refreshMaxHp(a) {
  const next = maxHpOf(a);
  const diff = next - a.hp_max;
  a.hp_max = next;
  a.hp = Math.max(1, Math.min(next, diff > 0 ? a.hp + diff : a.hp));
}

// ---- equipment ----

// Base items: the first word match in an item name decides slot and which stat the item helps. big: takes 2 pack slots.
const BASES = [
  { re: /\b(dagger|knife|dirk|stiletto)\b/, slot: "weapon", stat: "wits" },
  { re: /\b(bow|crossbow|sling)\b/, slot: "weapon", stat: "wits" },
  { re: /\b(sword|blade|saber|sabre|cutlass|rapier)\b/, slot: "weapon", stat: "might" },
  { re: /\b(axe|hatchet|cleaver)\b/, slot: "weapon", stat: "might" },
  { re: /\b(mace|club|hammer|cudgel|staff|flail)\b/, slot: "weapon", stat: "might" },
  { re: /\b(spear|pike|halberd|lance)\b/, slot: "weapon", stat: "might", big: true },
  { re: /\b(shield|buckler)\b/, slot: "armor", stat: "grit" },
  { re: /\b(helm|helmet|cap)\b/, slot: "armor", stat: "grit" },
  { re: /\b(armor|armour|mail|hauberk|breastplate|cuirass|plate)\b/, slot: "armor", stat: "grit", big: true },
  { re: /\b(coat|jerkin|vest|tunic|leathers|gambeson)\b/, slot: "armor", stat: "grit" },
  { re: /\b(cloak|cape|hood|mantle|robe)\b/, slot: "armor", stat: "wits" },
  { re: /\b(gauntlets?|gloves?|bracers?|boots?)\b/, slot: "armor", stat: "might" },
];
const RARITIES = [
  { id: "common", weight: 70, damage: 3, mult: 1.0, defense: 1 },
  { id: "fine", weight: 25, damage: 4, mult: 1.1, defense: 2 },
  { id: "rare", weight: 5, damage: 6, mult: 1.25, defense: 3 },
];

const baseFor = (name) => BASES.find((b) => b.re.test(String(name).toLowerCase())) || null;

export function makeGear(name, base, rarity) {
  const r = RARITIES.find((x) => x.id === rarity) || RARITIES[0];
  const item = { id: `item-${slugify(name)}`, name, slot: base.slot, rarity: r.id, bonus_stat: base.stat };
  if (base.big) item.big = true;
  if (base.slot === "weapon") Object.assign(item, { damage: r.damage, mult: r.mult });
  else item.defense = r.defense;
  return item;
}

// Gear for a starting kit or a legacy item: the name decides slot and stat, the rarity is common.
export function gearFromName(name, slotHint) {
  const base = baseFor(name) || { slot: slotHint, stat: slotHint === "weapon" ? "might" : "grit" };
  return makeGear(name, { ...base, slot: slotHint || base.slot }, "common");
}

// Fill in stats for an equipped item that predates the rules engine (schema v1).
export function ensureGearStats(item, slot) {
  if (!item || item.rarity) return item;
  const id = item.id;
  Object.assign(item, gearFromName(item.name, slot));
  if (id) item.id = id;
  return item;
}

const gearScore = (g) => (g.slot === "weapon" ? (g.damage || 0) * (g.mult || 1) : g.defense || 0);

// ---- pack slots ----

const isCoins = (name) => /^coins?$/i.test(String(name).trim());
export const slotCost = (i) => (isCoins(i.name) ? 0 : i.gear ? (i.gear.big ? 2 : 1) : Math.max(1, Math.ceil(i.qty / 10)));
export const packUsed = (a) => a.inventory.reduce((n, i) => n + slotCost(i), 0);
export const packSlots = (a) => 10 + Math.max(0, a.stats.grit) + talentEffects(a, "slots").reduce((n, x) => n + x.e.amount, 0);

// ---- rolling ----

// One d20 per turn (a second one for advantage or disadvantage): picking a different option on the same turn cannot reroll either.
export function turnDie(save, label = "d20") {
  return 1 + Math.floor(turnRng(save, label)() * 20);
}

export const resultOf = (d) => d?.result || (d?.success ? "success" : "failure");

// Success at total >= dc, success at a cost when missing by 1-2, failure below. Natural 20 always succeeds, natural 1 always fails.
export function classify(die, total, dc) {
  if (die === 20) return "success";
  if (die === 1) return "failure";
  if (total >= dc) return "success";
  if (total >= dc - 2) return "cost";
  return "failure";
}

const RESULT_TEXT = { success: "Success", cost: "Success at a cost", failure: "Failure" };
export const resultLabel = (r) => RESULT_TEXT[r] || r;

export function rollOption(save, option) {
  const a = save.actors[save.party[0]];
  const danger = dangerOf(save, save.scene.location_id);
  const tier = TIERS[option.tier] ? option.tier : tierFromNumber(Number(option.difficulty) || 10);
  const dc = TIERS[tier] + danger;
  const parts = [];
  let mod = a.stats[option.stat] || 0;
  const gear = Object.values(a.equipment).find((g) => g && g.bonus_stat === option.stat);
  if (gear) { mod += 1; parts.push(`+1 ${gear.name}`); }
  for (const { t, e } of talentEffects(a, "bonus")) {
    if ((!e.stat || e.stat === option.stat) && (!e.kind || e.kind === option.kind)) { mod += e.amount; parts.push(`+${e.amount} ${TALENTS[t.id].name}`); }
  }
  if (a.conditions.includes(WOUNDED)) { mod -= 1; parts.push("-1 wounded"); }

  let adv = option.edge === "advantage", dis = option.edge === "disadvantage";
  if (adv) parts.push(`advantage: ${option.edge_why || "the situation helps"}`);
  if (dis) parts.push(`disadvantage: ${option.edge_why || "the situation hurts"}`);
  let edgeSource = null;
  const nx = a.edge_next;
  if (nx && (!nx.kind || nx.kind === option.kind)) { adv = true; edgeSource = "talent"; parts.push("advantage: talent"); }
  const edge = adv && !dis ? "advantage" : dis && !adv ? "disadvantage" : null;
  if (adv && dis) parts.push("advantage and disadvantage cancel out");

  const d1 = turnDie(save), d2 = turnDie(save, "d20b");
  const die = edge === "advantage" ? Math.max(d1, d2) : edge === "disadvantage" ? Math.min(d1, d2) : d1;
  const result = classify(die, die + mod, dc);
  return {
    die, ...(edge ? { die2: die === d1 ? d2 : d1 } : {}), edge, edge_src: edgeSource, mod, dc, tier,
    label: option.stat[0].toUpperCase() + option.stat.slice(1),
    result, crit: die === 20 ? 20 : die === 1 ? 1 : null,
    success: result === "success", // legacy flag for old clients and records
    note: parts.join(", "),
  };
}

// A used "next check" talent is spent once the turn is applied (rolling itself never changes the save, so a replay rolls the same).
export function consumeEdge(save, dice) {
  if (dice?.edge_src === "talent") save.actors[save.party[0]].edge_next = null;
}

// ---- XP, levels, picks ----

export function awardQuestXp(save, actor, kind, events) {
  gainXp(save, actor, kind === "milestone" ? XP.milestone : XP.side_quest, events);
}

// Three talents from those not owned, seeded per game: one from the character's best stat when there is one, two from the rest.
function offerTalents(save, actor, label) {
  const owned = new Set((actor.talents || []).map((t) => t.id));
  const r = rng(`${save.id}:offer:${label}`);
  const shuffle = (list) => { for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; } return list; };
  const pool = shuffle(Object.keys(TALENTS).filter((id) => !owned.has(id)));
  const top = [...STATS].sort((x, y) => actor.stats[y] - actor.stats[x])[0];
  const favored = pool.find((id) => TALENTS[id].stat === top);
  return [...(favored ? [favored] : []), ...pool.filter((id) => id !== favored)].slice(0, 3);
}

// Levels alternate: even levels give +1 to a stat of your choice, odd levels from 3 give a talent (1 of 3). Picks wait in a queue.
function queuePick(save, actor, level) {
  actor.picks ??= [];
  if (level % 2 === 0) actor.picks.push({ kind: "stat", level });
  else if (level >= 3) {
    const offer = offerTalents(save, actor, `level${level}`);
    if (offer.length) actor.picks.push({ kind: "talent", level, offer });
  }
}

// A saved character from before Character existed: a starting talent to pick, and a talent pick for every odd level reached.
export function catchUpPicks(save, actor) {
  actor.picks ??= [];
  const offer = offerTalents(save, actor, "start");
  if (offer.length) actor.picks.push({ kind: "talent", level: 1, offer });
  for (let l = 3; l <= actor.level; l += 2) queuePick(save, actor, l);
}

export function gainXp(save, actor, amount, events) {
  if (amount <= 0 || actor.level >= MAX_LEVEL) return;
  actor.xp += amount;
  events.push(`+${amount} XP`);
  while (actor.level < MAX_LEVEL && actor.xp >= xpForLevel(actor.level + 1)) {
    actor.level++;
    const before = actor.hp_max;
    refreshMaxHp(actor);
    events.push(`Level ${actor.level}! Max HP +${actor.hp_max - before}.`);
    queuePick(save, actor, actor.level);
    const p = actor.picks.at(-1);
    if (p?.level === actor.level) events.push(p.kind === "stat" ? "Choose a stat to raise on the Character screen." : "Choose a new talent on the Character screen.");
  }
}

export function addTalent(actor, id) {
  actor.talents ??= [];
  if (!TALENTS[id] || hasTalent(actor, id)) return false;
  actor.talents.push({ id, ready_turn: 0 });
  refreshMaxHp(actor);
  return true;
}

// pick: { kind: "stat", stat } or { kind: "talent", talent }. Returns { ok, error, events }.
export function applyPick(save, pick) {
  const a = save.actors[save.party[0]];
  const cur = a.picks?.[0];
  const events = [];
  if (!cur || cur.kind !== pick?.kind) return { ok: false, error: "no_such_pick", events };
  if (cur.kind === "stat") {
    if (!STATS.includes(pick.stat) || a.stats[pick.stat] >= STAT_MAX) return { ok: false, error: "bad_stat", events };
    a.stats[pick.stat]++;
    refreshMaxHp(a);
    events.push(`${pick.stat[0].toUpperCase() + pick.stat.slice(1)} +1`);
  } else {
    if (!cur.offer.includes(pick.talent) || !addTalent(a, pick.talent)) return { ok: false, error: "bad_talent", events };
    events.push(`New talent: ${TALENTS[pick.talent].name}`);
  }
  a.picks.shift();
  return { ok: true, events };
}

// Active talents: no roll, no AI call. { ok, error, events }
export function useTalent(save, id) {
  const a = save.actors[save.party[0]];
  const t = (a.talents || []).find((x) => x.id === id);
  const def = TALENTS[id];
  const events = [];
  if (!t || def.use !== "active") return { ok: false, error: "not_usable", events };
  if (save.turn < t.ready_turn) return { ok: false, error: "not_ready", events };
  const e = def.effect;
  if (e.type === "heal") {
    if (a.hp >= a.hp_max) return { ok: false, error: "full_health", events };
    const amount = Math.max(3, Math.ceil((a.hp_max * e.pct) / 100));
    const before = a.hp;
    a.hp = Math.min(a.hp_max, a.hp + amount);
    settleWounded(a);
    events.push(`${def.name}: +${a.hp - before} HP`);
  } else if (e.type === "cleanse") {
    const keep = a.conditions.filter((c) => c === WOUNDED);
    if (keep.length === a.conditions.length) return { ok: false, error: "nothing_to_clear", events };
    a.conditions = keep;
    events.push(`${def.name}: conditions cleared`);
  } else if (e.type === "edge") {
    a.edge_next = { kind: e.kind || null, from: id };
    events.push(`${def.name}: your next ${e.kind ? e.kind + " " : ""}check has advantage`);
  } else return { ok: false, error: "not_usable", events };
  t.ready_turn = save.turn + TALENT_COOLDOWN;
  return { ok: true, events };
}

export function dropItem(save, itemId) {
  const a = save.actors[save.party[0]];
  const i = a.inventory.findIndex((x) => x.id === itemId);
  if (i < 0 || isCoins(a.inventory[i].name)) return { ok: false, error: "cannot_drop", events: [] };
  const [gone] = a.inventory.splice(i, 1);
  return { ok: true, events: [`Dropped ${gone.name}`] };
}

// ---- alignment (two hidden axes; only the label is shown) ----

const band = (v, pos, neg) => (v >= 3 ? pos : v <= -3 ? neg : "neutral");
export function alignBands(align = { law: 0, good: 0 }) {
  return { law: band(align.law, "lawful", "chaotic"), good: band(align.good, "good", "evil") };
}
export function alignLabel(align) {
  const b = alignBands(align);
  if (b.law === "neutral" && b.good === "neutral") return "True Neutral";
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  return `${cap(b.law)} ${cap(b.good)}`;
}
const ALIGN_NOTE = {
  law: { lawful: "You are becoming known as someone who keeps their word.", chaotic: "You are becoming known as someone who answers to no one.", neutral: "People can no longer tell which side of the law you stand on." },
  good: { good: "Word of your kindness is spreading.", evil: "Word of your cruelty is spreading.", neutral: "People can no longer tell what kind of person you are." },
};

function shiftAlign(a, axis, amount, events) {
  a.align ??= { law: 0, good: 0 };
  const step = Math.sign(amount);
  if (!step) return "ignored";
  const before = alignBands(a.align)[axis];
  a.align[axis] = Math.max(-ALIGN_MAX, Math.min(ALIGN_MAX, a.align[axis] + step));
  const after = alignBands(a.align)[axis];
  if (after !== before) events.push(ALIGN_NOTE[axis][after]);
  return "applied";
}

// ---- no retry without change ----

// A failed approach cannot be offered again unchanged until something changes: a move, new gear, or enough turns.
export function recordFailure(save, action, dice) {
  if (action.kind !== "option" || resultOf(dice) !== "failure") return;
  save.failed = [...(save.failed || []), { text: action.text, n: save.turn, loc: save.scene.location_id }].slice(-FAILED_KEEP);
}

export function clearFailures(save) {
  save.failed = [];
}

export function activeFailures(save) {
  return (save.failed || []).filter((f) => f.loc === save.scene.location_id && save.turn - f.n <= FAILED_TURNS);
}

// ---- applying the AI's proposed state changes ----

function addInventory(actor, name, qty) {
  const have = actor.inventory.find((i) => i.name.toLowerCase() === name.toLowerCase() && !i.gear);
  const used = packUsed(actor);
  if (have) {
    const next = { ...have, qty: Math.min(999, have.qty + qty) };
    if (used - slotCost(have) + slotCost(next) > packSlots(actor)) return "full";
    have.qty = next.qty;
    return "added";
  }
  const entry = { id: `item-${slugify(name)}`, name, qty, note: "" };
  if (used + slotCost(entry) > packSlots(actor)) return "full";
  actor.inventory.push(entry);
  return "added";
}

function addItem(save, actor, name, qty, events) {
  const base = baseFor(name);
  if (!base) {
    const r = addInventory(actor, name, qty);
    events.push(r === "full" ? `Pack full: left ${name} behind` : `Got ${name}${qty > 1 ? ` x${qty}` : ""}`);
    return r;
  }
  // Gear: rarity and numbers come from the table; the AI only supplied the name.
  const r = turnRng(save, `loot:${slugify(name)}`)() * 100;
  let acc = 0;
  const rarity = RARITIES.find((x) => (acc += x.weight) > r) || RARITIES[0];
  const item = makeGear(name, base, rarity.id);
  const worn = actor.equipment[item.slot];
  const room = (extra) => packUsed(actor) + extra <= packSlots(actor);
  if (!worn || gearScore(item) > gearScore(worn)) {
    if (worn) {
      const old = { id: worn.id, name: worn.name, qty: 1, note: "", gear: worn };
      if (room(slotCost(old))) actor.inventory.push(old);
      else events.push(`Pack full: left ${worn.name} behind`);
    }
    actor.equipment[item.slot] = item;
    events.push(`Found ${item.name} (${item.rarity}), equipped`);
    return "equipped";
  }
  const entry = { id: item.id, name: item.name, qty: 1, note: "", gear: item };
  if (!room(slotCost(entry))) { events.push(`Pack full: left ${item.name} behind`); return "full"; }
  actor.inventory.push(entry);
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
  // One XP note per turn: the roll, plus the AI's bonus for a notable moment (capped).
  let xp = dice ? XP[resultOf(dice)] : XP.none;
  let bonus = 0;
  const shifted = new Set();
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
      if (a === player) bonus = Math.min(XP.ai_max, bonus + Math.max(0, c.amount));
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
    } else if (c.kind === "law" || c.kind === "good") {
      // One small step per axis per turn, for choices with real moral weight; only the player has an alignment.
      if (a === player && !shifted.has(c.kind)) { shifted.add(c.kind); result = shiftAlign(a, c.kind, c.amount, events); } else result = "ignored";
    }
    changes.push({ ...c, applied: result !== "ignored" && result !== "not_found" && result !== "full", result });
  }
  gainXp(save, player, xp + bonus, events);
  for (const id of save.party) settleWounded(save.actors[id]);
  return { changes, events };
}

// Count the final difficulty of each roll so drift stays visible, plus tiers, results and edges.
export function logDifficulty(save, dice) {
  if (!dice) return;
  const c = save.counters;
  c.dc[dice.dc] = (c.dc[dice.dc] || 0) + 1;
  c.tiers ??= {}; c.results ??= {};
  c.tiers[dice.tier] = (c.tiers[dice.tier] || 0) + 1;
  const r = resultOf(dice);
  c.results[r] = (c.results[r] || 0) + 1;
  if (dice.edge) c.edges = (c.edges || 0) + 1;
}
