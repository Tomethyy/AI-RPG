// Story screen. Online: turns come from the backend (More → Server). Offline: the Phase 1 hardcoded demo below.
// Online, dice and rules come from the server (Phase 3); the offline demo uses fixed fake dice.

const TURNS = [
  {
    location: "The Rusted Ford",
    hp: 18,
    narration: [
      "Rain hammers the old toll house as you shoulder through the door. Inside, a handful of drovers hunch over cold stew, and nobody looks up. The bridge outside is gone; only blackened stumps remain in the river.",
      "A woman by the hearth is sewing a seal onto a leather satchel. She notices your mud-caked boots and finally meets your eye.",
    ],
    options: [
      "Ask the woman about the bridge",
      "Search the toll house for a way across",
      "Offer to buy a round for the drovers",
      "Step back outside and study the river",
    ],
  },
  {
    location: "The Rusted Ford",
    hp: 18,
    dice: { die: 14, label: "Wits", mod: 2, dc: 12, success: true },
    narration: [
      "The woman gives her name as Maren and sets the satchel aside. \"Burned three nights ago,\" she says. \"Whoever did it wanted the road closed, not the river crossed.\"",
      "She slides a scrap of oilcloth across the table. A ferryman's mark is scratched into it, along with the words “Gull's Landing”.",
    ],
    options: [
      "Ask what is in the satchel",
      "Ask where Gull's Landing is",
      "Keep the oilcloth and say nothing",
      "Ask who benefits from a closed road",
    ],
  },
  {
    location: "The Rusted Ford",
    hp: 15,
    dice: { die: 4, label: "Grit", mod: 1, dc: 13, success: false },
    narration: [
      "You reach for the satchel and the nearest drover catches your wrist. A short scuffle follows; you come away with a split lip and a bruised pride, but the satchel stays where it was.",
      "Maren watches without moving. \"Now you know how the road feels,\" she says.",
    ],
    options: [
      "Apologize and ask for a moment of her time",
      "Leave for Gull's Landing",
      "Rest by the fire and watch the room",
      "Ask the drover what he is guarding",
    ],
  },
];

const JS_BUILD = "1.17"; // stamped by stamp.py
const HP_MAX = 20;
const GENERIC = ["Look", "Talk", "Travel", "Rest"];
const MORE = ["Ledger", "Prompt", "Inventory", "Wildcard", "Custom action"];
const PANELS = new Set(["Ledger", "Prompt"]); // open inside the More sheet
const DEFAULT_SERVER = "https://ai-rpg.mr-tom-richter.workers.dev"; // not a secret; the game key is typed in on the phone
const LS = { server: "rpg.server", key: "rpg.key", pending: "rpg.pending" };

const $ = (id) => document.getElementById(id);
const story = $("story");
let turnIndex = 0;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function scrollDown() {
  story.scrollTo({ top: story.scrollHeight, behavior: "smooth" });
}

function addNote(text) {
  story.append(el("p", "note", text));
  scrollDown();
}

function renderDice(d, animate = true) {
  const box = el("div", "dice");
  const die = el("div", animate ? "die rolling" : "die", animate ? "…" : String(d.die));
  const math = el("div", "math");
  const total = d.die + d.mod;
  const result = el("div", "result " + (d.success ? "success" : "fail"), d.success ? "Success" : "Failure");
  math.innerHTML = `d20 <b>${d.die}</b> + ${d.label} <b>${d.mod >= 0 ? "+" : ""}${d.mod}</b> = <b>${total}</b> vs DC <b>${d.dc}</b><br>`;
  math.append(result);
  if (d.note) math.append(el("div", "dice-note", d.note));
  box.append(die, math);
  if (animate) setTimeout(() => { die.textContent = d.die; die.classList.remove("rolling"); }, 500);
  return box;
}

function renderHeader(location, hp, hpMax, turnNo) {
  $("location").textContent = location;
  $("hp").textContent = `HP ${hp}/${hpMax}`;
  $("hpfill").style.width = (hp / hpMax) * 100 + "%";
  const pct = hp / hpMax;
  $("hpbar").classList.toggle("mid", pct <= 0.5 && pct >= 0.25);
  $("hpbar").classList.toggle("low", pct < 0.25);
  $("hpbar").setAttribute("aria-valuenow", hp);
  $("hpbar").setAttribute("aria-valuemax", hpMax);
  $("turn").textContent = "Turn " + turnNo;
}

