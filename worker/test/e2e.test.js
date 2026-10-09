// End-to-end: the real Worker code (src/index.js) against worker/test/mock-anthropic.mjs and an in-memory KV.
// A 30-turn game from character creation to the Character screen actions, with the background jobs, saves and migration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import nodeCrypto from "node:crypto";
import worker from "../src/index.js";

// Cloudflare Workers have crypto.subtle.timingSafeEqual; Node does not. A test-only stand-in.
crypto.subtle.timingSafeEqual ??= (a, b) => nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const PORT = 18788;
const KEY = "test-key";
let mock;
const logFile = new URL("./.mock-calls.log", import.meta.url).pathname;

// KV stand-in that counts writes (the free plan allows 1,000 a day).
function makeKV() {
  const m = new Map();
  const kv = {
    writes: 0,
    get: async (k, type) => (m.has(k) ? (type === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null),
    put: async (k, v) => { kv.writes++; m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    keys: () => [...m.keys()],
    raw: (k) => m.get(k),
  };
  return kv;
}

const pending = [];
const ctx = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

function makeEnv(kv, extra = {}) {
  return { GAME: kv, GAME_KEY: KEY, ANTHROPIC_API_KEY: "x", ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}`, ALLOWED_ORIGINS: "https://example.test", DAILY_CAP_USD: "100", ...extra };
}

async function call(env, method, path, body, key = KEY) {
  const res = await worker.fetch(new Request(`https://worker.test${path}`, {
    method, headers: { "X-Game-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
  }), env, ctx);
  return { status: res.status, data: await res.json() };
}

const CHARACTER = { name: "Wren", background: "hunter", drive: "missing", flaw: "reckless", law: "neutral", good: "good", free: { grit: 1, charm: 1 }, talent: "light-fingers" };

before(async () => {
  fs.rmSync(logFile, { force: true });
  mock = spawn(process.execPath, [new URL("./mock-anthropic.mjs", import.meta.url).pathname, String(PORT), logFile], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve, reject) => {
    mock.stdout.on("data", (d) => String(d).includes("mock anthropic on") && resolve());
    mock.on("error", reject);
    setTimeout(() => reject(new Error("mock did not start")), 5000);
  });
});
after(() => { mock?.kill(); fs.rmSync(logFile, { force: true }); });

test("health and auth", async () => {
  const env = makeEnv(makeKV());
  assert.equal((await call(env, "GET", "/api/health", null, "")).data.ok, true);
  assert.equal((await call(env, "GET", "/api/state", null, "wrong")).status, 401);
  assert.equal((await call(env, "GET", "/api/creation")).data.backgrounds.length, 6);
});

