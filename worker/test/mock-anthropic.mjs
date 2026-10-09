// Local stand-in for the Claude API, for testing the Worker without spending credit.
// POST /__queue with a JSON array of modes ("valid", "invalid", "refusal", "error500", "badjson") to script replies.
// Requests without a JSON schema are rolling-summary calls and get a plain-text summary.
import http from "node:http";
import fs from "node:fs";

const port = Number(process.argv[2] || 8788);
const logFile = process.argv[3] || "/dev/null";
let queue = [];
let n = 0;

function turnJSON() {
  n++;
  return {
    narration: [`Mock narration ${n}. Maren looks up from the satchel.`, "Rain keeps falling."],
    options: [
      { text: `Ask Maren about the seal ${n}`, kind: "social", stat: "wits", difficulty: 11 },
      { text: `Search the stable ${n}`, kind: "explore", stat: "wits", difficulty: 25 },
      { text: `Push past the drovers ${n}`, kind: "direct", stat: "might", difficulty: 13 },
    ],
    classification: "allowed",
    state_changes: n % 3 === 0 ? [{ actor: "pc", kind: "item_add", amount: 1, text: "Iron dagger", reason: "found" }, { actor: "pc", kind: "xp", amount: 9, text: "", reason: "clever" }] : n === 2 ? [{ actor: "pc", kind: "move", amount: 0, text: "Gull's Landing", reason: "walked there" }, { actor: "nobody", kind: "hp", amount: -3, text: "", reason: "x" }] : [{ actor: "pc", kind: "hp", amount: -2, text: "", reason: "scuffle" }],
    new_facts: [
      { entity: n === 1 ? "The woman by the hearth" : "Maren", type: "npc", fact: n === 1 ? "Sews a seal onto a satchel" : "Sews seals onto satchels", location: "The Rusted Ford", was: n === 2 ? "the woman by the hearth" : "" },
      { entity: "Gull's Landing", type: "location", fact: "A ferry landing downriver", location: "The Rusted Ford", was: "" },
      { entity: "Maren", type: "npc", fact: "Sews seals onto satchels", location: "", was: "" },
    ],
    quest_flags: [],
  };
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/__queue") { queue = JSON.parse(body); res.end("ok"); return; }
    fs.appendFileSync(logFile, JSON.stringify({ url: req.url, headers: req.headers, body: JSON.parse(body) }) + "\n");
    const call = JSON.parse(body);
    if (!call.output_config?.format) {
      const last = [...JSON.stringify(call.messages).matchAll(/Turn (\d+)\./g)].map((m) => m[1]).at(-1);
      const msg = { id: "msg_mock_sum", type: "message", role: "assistant", model: call.model, content: [{ type: "text", text: `Mock summary through turn ${last}. Ash met Maren at the Rusted Ford.` }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 1800, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
      res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock_sum" });
      res.end(JSON.stringify(msg));
      return;
    }
    const mode = queue.shift() || "valid";
    if (mode === "error500") { res.writeHead(500, { "content-type": "application/json" }); res.end('{"type":"error","error":{"type":"api_error","message":"boom"}}'); return; }
    let text = JSON.stringify(turnJSON());
    if (mode === "invalid") text = JSON.stringify({ ...turnJSON(), options: [{ text: "Only one", kind: "social", stat: "wits", difficulty: 10 }] });
    if (mode === "badjson") text = "{not json";
    const msg = {
      id: "msg_mock", type: "message", role: "assistant", model: JSON.parse(body).model,
      content: mode === "refusal" ? [] : [{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text }],
      stop_reason: mode === "refusal" ? "refusal" : "end_turn",
      stop_details: mode === "refusal" ? { type: "refusal", category: "general_harms", explanation: "" } : null,
      usage: { input_tokens: 2500, output_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 1400 },
    };
    res.writeHead(200, { "content-type": "application/json", "request-id": "req_mock" });
    res.end(JSON.stringify(msg));
  });
}).listen(port, "127.0.0.1", () => console.log("mock anthropic on", port));
