// Region generation (Phase 7): one AI call at New game writes the hidden story plan inside the fixed world core:
// places with travel times, factions, key people with profiles, the hidden truth, the character's personal stake,
// the milestone graph with 3 leads each and a branching finale, the threat clock, and seeded side quests.
// Code fixes the shape and checks the reply like a turn; everything goes into the save (and the ledger) before turn 1.
import { makeClient, costUSD, DEFAULT_TURN_MODEL } from "./ai.js";
import { WORLD } from "./world.js";
import { BACKGROUNDS, DRIVES, FLAWS } from "./content.js";
import { rng } from "./rules.js";
import { createEntity, findEntity, norm } from "./ledger.js";
import { newQuests, newClock, newTime, openStory, travelWords, CLOCK_SEGMENTS, MAX_DOOMS } from "./quest.js";
import { fit } from "./prompt.js";

export const DEFAULT_REGION_EFFORT = "medium";
const MAX_TOKENS = 20000; // thinking + about 5k tokens of JSON
const TIMEOUT_MS = 240_000;
const MAX_ATTEMPTS = 2;
export const TRUNK = 6, BRANCHES = 2, BRANCH_LEN = 2, LEADS = 3;
const REGION_BUDGET = 1100; // tokens of the static region block in the cached system prompt

// Variety between games: code picks the part of the realm and a starting idea; the AI may twist it.
const SETTINGS = ["the Fenmarch (river toll roads, ferries, feuding guilds)", "the Reach (farmland and river towns)", "the edge of the Greywold (old forest, elf country)", "the foothills of the Spine (mines, dwarf trade, the Karsk border)", "the Reach near Highmark (the weak Crown's own country)"];
const IDEAS = ["a disputed inheritance", "a missing tax convoy", "a forged guild charter", "a sickness in the wells", "a heretic preacher drawing crowds", "a sealed Vael ruin that was opened", "a stolen Church relic", "a hedge-mage hiding among villagers", "a feud between two guild families", "a bandit company that went quiet", "a bridge, mill or mine that someone wants ruined", "a murdered Concord warden", "a debt ledger that would ruin powerful people", "beasts driven out of the wild by something worse"];

const str = { type: "string" };
const lead = { type: "object", additionalProperties: false, required: ["text", "target"], properties: { text: str, target: str } };
const milestone = { type: "object", additionalProperties: false, required: ["title", "goal", "leads"], properties: { title: str, goal: str, leads: { type: "array", items: lead } } };
export const REGION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["region", "truth", "stake", "start", "places", "factions", "npcs", "main", "clock", "side_quests"],
  properties: {
    region: { type: "object", additionalProperties: false, required: ["name", "summary", "customs"], properties: { name: str, summary: str, customs: { type: "array", items: str } } },
    truth: str,
    stake: str,
    start: str,
    places: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "kind", "description", "links"], properties: {
      name: str, kind: str, description: str,
      links: { type: "array", items: { type: "object", additionalProperties: false, required: ["to", "parts"], properties: { to: str, parts: { type: "integer" } } } },
    } } },
    factions: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "goal", "method"], properties: { name: str, goal: str, method: str } } },
    npcs: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "role", "faction", "place", "want", "fear", "secret", "voice", "values", "base"], properties: {
      name: str, role: str, faction: str, place: str, want: str, fear: str, secret: str, voice: str,
      values: { type: "string", enum: ["law", "chaos", "good", "evil", "none"] }, base: { type: "integer" },
    } } },
    main: { type: "object", additionalProperties: false, required: ["title", "conflict", "milestones", "branches"], properties: {
      title: str, conflict: str, milestones: { type: "array", items: milestone },
      branches: { type: "array", items: { type: "object", additionalProperties: false, required: ["choice", "outcome", "milestones"], properties: { choice: str, outcome: str, milestones: { type: "array", items: milestone } } } },
    } },
    clock: { type: "object", additionalProperties: false, required: ["name", "signs", "dooms"], properties: { name: str, signs: { type: "array", items: str }, dooms: { type: "array", items: str } } },
    side_quests: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "goal", "giver", "place", "leads"], properties: { title: str, goal: str, giver: str, place: str, leads: { type: "array", items: lead } } } },
  },
};

