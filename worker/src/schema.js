// Save format: the app's memory. The AI never holds state; every turn is rebuilt from this.
//
// One save per slot, stored in KV under "save:<slot>":
// {
//   v, id, slot, created_at, updated_at,     id is unique per game (archive keys use it)
//   settings: { language, tone },            the world itself is the fixed world core (world.js)
//   turn,                         number of the scene now on screen (starts at 1)
//   scene: { location_id, narration[], options[] },   what the player sees now
//   actors: { <id>: Actor },      the player ("pc") and, later, companions. Same shape for both.
//   party: [actor ids],           order of the party; companions get appended here
//   ledger: { entities: { <id>: Entity } },           lore ledger, written from new_facts (and the generated region)
//   world: { name, summary, truth, stake, start, block, extra_places, model, cost } | null,   the generated region (region.js);
//                                 null for the fixed Rusted Ford opening. block is the static region text for the cached prompt
//   quests: { main: Main, side: { <id>: Side }, focus: "main"|<side id>, flags: [{turn, text}], side_seq },   quest.js
//   clock: { name, signs[8], dooms[3], filled, dooms_hit, pending: [told next turn], seen: [{turn, kind, text}] },   threat clock
//   time: { day, part: 0-3 (morning, afternoon, evening, night), idle },   code-owned day and time of day
//   over: { kind: "won", turn, branch, epilogue: [paragraphs] | null } | null,   game complete (Phase 6 adds "dead")
//   summary: { text, through_turn, requested_through, requested_at },   rolling summary of turns 1..through_turn
//                                 (written in the background by a cheap model into "sum:<game id>", adopted on the next request)
//   recent: [TurnRecord],         turns not yet summarized plus the newest RECENT_PROMPT, at most RECENT_KEEP
//   last: { request_id, response } | null,           idempotency: a repeated request gets the stored reply
//   intro: { cost, narration[], options[] } | absent,  the AI-written opening scene (turn 1 has no turn record)
//   failed: [{ text, n, loc }],   approaches that failed lately; not offered again unchanged (rules.js recordFailure)
//   fm: { entity, requested_at } | null,             a background fact merge is running for this entity (factmerge.js)
//   fallback_log: [{ ts, turn, reason, detail }],    last 5 fallback turns (optional; created on the first fallback)
//   counters: { ai_turns, fallbacks, retries, dc{final difficulty: count}, dc_clamped (legacy), tiers{}, results{}, edges,
//               summaries, merges, fact_merges, options_dropped (repeats removed), variety_low (turns with < 3 option kinds), kinds{kind: count} },
// }
// Actor:  { id, kind: "pc"|"companion", name, ledger_id, level, xp, hp, hp_max, stats{might,wits,charm,grit},
//           equipment{slot: item}, inventory[{id,name,qty,note,gear?}], conditions[],
//           bio {background, drive, flaw} | null, align {law, good} (hidden numbers, -12..12), talents[{id, ready_turn}],
//           picks[{kind: "stat"|"talent", level, offer?}] (level-up choices waiting), edge_next {kind, from} | null }
// Entity: { id, type, name, aliases[] (earlier names, kept on rename or merge), location_id, connections[], facts[{text,turn,kind}], first_turn, last_turn,
//           known (false: generated but not yet heard of; hidden from the Ledger view),
//           locations: danger (0-2, set by code), travel { <location id>: parts of a day }, region (generated)
//           npcs: attitude (-2..2), met, profile { want, fear, secret, voice } | null, values, base, faction }
// Gear:   { id, name, slot: "weapon"|"armor", rarity, bonus_stat, big?, damage+mult (weapons) | defense (armor) }. Inventory gear carries it in `gear`.
// Option: { text, kind, stat, tier: "easy"|"standard"|"hard"|"daunting", edge: "none"|"advantage"|"disadvantage", edge_why,
//           value: "scene"|"advance"|"costly"|"sidetrack"|"choose" (hidden), quest: quest id (or branch id for choose), npc }
// Main: { title, conflict, milestones: { <id>: Milestone }, current, fork, branches: [{ id, choice, outcome, first }], branch, choosing }
// Milestone: { id, title, goal, leads: [{ text, target, revealed, turn }], status: "undiscovered"|"ongoing"|"completed", next[], branch, final,
//              steps, need, started_turn, last_step_turn, last_move_turn }
// Side: { id, title, goal, giver, place, leads[], status: "hidden"|"active"|"completed"|"failed", origin: "seed"|"story", steps, need, ... }
// Every turn also goes to an archive in chunks: "arc:<game id>:<n>" = [TurnRecord] (ARCHIVE_CHUNK per key).

