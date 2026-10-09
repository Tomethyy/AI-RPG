// Local stand-in for the Claude API, for testing the Worker without spending credit.
// POST /__queue with a JSON array of modes ("valid", "invalid", "refusal", "error500", "badjson", "badregion", "slowregion", "wrongroll") to script replies.
// Calls with the region schema get a story plan; requests without a JSON schema are background calls:
// rolling summary (plain-text summary), fact merge (a few fact lines) or epilogue (paragraphs).
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] || 8788);
const logFile = process.argv[3] || "/dev/null";
let queue = [];
let n = 0;

// A free-text action: read code's roll table from the prompt and report the matching result (or a wrong one, to test the retry).
function customRoll(prompt, wrong) {
  const m = /Results: .*?wits [+-]\d+: easy (\w+), standard (\w+)/.exec(prompt);
  if (!m) return { stat: "wits", tier: "none", value: "scene", result: "none" };
  const result = wrong ? (m[2] === "success" ? "failure" : "success") : m[2];
  return { stat: "wits", tier: "standard", value: "advance", result };
}

function turnJSON(prompt, mode) {
  n++;
  const isCustom = /Free-text action: the app rolled/.test(prompt);
  return {
    narration: [`Mock narration ${n}. Maren looks up from the satchel.`, n === 3 ? "Tobin Reed, a ferry hand, leans on the doorframe." : "Rain keeps falling."],
    options: [
      { text: `Ask Maren about the seal ${n}`, kind: "social", stat: "charm", tier: "standard", edge: "none", edge_why: "", value: "advance", quest: "main", npc: "Maren" },
      { text: `Search the stable ${n}`, kind: "explore", stat: "wits", tier: n % 5 === 0 ? "legendary" : "daunting", edge: "none", edge_why: "", value: "sidetrack", quest: "", npc: "" },
      { text: `Push past the drovers ${n}`, kind: "direct", stat: "might", tier: "hard", edge: n % 4 === 0 ? "advantage" : "none", edge_why: n % 4 === 0 ? "Maren holds the door" : "", value: n % 5 === 0 ? "costly" : "scene", quest: n % 5 === 0 ? "main" : "", npc: "" },
      { text: `Wait and listen ${n}`, kind: "cautious", stat: "grit", tier: "easy", edge: n % 4 === 0 ? "disadvantage" : "none", edge_why: "rain", value: n % 5 === 0 ? "costly" : "scene", quest: "", npc: "" }, // a second edge and a second costly in one turn: code drops them
    ],
    classification: "allowed",
    custom_roll: isCustom ? customRoll(prompt, mode === "wrongroll") : { stat: "wits", tier: "none", value: "scene", result: "none" },
    state_changes: [
      ...(n % 3 === 0 ? [{ actor: "pc", kind: "item_add", amount: 1, text: "Iron dagger", reason: "found" }, { actor: "pc", kind: "xp", amount: 9, text: "", reason: "clever" }] : n === 2 ? [{ actor: "pc", kind: "move", amount: 0, text: "Gull's Landing", reason: "walked there" }, { actor: "nobody", kind: "hp", amount: -3, text: "", reason: "x" }] : [{ actor: "pc", kind: "hp", amount: n % 2 ? -2 : 1, text: "", reason: "scuffle" }]),
      ...(n % 6 === 0 ? [{ actor: "pc", kind: "good", amount: 1, text: "", reason: "spared a thief" }, { actor: "pc", kind: "good", amount: 1, text: "", reason: "again" }] : []),
      ...(n % 7 === 0 ? [{ actor: "pc", kind: "law", amount: -1, text: "", reason: "broke an oath" }] : []),
      ...(n % 4 === 1 ? [{ actor: "pc", kind: "item_add", amount: 1, text: `Trinket ${n}`, reason: "found" }] : []),
      ...(n % 5 === 0 ? [{ actor: "pc", kind: "attitude", amount: 1, text: "Maren", reason: "helped her" }, { actor: "pc", kind: "attitude", amount: 1, text: "Maren", reason: "again" }] : []),
      ...(n % 4 === 2 ? [{ actor: "pc", kind: "time", amount: 1, text: "", reason: "a long search" }] : []),
    ],
    new_facts: [
      { entity: n === 1 ? "The woman by the hearth" : "Maren", type: "npc", kind: "identity", fact: n === 1 ? "Sews a seal onto a satchel" : "Sews seals onto satchels", location: "", was: n === 2 ? "the woman by the hearth" : "" },
      { entity: "Gull's Landing", type: "location", kind: "place", fact: "A ferry landing downriver", location: "", was: "" },
      { entity: "Maren", type: "npc", kind: "want", fact: `Wants the road kept closed, reason ${n}`, location: "", was: "" },
      ...(n === 3 ? [{ entity: "Tobin Reed", type: "npc", kind: "identity", fact: "A ferry hand", location: "", was: "" }] : []),
      ...(n === 4 ? [{ entity: `Far Place ${n}`, type: "location", kind: "place", fact: "A place the AI made up", location: "", was: "" }] : []),
    ],
    profiles: n === 3 ? [{ npc: "Tobin Reed", want: "a dry bed", fear: "the river", secret: "owes the ferryman", voice: "hums sea songs" }] : [],
    side_quest: n === 7 ? { title: "The drowned cart", goal: "Pull the miller's cart out of the river", giver: "Maren" } : n === 8 ? { title: "A second errand", goal: "Refused while the first is open", giver: "Maren" } : { title: "", goal: "", giver: "" },
    quest_flags: n === 20 ? ["failed:s9"] : [],
  };
}