export const REGION_RULES = `You design the hidden story plan for a long solo text RPG in a fixed fantasy world. The app stores your plan and reveals it to the player piece by piece over about 300 turns; a narrator AI plays it out turn by turn and must never contradict it. Reply with one JSON object.

World (fixed; never contradict it):
${WORLD}

What makes a good plan:
- Continuity first. One central conflict with a hidden truth: who did what, why, and what they will do next if nobody stops them. Every milestone uncovers a piece of that truth or acts on it; nothing is random. Key people act for stated reasons.
- Texture, not quotas. Name concrete places, people, customs and institutions of Calder and of this region (the Lantern Church, the Concord, the Crown, local habits, trades, food, weather). Magic, monsters and non-humans appear only where the story calls for them.
- Grounded and specific: a forged seal, a missing ferryman, a debt ledger, an opened Vael ruin; never "an ancient evil awakens".
- A personal stake: tie the character's drive to the conflict (a debt, a missing person, an enemy, a past that catches up). The story opens from it.
- Fair: the character is not a chosen one. Every lead points to a place, person or item that exists in this plan.

Shape (exact counts; the app rejects anything else):
- region: name, a summary of 2 sentences (a small area inside the given part of Calder), customs: 3 concrete local customs or details.
- places: 6 to 8, each with a kind (village, inn, ferry, ruin, manor...), a description under 25 words, and links to other places in this list with travel time in parts of a day (1 = a few hours, 2 = half a day, 4 = a full day). Every place reachable. start = the name of the place where the story opens.
- factions: 3 or 4 local groups with a goal and a method.
- npcs: 4 to 6 key people. role (under 8 words), faction (a faction name or ""), place (a place name), want, fear, secret, voice (a quirk of speech or manner), values (what they respect: law, chaos, good, evil or none), base (their attitude to strangers: -1, 0 or 1).
- truth: the hidden truth in 3 to 5 sentences.
- stake: the character's personal stake, 1 or 2 sentences, second person ("Your brother...").
- main: title, conflict (one sentence), exactly ${TRUNK} milestones shared by every playthrough, then exactly ${BRANCHES} branches. Milestone ${TRUNK} ends at a key decision; each branch is one side of it: choice (what the character commits to, under 10 words, e.g. "Hand the ledger to the Wardens"), outcome (where that path leads, one sentence) and exactly ${BRANCH_LEN} milestones, the second of which is the finale.
- Each milestone: title (under 10 words), goal (a yes/no condition, e.g. "The character knows who ordered the fire") and exactly ${LEADS} leads. A lead is a clue under 25 words that points to a place, person or item from this plan (target = its exact name). Any one lead is enough to make progress. Milestones grow from small and local (what happened, who) to large (stopping it); each is about 40 turns of play.
- clock: the threat if the character dawdles: name, ${CLOCK_SEGMENTS} warning signs (escalating, concrete things the character can see or hear about), ${MAX_DOOMS} dooms (hard setbacks if the clock fills: an ally lost, a place falls, evidence destroyed; never the end of the story).
- side_quests: 2 or 3, each from a key person (giver = their name) at a place, tied to the region but not required for the main quest: title, goal, giver, place, ${LEADS} leads.

Names: concrete and varied, fitting a river kingdom; no apostrophes inside names. Use every name exactly the same way everywhere.`;

export function regionRequest(character, seedText) {
  const r = rng(`${seedText}:region`);
  const bg = BACKGROUNDS[character.background], dr = DRIVES[character.drive], fl = FLAWS[character.flaw];
  return `The player character: ${character.name}, a human ${bg.name.toLowerCase()} (${bg.text}). Drive: ${dr.text} Flaw: ${fl.name} (${fl.text})
Set the story in ${SETTINGS[Math.floor(r() * SETTINGS.length)]}. A starting idea, to use or twist: ${IDEAS[Math.floor(r() * IDEAS.length)]}.`;
}

