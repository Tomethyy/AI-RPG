// Lore ledger: every named thing the AI invents becomes an entity record with facts.
import { ENTITY_TYPES, newEntity, slugify } from "./schema.js";
import { rollDanger } from "./rules.js";

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

function createEntity(save, type, name, turn) {
  const base = `${type}-${slugify(name)}`;
  let id = base;
  for (let i = 2; save.ledger.entities[id]; i++) id = `${base}-${i}`;
  const e = (save.ledger.entities[id] = newEntity(id, type, String(name).trim().slice(0, 80), turn));
  if (type === "location") e.danger = rollDanger(save, id);
  return e;
}

export function ensureLocation(save, name, turn) {
  return findEntity(save, name, "location") || createEntity(save, "location", name, turn);
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

// new_facts: [{ entity, type, fact, location, was }]. Returns how many facts were actually added.
export function applyNewFacts(save, facts, turn) {
  let added = 0;
  for (const f of facts) {
    const type = ENTITY_TYPES.includes(f.type) ? f.type : "lore";
    const { e, fresh } = resolveEntity(save, f, type, turn);
    if (f.location && norm(f.location) !== norm(e.name)) {
      const loc = ensureLocation(save, f.location, turn);
      if (type === "location") connect(e, loc);
      else e.location_id = loc.id;
    } else if (fresh && type !== "location" && type !== "lore") {
      e.location_id = save.scene.location_id;
    }
    const text = String(f.fact || "").trim().slice(0, 300);
    if (text && !e.facts.some((x) => norm(x.text) === norm(text))) {
      e.facts.push({ text, turn });
      added++;
    }
    e.last_turn = turn;
  }
  return added;
}

// Ledger retrieval: entities at or linked to the current location, or named in the action, the scene, its options or the last turns.
// Returns them best first; the prompt keeps as many as fit its token budget.
export function relevantEntities(save, actionText, { max = 20, factsEach = 6 } = {}) {
  const loc = save.scene.location_id;
  const here = save.ledger.entities[loc];
  const hay = (parts) => ` ${norm(parts.join(" "))} `;
  const inAction = hay([actionText]);
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
  }));
}