// The story plan: a fixture shared with the unit tests; "badregion" cuts it to 3 places so code rejects it.
const REGION = JSON.parse(fs.readFileSync(new URL("./fixtures/region.json", import.meta.url), "utf8"));
const regionJSON = (bad) => (bad ? { ...REGION, places: REGION.places.slice(0, 3) } : REGION);

const reply = (res, text, extra = {}) => {
  res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock" });
  res.end(JSON.stringify({ id: "msg_mock", type: "message", role: "assistant", content: [{ type: "text", text }], stop_reason: "end_turn", stop_details: null, ...extra }));
};

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__queue") { queue = JSON.parse(body); res.end("ok"); return; }
    fs.appendFileSync(logFile, JSON.stringify({ url: req.url, headers: req.headers, body: JSON.parse(body) }) + "\n");
    const call = JSON.parse(body);
    const system = JSON.stringify(call.system);
    if (!call.output_config?.format && system.includes("tidy the facts")) {
      reply(res, "Sews seals onto satchels\n- Muttered about the road\n2. Secretly worried about the bridge", { model: call.model, usage: { input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
      return;
    }
    if (!call.output_config?.format && system.includes("epilogue")) {
      reply(res, "The crossing reopened.\n\nMaren found her son.\n\nThe character walked on.", { model: call.model, usage: { input_tokens: 1500, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
      return;
    }
    if (!call.output_config?.format) {
      const last = [...JSON.stringify(call.messages).matchAll(/Turn (\d+)\./g)].map((m) => m[1]).at(-1);
      reply(res, `Mock summary through turn ${last}. Ash met Maren at the Rusted Ford.`, { model: call.model, usage: { input_tokens: 1800, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
      return;
    }
    const mode = queue.shift() || "valid";
    if (mode === "error500") { res.writeHead(500, { "content-type": "application/json" }); res.end('{"type":"error","error":{"type":"api_error","message":"boom"}}'); return; }
    if (call.output_config.format.schema.properties.places) {
      if (mode === "slowregion") { setTimeout(() => reply(res, JSON.stringify(regionJSON(false)), { model: call.model, usage: { input_tokens: 3200, output_tokens: 7000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }), 700); return; }
      reply(res, JSON.stringify(regionJSON(mode === "badregion")), { model: call.model, usage: { input_tokens: 3200, output_tokens: 7000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
      return;
    }
    const prompt = JSON.stringify(call.messages);
    let text = JSON.stringify(turnJSON(prompt, mode));
    if (mode === "invalid") text = JSON.stringify({ ...turnJSON(prompt), options: [{ text: "Only one", kind: "social", stat: "wits", tier: "standard", edge: "none", edge_why: "", value: "scene", quest: "", npc: "" }] });
    if (mode === "badjson") text = "{not json";
    const msg = {
      id: "msg_mock", type: "message", role: "assistant", model: call.model,
      content: mode === "refusal" ? [] : [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
      stop_reason: mode === "refusal" ? "refusal" : "end_turn",
      stop_details: mode === "refusal" ? { type: "refusal", category: "general_harms", explanation: "" } : null,
      usage: { input_tokens: 2700, output_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 3600 },
    };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock" });
    res.end(JSON.stringify(msg));
  });
}).listen(port, "127.0.0.1", () => console.log("mock anthropic on", port));