// ---- validation ----

const clip = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// Returns { spec, errors }; errors means retry. spec is the cleaned plan.
export function validateRegion(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") return { spec: null, errors: ["reply is not a JSON object"] };
  const places = (raw.places || []).map((p) => ({ name: clip(p.name, 60), kind: clip(p.kind, 30), description: clip(p.description, 220), links: (p.links || []).map((l) => ({ to: clip(l.to, 60), parts: clamp(l.parts, 1, 4) })) })).filter((p) => p.name);
  const uniq = (list) => new Set(list.map((x) => norm(x.name))).size === list.length;
  if (places.length < 6 || places.length > 8) errors.push(`need 6 to 8 places, got ${places.length}`);
  if (!uniq(places)) errors.push("place names must be unique");
  const placeBy = (name) => places.find((p) => norm(p.name) === norm(name));
  const start = placeBy(raw.start);
  if (!start) errors.push(`start "${clip(raw.start, 60)}" is not one of the places`);
  for (const p of places) p.links = p.links.filter((l) => placeBy(l.to) && norm(l.to) !== norm(p.name));
  const factions = (raw.factions || []).map((f) => ({ name: clip(f.name, 60), goal: clip(f.goal, 200), method: clip(f.method, 160) })).filter((f) => f.name);
  if (factions.length < 3 || factions.length > 4) errors.push(`need 3 or 4 factions, got ${factions.length}`);
  const npcs = (raw.npcs || []).map((n) => ({
    name: clip(n.name, 50), role: clip(n.role, 80), faction: clip(n.faction, 60), place: clip(n.place, 60),
    want: clip(n.want, 140), fear: clip(n.fear, 140), secret: clip(n.secret, 200), voice: clip(n.voice, 100),
    values: ["law", "chaos", "good", "evil"].includes(n.values) ? n.values : "none", base: clamp(n.base, -1, 1),
  })).filter((n) => n.name);
  if (npcs.length < 4 || npcs.length > 6) errors.push(`need 4 to 6 npcs, got ${npcs.length}`);
  if (!uniq(npcs)) errors.push("npc names must be unique");
  for (const n of npcs) if (!placeBy(n.place)) n.place = start?.name || places[0]?.name || "";
  const leads = (list, where) => {
    const out = (list || []).map((l) => ({ text: clip(l.text, 220), target: clip(l.target, 60) })).filter((l) => l.text);
    if (out.length !== LEADS) errors.push(`${where} needs exactly ${LEADS} leads, got ${out.length}`);
    return out.slice(0, LEADS);
  };
  const ms = (list, where) => (list || []).map((m, i) => ({ title: clip(m.title, 90), goal: clip(m.goal, 200), leads: leads(m.leads, `${where} milestone ${i + 1}`) }));
  const main = raw.main || {};
  const trunk = ms(main.milestones, "main");
  if (trunk.length !== TRUNK) errors.push(`main needs exactly ${TRUNK} milestones, got ${trunk.length}`);
  const branches = (main.branches || []).map((b, i) => ({ choice: clip(b.choice, 80), outcome: clip(b.outcome, 200), milestones: ms(b.milestones, `branch ${i + 1}`) }));
  if (branches.length !== BRANCHES) errors.push(`main needs exactly ${BRANCHES} branches, got ${branches.length}`);
  for (const [i, b] of branches.entries()) if (b.milestones.length !== BRANCH_LEN) errors.push(`branch ${i + 1} needs exactly ${BRANCH_LEN} milestones, got ${b.milestones.length}`);
  for (const m of [...trunk, ...branches.flatMap((b) => b.milestones)]) if (!m.title || !m.goal) errors.push("every milestone needs a title and a goal");
  const clock = { name: clip(raw.clock?.name, 80), signs: (raw.clock?.signs || []).map((s) => clip(s, 160)).filter(Boolean), dooms: (raw.clock?.dooms || []).map((s) => clip(s, 200)).filter(Boolean) };
  if (!clock.name || clock.signs.length < CLOCK_SEGMENTS - 2 || clock.dooms.length < 1) errors.push(`clock needs a name, ${CLOCK_SEGMENTS} signs and ${MAX_DOOMS} dooms`);
  const side = (raw.side_quests || []).map((s, i) => ({ title: clip(s.title, 80), goal: clip(s.goal, 200), giver: clip(s.giver, 50), place: clip(s.place, 60), leads: leads(s.leads, `side quest ${i + 1}`) })).filter((s) => s.title);
  if (side.length < 2 || side.length > 3) errors.push(`need 2 or 3 side quests, got ${side.length}`);
  const region = { name: clip(raw.region?.name, 60), summary: clip(raw.region?.summary, 400), customs: (raw.region?.customs || []).map((c) => clip(c, 160)).filter(Boolean).slice(0, 4) };
  const truth = clip(raw.truth, 900), stake = clip(raw.stake, 300);
  if (!region.name || !truth || !stake) errors.push("region name, truth and stake are required");
  if (errors.length) return { spec: null, errors };

  // Every place reachable from the start: an unlinked one joins the start (half a day).
  const linked = (a, b) => a.links.some((l) => norm(l.to) === norm(b.name));
  for (const p of places) for (const l of p.links) { const o = placeBy(l.to); if (!linked(o, p)) o.links.push({ to: p.name, parts: l.parts }); }
  const seen = new Set([norm(start.name)]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of places) if (seen.has(norm(p.name))) for (const l of p.links) if (!seen.has(norm(l.to))) { seen.add(norm(l.to)); grew = true; }
  }
  for (const p of places) if (!seen.has(norm(p.name))) { p.links.push({ to: start.name, parts: 2 }); start.links.push({ to: p.name, parts: 2 }); seen.add(norm(p.name)); }

  return { spec: { region, truth, stake, start: start.name, places, factions, npcs, main: { title: clip(main.title, 80), conflict: clip(main.conflict, 240), milestones: trunk, branches }, clock, side_quests: side }, errors: [] };
}

