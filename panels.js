// The More sheet and its read-only panels: build info, Ledger and Prompt (no AI calls).
// Uses globals from ui.js and app.js (game, REASONS).

function setSheet(open) {
  sheet.hidden = backdrop.hidden = !open;
  sheet.style.transform = "";
  if (!open) showPanel(false);
  if (open) showBuildInfo();
}

// One panel area inside the sheet (Ledger, Prompt, Character, New character) replaces the menu and the server form.
function showPanel(on) {
  sheet.scrollTop = 0;
  $("ledger").hidden = !on;
  $("sheetBody").hidden = on;
  $("serverForm").hidden = on;
}

// Build stamp + live layout numbers, so the Home Screen app can be compared with Safari.
const metaBuild = (document.querySelector('meta[name="build"]')?.content || "?|").split("|");
const HTML_BUILD = metaBuild[0];
const CSS_BUILD = getComputedStyle(document.documentElement).getPropertyValue("--build").replace(/["'\s]/g, "");

// html, css and js are stamped together. If a cached file is from another build, reload once past the cache (called by app.js).
function reloadIfStale() {
  if (new Set([HTML_BUILD, CSS_BUILD, JS_BUILD]).size > 1 && !location.search.includes("fresh=")) {
    location.replace(location.pathname + "?fresh=" + Date.now());
  }
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

async function openLedger() {
  const body = $("ledgerBody");
  body.replaceChildren(el("p", "note", "Loading…"));
  showPanel(true);
  if (!online()) { body.replaceChildren(el("p", "note", "The ledger lives on the server. Go back and connect a server first.")); return; }
  try {
    const { status, data } = await api("/api/ledger");
    if (status !== 200) { body.replaceChildren(el("p", "note", `Couldn't load the ledger (${status}).`)); return; }
    body.replaceChildren();
    const pc = game?.pc;
    if (pc?.stats) {
      const eq = Object.values(pc.equipment || {}).map((g) => g.name).join(", ") || "nothing";
      const st = Object.entries(pc.stats).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)} ${v}`).join(", ");
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
  showPanel(true);
  if (!online()) { body.replaceChildren(el("p", "note", "The prompt is built on the server. Go back and connect a server first.")); return; }
  try {
    const { status, data } = await api("/api/prompt");
    if (status !== 200) { body.replaceChildren(el("p", "note", `Couldn't load the prompt (${status}).`)); return; }
    body.replaceChildren();
    const d = data;
    body.append(el("p", "note", `Next prompt (turn ${d.turn}, example action "${d.example_action}") · ${d.model}`));
    body.append(ledgerLine("Estimate", `~${d.est.total} tokens including the output schema, ~${d.est.cached} of them cacheable` +
      (d.est.scaled ? ` · scaled by the last turn's real/estimated ratio (${d.ratio}): ~${d.est.scaled}` : "")));
    if (d.last) {
      const u = d.last.usage || {};
      body.append(ledgerLine(`Last turn ${d.last.n}`, `input ${u.input_tokens ?? "?"} + cache read ${u.cache_read_input_tokens ?? 0} + cache write ${u.cache_creation_input_tokens ?? 0}, output ${u.output_tokens ?? "?"} · ${fmtUsd(d.last.cost)}` +
        (d.last.attempts > 1 ? ` · ${d.last.attempts} attempts` : "") + (d.last.est_input ? ` · estimate was ~${d.last.est_input}` : "")));
    }
    const s = d.summary;
    body.append(ledgerLine("Summary", `through turn ${s.through_turn}, ${s.words} words · next at turn ${s.next_due_at_turn}` + (s.last_cost ? ` · last ${fmtUsd(s.last_cost)} (${s.last_model})` : "") + (s.error ? ` · last try failed: ${s.error}` : "")));
    const c = d.counters;
    const kinds = Object.entries(c.kinds || {}).map(([k, n]) => `${k} ${n}`).join(", ") || "none yet";
    body.append(ledgerLine("Counters", `AI turns ${c.ai_turns}, fallbacks ${c.fallbacks}, retries ${c.retries}, merges ${c.merges}, fact merges ${c.fact_merges || 0}, repeats dropped ${c.options_dropped}, low-variety turns ${c.variety_low} · option kinds: ${kinds}`));
    const tiers = Object.entries(c.tiers || {}).map(([k, n]) => `${k} ${n}`).join(", ") || "none yet";
    const results = Object.entries(c.results || {}).map(([k, n]) => `${k} ${n}`).join(", ") || "none yet";
    body.append(ledgerLine("Checks", `tiers: ${tiers} · results: ${results} · edges ${c.edges || 0}`));
    for (const f of (d.fallbacks || []).slice().reverse()) {
      const when = new Date(f.ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
      body.append(ledgerLine(`Fallback · turn ${f.turn} · ${when}`, `${REASONS[f.reason] || f.reason}${f.detail ? ": " + f.detail : ""}`));
    }
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