function renderOptions(texts, onPick) {
  const options = $("options");
  options.replaceChildren();
  texts.forEach((text, i) => {
    const btn = el("button", "", text);
    btn.type = "button";
    btn.addEventListener("click", () => onPick(i, text));
    options.append(btn);
  });
}

function renderTurn(index, chosenText) {
  const turn = TURNS[index];
  renderHeader(turn.location, turn.hp, HP_MAX, index + 1);
  if (chosenText) story.append(el("p", "chosen", chosenText));
  if (turn.dice) story.append(renderDice(turn.dice));
  for (const para of turn.narration) story.append(el("p", "", para));
  renderOptions(turn.options, (i, text) => choose(text));
  scrollDown();
}

function choose(text) {
  if (online()) return;
  // Offline demo: cycle through the hardcoded turns.
  turnIndex = (turnIndex + 1) % TURNS.length;
  if (turnIndex === 0) addNote("(Fake story ended, looping back to turn 1.)");
  renderTurn(turnIndex, "▸ " + text);
}

// ---- Online play (backend) ----
let game = null; // last public state from the server
let busy = false;

const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch {} };
const serverUrl = () => lsGet(LS.server) || DEFAULT_SERVER;
const online = () => !!(serverUrl() && lsGet(LS.key));

async function api(path, body) {
  const res = await fetch(serverUrl() + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Game-Key": lsGet(LS.key), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function setBusy(on) {
  busy = on;
  for (const b of document.querySelectorAll("#options button, #generic button, #custom button")) b.disabled = on;
  $("pending")?.remove();
  if (on) { const p = el("p", "note pending", "The story continues…"); p.id = "pending"; story.append(p); scrollDown(); }
}

function applyState(state) {
  game = state;
  renderHeader(state.location, state.pc.hp, state.pc.hp_max, state.turn);
  renderOptions(state.scene.options, (i) => act({ kind: "option", index: i }, state.scene.options[i]));
}

function renderFull(state) {
  story.replaceChildren();
  if (!state.recent.length) for (const p of state.scene.narration) story.append(el("p", "", p));
  else story.append(el("p", "note", "(Earlier scenes are kept in the save.)"));
  for (const t of state.recent) {
    story.append(el("p", "chosen", "▸ " + t.action));
    if (t.dice) story.append(renderDice(t.dice, false));
    for (const p of t.narration) story.append(el("p", "", p));
  }
  applyState(state);
  scrollDown();
}

const REASONS = { daily_cap: "Today's spend cap is reached", ai_failed: "The narrator didn't answer", no_api_key: "The server has no API key yet" };

function handleReply(status, data) {
  if (status === 200 && data?.turn) {
    const t = data.turn;
    story.append(el("p", "chosen", "▸ " + t.action));
    if (t.dice) story.append(renderDice(t.dice));
    for (const p of t.narration) story.append(el("p", data.fallback ? "note" : "", p));
    for (const e of data.events || []) story.append(el("p", "note", e));
    if (data.fallback) story.append(el("p", "note", `(${REASONS[data.reason] || data.reason}. Nothing changed; pick again.)` + (data.detail ? ` [${data.detail}]` : "")));
    applyState(data.state);
    scrollDown();
    return true;
  }
  if (status === 409 && data?.state) { renderFull(data.state); addNote("(Synced with the saved game.)"); return true; }
  if (status === 401) { addNote("Server key rejected. Check it in More → Server."); return true; }
  addNote(`Server error (${status || "no reply"}${data?.error ? ": " + data.error : ""}). Tap to try again.`);
  return status >= 400 && status < 500; // 4xx: don't resend the same request
}

async function sendTurn(pending) {
  setBusy(true);
  let done = false;
  try {
    const { status, data } = await api("/api/turn", pending);
    done = handleReply(status, data);
  } catch {
    addNote("Couldn't reach the server. Tap to try again.");
  }
  if (done) lsSet(LS.pending, "");
  setBusy(false);
}

function act(action, label) {
  if (busy || !game) return;
  const pending = { request_id: crypto.randomUUID?.() || String(Date.now()) + Math.random(), turn: game.turn, action, label };
  lsSet(LS.pending, JSON.stringify(pending));
  sendTurn(pending);
}

async function connect() {
  const status = $("serverStatus");
  status.textContent = "Connecting…";
  try {
    const { status: code, data } = await api("/api/state");
    if (code !== 200) { status.textContent = code === 401 ? "Key rejected." : `Error ${code}${data?.error ? ": " + data.error : ""}`; return false; }
    status.textContent = `Connected · turn ${data.turn}`;
    renderFull(data);
    // Resume a turn that was sent but never answered (app closed mid-turn): same request id, so no double turn.
    let pending = null;
    try { pending = JSON.parse(lsGet(LS.pending) || "null"); } catch {}
    if (pending && pending.turn === data.turn) sendTurn(pending);
    else lsSet(LS.pending, "");
    return true;
  } catch {
    status.textContent = "Couldn't reach the server.";
    addNote("Couldn't reach the server. Open More → Server to retry.");
    return false;
  }
}

function setupServerForm() {
  $("serverUrl").value = serverUrl();
  $("serverKey").value = lsGet(LS.key);
  $("serverForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let url = $("serverUrl").value.trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
    $("serverUrl").value = url;
    lsSet(LS.server, url);
    lsSet(LS.key, $("serverKey").value.trim());
    document.activeElement?.blur();
    if (online() && (await connect())) setSheet(false);
    else if (!online()) $("serverStatus").textContent = "Offline demo (no server set).";
  });
  $("newGame").addEventListener("click", async () => {
    if (!online()) { $("serverStatus").textContent = "Connect to a server first."; return; }
    if (!confirm("Start a new game? The current run is replaced (one backup is kept on the server).")) return;
    const { status, data } = await api("/api/new", { confirm: true });
    if (status === 200) { lsSet(LS.pending, ""); renderFull(data); setSheet(false); }
    else $("serverStatus").textContent = `Error ${status}`;
  });
}