import { ensureGearStats, rollDanger, xpForLevel, MAX_LEVEL, maxHpOf, packUsed, packSlots, alignLabel, catchUpPicks } from "./rules.js";
import { BACKGROUNDS, DRIVES, FLAWS, TALENTS, STAT_LABELS, KIND_LABELS, tierFromNumber } from "./content.js";
import { buildActor, DEFAULT_CHARACTER, validateCharacter } from "./character.js";
import { newQuests, newClock, newTime, openStory, PLACEHOLDER_MAIN, PLACEHOLDER_CLOCK, timeLabel, publicQuests, attitudeLabel, VALUES } from "./quest.js";

export const SCHEMA_VERSION = 6;
export const STATS = ["might", "wits", "charm", "grit"];
export const ENTITY_TYPES = ["npc", "location", "faction", "item", "quest", "lore"];
// A stored fact must be one of these lasting kinds; there is deliberately no "event" kind (what someone did in one scene).
export const FACT_KINDS = ["identity", "want", "relationship", "secret", "status", "place"];
export const OPTION_KINDS = ["social", "explore", "direct", "cautious", "other"];
export const OPTION_TIERS = ["easy", "standard", "hard", "daunting"];
export const OPTION_EDGES = ["none", "advantage", "disadvantage"];
export const CLASSIFICATIONS = ["allowed", "conditional", "blocked"];
export const CHANGE_KINDS = ["hp", "xp", "item_add", "item_remove", "condition_add", "condition_remove", "move", "law", "good", "attitude", "time"];
export const OPTION_VALUES = VALUES; // scene, advance, costly, sidetrack ("choose" is added by code for the key decision)
export const CUSTOM_TIERS = ["none", "easy", "standard", "hard", "daunting"];
export const RESULTS = ["none", "success", "cost", "failure"];
export const RECENT_PROMPT = 5; // turns the prompt shows verbatim (the newest one is the current scene)
export const RECENT_KEEP = 12; // turns kept in the save until the summary has them
export const SUMMARY_BATCH = 5; // summarize once this many turns have left the verbatim window
export const ARCHIVE_CHUNK = 50;

