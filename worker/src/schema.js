// Save format: the app's memory. The AI never holds state; every turn is rebuilt from this.
//
// One save per slot, stored in KV under "save:<slot>":
// {
//   v, id, slot, created_at, updated_at,     id is unique per game (archive keys use it)
//   settings: { language, setting, tone },
//   turn,                         number of the scene now on screen (starts at 1)
//   scene: { location_id, narration[], options[] },   what the player sees now
//   actors: { <id>: Actor },      the player ("pc") and, later, companions. Same shape for both.
//   party: [actor ids],           order of the party; companions get appended here
//   ledger: { entities: { <id>: Entity } },           lore ledger, written from new_facts
//   quests: { main: { title, milestones: { <id>: Milestone }, current, finale }, side: {}, focus },
//   summary: { text, through_turn },                  rolling summary (written from Phase 4 on)
//   recent: [TurnRecord],         last RECENT_TURNS turns verbatim
//   last: { request_id, response } | null,           idempotency: a repeated request gets the stored reply
//   counters: { ai_turns, fallbacks, retries, dc{final difficulty: count}, dc_clamped },
// }
// Actor:  { id, kind: "pc"|"companion", name, ledger_id, level, xp, hp, hp_max, stats{might,wits,grit},
//           equipment{slot: item}, inventory[{id,name,qty,note}], conditions[] }
// Entity: { id, type, name, aliases[], location_id, connections[], facts[{text,turn}], first_turn, last_turn, danger (locations only, 0-2, set by code) }
// Gear:   { id, name, slot: "weapon"|"armor", rarity, bonus_stat, damage+mult (weapons) | defense (armor) }. Inventory gear carries it in `gear`.
// Milestone: { id, title, conditions[], status: "undiscovered"|"ongoing"|"completed", next[] }
// Every turn also goes to an archive in chunks: "arc:<game id>:<n>" = [TurnRecord] (ARCHIVE_CHUNK per key).

import { ensureGearStats, rollDanger, xpForLevel } from "./rules.js";

export const SCHEMA_VERSION = 2;
export const STATS = ["might", "wits", "grit"];
export const ENTITY_TYPES = ["npc", "location", "faction", "item", "quest", "lore"];
export const OPTION_KINDS = ["social", "explore", "direct", "cautious", "other"];
export const CLASSIFICATIONS = ["allowed", "conditional", "blocked"];
export const CHANGE_KINDS = ["hp", "xp", "item_add", "item_remove", "condition_add", "condition_remove", "move"];
export const RECENT_TURNS = 5;
export const ARCHIVE_CHUNK = 50;

