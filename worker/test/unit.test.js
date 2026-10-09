import { test } from "node:test";
import assert from "node:assert/strict";
import { newGame, migrate, publicState, SCHEMA_VERSION } from "../src/schema.js";
import { applyNewFacts, findEntity, relevantEntities } from "../src/ledger.js";
import { validateTurn, costUSD, buildPrompt, OUTPUT_SCHEMA, SCHEMA_TOKENS } from "../src/ai.js";
import { mergeDue, mergeJob, adoptFactMerge, parseFacts, FACT_TARGET } from "../src/factmerge.js";
import { FACT_CAP, FACT_HARD } from "../src/ledger.js";
import { TALENTS } from "../src/content.js";
import { gainXp, applyPick } from "../src/rules.js";

const good = () => ({
  narration: ["You ask. She answers.", ""],
  options: [
    { text: "Ask about the satchel", kind: "social", stat: "charm", tier: "daunting", edge: "advantage", edge_why: "she owes a favor" },
    { text: "Ask about the satchel", kind: "social", stat: "wits", tier: "easy", edge: "none", edge_why: "" },
    { text: "Check the stable", kind: "explore", stat: "luck", tier: "trivial", edge: "advantage", edge_why: "lantern" },
    { text: "Leave", kind: "weird", stat: "grit", tier: "hard", edge: "disadvantage", edge_why: "" },
  ],
  classification: "allowed",
  state_changes: [{ actor: "pc", kind: "hp", amount: -2, text: "", reason: "cut" }, { actor: "ghost", kind: "hp", amount: 5, text: "", reason: "" }],
  new_facts: [{ entity: "Maren", type: "npc", kind: "identity", fact: "Sews seals", location: "", was: "" }, { entity: "", type: "npc", kind: "identity", fact: "x", location: "", was: "" }],
  quest_flags: ["met_maren"],
});

test("validateTurn normalizes tiers and edges", () => {
  const { turn, errors } = validateTurn(good(), newGame());
  assert.deepEqual(errors, []);
  assert.equal(turn.narration.length, 1);
  assert.equal(turn.options.length, 3); // duplicate dropped
  assert.equal(turn.options[0].tier, "daunting");
  assert.equal(turn.options[0].edge, "advantage"); // the one edge a turn
  assert.equal(turn.options[0].edge_why, "she owes a favor");
  assert.equal(turn.options[1].tier, "standard"); // unknown tier
  assert.equal(turn.options[1].edge, "none"); // a second edge is dropped
  assert.equal(turn.options[1].stat, "wits");
  assert.equal(turn.options[2].kind, "other");
  assert.equal(turn.options[2].edge, "none"); // an edge without a reason is dropped
  assert.equal(validateTurn({ ...good(), options: [{ text: "Old style", kind: "social", stat: "wits", difficulty: 15 }, ...good().options.slice(2)] }, newGame()).turn.options[0].tier, "daunting");
  assert.equal(turn.state_changes.length, 1); // unknown actor dropped
  assert.equal(turn.new_facts.length, 1);
});

test("validateTurn rejects too few options and empty narration", () => {
  const raw = { ...good(), narration: [], options: good().options.slice(0, 2) };
  const { turn, errors } = validateTurn(raw, newGame());
  assert.equal(turn, null);
  assert.equal(errors.length, 2);
  assert.equal(validateTurn(null, newGame()).turn, null);
});

test("new_facts create, dedupe and link entities", () => {
  const s = newGame();
  const added = applyNewFacts(s, [
    { entity: "Maren", type: "npc", fact: "Sews seals onto satchels", location: "" },
    { entity: "maren", type: "npc", fact: "sews seals onto satchels.", location: "Gull's Landing" },
    { entity: "Gull's Landing", type: "location", fact: "Ferry landing", location: "Rusted Ford" },
  ], 2);
  assert.equal(added, 2);
  const maren = findEntity(s, "Maren");
  assert.equal(maren.facts.length, 1);
  const gull = findEntity(s, "Gull's Landing", "location");
  assert.equal(maren.location_id, gull.id);
  assert.ok(gull.connections.includes("location-the-rusted-ford"));
  assert.ok(s.ledger.entities["location-the-rusted-ford"].connections.includes(gull.id));
});

test("retrieval ranks the current place first and matches whole words only", () => {
  const s = newGame();
  for (let i = 0; i < 30; i++) applyNewFacts(s, [{ entity: `Drover ${i}`, type: "npc", fact: "Drinks", location: "The Rusted Ford" }], 2);
  applyNewFacts(s, [{ entity: "Ash", type: "item", fact: "grey", location: "Far Hill" }], 2);
  const list = relevantEntities(s, "I poke the ashes");
  assert.equal(list.length, 20);
  assert.ok(!list.some((e) => e.name === "Ash"));
  assert.equal(list[0].name, "The Rusted Ford");
  assert.ok(relevantEntities(s, "Ask Drover 7 about the ash").slice(0, 3).some((e) => e.name === "Ash"));
});

