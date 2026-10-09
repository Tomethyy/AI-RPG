// Character screen (More → Character) and character creation (New game). Both draw inside the sheet's panel area.
// The server owns every number; this file only shows them and sends the player's picks.

const STAT_NAMES = { might: "Might", wits: "Wits", charm: "Charm", grit: "Grit" };
const STAT_HINTS = { might: "force, melee", wits: "notice, know, sneak, ranged", charm: "talk, deceive, lead", grit: "endure, nerve; HP and pack" };
const RANDOM_NAMES = ["Wren", "Tamsin", "Corwin", "Edda", "Bram", "Lysa", "Garrick", "Isolde", "Hob", "Maelis", "Ronan", "Sela", "Dunstan", "Ivo", "Perrin", "Odette", "Joss", "Kestrel", "Alder", "Nessa", "Tobin", "Rhea", "Aldous", "Mirren"];
const sign = (n) => (n >= 0 ? "+" : "") + n;

function section(title) { return el("h3", "", title); }

// ---- Character screen ----

function openCharacter() {
  showPanel(true);
  renderCharacter();
}

function renderCharacter(notes = []) {
  const body = $("ledgerBody");
  body.replaceChildren();
  const p = game?.pc;
  if (!p) { body.append(el("p", "note", "Connect to the server to see your character.")); return; }
  for (const n of notes) body.append(el("p", "note", n));

  const head = el("div", "char-head");
  head.append(el("div", "char-name", p.name));
  head.append(el("div", "ledger-meta", [p.bio?.background, `Level ${p.level}`, p.align].filter(Boolean).join(" · ")));
  const xp = p.xp_next ? `XP ${p.xp}/${p.xp_next}` : `XP ${p.xp} (top level)`;
  head.append(el("div", "ledger-meta", `HP ${p.hp}/${p.hp_max} · ${xp}`));
  if (p.xp_next) {
    const bar = el("div", "xpbar");
    const fill = el("div");
    fill.style.width = Math.max(0, Math.min(100, ((p.xp - p.xp_floor) / (p.xp_next - p.xp_floor)) * 100)) + "%";
    bar.append(fill);
    head.append(bar);
  }
  body.append(head);

  if (p.pick) body.append(pickCard(p.pick));

  const stats = el("div", "stat-grid");
  for (const [k, v] of Object.entries(p.stats)) {
    const cell = el("div", "stat");
    cell.append(el("div", "stat-name", STAT_NAMES[k]), el("div", "stat-val", sign(v)), el("div", "stat-hint", STAT_HINTS[k]));
    stats.append(cell);
  }
  body.append(section("Stats"), stats);

  if (p.bio) {
    body.append(section("Who you are"));
    body.append(ledgerLine("Drive", p.bio.drive), ledgerLine("Flaw", `${p.bio.flaw}. ${p.bio.flaw_text}`));
  }
  if (p.conditions.length) body.append(ledgerLine("Conditions", p.conditions.join(", ")));

  body.append(section("Talents"));
  if (p.edge_next) body.append(el("p", "note", `Your next ${p.edge_next.kind ? p.edge_next.kind + " " : ""}check has advantage.`));
  for (const t of p.talents) {
    const card = el("div", "ledger-entity");
    card.append(el("div", "ledger-name", t.name), el("div", "ledger-fact", t.text));
    if (t.use === "active") {
      const btn = el("button", "mini", t.ready_in ? `Ready in ${t.ready_in} turns` : "Use");
      btn.type = "button";
      btn.disabled = busy || t.ready_in > 0;
      btn.addEventListener("click", () => charAct({ act: "use", id: t.id }));
      card.append(btn);
    }
    body.append(card);
  }
  if (!p.talents.length) body.append(el("p", "note", "No talents yet."));

  body.append(section("Equipment"));
  const eq = Object.entries(p.equipment).filter(([, g]) => g);
  for (const [slot, g] of eq) {
    const nums = g.damage ? `damage ${g.damage}` : g.defense ? `defense ${g.defense}` : "";
    body.append(ledgerLine(slot[0].toUpperCase() + slot.slice(1), `${g.name}${g.rarity ? ` (${g.rarity})` : ""}${nums ? ", " + nums : ""}${g.bonus_stat ? `, +1 ${STAT_NAMES[g.bonus_stat]} checks` : ""}`));
  }
  if (!eq.length) body.append(el("p", "note", "Nothing equipped."));

  body.append(section(`Pack ${p.slots.used}/${p.slots.max}`));
  if (p.slots.used >= p.slots.max) body.append(el("p", "note", "The pack is full. New loot is left behind until you drop something."));
  for (const i of p.inventory) {
    const row = el("div", "pack-row");
    row.append(el("span", "", `${i.name}${i.qty > 1 ? " x" + i.qty : ""}${i.big ? " (big, 2 slots)" : ""}`));
    if (!/^coins?$/i.test(i.name)) {
      const btn = el("button", "mini ghost", "Drop");
      btn.type = "button";
      btn.disabled = busy;
      btn.addEventListener("click", () => { if (confirm(`Drop ${i.name}? It is gone for good.`)) charAct({ act: "drop", id: i.id }); });
      row.append(btn);
    }
    body.append(row);
  }
  if (!p.inventory.length) body.append(el("p", "note", "The pack is empty."));
}

