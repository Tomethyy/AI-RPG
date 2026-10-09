// KV storage: the save, its backups, the turn archive and the daily spend counter.
import { migrate, SCHEMA_VERSION, ARCHIVE_CHUNK } from "./schema.js";

export const SLOT = "main";
const DEFAULT_CAP_USD = 1;

const today = () => new Date().toISOString().slice(0, 10);

export async function getSpend(env) {
  return Number((await env.GAME.get(`spend:${today()}`)) || 0);
}

export async function addSpend(env, usd) {
  if (!usd) return;
  const key = `spend:${today()}`;
  const now = Number((await env.GAME.get(key)) || 0);
  await env.GAME.put(key, String(now + usd), { expirationTtl: 3 * 86400 });
}

export function capUSD(env) {
  const n = parseFloat(env.DAILY_CAP_USD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CAP_USD;
}

export async function underCap(env) {
  return (await getSpend(env)) < capUSD(env);
}

// An older save is copied to "bak:<slot>:v<old version>" before it is migrated and stored, once; then it stays on the new version.
export async function loadSave(env) {
  const raw = await env.GAME.get(`save:${SLOT}`);
  if (!raw) return null;
  const save = JSON.parse(raw);
  if (save.v === SCHEMA_VERSION) return save;
  const from = save.v ?? 1;
  const migrated = migrate(save); // throws on a save from a newer server, leaving it untouched
  await env.GAME.put(`bak:${SLOT}:v${from}`, raw);
  await storeSave(env, migrated);
  return migrated;
}

export async function storeSave(env, save) {
  save.updated_at = new Date().toISOString();
  await env.GAME.put(`save:${SLOT}`, JSON.stringify(save));
}

export async function archiveTurn(env, save, record) {
  const key = `arc:${save.id}:${Math.floor(record.n / ARCHIVE_CHUNK)}`;
  const chunk = (await env.GAME.get(key, "json")) || [];
  if (!chunk.some((r) => r.n === record.n)) chunk.push(record);
  await env.GAME.put(key, JSON.stringify(chunk));
}
