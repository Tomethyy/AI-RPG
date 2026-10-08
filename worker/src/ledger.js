// Lore ledger: every named thing the AI invents becomes an entity record with facts.
import { ENTITY_TYPES, newEntity, slugify } from "./schema.js";
import { rollDanger } from "./rules.js";

const norm = (s) => String(s || "").toLowerCase().replace(/^(the|a|an)\s+/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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

// new_facts: [{ entity, type, fact, location }]. Returns how many facts were actually added.
export function applyNewFacts(save, facts, turn) {
  let added = 0;
  for (const f of facts) {
    const type = ENTITY_TYPES.includes(f.type) ? f.type : "lore";
    let e = findEntity(save, f.entity, type);
    const fresh = !e;
    if (fresh) e = createEntity(save, type, f.entity, turn);
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

// Phase 2 retrieval: entities at the current location or named in the action or recent narration.
// Capped so the prompt stays flat; Phase 4 replaces this with a token budget.
export function relevantEntities(save, actionText, { max = 10, factsEach = 6 } = {}) {
  const loc = save.scene.location_id;
  const haystack = ` ${norm([actionText, ...save.scene.narration, ...save.recent.slice(-2).flatMap((t) => t.narration)].join(" "))} `;
  const scored = [];
  for (const e of Object.values(save.ledger.entities)) {
    let score = 0;
    if (e.id === loc) score += 100;
    if (e.location_id === loc) score += 10;
    if (e.connections.includes(loc)) score += 5;
    if ([e.name, ...e.aliases].some((n) => norm(n) && haystack.includes(` ${norm(n)} `))) score += 20;
    if (score) scored.push([score + e.last_turn / 1e4, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, max).map(([, e]) => ({
    name: e.name,
    type: e.type,
    where: e.type === "location" ? undefined : save.ledger.entities[e.location_id]?.name,
    facts: e.facts.slice(-factsEach).map((x) => x.text),
  }));
}