export function slugify(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

export function newActor(id, kind, fields) {
  return {
    id, kind, name: "", ledger_id: null,
    level: 1, xp: 0, hp: 20, hp_max: 20,
    stats: { might: 0, wits: 0, grit: 0 },
    equipment: {}, inventory: [], conditions: [],
    ...fields,
  };
}

export function newEntity(id, type, name, turn, fields = {}) {
  return { id, type, name, aliases: [], location_id: null, connections: [], facts: [], first_turn: turn, last_turn: turn, ...fields };
}

// Hand-built starting template (the Phase 1 opening). Phase 7 replaces this with the New game flow.
export function newGame(slot = "main", now = new Date().toISOString()) {
  const ford = "location-the-rusted-ford";
  const save = {
    v: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    slot,
    created_at: now,
    updated_at: now,
    settings: {
      language: "English",
      setting: "Gritty low fantasy frontier: muddy roads, river crossings, toll houses, feuding guilds, little magic and all of it feared.",
      tone: "Grounded and wry. Danger is real but quiet. Short, concrete sentences.",
    },
    turn: 1,
    scene: {
      location_id: ford,
      narration: [
        "Rain hammers the old toll house as you shoulder through the door. Inside, a handful of drovers hunch over cold stew, and nobody looks up. The bridge outside is gone; only blackened stumps remain in the river.",
        "A woman by the hearth is sewing a seal onto a leather satchel. She notices your mud-caked boots and finally meets your eye.",
      ],
      options: [
        { text: "Ask the woman about the bridge", kind: "social", stat: "wits", difficulty: 10 },
        { text: "Search the toll house for a way across", kind: "explore", stat: "wits", difficulty: 12 },
        { text: "Offer to buy a round for the drovers", kind: "social", stat: "grit", difficulty: 10 },
        { text: "Step back outside and study the river", kind: "cautious", stat: "wits", difficulty: 11 },
      ],
    },
    actors: {
      pc: newActor("pc", "pc", {
        name: "Ash",
        hp: 18, hp_max: 20,
        stats: { might: 1, wits: 2, grit: 1 },
        equipment: { weapon: { id: "item-worn-shortsword", name: "Worn shortsword" }, armor: { id: "item-oiled-coat", name: "Oiled travel coat" } },
        inventory: [
          { id: "item-coin", name: "Coins", qty: 12, note: "" },
          { id: "item-rations", name: "Trail rations", qty: 3, note: "" },
        ],
      }),
    },
    party: ["pc"],
    ledger: { entities: {} },
    quests: {
      main: {
        title: "The Burned Bridge",
        // Placeholder graph until Phase 6 generates one per game.
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
    summary: { text: "", through_turn: 0 },
    recent: [],
    last: null,
    counters: { ai_turns: 0, fallbacks: 0, retries: 0, dc: {}, dc_clamped: 0 },
  };
  save.ledger.entities[ford] = newEntity(ford, "location", "The Rusted Ford", 1, {
    aliases: ["Rusted Ford", "toll house"],
    danger: 0,
    facts: [
      { text: "An old toll house on the river road", turn: 1 },
      { text: "The bridge was burned; only blackened stumps remain", turn: 1 },
    ],
  });
  for (const [slot, item] of Object.entries(save.actors.pc.equipment)) ensureGearStats(item, slot);
  return save;
}

// Upgrade older saves in place. Add a step here whenever SCHEMA_VERSION goes up.
export function migrate(save) {
  if (!save || typeof save !== "object") throw new Error("bad save");
  if (save.v > SCHEMA_VERSION) throw new Error(`save v${save.v} is newer than this server (v${SCHEMA_VERSION})`);
  if (save.v < 2) {
    // v2: rules engine. Gear stats, location danger, difficulty log.
    for (const a of Object.values(save.actors)) for (const [slot, item] of Object.entries(a.equipment)) ensureGearStats(item, slot);
    for (const e of Object.values(save.ledger.entities)) if (e.type === "location" && e.danger === undefined) e.danger = e.id === "location-the-rusted-ford" ? 0 : rollDanger(save, e.id);
    save.counters.dc ??= {};
    save.counters.dc_clamped ??= 0;
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

// What the phone gets: no internal option stats or difficulties (option text stays neutral).
export function publicState(save, extra = {}) {
  const p = pc(save);
  return {
    turn: save.turn,
    location: locationName(save, save.scene.location_id),
    pc: { name: p.name, hp: p.hp, hp_max: p.hp_max, level: p.level, xp: p.xp, xp_next: p.level >= 10 ? null : xpForLevel(p.level + 1), stats: p.stats, equipment: p.equipment, inventory: p.inventory.map((i) => ({ name: i.name, qty: i.qty })), conditions: p.conditions },
    scene: { narration: save.scene.narration, options: save.scene.options.map((o) => o.text) },
    recent: save.recent.map((t) => ({ n: t.n, action: t.action.text, dice: t.dice, narration: t.narration })),
    ...extra,
  };
}

// Read-only view of the lore ledger for the Ledger screen: what the app remembers, no AI involved.
export function ledgerView(save) {
  const name = (id) => save.ledger.entities[id]?.name;
  const entities = Object.values(save.ledger.entities)
    .map((e) => ({ type: e.type, name: e.name, where: e.type === "location" ? undefined : name(e.location_id), links: e.connections.map(name).filter(Boolean), facts: e.facts.map((f) => f.text), last_turn: e.last_turn }))
    .sort((a, b) => ENTITY_TYPES.indexOf(a.type) - ENTITY_TYPES.indexOf(b.type) || a.name.localeCompare(b.name));
  return { turn: save.turn, here: name(save.scene.location_id), entities };
}