const custom = $("custom");
const customText = $("customText");
const generic = $("generic");
const sheet = $("sheet");
const backdrop = $("backdrop");

// The custom input takes the generic row's slot; the options above stay visible and untouched.
function openCustom() {
  generic.hidden = true;
  custom.hidden = false;
  customText.focus();
}
function closeCustom() {
  custom.hidden = true;
  generic.hidden = false;
  customText.value = "";
  customText.blur();
}

function setSheet(open) {
  sheet.hidden = backdrop.hidden = !open;
  sheet.style.transform = "";
  if (!open) showLedger(false);
  if (open) showBuildInfo();
}

// Build stamp + live layout numbers, so the Home Screen app can be compared with Safari.
const metaBuild = (document.querySelector('meta[name="build"]')?.content || "?|").split("|");
const HTML_BUILD = metaBuild[0];
const CSS_BUILD = getComputedStyle(document.documentElement).getPropertyValue("--build").replace(/["'\s]/g, "");

// html, css and js are stamped together. If a cached file is from another build, reload once past the cache.
if (new Set([HTML_BUILD, CSS_BUILD, JS_BUILD]).size > 1 && !location.search.includes("fresh=")) {
  location.replace(location.pathname + "?fresh=" + Date.now());
}

// What sits on top of a node, ignoring the More sheet itself (it is open while we measure).
function topEl(node) {
  const r = node.getBoundingClientRect();
  sheet.style.pointerEvents = backdrop.style.pointerEvents = "none";
  const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  sheet.style.pointerEvents = backdrop.style.pointerEvents = "";
  return e ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") : "none";
}

function showBuildInfo() {
  const when = new Date(metaBuild[1]);
  const time = isNaN(when) ? "?" : when.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const same = new Set([HTML_BUILD, CSS_BUILD, JS_BUILD]).size === 1;
  $("buildStamp").textContent = `build ${HTML_BUILD} · ${time}` + (same ? "" : `  (MISMATCH html ${HTML_BUILD} css ${CSS_BUILD} js ${JS_BUILD})`);

  const probe = el("div");
  probe.style.cssText = "position:fixed;visibility:hidden;top:0;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)";
  document.body.append(probe);
  const insetSum = probe.getBoundingClientRect().height;
  probe.remove();
  const cs = getComputedStyle($("hp"));
  const vv = window.visualViewport;
  const lastBtn = generic.hidden ? null : generic.querySelector("button");
  const lines = [
    `mode ${navigator.standalone || matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
    `inner ${innerWidth}x${innerHeight}  visual ${vv ? Math.round(vv.width) + "x" + Math.round(vv.height) : "n/a"}  screen ${screen.width}x${screen.height}`,
    `insets top+bottom ${insetSum}  app.kb ${$("app").classList.contains("kb")}`,
    `app bottom ${Math.round($("app").getBoundingClientRect().bottom)}  gap below buttons ${lastBtn ? Math.round(innerHeight - lastBtn.getBoundingClientRect().bottom) : "n/a"}`,
    `header title y ${Math.round($("location").getBoundingClientRect().top)}  on top: ${topEl($("location"))} / ${topEl($("hp"))}`,
    `title opacity ${getComputedStyle($("location")).opacity} color ${getComputedStyle($("location")).color}  hp color ${cs.color}`,
  ];
  const vh = (u) => { const t = el("div"); t.style.cssText = `position:fixed;visibility:hidden;height:100${u}`; document.body.append(t); const h = Math.round(t.getBoundingClientRect().height); t.remove(); return h; };
  lines.push(`units vh ${vh("vh")} lvh ${vh("lvh")} dvh ${vh("dvh")} svh ${vh("svh")}  html ${document.documentElement.clientHeight}`);
  lines.push(online() ? `server ${serverUrl().replace(/^https?:\/\//, "")}` + (game?.spend ? `  spend today $${game.spend.today.toFixed(3)} of $${game.spend.cap}` : "") : "server none (offline demo)");
  $("diag").textContent = lines.join("\n");
}


// ---- Ledger (read-only view of what the app remembers; no AI call) ----
const TYPE_TITLES = { npc: "People", location: "Places", faction: "Factions", item: "Items", quest: "Quests", lore: "Lore" };

function ledgerLine(label, text) {
  const p = el("p", "ledger-line");
  p.append(el("b", "", label + " "), document.createTextNode(text));
  return p;
}

function showLedger(on) {
  $("ledger").hidden = !on;
  $("sheetBody").hidden = on;
  $("serverForm").hidden = on;
}

async function openLedger() {
  const body = $("ledgerBody");
  body.replaceChildren(el("p", "note", "Loading…"));
  showLedger(true);
  if (!online()) { body.replaceChildren(el("p", "note", "The ledger lives on the server. Go back and connect a server first.")); return; }
  try {
    const { status, data } = await api("/api/ledger");
    if (status !== 200) { body.replaceChildren(el("p", "note", `Couldn't load the ledger (${status}).`)); return; }
    body.replaceChildren();
    const pc = game?.pc;
    if (pc?.stats) {
      const eq = Object.values(pc.equipment || {}).map((g) => g.name).join(", ") || "nothing";
      const st = `Might ${pc.stats.might}, Wits ${pc.stats.wits}, Grit ${pc.stats.grit}`;
      body.append(ledgerLine(`${pc.name} · Level ${pc.level}`, `XP ${pc.xp}${pc.xp_next ? "/" + pc.xp_next : ""} · ${st} · Gear: ${eq}${pc.conditions.length ? " · " + pc.conditions.join(", ") : ""}`));
    }
    body.append(el("p", "note", `Turn ${data.turn} · now at ${data.here}`));
    let last = "";
    for (const e of data.entities) {
      if (e.type !== last) { body.append(el("h3", "", TYPE_TITLES[e.type] || e.type)); last = e.type; }
      const card = el("div", "ledger-entity");
      card.append(el("div", "ledger-name", e.name));
      const meta = [e.where && `at ${e.where}`, e.links.length && `links: ${e.links.join(", ")}`, e.aliases?.length && `also: ${e.aliases.join(", ")}`].filter(Boolean).join(" · ");
      if (meta) card.append(el("div", "ledger-meta", meta));
      for (const f of e.facts) card.append(el("div", "ledger-fact", "• " + f));
      body.append(card);
    }
    if (!data.entities.length) body.append(el("p", "note", "Nothing recorded yet."));
  } catch {
    body.replaceChildren(el("p", "note", "Couldn't reach the server."));
  }
}

// ---- Prompt (debug view of what the AI is sent; built by the server from the save, no AI call) ----
const fmtUsd = (n) => (typeof n === "number" ? "$" + n.toFixed(4) : "?");

async function openPrompt() {
  const body = $("ledgerBody");
  body.replaceChildren(el("p", "note", "Loading…"));
  showLedger(true);
  if (!online()) { body.replaceChildren(el("p", "note", "The prompt is built on the server. Go back and connect a server first.")); return; }
  try {
    const { status, data } = await api("/api/prompt");
    if (status !== 200) { body.replaceChildren(el("p", "note", `Couldn't load the prompt (${status}).`)); return; }
    body.replaceChildren();
    const d = data;
    body.append(el("p", "note", `Next prompt (turn ${d.turn}, example action "${d.example_action}") · ${d.model}`));
    body.append(ledgerLine("Estimate", `~${d.est.total} tokens, ~${d.est.cached} of them cacheable`));
    if (d.last) {
      const u = d.last.usage || {};
      body.append(ledgerLine(`Last turn ${d.last.n}`, `input ${u.input_tokens ?? "?"} + cache read ${u.cache_read_input_tokens ?? 0} + cache write ${u.cache_creation_input_tokens ?? 0}, output ${u.output_tokens ?? "?"} · ${fmtUsd(d.last.cost)}` +
        (d.last.attempts > 1 ? ` · ${d.last.attempts} attempts` : "") + (d.last.est_input ? ` · estimate was ~${d.last.est_input}` : "")));
    }
    const s = d.summary;
    body.append(ledgerLine("Summary", `through turn ${s.through_turn}, ${s.words} words · next at turn ${s.next_due_at_turn}` + (s.last_cost ? ` · last ${fmtUsd(s.last_cost)} (${s.last_model})` : "") + (s.error ? ` · last try failed: ${s.error}` : "")));
    const c = d.counters;
    const kinds = Object.entries(c.kinds || {}).map(([k, n]) => `${k} ${n}`).join(", ") || "none yet";
    body.append(ledgerLine("Counters", `AI turns ${c.ai_turns}, fallbacks ${c.fallbacks}, retries ${c.retries}, merges ${c.merges}, repeats dropped ${c.options_dropped}, low-variety turns ${c.variety_low} · option kinds: ${kinds}`));
    for (const sec of d.sections) {
      const box = el("details", "prompt-sec");
      const over = sec.budget && sec.tokens > sec.budget;
      box.append(el("summary", over ? "over" : "", `${sec.name} · ${sec.tokens}${sec.budget ? " / " + sec.budget : ""} tok${sec.cached ? " · cached" : ""}`));
      box.append(el("pre", "", sec.text || "(empty)"));
      body.append(box);
    }
  } catch {
    body.replaceChildren(el("p", "note", "Couldn't reach the server."));
  }
}

function useGeneric(label) {
  if (label === "Ledger") { openLedger(); return; }
  if (label === "Prompt") { openPrompt(); return; }
  if (label === "Custom action") { openCustom(); return; }
  if (online() && label === "Look") { act({ kind: "look" }, "Look around"); return; }
  if (online() && label === "Talk") { act({ kind: "talk" }, "Talk to someone nearby"); return; }
  addNote(`[${label}] is not wired up yet.`);
}

function buildGeneric() {
  for (const label of GENERIC) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => useGeneric(label));
    generic.append(btn);
  }
  const more = el("button", "", "More");
  more.type = "button";
  more.addEventListener("click", () => setSheet(true));
  generic.append(more);

  for (const label of MORE) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => { if (!PANELS.has(label)) setSheet(false); useGeneric(label); });
    $("sheetBody").append(btn);
  }
  backdrop.addEventListener("click", () => setSheet(false));
  $("sheetClose").addEventListener("click", () => setSheet(false));
  $("ledgerBack").addEventListener("click", () => showLedger(false));

  // Drag the handle area down to dismiss.
  const head = $("sheetHead");
  let startY = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startY = e.clientY;
    head.setPointerCapture(e.pointerId);
    sheet.classList.add("dragging");
  });
  head.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const endDrag = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    sheet.classList.remove("dragging");
    if (dy > 70) setSheet(false); else sheet.style.transform = "";
  };
  head.addEventListener("pointerup", endDrag);
  head.addEventListener("pointercancel", endDrag);
}

custom.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = customText.value.trim();
  closeCustom();
  if (!text) return;
  if (online()) act({ kind: "custom", text }, text);
  else choose(text);
});
$("customCancel").addEventListener("click", closeCustom);

// iOS keeps the layout viewport full height when the keyboard opens, so size the app to the visible area.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    // Only shrink for the keyboard while the input is focused; a stray viewport difference must never shorten the layout.
    const keyboard = document.activeElement?.tagName === "INPUT" && window.innerHeight - vv.height > 80;
    const app = document.getElementById("app");
    app.classList.toggle("kb", keyboard);
    app.style.setProperty("--app-h", keyboard ? vv.height + "px" : "");
    if (keyboard) window.scrollTo(0, 0);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  document.addEventListener("focusout", fit);
}

buildGeneric();
setupServerForm();
if (online()) connect();
else renderTurn(0);