export function slugify(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

export function newActor(id, kind, fields) {
  return {
    id, kind, name: "", ledger_id: null,
    level: 1, xp: 0, hp: 20, hp_max: 20,
    stats: { might: 0, wits: 0, charm: 0, grit: 0 },
    equipment: {}, inventory: [], conditions: [],
    bio: null, align: { law: 0, good: 0 }, talents: [], picks: [], edge_next: null,
    ...fields,
  };
}

export function newEntity(id, type, name, turn, fields = {}) {
  return { id, type, name, aliases: [], location_id: null, connections: [], facts: [], first_turn: turn, last_turn: turn, ...fields };
}

const openingSummary = (name) => `${name} came to the old toll house at the Rusted Ford in heavy rain and found the bridge burned. Drovers sat over cold stew; a woman by the hearth was sewing a seal onto a leather satchel.`;
const FORD = "location-the-rusted-ford";

// Hand-built starting scene (the Phase 1 opening) for whatever character the player made. With an API key, New game replaces it
// with a generated region (region.js applyRegion); without one, or for a test, this placeholder story is played.
export function newGame(slot = "main", now = new Date().toISOString(), characterInput = DEFAULT_CHARACTER) {
  const { character, error } = validateCharacter(characterInput);
  if (error) throw new Error(`bad character: ${error}`);
  const actor = buildActor(character);
  const save = {
    v: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    slot,
    created_at: now,
    updated_at: now,
    settings: {
      language: "English",
      tone: "Grounded and wry. Danger is real but quiet. Short, concrete sentences.",
    },
    turn: 1,
    scene: {
      location_id: FORD,
      narration: [
        "Rain hammers the old toll house as you shoulder through the door. Inside, a handful of drovers hunch over cold stew, and nobody looks up. The bridge outside is gone; only blackened stumps remain in the river.",
        "A woman by the hearth is sewing a seal onto a leather satchel. She notices your mud-caked boots and finally meets your eye.",
      ],
      options: [
        { text: "Ask the woman about the bridge", kind: "social", stat: "charm", tier: "standard", edge: "none", edge_why: "", value: "advance", quest: "main", npc: "" },
        { text: "Search the toll house for a way across", kind: "explore", stat: "wits", tier: "standard", edge: "none", edge_why: "", value: "scene", quest: "", npc: "" },
        { text: "Offer to buy a round for the drovers", kind: "social", stat: "charm", tier: "easy", edge: "none", edge_why: "", value: "scene", quest: "", npc: "" },
        { text: "Step back outside and study the river", kind: "cautious", stat: "wits", tier: "standard", edge: "none", edge_why: "", value: "sidetrack", quest: "", npc: "" },
      ],
    },
    actors: { pc: actor },
    party: ["pc"],
    ledger: { entities: {} },
    world: null,
    quests: newQuests(PLACEHOLDER_MAIN),
    clock: newClock(PLACEHOLDER_CLOCK),
    time: newTime(),
    over: null,
    // The opening scene has no turn record, so the summary starts with it.
    summary: { text: openingSummary(actor.name), through_turn: 0, requested_through: 0, requested_at: null },
    recent: [],
    last: null,
    failed: [],
    fm: null,
    counters: { ai_turns: 0, fallbacks: 0, retries: 0, dc: {}, dc_clamped: 0, tiers: {}, results: {}, edges: 0, summaries: 0, merges: 0, fact_merges: 0, options_dropped: 0, variety_low: 0, kinds: {}, values: {}, no_quest_option: 0, steps: 0 },
  };
  save.ledger.entities[FORD] = newEntity(FORD, "location", "The Rusted Ford", 1, {
    aliases: ["Rusted Ford", "toll house"],
    danger: 0,
    facts: [
      { text: "An old toll house on the river road in the Fenmarch", turn: 1 },
      { text: "The bridge was burned; only blackened stumps remain", turn: 1 },
    ],
  });
  openStory(save, 1);
  return save;
}

const toOption = (o) => ({ text: o.text, kind: o.kind, stat: o.stat, tier: OPTION_TIERS.includes(o.tier) ? o.tier : tierFromNumber(Number(o.difficulty) || 10), edge: OPTION_EDGES.includes(o.edge) ? o.edge : "none", edge_why: o.edge_why || "", value: o.value || "scene", quest: o.quest || "", npc: o.npc || "" });

// Upgrade older saves in place. Add a step here whenever SCHEMA_VERSION goes up (and keep a test that migrates an old save).
// The server keeps a copy of the old save before it stores a migrated one (index.js loadSave).
export function migrate(save) {
  if (!save || typeof save !== "object") throw new Error("bad save");
  if (save.v > SCHEMA_VERSION) throw new Error(`save v${save.v} is newer than this server (v${SCHEMA_VERSION})`);
  if (save.v < 2) {
    // v2: rules engine. Gear stats, location danger, difficulty log.
    for (const a of Object.values(save.actors)) for (const [slot, item] of Object.entries(a.equipment)) ensureGearStats(item, slot);
    for (const e of Object.values(save.ledger.entities)) if (e.type === "location" && e.danger === undefined) e.danger = e.id === FORD ? 0 : rollDanger(save, e.id);
    save.counters.dc ??= {};
    save.counters.dc_clamped ??= 0;
  }
  if (save.v < 3) {
    // v3: rolling summary bookkeeping and prompt counters. Turns that already fell out of `recent` are summarized from the archive.
    save.summary.requested_through ??= 0;
    if (!save.summary.text && save.ledger.entities[FORD]) save.summary.text = openingSummary(save.actors[save.party[0]]?.name || "The traveller");
    save.summary.requested_at ??= null;
    Object.assign(save.counters, { summaries: 0, merges: 0, options_dropped: 0, variety_low: 0, kinds: {}, ...save.counters });
  }
  if (save.v < 4) {
    // v4: Character. Four stats (Charm is new), alignment, talents, level-up picks, difficulty tiers, pack slots, failed approaches.
    for (const a of Object.values(save.actors)) {
      a.stats.charm ??= 0;
      a.align ??= { law: 0, good: 0 };
      a.bio ??= null;
      a.talents ??= [];
      a.picks ??= [];
      a.edge_next ??= null;
      a.hp_max = maxHpOf(a);
      a.hp = Math.max(1, Math.min(a.hp, a.hp_max));
      if (a.kind === "pc" && !a.talents.length) catchUpPicks(save, a); // a starting talent, and one per odd level reached
    }
    save.scene.options = save.scene.options.map(toOption);
    for (const t of save.recent) t.options = (t.options || []).map(toOption);
    delete save.settings.setting;
    save.failed ??= [];
    save.fm ??= null;
    Object.assign(save.counters, { tiers: {}, results: {}, edges: 0, fact_merges: 0, ...save.counters });
  }
  if (save.v < 5) {
    // v5: Grim Resolve became Stubborn; facts may carry a kind.
    for (const a of Object.values(save.actors)) {
      for (const t of a.talents || []) if (t.id === "grim-resolve") t.id = "stubborn";
      for (const p of a.picks || []) if (p.offer) p.offer = [...new Set(p.offer.map((id) => (id === "grim-resolve" ? "stubborn" : id)))];
    }
    save.fm ??= null;
  }
  if (save.v < 6) {
    // v6: quest structure. The old three-step placeholder becomes the new quest shape with leads, from the turn it is migrated;
    // a threat clock, the day and time of day; every known person has met the character and is neutral.
    const old = save.quests?.main?.milestones || {};
    save.world ??= null;
    save.quests = newQuests(PLACEHOLDER_MAIN);
    const main = save.quests.main;
    const done = ["m1", "m2", "m3"].filter((id) => old[id]?.status === "completed");
    for (const id of done) main.milestones[id].status = "completed";
    const cur = ["m1", "m2", "m3"].find((id) => !done.includes(id)) || "m3";
    main.current = cur;
    openStory(save, save.turn);
    save.clock ??= newClock(PLACEHOLDER_CLOCK);
    save.time ??= newTime();
    save.over ??= null;
    for (const e of Object.values(save.ledger.entities)) {
      e.known ??= true;
      if (e.type === "npc") { e.attitude ??= 0; e.met ??= true; e.profile ??= null; }
    }
    save.scene.options = save.scene.options.map(toOption);
    for (const t of save.recent) t.options = (t.options || []).map(toOption);
    Object.assign(save.counters, { values: {}, no_quest_option: 0, steps: 0, ...save.counters });
  }
  save.v = SCHEMA_VERSION;
  return save;
}

export function pc(save) {
  return save.actors[save.party[0]];
}

export function locationName(save, id) {
  return save.ledger.entities[id]?.name || "Somewhere";
}

// The level-up choice waiting for the player, shaped for the phone.
function publicPick(a) {
  const p = a.picks?.[0];
  if (!p) return null;
  if (p.kind === "stat") return { kind: "stat", level: p.level, stats: STATS.map((s) => ({ stat: s, value: a.stats[s] })) };
  return { kind: "talent", level: p.level, offer: p.offer.map((id) => ({ id, name: TALENTS[id].name, text: TALENTS[id].text })) };
}

// What the phone gets: each option with its kind and stat as a small tag, but never its difficulty or edge (option text stays neutral).
export function publicState(save, extra = {}) {
  const p = pc(save);
  const bio = p.bio && { background: BACKGROUNDS[p.bio.background]?.name || "", drive: DRIVES[p.bio.drive]?.text || "", flaw: FLAWS[p.bio.flaw]?.name || "", flaw_text: FLAWS[p.bio.flaw]?.text || "" };
  return {
    turn: save.turn,
    location: locationName(save, save.scene.location_id),
    pc: {
      name: p.name, bio, hp: p.hp, hp_max: p.hp_max, level: p.level, xp: p.xp,
      xp_floor: xpForLevel(p.level), xp_next: p.level >= MAX_LEVEL ? null : xpForLevel(p.level + 1),
      stats: p.stats, align: alignLabel(p.align), equipment: p.equipment,
      inventory: p.inventory.map((i) => ({ id: i.id, name: i.name, qty: i.qty, big: !!i.gear?.big })),
      slots: { used: packUsed(p), max: packSlots(p) },
      conditions: p.conditions,
      talents: (p.talents || []).map((t) => ({ id: t.id, name: TALENTS[t.id].name, text: TALENTS[t.id].text, use: TALENTS[t.id].use, ready_in: Math.max(0, t.ready_turn - save.turn) })),
      edge_next: p.edge_next ? { kind: p.edge_next.kind } : null,
      pick: publicPick(p), picks_left: p.picks?.length || 0,
    },
    time: timeLabel(save.time), part: ["morning", "afternoon", "evening", "night"][save.time.part],
    scene: { narration: save.scene.narration, options: save.scene.options.map((o) => ({ text: o.text, tag: o.value === "choose" ? "Decision" : [KIND_LABELS[o.kind], STAT_LABELS[o.stat]].filter(Boolean).join(" · ") })) },
    recent: save.recent.slice(-RECENT_PROMPT).map((t) => ({ n: t.n, action: t.action.text, dice: t.dice, narration: t.narration, events: t.events || [] })),
    focus: save.quests.focus === "main" ? save.quests.main.title : save.quests.side[save.quests.focus]?.title || save.quests.main.title,
    over: save.over ? { kind: save.over.kind, turn: save.over.turn, epilogue: save.over.epilogue } : null,
    ...extra,
  };
}

// Read-only view of the lore ledger for the Ledger screen: what the app remembers, no AI involved.
export function ledgerView(save) {
  const name = (id) => save.ledger.entities[id]?.name;
  const known = (id) => save.ledger.entities[id]?.known !== false && name(id);
  // Generated people and places stay out of view until the character has heard of them; secrets stay hidden (they are in the profile).
  const entities = Object.values(save.ledger.entities).filter((e) => e.known !== false)
    .map((e) => ({ type: e.type, name: e.name, aliases: e.aliases, where: e.type === "location" ? undefined : known(e.location_id) || undefined, links: e.connections.map(known).filter(Boolean),
      attitude: e.type === "npc" && e.met !== false ? attitudeLabel(e.attitude) : undefined, facts: e.facts.map((f) => f.text), last_turn: e.last_turn }))
    .sort((a, b) => ENTITY_TYPES.indexOf(a.type) - ENTITY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
  return { turn: save.turn, here: name(save.scene.location_id), entities };
}

export { publicQuests };
