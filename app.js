// Story screen, play loop and buttons. Online: turns come from the backend (More → Server). Offline: the Phase 1 hardcoded demo below.
// Online, dice and rules come from the server; the offline demo uses fixed fake dice.
// Shared helpers are in ui.js, the More sheet panels in panels.js, the Character screen and creation in character.js.

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
    dice: { die: 14, label: "Wits", mod: 2, dc: 12, result: "success", success: true },
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
    dice: { die: 4, label: "Grit", mod: 1, dc: 13, result: "failure", success: false },
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

const JS_BUILD = "1.44"; // stamped by stamp.py
const HP_MAX = 20;
const GENERIC = ["Talents", "Travel", "Rest", "Custom"];
const MORE = ["Character", "Quests", "Ledger", "Prompt", "Playtest log", "Wildcard"];
const PANELS = new Set(["Character", "Quests", "Ledger", "Prompt", "Playtest log"]); // open inside the More sheet
let turnIndex = 0;

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

function setBusy(on) {
  busy = on;
  for (const b of document.querySelectorAll("#options button, #generic button, #custom button")) b.disabled = on;
  $("pending")?.remove();
  if (on) { const p = el("p", "note pending", "The story continues…"); p.id = "pending"; story.append(p); scrollDown(); }
}

function applyState(state) {
  game = state;
  renderHeader(state.location, state.pc.hp, state.pc.hp_max, state.turn, state.part || "");
  if (state.over) renderGameOver(state);
  else renderOptions(state.scene.options, (i) => act({ kind: "option", index: i }, state.scene.options[i].text));
  // A waiting level-up choice lights up the More button and the Character entry.
  const waiting = !!state.pc.pick;
  generic.lastElementChild?.classList.toggle("alert", waiting);
  generic.firstElementChild.textContent = state.pc.edge_next ? "Talents ⚡" : "Talents"; // an advantage talent is armed
  document.querySelector("#sheetBody button")?.classList.toggle("alert", waiting);
}

function renderFull(state) {
  story.replaceChildren();
  if (!state.recent.length) for (const p of state.scene.narration) story.append(el("p", "", p));
  else story.append(el("p", "note", "(Earlier scenes are kept in the save.)"));
  for (const t of state.recent) {
    story.append(el("p", "chosen", "▸ " + t.action));
    if (t.dice) story.append(renderDice(t.dice, false));
    for (const p of t.narration) story.append(el("p", "", p));
    for (const e of t.events || []) if (QUEST_NOTE.test(e)) story.append(el("p", "note", e));
  }
  if (state.over?.epilogue) appendEpilogue(state.over.epilogue);
  applyState(state);
  scrollDown();
}

// Quest notes stay visible when the story is redrawn (XP and loot notes do not).
const QUEST_NOTE = /^(New lead|Milestone complete|New side quest|Side quest|You chose|A decision|The threat grows|Doom|The story is complete)/;

function appendEpilogue(paragraphs) {
  story.append(el("h3", "epilogue-head", "Epilogue"));
  for (const p of paragraphs) story.append(el("p", "epilogue", p));
}

// The story is over: the options make way for the epilogue, then for a new game.
function renderGameOver(state) {
  const options = $("options");
  options.replaceChildren();
  const btn = el("button", "", state.over.epilogue ? "Start a new game" : "Read the epilogue");
  btn.type = "button";
  btn.addEventListener("click", async () => {
    if (state.over.epilogue) { setSheet(true); openCreation(); return; }
    if (busy) return;
    setBusy(true);
    $("pending").textContent = "The narrator is writing the epilogue…";
    try {
      const { status, data } = await api("/api/epilogue", {});
      setBusy(false);
      if (status === 200 && data?.over?.epilogue) { appendEpilogue(data.over.epilogue); applyState(data); scrollDown(); }
      else addNote(`Couldn't write the epilogue (${status}${data?.error ? ": " + data.error : ""}). Tap to try again.`);
    } catch { setBusy(false); addNote("Couldn't reach the server. Tap to try again."); }
  });
  options.append(btn);
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
  if (status === 409 && data?.state) { renderFull(data.state); addNote(data.error === "game_over" ? "(The story is over.)" : "(Synced with the saved game.)"); return true; }
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
  // New game opens character creation; the game starts when the player taps Begin there.
  $("newGame").addEventListener("click", () => {
    if (!online()) { $("serverStatus").textContent = "Connect to a server first."; return; }
    openCreation();
  });
}

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

function useGeneric(label) {
  if (label === "Character") { openCharacter(); return; }
  if (label === "Quests") { openQuests(); return; }
  if (label === "Ledger") { openLedger(); return; }
  if (label === "Prompt") { openPrompt(); return; }
  if (label === "Playtest log") { openPlaytest(25); return; }
  if (label === "Talents") { openTalents(); return; }
  if (label === "Custom") { openCustom(); return; }
  addNote(`[${label}] is not wired up yet.`);
}

function buildGeneric() {
  for (const label of GENERIC) {
    const btn = el("button", "", label);
    btn.type = "button";
    btn.addEventListener("click", () => { if (label === "Talents") setSheet(true); useGeneric(label); });
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
  $("ledgerBack").addEventListener("click", () => showPanel(false));

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

reloadIfStale();
buildGeneric();
setupServerForm();
if (online()) connect();
else renderTurn(0);