test("prompt size stays flat as the ledger grows", () => {
  const s = newGame();
  const size = () => JSON.stringify(buildPrompt(s, { kind: "custom", text: "Look" }, null)).length;
  const before = size();
  for (let i = 0; i < 500; i++) applyNewFacts(s, [{ entity: `Thing ${i}`, type: "lore", fact: "A fact ".repeat(10), location: "" }], i);
  for (let i = 0; i < 50; i++) applyNewFacts(s, [{ entity: `Local ${i}`, type: "npc", fact: "fact ".repeat(20) + i, location: "The Rusted Ford" }], i);
  assert.ok(size() < before + 6000, `prompt grew from ${before} to ${size()}`);
});

test("cost and schema basics", () => {
  assert.equal(costUSD("claude-sonnet-5-5", { input_tokens: 1e6 }), 2);
  assert.equal(costUSD("claude-haiku-5-5", { output_tokens: 1e6 }), 0.5);
  assert.equal(OUTPUT_SCHEMA.additionalProperties, false);
  assert.ok(SCHEMA_TOKENS > 100);
  assert.equal(SCHEMA_VERSION, 6);
  assert.equal(migrate(newGame()).v, SCHEMA_VERSION);
  assert.throws(() => migrate({ v: SCHEMA_VERSION + 1 }));
  const pub = publicState(newGame());
  assert.deepEqual(Object.keys(pub.scene.options[0]), ["text", "tag"]); // the kind and stat as a tag; no difficulty or edge leaks to the phone
  assert.equal(pub.scene.options[0].tag, "Social · Charm");
});

test("ledger facts: a hard cap, a cheap merge when an entity passes the cap, new facts survive the merge", async () => {
  const s = newGame();
  const maren = () => findEntity(s, "Maren");
  for (let i = 1; i <= FACT_CAP; i++) applyNewFacts(s, [{ entity: "Maren", type: "npc", fact: `Fact ${i}`, location: "", was: "" }], i);
  assert.equal(mergeDue(s), null); // at the cap, not over it
  applyNewFacts(s, [{ entity: "Maren", type: "npc", fact: "Fact 9", location: "", was: "" }], 9);
  assert.equal(mergeDue(s).name, "Maren");
  s.turn = 9;
  const job = mergeJob(s, mergeDue(s));
  assert.equal(job.facts.length, FACT_CAP + 1);
  assert.equal(mergeDue(s), null); // one merge at a time
  assert.ok(mergeDue(s, Date.now() + 130_000)); // a lost run is tried again later
  applyNewFacts(s, [{ entity: "Maren", type: "npc", fact: "Fact 10, added while the merge ran", location: "", was: "" }], 10);
  const kv = new Map();
  const env = { GAME: { get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null), put: async (k, v) => kv.set(k, v), delete: async (k) => kv.delete(k) } };
  kv.set(`fm:${s.id}`, JSON.stringify({ entity: job.entity, turn: 9, facts: ["Sews seals", "Worried about the road"] }));
  await adoptFactMerge(env, s);
  assert.deepEqual(maren().facts.map((f) => f.text), ["Sews seals", "Worried about the road", "Fact 10, added while the merge ran"]);
  assert.equal(s.fm, null);
  assert.equal(s.counters.fact_merges, 1);
  assert.equal(kv.size, 0);
  for (let i = 0; i < 30; i++) applyNewFacts(s, [{ entity: "Tam", type: "npc", fact: `Tam fact ${i}`, location: "", was: "" }], i);
  const tam = findEntity(s, "Tam");
  assert.equal(tam.facts.length, FACT_HARD);
  assert.equal(tam.facts[0].text, "Tam fact 0"); // the identity fact stays
  assert.deepEqual(parseFacts("- One fact here\n2. Another fact\n\n  ok\n• Third fact\nFourth fact\nFifth fact\nSixth fact").length, FACT_TARGET);
});

