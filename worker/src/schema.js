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
//   ledger: { entities: { <id>: Entity } },           lore ledger, written from new_facts
//   quests: { main: { title, milestones: { <id>: Milestone }, current, finale }, side: {}, focus },
//   summary: { text, through_turn, requested_through, requested_at },   rolling summary of turns 1..through_turn
//                                 (written in the background by a cheap model into "sum:<game id>", adopted on the next request)
//   recent: [TurnRecord],         turns not yet summarized plus the newest RECENT_PROMPT, at most RECENT_KEEP
//   last: { request_id, response } | null,           idempotency: a repeated request gets the stored reply
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
// Entity: { id, type, name, aliases[] (earlier names, kept on rename or merge), location_id, connections[], facts[{text,turn}], first_turn, last_turn, danger (locations only, 0-2, set by code) }
// Gear:   { id, name, slot: "weapon"|"armor", rarity, bonus_stat, big?, damage+mult (weapons) | defense (armor) }. Inventory gear carries it in `gear`.
// Option: { text, kind, stat, tier: "easy"|"standard"|"hard"|"daunting", edge: "none"|"advantage"|"disadvantage", edge_why }
// Milestone: { id, title, conditions[], status: "undiscovered"|"ongoing"|"completed", next[] }
// Every turn also goes to an archive in chunks: "arc:<game id>:<n>" = [TurnRecord] (ARCHIVE_CHUNK per key).

import { ensureGearStats, rollDanger, xpForLevel, MAX_LEVEL, maxHpOf, packUsed, packSlots, alignLabel, catchUpPicks } from "./rules.js";
import { BACKGROUNDS, DRIVES, FLAWS, TALENTS, tierFromNumber } from "./content.js";
import { buildActor, DEFAULT_CHARACTER, validateCharacter } from "./character.js";

export const SCHEMA_VERSION = 4;
export const STATS = ["might", "wits", "charm", "grit"];
export const ENTITY_TYPES = ["npc", "location", "faction", "item", "quest", "lore"];
export const OPTION_KINDS = ["social", "explore", "direct", "cautious", "other"];
export const OPTION_TIERS = ["easy", "standard", "hard", "daunting"];
export const OPTION_EDGES = ["none", "advantage", "disadvantage"];
export const CLASSIFICATIONS = ["allowed", "conditional", "blocked"];
export const CHANGE_KINDS = ["hp", "xp", "item_add", "item_remove", "condition_add", "condition_remove", "move", "law", "good"];
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

// Hand-built starting scene (the Phase 1 opening) for whatever character the player made. Phase 7 and 8 replace it with a generated region.
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
        { text: "Ask the woman about the bridge", kind: "social", stat: "charm", tier: "standard", edge: "none", edge_why: "" },
        { text: "Search the toll house for a way across", kind: "explore", stat: "wits", tier: "standard", edge: "none", edge_why: "" },
        { text: "Offer to buy a round for the drovers", kind: "social", stat: "charm", tier: "easy", edge: "none", edge_why: "" },
        { text: "Step back outside and study the river", kind: "cautious", stat: "wits", tier: "standard", edge: "none", edge_why: "" },
      ],
    },
    actors: { pc: actor },
    party: ["pc"],
    ledger: { entities: {} },
    quests: {
      main: {
        title: "The Burned Bridge",
        // Placeholder graph until Phase 7 generates one per game.
        milestones: {
          "m1": { id: "m1", title: "Learn who burned the bridge at the Rusted Ford", conditions: ["The player knows who ordered the burning"], status: "ongoing", next: ["m2"] },
          "m2": { id: "m2", title: "Find out why they want the road closed", conditions: ["The player learns what the closed road protects or hides"], status: "undiscovered", next: ["m3"] },
          "m3": { id: "m3", title: "Reopen the road", conditions: ["The crossing is usable again or the culprit is stopped"], status: "undiscovered", next: [] },
        },
        current: "m1",
        finale: "m3",
      },
      side: {},
      focus: "main",
    },
    // The opening scene has no turn record, so the summary starts with it.
    summary: { text: openingSummary(actor.name), through_turn: 0, requested_through: 0, requested_at: null },
    recent: [],
    last: null,
    failed: [],
    fm: null,
    counters: { ai_turns: 0, fallbacks: 0, retries: 0, dc: {}, dc_clamped: 0, tiers: {}, results: {}, edges: 0, summaries: 0, merges: 0, fact_merges: 0, options_dropped: 0, variety_low: 0, kinds: {} },
  };
  save.ledger.entities[FORD] = newEntity(FORD, "location", "The Rusted Ford", 1, {
    aliases: ["Rusted Ford", "toll house"],
    danger: 0,
    facts: [
      { text: "An old toll house on the river road in the Fenmarch", turn: 1 },
      { text: "The bridge was burned; only blackened stumps remain", turn: 1 },
    ],
  });
  return save;
}

const toOption = (o) => ({ text: o.text, kind: o.kind, stat: o.stat, tier: OPTION_TIERS.includes(o.tier) ? o.tier : tierFromNumber(Number(o.difficulty) || 10), edge: OPTION_EDGES.includes(o.edge) ? o.edge : "none", edge_why: o.edge_why || "" });

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

// What the phone gets: no internal option stats or difficulties (option text stays neutral).
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
    scene: { narration: save.scene.narration, options: save.scene.options.map((o) => o.text) },
    recent: save.recent.slice(-RECENT_PROMPT).map((t) => ({ n: t.n, action: t.action.text, dice: t.dice, narration: t.narration })),
    ...extra,
  };
}

// Read-only view of the lore ledger for the Ledger screen: what the app remembers, no AI involved.
export function ledgerView(save) {
  const name = (id) => save.ledger.entities[id]?.name;
  const entities = Object.values(save.ledger.entities)
    .map((e) => ({ type: e.type, name: e.name, aliases: e.aliases, where: e.type === "location" ? undefined : name(e.location_id), links: e.connections.map(name).filter(Boolean), facts: e.facts.map((f) => f.text), last_turn: e.last_turn }))
    .sort((a, b) => ENTITY_TYPES.indexOf(a.type) - ENTITY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
  return { turn: save.turn, here: name(save.scene.location_id), entities };
}