// ---- the call ----

// Returns { spec, model, usage, cost, attempts, error }. cost covers every billed attempt.
export async function generateRegion(env, character, seedText) {
  const model = env.REGION_MODEL || env.TURN_MODEL || DEFAULT_TURN_MODEL;
  const client = makeClient(env, { timeout: TIMEOUT_MS });
  const request = regionRequest(character, seedText);
  let lastError = "", cost = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const content = attempt === 1 ? request : `${request}\n\nYour previous plan was rejected: ${lastError}. Write it again, following the shape exactly.`;
    let res;
    try {
      res = await client.messages.create({
        model, max_tokens: MAX_TOKENS, system: REGION_RULES,
        messages: [{ role: "user", content }],
        output_config: { effort: env.REGION_EFFORT || DEFAULT_REGION_EFFORT, format: { type: "json_schema", schema: REGION_SCHEMA } },
      });
    } catch (err) {
      lastError = `API error ${err.status || ""} ${String(err.message || err).slice(0, 200)}`;
      if (err.status === 401 || err.status === 403) break;
      continue;
    }
    for (const k of Object.keys(usage)) usage[k] += res.usage?.[k] || 0;
    cost += costUSD(model, res.usage);
    if (res.stop_reason === "refusal") { lastError = "refused"; continue; }
    if (res.stop_reason === "max_tokens") { lastError = "ran out of tokens; keep every text short"; continue; }
    let raw;
    try { raw = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join("")); } catch { lastError = "reply was not valid JSON"; continue; }
    const { spec, errors } = validateRegion(raw);
    if (spec) return { spec, model: res.model || model, usage, cost, attempts: attempt };
    lastError = errors.slice(0, 6).join("; ");
  }
  return { spec: null, model, usage, cost, attempts: MAX_ATTEMPTS, error: lastError };
}

// ---- seeding a new game ----