test("facts are lasting truths: no event kind, two a turn, a status replaces the last, partial names merge", () => {
  const f = (entity, kind, fact, extra = {}) => ({ entity, type: "npc", kind, fact, location: "", was: "", ...extra });
  const s = newGame();
  // an invalid kind (an event) is dropped; the person is still recorded; two facts an entity a turn
  const raw = { ...good(), new_facts: [f("Reeve", "event", "Drew his belt knife"), f("Tam Reeve", "identity", "A rider"), f("Tam Reeve", "want", "Wants the ledger"), f("Tam Reeve", "secret", "Works for Hale")] };
  const { turn } = validateTurn(raw, s);
  assert.deepEqual(turn.new_facts.map((x) => [x.entity, x.fact]), [["Reeve", ""], ["Tam Reeve", "A rider"], ["Tam Reeve", "Wants the ledger"], ["Tam Reeve", ""]]);
  // "Reeve" and "Tam Reeve" are one person; the longer name wins and the short one stays an alias
  applyNewFacts(s, turn.new_facts, 3);
  const reeves = Object.values(s.ledger.entities).filter((e) => /reeve/i.test(e.name));
  assert.equal(reeves.length, 1);
  assert.equal(reeves[0].name, "Tam Reeve");
  assert.ok(reeves[0].aliases.includes("Reeve"));
  assert.equal(reeves[0].facts.length, 2);
  // two records that already exist (an older save) fold together when either is mentioned again
  const old = newGame();
  applyNewFacts(old, [f("Dobbin", "identity", "Toll-keeper")], 1);
  old.ledger.entities["npc-dobbin-extra"] = { ...old.ledger.entities["npc-dobbin"], id: "npc-dobbin-extra", name: "Hob Dobbin", facts: [{ text: "Keeps a ledger", turn: 2 }], first_turn: 2 };
  applyNewFacts(old, [f("Dobbin", "want", "Wants his debt paid")], 5);
  assert.equal(Object.values(old.ledger.entities).filter((e) => /dobbin/i.test(e.name)).length, 1);
  // numbered people stay separate; two people who share one name word are never guessed
  const crowd = newGame();
  for (const n of ["Drover 1", "Drover 2", "Tam Reeve", "Tam Dobbin"]) applyNewFacts(crowd, [f(n, "identity", `${n} is here`)], 1);
  applyNewFacts(crowd, [f("Tam", "identity", "Just Tam")], 2);
  assert.equal(Object.values(crowd.ledger.entities).filter((e) => e.type === "npc").length, 5);
  // a status replaces the previous status
  const st = newGame();
  applyNewFacts(st, [f("Maren", "identity", "A seal-sewer"), f("Maren", "status", "Hostile to Ash")], 2);
  applyNewFacts(st, [f("Maren", "status", "Allied with Ash")], 4);
  assert.deepEqual(findEntity(st, "Maren").facts.map((x) => x.text), ["A seal-sewer", "Allied with Ash"]);
});

test("talent offers include one from the character's best stat, seeded per game", () => {
  const s = newGame("main", undefined, { name: "Hana", background: "clerk", drive: "debt", flaw: "proud", law: "neutral", good: "neutral", free: { wits: 1, charm: 1 }, talent: "quick-study" });
  const p = s.actors.pc;
  for (let i = 0; i < 6; i++) {
    s.id = `game-${i}`;
    p.picks = [];
    gainXp(s, p, 1000 - p.xp > 0 ? 1000 : 1, []); // jump to a high level; the odd levels each queue an offer
    const offers = p.picks.filter((x) => x.kind === "talent");
    assert.ok(offers.length >= 1);
    assert.ok(offers[0].offer.length === 3 && new Set(offers[0].offer).size === 3);
    assert.ok(offers[0].offer.some((id) => TALENTS[id].stat === "wits"), `${offers[0].offer}`); // clerk: wits 4 is the best stat
    p.level = 1; p.xp = 0;
  }
});

test("v4 saves migrate to v5", () => {
  const s = newGame();
  s.v = 4;
  s.actors.pc.talents = [{ id: "grim-resolve", ready_turn: 0 }];
  s.actors.pc.picks = [{ kind: "talent", level: 3, offer: ["grim-resolve", "keen-eye", "stubborn"] }];
  migrate(s);
  assert.equal(s.v, 6);
  assert.equal(s.actors.pc.talents[0].id, "stubborn");
  assert.deepEqual(s.actors.pc.picks[0].offer, ["stubborn", "keen-eye"]);
});

test("a stray closing quote at the end of a paragraph is removed", () => {
  const raw = { ...good(), narration: ['She says, "Go," and nods. She is leaving now.', '"I carry, not answer," she says. You have made sure she will not talk to you on the way."', '"Fine." He leaves.'] };
  const { turn } = validateTurn(raw, newGame());
  assert.equal(turn.narration[1].endsWith("on the way."), true);
  assert.equal(turn.narration[2], '"Fine." He leaves.');
  assert.equal(turn.narration[0], 'She says, "Go," and nods. She is leaving now.');
});