// The waiting level-up choice: a stat to raise, or one of three talents.
function pickCard(pick) {
  const card = el("div", "pick-card");
  card.append(el("div", "ledger-name", pick.kind === "stat" ? `Level ${pick.level}: raise a stat` : pick.level === 1 ? "Choose your first talent" : `Level ${pick.level}: choose a talent`));
  const choices = el("div", "chips");
  if (pick.kind === "stat") {
    for (const s of pick.stats) {
      const b = el("button", "chip", `${STAT_NAMES[s.stat]} ${sign(s.value)} → ${sign(s.value + 1)}`);
      b.append(el("small", "", STAT_HINTS[s.stat]));
      b.type = "button";
      b.disabled = busy;
      b.addEventListener("click", () => charAct({ act: "pick", kind: "stat", stat: s.stat }));
      choices.append(b);
    }
  } else {
    for (const t of pick.offer) {
      const b = el("button", "chip", t.name);
      b.append(el("small", "", t.text));
      b.type = "button";
      b.disabled = busy;
      b.addEventListener("click", () => charAct({ act: "pick", kind: "talent", talent: t.id }));
      choices.append(b);
    }
  }
  card.append(choices);
  return card;
}

const CHAR_ERRORS = { no_such_pick: "Nothing to choose right now.", not_ready: "Not ready yet.", full_health: "You are already at full health.", nothing_to_clear: "Nothing to shake off.", not_usable: "That can't be used.", cannot_drop: "That can't be dropped.", bad_stat: "That stat can't go higher.", bad_talent: "That talent isn't on offer." };

async function charAct(body) {
  if (busy) return;
  try {
    const { status, data } = await api("/api/char", body);
    if (status === 200) {
      applyState(data.state);
      for (const e of data.events || []) story.append(el("p", "note", e));
      scrollDown();
      renderCharacter(data.events || []);
    } else {
      if (data?.state) applyState(data.state);
      renderCharacter([CHAR_ERRORS[data?.error] || `Error ${status}`]);
    }
  } catch {
    renderCharacter(["Couldn't reach the server."]);
  }
}

// ---- Character creation (New game) ----

