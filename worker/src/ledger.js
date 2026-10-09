// Lore ledger: every named thing the AI invents becomes an entity record with facts.
import { ENTITY_TYPES, newEntity, slugify } from "./schema.js";
import { rollDanger } from "./rules.js";

export const FACT_CAP = 8; // above this a cheap model merges an entity's facts (factmerge.js)
export const FACT_HARD = 12; // if that has not happened yet, the oldest facts after the first are dropped
export const EXTRA_PLACES = 4; // places the AI may add inside a generated region (the region is the map)

export const norm = (s) => String(s || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function findEntity(save, name, type) {
  const key = norm(name);
  if (!key) return null;
  let loose = null;
  for (const e of Object.values(save.ledger.entities)) {
    if (norm(e.name) === key || e.aliases.some((a) => norm(a) === key)) {
      if (!type || e.type === type) return e;
      loose ??= e;
    }
  }
  return loose;
}

// People are often named in pieces: "Reeve", then "Tam Reeve". One name's words all appear in the other's, and only one person fits.
function partialMatches(save, name, type) {
  const words = (n) => norm(n).split(" ").filter((w) => w.length > 2 || /\d/.test(w));
  const mine = words(name);
  if (!mine.length) return [];
  const subset = (a, b) => a.every((w) => b.includes(w));
  return Object.values(save.ledger.entities).filter((e) => {
    if (e.type !== type) return false;
    return [e.name, ...e.aliases].some((n) => { const theirs = words(n); return theirs.length && (subset(mine, theirs) || subset(theirs, mine)); });
  });
}

// In a generated region the AI may add only a few places; after that a new place name is refused (it lies beyond this story).
export const placeRoom = (save) => !save.world || (save.world.extra_places || 0) < EXTRA_PLACES;

export function createEntity(save, type, name, turn, fields = {}) {
  const base = `${type}-${slugify(name)}`;
  let id = base;
  for (let i = 2; save.ledger.entities[id]; i++) id = `${base}-${i}`;
  const e = (save.ledger.entities[id] = newEntity(id, type, String(name).trim().slice(0, 80), turn, fields));
  if (type === "location" && e.danger === undefined) e.danger = rollDanger(save, id);
  // Someone the AI introduces has just met the character; their first reaction is set by quest.js after the turn.
  if (type === "npc") Object.assign(e, { attitude: 0, met: true, profile: null, ...fields });
  return e;
}

// The place by that name, a new one while the region has room, or null.
export function ensureLocation(save, name, turn) {
  const found = findEntity(save, name, "location");
  if (found || !placeRoom(save)) return found;
  if (save.world) save.world.extra_places = (save.world.extra_places || 0) + 1;
  return createEntity(save, "location", name, turn);
}

function connect(a, b) {
  if (a.id === b.id) return;
  if (!a.connections.includes(b.id)) a.connections.push(b.id);
  if (!b.connections.includes(a.id)) b.connections.push(a.id);
}

// Two records turned out to be the same thing: fold `drop` into `keep` and point every reference at `keep`.
function mergeEntities(save, keep, drop) {
  for (const n of [drop.name, ...drop.aliases]) if (!keep.aliases.includes(n) && norm(n) !== norm(keep.name)) keep.aliases.push(n);
  for (const f of drop.facts) if (!keep.facts.some((x) => norm(x.text) === norm(f.text))) keep.facts.push(f);
  keep.facts.sort((a, b) => a.turn - b.turn);
  keep.location_id ??= drop.location_id;
  // What code generated or rolled for either record survives: a profile, values, travel times, the region flag, a met person's attitude.
  for (const k of ["profile", "values", "base", "faction", "region", "travel", "danger"]) if (keep[k] == null && drop[k] != null) keep[k] = drop[k];
  if (keep.met === false && drop.met !== false) { keep.met = true; keep.attitude = drop.attitude ?? 0; }
  if (drop.known !== false) keep.known = true;
  keep.first_turn = Math.min(keep.first_turn, drop.first_turn);
  keep.last_turn = Math.max(keep.last_turn, drop.last_turn);
  delete save.ledger.entities[drop.id];
  for (const e of Object.values(save.ledger.entities)) {
    if (e.location_id === drop.id) e.location_id = keep.id;
    if (e.connections.includes(drop.id)) {
      e.connections = e.connections.filter((c) => c !== drop.id);
      if (e.id !== keep.id && !e.connections.includes(keep.id)) e.connections.push(keep.id);
    }
  }
  for (const c of drop.connections) if (c !== keep.id && save.ledger.entities[c] && !keep.connections.includes(c)) keep.connections.push(c);
  if (keep.location_id === keep.id) keep.location_id = null;
  if (save.scene.location_id === drop.id) save.scene.location_id = keep.id;
  for (const a of Object.values(save.actors)) if (a.ledger_id === drop.id) a.ledger_id = keep.id;
  save.counters.merges = (save.counters.merges || 0) + 1;
  return keep;
}

// Give an entity a new name; the old one stays as an alias so later mentions still find it.
function rename(e, name) {
  if (norm(e.name) === norm(name)) return;
  if (!e.aliases.some((a) => norm(a) === norm(e.name))) e.aliases.push(e.name);
  e.aliases = e.aliases.filter((a) => norm(a) !== norm(name)).slice(-6);
  e.name = String(name).trim().slice(0, 80);
}

// The entity a fact is about, honoring `was` (an earlier name or description of the same thing).
function resolveEntity(save, f, type, turn) {
  let e = findEntity(save, f.entity, type);
  if (type === "npc") {
    // Fold a partial name into the one person it fits, and two records of one person into one.
    const part = partialMatches(save, f.entity, type);
    if (!e && part.length === 1) e = part[0];
    if (e && part.length === 2 && part.includes(e)) {
      const other = part.find((x) => x !== e);
      const [keep, drop] = e.first_turn <= other.first_turn ? [e, other] : [other, e];
      e = mergeEntities(save, keep, drop);
    }
    if (e && norm(f.entity).split(" ").length > norm(e.name).split(" ").length && partialMatches(save, f.entity, type).includes(e)) rename(e, f.entity); // "Tam Reeve" beats "Reeve"
  }
  const was = f.was && norm(f.was) !== norm(f.entity) ? f.was : "";
  const prev = was ? findEntity(save, was, type) : null;
  if (prev && prev.type === type) {
    if (e && e.id !== prev.id) {
      const [keep, drop] = prev.first_turn <= e.first_turn ? [prev, e] : [e, prev];
      e = mergeEntities(save, keep, drop);
    } else e = prev;
    rename(e, f.entity);
    return { e, fresh: false };
  }
  if (e) {
    if (was && !e.aliases.some((a) => norm(a) === norm(was))) e.aliases = [...e.aliases, String(was).trim().slice(0, 80)].slice(-6);
    return { e, fresh: false };
  }
  e = createEntity(save, type, f.entity, turn);
  if (was) e.aliases.push(String(was).trim().slice(0, 80));
  return { e, fresh: true };
}

// new_facts: [{ entity, type, fact, location, was }]. Returns how many facts were actually added; new entities go into `created`.
export function applyNewFacts(save, facts, turn, created = []) {
  let added = 0;
  for (const f of facts) {
    let type = ENTITY_TYPES.includes(f.type) ? f.type : "lore";
    // A place beyond the region's room is still remembered by name, as lore that cannot be reached.
    if (type === "location" && !findEntity(save, f.entity, "location") && !(f.was && findEntity(save, f.was, "location")) && !placeRoom(save)) type = "lore";
    else if (type === "location" && save.world && !findEntity(save, f.entity, "location") && !(f.was && findEntity(save, f.was, "location"))) save.world.extra_places = (save.world.extra_places || 0) + 1;
    const { e, fresh } = resolveEntity(save, f, type, turn);
    if (fresh) created.push(e);
    e.known = true;
    const loc = f.location && norm(f.location) !== norm(e.name) ? ensureLocation(save, f.location, turn) : null;
    if (loc) {
      if (type === "location") connect(e, loc);
      else e.location_id = loc.id;
    } else if (fresh && type !== "location" && type !== "lore") {
      e.location_id = save.scene.location_id;
    }
    const text = String(f.fact || "").trim().slice(0, 300);
    if (text && !e.facts.some((x) => norm(x.text) === norm(text))) {
      // A status (dead, hostile, allied...) replaces the previous status instead of piling up.
      if (f.kind === "status") e.facts = e.facts.filter((x) => x.kind !== "status");
      e.facts.push(f.kind ? { text, turn, kind: f.kind } : { text, turn });
      added++;
    }
    if (e.facts.length > FACT_HARD) e.facts = [e.facts[0], ...e.facts.slice(-(FACT_HARD - 1))];
    e.last_turn = turn;
  }
  return added;
}

// Ledger retrieval: entities at or linked to the current location, or named in the action, the scene, its options or the last turns.
// Returns them best first; the prompt keeps as many as fit its token budget.
export function relevantEntities(save, actionText, { max = 20, factsEach = 6, leads = [] } = {}) {
  const loc = save.scene.location_id;
  const here = save.ledger.entities[loc];
  const hay = (parts) => ` ${norm(parts.join(" "))} `;
  const inAction = hay([actionText]);
  const inLeads = hay(leads);
  const inScene = hay([...save.scene.narration, ...save.scene.options.map((o) => o.text), ...save.recent.slice(-3).flatMap((t) => [t.action.text, ...t.narration])]);
  const scored = [];
  for (const e of Object.values(save.ledger.entities)) {
    const names = [e.name, ...e.aliases].map(norm).filter(Boolean);
    const named = (h) => names.some((n) => h.includes(` ${n} `));
    let score = 0;
    if (e.id === loc) score += 100;
    if (named(inAction)) score += 40;
    if (named(inScene)) score += 20;
    if (e.location_id === loc) score += 10;
    if (e.connections.includes(loc) || here?.connections.includes(e.id)) score += 5;
    if (named(inLeads)) score += 6; // where the revealed leads point
    if (score) scored.push([score + e.last_turn / 1e5, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const name = (id) => save.ledger.entities[id]?.name;
  return scored.slice(0, max).map(([, e]) => ({
    name: e.name,
    type: e.type,
    aliases: e.aliases.slice(-3),
    where: e.type === "location" ? undefined : name(e.location_id),
    links: e.type === "location" ? e.connections.map(name).filter(Boolean).slice(0, 6) : undefined,
    // The first fact usually says what the thing is; the newest ones say where it stands now.
    facts: (e.facts.length > factsEach ? [e.facts[0], ...e.facts.slice(-(factsEach - 1))] : e.facts).map((x) => x.text),
    ...(e.type === "npc" ? { id: e.id, attitude: e.attitude ?? 0, met: e.met !== false, profile: e.profile || null, faction: e.faction || "" } : {}),
  }));
}