test("a 30-turn game: creation, turns, level-ups, talents, fact merge, summaries, saves", async () => {
  const kv = makeKV();
  const env = makeEnv(kv);

  // creation: bad picks are refused, good ones start the game
  assert.equal((await call(env, "POST", "/api/new", { confirm: true, character: { ...CHARACTER, free: { grit: 3 } } })).status, 400);
  assert.equal((await call(env, "POST", "/api/new", { character: CHARACTER })).status, 400); // confirm required
  const created = await call(env, "POST", "/api/new", { confirm: true, character: CHARACTER });
  assert.equal(created.status, 200);
  let state = created.data;
  assert.equal(state.pc.name, "Wren");
  assert.equal(state.pc.bio.background, "Hunter");
  assert.equal(state.pc.align, "Neutral Good");
  assert.deepEqual(Object.keys(state.pc.stats), ["might", "wits", "charm", "grit"]);
  assert.equal(state.pc.talents[0].name, "Light Fingers");
  assert.ok(state.scene.options.length >= 3);
  // the intro: one AI call wrote the opening scene instead of the fixed one
  assert.match(state.scene.narration[0], /^Mock narration/);
  const introCall = JSON.parse(fs.readFileSync(logFile, "utf8").trim().split("\n").at(-1));
  assert.match(introCall.body.messages[0].content[1].text, /\(new game\) Write the opening scene/);
  assert.match(introCall.body.messages[0].content[1].text, /Drive: Someone you love is missing/);

  const kinds = {};
  const results = { success: 0, cost: 0, failure: 0 };
  let promptSizes = [];
  let usedTalent = false;
  let cpuMs = 0;
  const writes0 = kv.writes;
  let ok = 0;

  for (let i = 0; i < 30; i++) {
    const idx = i % state.scene.options.length;
    const cpu = process.cpuUsage();
    const r = await call(env, "POST", "/api/turn", { request_id: `req-${i}`, turn: state.turn, action: { kind: "option", index: idx } });
    const used = process.cpuUsage(cpu);
    cpuMs += (used.user + used.system) / 1000;
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(!r.data.fallback, `turn ${i + 1} fell back: ${r.data.reason}`);
    ok++;
    const t = r.data.turn;
    assert.equal(t.n, state.turn + 1);
    if (t.dice) {
      assert.ok(["success", "cost", "failure"].includes(t.dice.result));
      assert.ok(t.dice.dc >= 7 && t.dice.dc <= 18, `dc ${t.dice.dc}`);
      results[t.dice.result]++;
    }
    const xpNotes = r.data.events.filter((e) => /^\+\d+ XP$/.test(e));
    assert.equal(xpNotes.length, 1, `one XP note a turn: ${r.data.events}`);
    // idempotent: the same request id gives the stored reply, no second AI call
    if (i === 3) {
      const again = await call(env, "POST", "/api/turn", { request_id: `req-${i}`, turn: state.turn, action: { kind: "option", index: idx } });
      assert.equal(again.data.replay, true);
      assert.equal(again.data.turn.n, t.n);
    }
    state = r.data.state;
    for (const o of state.scene.options) assert.deepEqual(Object.keys(o), ["text", "tag"]);
    await settle(); // background summary / fact merge, as ctx.waitUntil would run them

    // Character screen actions between turns: picks, a talent, a drop
    const pick = state.pc.pick;
    if (pick) {
      const body = pick.kind === "stat" ? { act: "pick", kind: "stat", stat: "grit" } : { act: "pick", kind: "talent", talent: pick.offer[0].id };
      const c = await call(env, "POST", "/api/char", body);
      assert.equal(c.status, 200, JSON.stringify(c.data));
      state = c.data.state;
    }
    if (!usedTalent && state.pc.talents.some((x) => x.use === "active" && x.ready_in === 0) && state.pc.hp < state.pc.hp_max) {
      const id = state.pc.talents.find((x) => x.use === "active").id;
      const c = await call(env, "POST", "/api/char", { act: "use", id });
      if (c.status === 200) usedTalent = true;
      state = c.data.state;
    }
    if (i % 8 === 7) {
      const p = (await call(env, "GET", "/api/prompt")).data;
      promptSizes.push(p.est.total);
      assert.ok(p.sections.some((s) => s.name.startsWith("Output schema")));
      for (const s of p.sections) if (s.budget) assert.ok(s.tokens <= s.budget, `${s.name} over budget`);
    }
  }
  assert.equal(ok, 30);
  assert.equal(state.turn, 31);

  // progression: XP and levels moved, hp stayed in bounds, only the label of the alignment is public
  assert.ok(state.pc.xp > 30 && state.pc.level >= 2, `xp ${state.pc.xp} level ${state.pc.level}`);
  assert.ok(state.pc.hp >= 1 && state.pc.hp <= state.pc.hp_max);
  assert.ok(state.pc.slots.used <= state.pc.slots.max);
  assert.equal(typeof state.pc.align, "string");
  assert.ok(results.success > 0 && results.failure + results.cost > 0, JSON.stringify(results));

  // the save: prompt stayed flat, background jobs ran, the ledger stayed tidy, counters are consistent
  const save = JSON.parse(kv.raw("save:main"));
  assert.equal(save.v, 5);
  assert.equal(save.counters.ai_turns, 30);
  assert.ok(save.intro, "the intro call is recorded");
  assert.ok(save.summary.text.length > 0);
  assert.ok(save.counters.summaries >= 3, `summaries ${save.counters.summaries}`);
  assert.ok(save.counters.fact_merges >= 1, "an entity passed the fact cap and was merged");
  const maren = Object.values(save.ledger.entities).find((e) => e.name === "Maren");
  assert.ok(maren.facts.length <= 12, `Maren has ${maren.facts.length} facts`);
  assert.ok(Math.max(...promptSizes) - Math.min(...promptSizes) < 400, `prompt grew: ${promptSizes}`);
  assert.ok(save.counters.edges >= 1 && save.counters.options_dropped >= 0);
  assert.ok(Object.keys(save.counters.tiers).length >= 2);
  assert.ok(save.pc === undefined && save.actors.pc.stats.charm >= 1);

  // the playtest report: pasteable text with the hidden tiers, dice, ledger and new names
  const rep = (await call(env, "GET", "/api/playtest?last=8")).data;
  assert.equal(rep.turns, 8);
  assert.match(rep.text, /^PLAYTEST REPORT/);
  assert.match(rep.text, /## Turn 31 /);
  assert.ok(!rep.text.includes("## Turn 22 "));
  assert.match(rep.text, /Player \(option\): .* \[(social|explore|direct|cautious), (might|wits|charm|grit), (easy|standard|hard|daunting)/);
  assert.match(rep.text, /Dice: d20 \d+/);
  assert.match(rep.text, /OPENING SCENE/);
  assert.match(rep.text, /LEDGER \(what the app remembers\)/);
  assert.match(rep.text, /Maren \(npc/);
  const full = (await call(env, "GET", "/api/playtest?last=999")).data;
  assert.equal(full.last, full.max);
  assert.ok(full.turns >= 30 && full.turns <= full.max);
  assert.ok(full.bytes < 150_000, `report is ${full.bytes} bytes`);
  assert.match(full.text, /## Turn 2 /); // the first archived turn is there
  console.log(`# playtest report: ${rep.bytes} chars for 8 turns, ${full.bytes} chars for ${full.turns} turns`);

  // costs of the run, printed for the cost report
  const sizeKB = Buffer.byteLength(kv.raw("save:main")) / 1024;
  const writes = (kv.writes - writes0) / 30;
  const logged = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const turnCalls = logged.filter((c) => c.body.output_config?.format);
  console.log(`# e2e: save ${sizeKB.toFixed(1)} KB after 30 turns, ${writes.toFixed(1)} KV writes/turn, ${(cpuMs / 30).toFixed(2)} ms process CPU/turn (includes the mock HTTP round trip), ${turnCalls.length} turn calls, ${logged.length - turnCalls.length} background calls`);
  assert.ok(sizeKB < 200);
  assert.ok(writes < 5);

  // every turn call carried the world core and the cached prefix
  const first = turnCalls[0].body;
  assert.ok(first.system[1].text.includes("The Realm of Calder"));
  assert.deepEqual(first.system[1].cache_control, { type: "ephemeral" });
  assert.deepEqual(first.output_config.format.schema.properties.options.items.properties.tier.enum, ["easy", "standard", "hard", "daunting"]);
  assert.ok(turnCalls.every((c) => c.body.system[0].text === first.system[0].text));
});

test("stale turns, fallbacks and the spend cap", async () => {
  const kv = makeKV();
  const env = makeEnv(kv);
  const s0 = (await call(env, "GET", "/api/state")).data;
  assert.equal((await call(env, "POST", "/api/turn", { request_id: "a", turn: 99, action: { kind: "option", index: 0 } })).status, 409);
  assert.equal((await call(env, "POST", "/api/turn", { request_id: "b", turn: s0.turn, action: { kind: "option", index: 9 } })).status, 400);
  // a refused reply twice -> fallback turn, nothing changes
  await fetch(`http://127.0.0.1:${PORT}/__queue`, { method: "POST", body: JSON.stringify(["refusal", "refusal"]) });
  const f = await call(env, "POST", "/api/turn", { request_id: "c", turn: s0.turn, action: { kind: "option", index: 0 } });
  assert.equal(f.data.fallback, true);
  assert.equal(f.data.state.turn, s0.turn);
  // the cap: no AI call once the day's spend is used
  const capped = makeEnv(kv, { DAILY_CAP_USD: "0" });
  const c = await call(capped, "POST", "/api/turn", { request_id: "d", turn: s0.turn, action: { kind: "option", index: 0 } });
  assert.equal(c.data.reason, "daily_cap");
  // custom and generic actions work without a roll
  const look = await call(env, "POST", "/api/turn", { request_id: "e", turn: s0.turn, action: { kind: "look" } });
  assert.equal(look.data.turn.dice, null);
  const custom = await call(env, "POST", "/api/turn", { request_id: "f", turn: look.data.state.turn, action: { kind: "custom", text: "  Climb   the\nwall  " } });
  assert.equal(custom.data.turn.action, "Climb the wall");
});

test("character actions are validated", async () => {
  const env = makeEnv(makeKV());
  await call(env, "POST", "/api/new", { confirm: true, character: CHARACTER });
  assert.equal((await call(env, "POST", "/api/char", { act: "pick", kind: "stat", stat: "grit" })).status, 409); // no pick waiting
  assert.equal((await call(env, "POST", "/api/char", { act: "use", id: "light-fingers" })).status, 409); // passive
  assert.equal((await call(env, "POST", "/api/char", { act: "drop", id: "item-coins" })).status, 409); // coins stay
  assert.equal((await call(env, "POST", "/api/char", { act: "dance" })).status, 400);
  const dropped = await call(env, "POST", "/api/char", { act: "drop", id: "item-snare-wire" });
  assert.equal(dropped.status, 200);
  assert.deepEqual(dropped.data.events, ["Dropped Snare wire"]);
  assert.ok(!dropped.data.state.pc.inventory.some((i) => i.id === "item-snare-wire"));
});

test("an old v3 save is copied, then migrated, once", async () => {
  const kv = makeKV();
  const env = makeEnv(kv);
  const raw = fs.readFileSync(new URL("./fixtures/save-v3.json", import.meta.url), "utf8");
  await kv.put("save:main", raw);
  kv.writes = 0;
  const state = (await call(env, "GET", "/api/state")).data;
  assert.equal(kv.raw("bak:main:v3"), raw, "the old save is kept byte for byte");
  assert.equal(JSON.parse(kv.raw("save:main")).v, 5);
  assert.equal(kv.writes, 2);
  assert.equal(state.pc.level, 3);
  assert.equal(state.pc.pick.kind, "talent"); // a starting talent to choose
  assert.equal(state.pc.stats.charm, 0);
  await call(env, "GET", "/api/state");
  assert.equal(kv.writes, 2, "no second backup or rewrite");
  // the migrated game plays
  const picked = await call(env, "POST", "/api/char", { act: "pick", kind: "talent", talent: state.pc.pick.offer[0].id });
  assert.equal(picked.status, 200);
  const r = await call(env, "POST", "/api/turn", { request_id: "m1", turn: state.turn, action: { kind: "option", index: 0 } });
  assert.equal(r.status, 200);
  assert.ok(!r.data.fallback);
  // a save from a newer server is refused and left alone
  const future = JSON.stringify({ ...JSON.parse(raw), v: 99 });
  await kv.put("save:main", future);
  assert.equal((await call(env, "GET", "/api/state")).status, 500);
  assert.equal(kv.raw("save:main"), future);
});

test("without an API key a new game keeps the fixed opening scene", async () => {
  const env = makeEnv(makeKV(), { ANTHROPIC_API_KEY: "" });
  const r = await call(env, "POST", "/api/new", { confirm: true, character: CHARACTER });
  assert.equal(r.status, 200);
  assert.match(r.data.scene.narration[0], /^Rain hammers the old toll house/);
});

test("a v4 save (with Grim Resolve) upgrades to v5", async () => {
  const kv = makeKV();
  const env = makeEnv(kv);
  const made = (await call(env, "POST", "/api/new", { confirm: true, character: { ...CHARACTER, background: "drover", talent: "stubborn" } })).data;
  assert.equal(made.pc.talents[0].name, "Stubborn");
  const save = JSON.parse(kv.raw("save:main"));
  save.v = 4;
  save.actors.pc.talents[0].id = "grim-resolve";
  const raw = JSON.stringify(save);
  await kv.put("save:main", raw);
  const state = (await call(env, "GET", "/api/state")).data;
  assert.equal(kv.raw("bak:main:v4"), raw);
  assert.equal(state.pc.talents[0].name, "Stubborn");
});