async function openCreation() {
  const body = $("ledgerBody");
  body.replaceChildren(el("p", "note", "Loading…"));
  showPanel(true);
  if (!online()) { body.replaceChildren(el("p", "note", "Connect to a server first.")); return; }
  let t;
  try {
    const { status, data } = await api("/api/creation");
    if (status !== 200) { body.replaceChildren(el("p", "note", `Couldn't load character creation (${status}).`)); return; }
    t = data;
  } catch {
    body.replaceChildren(el("p", "note", "Couldn't reach the server."));
    return;
  }
  const pick = { name: RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)], background: "", drive: "", flaw: "", law: "neutral", good: "neutral", free: {}, talent: "" };
  const spent = () => Object.values(pick.free).reduce((a, b) => a + b, 0);
  const bg = () => t.backgrounds.find((b) => b.id === pick.background);

  function chips(items, key, render) {
    const wrap = el("div", "chips");
    for (const it of items) {
      const b = el("button", "chip" + (pick[key] === it.id ? " on" : ""), render.title(it));
      if (render.sub) b.append(el("small", "", render.sub(it)));
      b.type = "button";
      b.addEventListener("click", () => { pick[key] = it.id; if (key === "background") { pick.talent = ""; pick.free = {}; } draw(); });
      wrap.append(b);
    }
    return wrap;
  }

  function draw() {
    const keep = sheet.scrollTop;
    body.replaceChildren();
    body.append(el("p", "note", "Make your character. The world is the Realm of Calder; you play a human."));

    body.append(section("Name"));
    const row = el("div", "name-row");
    const input = el("input");
    input.type = "text"; input.value = pick.name; input.maxLength = 24; input.autocomplete = "off"; input.setAttribute("aria-label", "Name");
    input.addEventListener("input", () => { pick.name = input.value; updateBegin(); });
    const rnd = el("button", "mini ghost", "Random");
    rnd.type = "button";
    rnd.addEventListener("click", () => { pick.name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]; draw(); });
    row.append(input, rnd);
    body.append(row);

    body.append(section("Background"));
    body.append(chips(t.backgrounds, "background", { title: (b) => b.name, sub: (b) => b.text }));
    body.append(section("Drive"));
    body.append(chips(t.drives, "drive", { title: (d) => d.name, sub: (d) => d.text }));
    body.append(section("Flaw"));
    body.append(chips(t.flaws, "flaw", { title: (f) => f.name, sub: (f) => f.text }));

    body.append(section("How you live"));
    for (const q of t.questions) {
      body.append(el("p", "ledger-line q", q.text));
      body.append(chips(q.answers, q.axis, { title: (a) => a.text }));
    }

    body.append(section(`Stats · ${t.free_points - spent()} point${t.free_points - spent() === 1 ? "" : "s"} to place`));
    const b = bg();
    if (!b) body.append(el("p", "note", "Pick a background to see its stats."));
    else {
      for (const s of t.stats) {
        const free = pick.free[s] || 0;
        const r = el("div", "pack-row stat-row");
        r.append(el("span", "", `${STAT_NAMES[s]} ${sign(b.stats[s] + free)}`), el("small", "", STAT_HINTS[s]));
        const minus = el("button", "mini ghost", "−");
        const plus = el("button", "mini", "+");
        minus.type = plus.type = "button";
        minus.disabled = free === 0;
        plus.disabled = spent() >= t.free_points || b.stats[s] + free >= t.stat_max;
        minus.addEventListener("click", () => { pick.free[s] = free - 1; if (!pick.free[s]) delete pick.free[s]; draw(); });
        plus.addEventListener("click", () => { pick.free[s] = free + 1; draw(); });
        const ctl = el("span", "step");
        ctl.append(minus, plus);
        r.append(ctl);
        body.append(r);
      }
      body.append(section("Starting talent"));
      body.append(chips(b.talents, "talent", { title: (x) => x.name, sub: (x) => x.text }));
    }

    const begin = el("button", "begin", "Begin");
    begin.type = "button";
    begin.id = "beginBtn";
    begin.addEventListener("click", submit);
    body.append(begin, el("p", "note", "Starting a new game replaces the current run (one backup stays on the server)."));
    updateBegin();
    sheet.scrollTop = keep;
  }

  function ready() {
    return /^[\p{L}\p{N}][\p{L}\p{N} '’-]{0,23}$/u.test(pick.name.trim()) && pick.background && pick.drive && pick.flaw && pick.talent && spent() === t.free_points;
  }
  function updateBegin() { const b = $("beginBtn"); if (b) b.disabled = !ready(); }

  async function submit() {
    if (!ready() || !confirm("Start a new game with this character? The current run is replaced (one backup is kept on the server).")) return;
    const { status, data } = await api("/api/new", { confirm: true, character: { ...pick, name: pick.name.trim() } });
    if (status === 200) { lsSet(LS.pending, ""); renderFull(data); setSheet(false); }
    else body.prepend(el("p", "note", `Couldn't start the game (${status}${data?.field ? ": check " + data.field : ""}).`));
  }

  draw();
}