// The static region block for the cached system prompt (built once; it never changes during the game).
function regionText(spec) {
  const L = [`## This story's region: ${spec.region.name}`, spec.region.summary];
  if (spec.region.customs.length) L.push(`Customs: ${spec.region.customs.join(" ")}`);
  L.push("Places (the region is the map; travel times between linked places):");
  for (const p of spec.places) L.push(`- ${p.name} (${p.kind}): ${p.description} Links: ${p.links.map((l) => `${l.to} (${travelWords(l.parts)})`).join(", ")}`);
  L.push("Factions:");
  for (const f of spec.factions) L.push(`- ${f.name}: ${f.goal} (${f.method})`);
  L.push(`Key people: ${spec.npcs.map((n) => `${n.name} (${n.role}${n.faction ? `, ${n.faction}` : ""}, at ${n.place})`).join("; ")}`);
  L.push(`Hidden truth (never state it outright; the leads uncover it piece by piece): ${spec.truth}`);
  return fit(L.join("\n"), REGION_BUDGET);
}

// Put a generated plan into a fresh save (from newGame): world, ledger, quests, clock, time, scene and opening summary.
export function applyRegion(save, spec, meta = {}) {
  const ents = save.ledger.entities;
  for (const k of Object.keys(ents)) delete ents[k]; // the fixed Rusted Ford opening is not part of this story
  const placeIds = {};
  for (const p of spec.places) {
    const e = createEntity(save, "location", p.name, 1, { region: true, known: false });
    e.facts.push({ text: `${p.kind ? p.kind[0].toUpperCase() + p.kind.slice(1) + ": " : ""}${p.description}`, turn: 1, kind: "place" });
    placeIds[norm(p.name)] = e.id;
  }
  for (const p of spec.places) {
    const e = ents[placeIds[norm(p.name)]];
    e.travel = {};
    for (const l of p.links) { const id = placeIds[norm(l.to)]; if (!e.connections.includes(id)) e.connections.push(id); e.travel[id] = l.parts; }
  }
  const start = ents[placeIds[norm(spec.start)]];
  start.known = true;
  for (const id of start.connections) ents[id].known = true; // the neighbourhood is known by name
  for (const f of spec.factions) createEntity(save, "faction", f.name, 1, { known: false }).facts.push({ text: f.goal, turn: 1, kind: "want" });
  for (const n of spec.npcs) {
    const e = createEntity(save, "npc", n.name, 1, { known: false, met: false, attitude: 0, base: n.base, values: n.values, faction: n.faction, profile: { want: n.want, fear: n.fear, secret: n.secret, voice: n.voice } });
    e.facts.push({ text: n.role, turn: 1, kind: "identity" });
    e.location_id = placeIds[norm(n.place)] || start.id;
  }
  save.world = {
    name: spec.region.name, summary: spec.region.summary, truth: spec.truth, stake: spec.stake, start: start.id,
    block: regionText(spec), extra_places: 0, model: meta.model, cost: meta.cost,
  };
  save.quests = newQuests(spec.main, spec.side_quests);
  save.clock = newClock(spec.clock);
  save.time = newTime();
  save.scene.location_id = start.id;
  save.counters.region_cost = meta.cost || 0;
  openStory(save, 1);
  const lead = save.quests.main.milestones.m1.leads[0];
  const pc = save.actors[save.party[0]];
  // Shown only if the opening call fails; the intro call replaces it.
  save.scene.narration = [`${spec.region.summary}`, `${spec.stake}`, `You are at ${start.name}. ${lead.text}`];
  save.scene.options = [
    { text: `Follow up the lead about ${lead.target || "what you heard"}`, kind: "explore", stat: "wits", tier: "standard", edge: "none", edge_why: "", value: "advance", quest: "main", npc: findEntity(save, lead.target, "npc") ? lead.target : "" },
    { text: `Ask around ${start.name} for news`, kind: "social", stat: "charm", tier: "standard", edge: "none", edge_why: "", value: "scene", quest: "", npc: "" },
    { text: `Take a careful look around ${start.name}`, kind: "cautious", stat: "wits", tier: "easy", edge: "none", edge_why: "", value: "scene", quest: "", npc: "" },
  ];
  save.summary.text = `${pc.name} came to ${start.name} in ${spec.region.name}. ${spec.stake}`;
  return save;
}
