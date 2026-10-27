"use strict";
const crypto = require("node:crypto");
const { gzip, gunzipSync } = require("node:zlib");
const { promisify } = require("node:util");
const gzipAsync = promisify(gzip);
const MAX_LOG_BYTES = 32 * 1024 * 1024;

function createD1LogStore(env = process.env, fetchImpl = fetch) {
  const account = env.CHIBATORU_D1_ACCOUNT_ID || "";
  const database = env.CHIBATORU_D1_DATABASE_ID || "";
  const token = env.CHIBATORU_D1_API_TOKEN || "";
  if (!account || !database || !token) return null;
  if (!/^[a-f0-9]{32}$/i.test(account) || !/^[a-f0-9-]{36}$/i.test(database)) throw new Error("D1のアカウントID・データベースIDを確認してください。");
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  async function query(body) {
    const response = await fetchImpl(url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
    });
    const data = await response.json();
    if (!response.ok || !data.success || !Array.isArray(data.result) || data.result.some(r => !r.success)) {
      // Never include a remote response, request header or token in logs/UI.
      throw new Error(`D1への保存・取得に失敗しました（HTTP ${response.status}）。権限・容量・無料枠を確認してください。`);
    }
    return data.result;
  }
  let initialized;
  function init() {
    if (!initialized) initialized = query({ batch: [
      { sql: "CREATE TABLE IF NOT EXISTS battle_log_manifest (game_id TEXT PRIMARY KEY, revision TEXT NOT NULL, parts INTEGER NOT NULL, updated_at TEXT NOT NULL, metadata TEXT NOT NULL)" },
      { sql: "CREATE TABLE IF NOT EXISTS battle_log_parts (game_id TEXT NOT NULL, revision TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (game_id, revision, part))" },
      { sql: "CREATE INDEX IF NOT EXISTS battle_log_pending_updates ON battle_log_manifest(updated_at) WHERE json_extract(metadata, '$.final') IS NOT 1 AND json_extract(metadata, '$.deleted') IS NOT 1" }
    ] }).catch(error => { initialized = null; throw error; });
    return initialized;
  }
  return {
    async put(log) {
      await init();
      const current = (await query({ sql: "SELECT metadata FROM battle_log_manifest WHERE game_id = ?", params: [log.gameId] }))[0].results[0];
      if (current && JSON.parse(current.metadata).deleted) return;
      const raw = Buffer.from(JSON.stringify(log));
      if (raw.length > MAX_LOG_BYTES) throw new Error("詳細ログが保存上限を超えています。端末へ保存してください。");
      const packed = (await gzipAsync(raw)).toString("base64");
      const revision = crypto.createHash("sha256").update(raw).digest("hex");
      const chunks = packed.match(/.{1,131072}/g) || [""];
      for (let offset = 0; offset < chunks.length; offset += 20) {
        await query({ batch: chunks.slice(offset, offset + 20).map((data, i) => ({
          sql: "INSERT OR REPLACE INTO battle_log_parts (game_id, revision, part, data) VALUES (?, ?, ?, ?)",
          params: [log.gameId, revision, String(offset + i), data]
        })) });
      }
      const metadata = JSON.stringify({ gameId: log.gameId, receivedAt: log.receivedAt, final: log.final, closedReason: log.closedReason, closedAt: log.closedAt, summary: log.summary, learning: log.learning });
      // Publish the new revision only after every chunk succeeded; old data stays readable on failure.
      await query({ sql: "INSERT OR REPLACE INTO battle_log_manifest (game_id, revision, parts, updated_at, metadata) VALUES (?, ?, ?, ?, ?)",
        params: [log.gameId, revision, String(chunks.length), log.receivedAt || new Date().toISOString(), metadata] });
      await query({ sql: "DELETE FROM battle_log_parts WHERE game_id = ? AND revision <> ?", params: [log.gameId, revision] });
    },
    async get(gameId) {
      await init();
      const meta = (await query({ sql: "SELECT * FROM battle_log_manifest WHERE game_id = ?", params: [gameId] }))[0].results[0];
      if (!meta || JSON.parse(meta.metadata).deleted) return null;
      const rows = (await query({ sql: "SELECT part, data FROM battle_log_parts WHERE game_id = ? AND revision = ? ORDER BY part", params: [gameId, meta.revision] }))[0].results;
      if (rows.length !== Number(meta.parts) || rows.some((row, i) => Number(row.part) !== i)) throw new Error("クラウドの記録に不足があります。");
      const raw = gunzipSync(Buffer.from(rows.map(r => r.data).join(""), "base64"), { maxOutputLength: MAX_LOG_BYTES });
      if (crypto.createHash("sha256").update(raw).digest("hex") !== meta.revision) throw new Error("クラウドの記録が一致しません。");
      const log = JSON.parse(raw);
      const metadata = JSON.parse(meta.metadata);
      if (metadata.closedReason === "inactive") Object.assign(log, { final: true, closedReason: "inactive", closedAt: metadata.closedAt });
      return log;
    },
    async delete(gameId) {
      await init();
      // Retain a tiny tombstone so a late upload cannot resurrect a deleted game.
      await query({ batch: [
        { sql: "INSERT OR REPLACE INTO battle_log_manifest (game_id, revision, parts, updated_at, metadata) VALUES (?, ?, ?, ?, ?)",
          params: [gameId, "deleted", "0", new Date().toISOString(), JSON.stringify({ gameId, deleted: true })] },
        { sql: "DELETE FROM battle_log_parts WHERE game_id = ?", params: [gameId] }
      ] });
    },
    async closeInactive(cutoff) {
      await init();
      await query({ sql: "UPDATE battle_log_manifest SET metadata = json_set(metadata, '$.final', json('true'), '$.closedReason', 'inactive', '$.closedAt', ?) WHERE updated_at <= ? AND json_extract(metadata, '$.final') IS NOT 1 AND json_extract(metadata, '$.deleted') IS NOT 1",
        params: [new Date(Date.parse(cutoff) + 30 * 60 * 1000).toISOString(), cutoff] });
    },
    async list(cursor = "", limit = 50) {
      await init();
      const rows = (await query({ sql: cursor
        ? "SELECT game_id, metadata FROM battle_log_manifest WHERE game_id < ? AND json_extract(metadata, '$.deleted') IS NOT 1 ORDER BY game_id DESC LIMIT ?"
        : "SELECT game_id, metadata FROM battle_log_manifest WHERE json_extract(metadata, '$.deleted') IS NOT 1 ORDER BY game_id DESC LIMIT ?",
        params: cursor ? [cursor, String(limit + 1)] : [String(limit + 1)] }))[0].results;
      return { logs: rows.slice(0, limit).map(row => JSON.parse(row.metadata)), nextCursor: rows.length > limit ? rows[limit - 1].game_id : "" };
    }
  };
}

function createArchiveQueue(store, { intervalMs = 30000, finalDelayMs = 1200 } = {}) {
  const pending = new Map();
  const status = { configured: Boolean(store), pending: 0, lastSavedAt: "", error: "" };
  let running = false, finalTimer;
  let activeFlush = Promise.resolve();
  const deleted = new Set();
  function flush() {
    if (!store || running) return activeFlush;
    activeFlush = runFlush();
    return activeFlush;
  }
  async function runFlush() {
    running = true;
    try {
      for (const [id, log] of [...pending]) {
        if (pending.get(id) !== log) continue;
        pending.delete(id);
        if (deleted.has(id)) continue;
        try {
          await store.put(log);
          status.lastSavedAt = new Date().toISOString(); status.error = "";
        } catch {
          if (!deleted.has(id) && !pending.has(id)) pending.set(id, log);
          status.error = "クラウドへ未保存のログがあります。設定・容量・通信を確認してください。";
          break;
        }
      }
    } finally { status.pending = pending.size; running = false; }
  }
  const timer = setInterval(() => { void flush(); }, intervalMs); timer.unref();
  return {
    status, flush,
    async delete(gameId) {
      deleted.add(gameId); pending.delete(gameId); status.pending = pending.size;
      await activeFlush;
      await store?.delete(gameId);
    },
    enqueue(log) {
      if (deleted.has(log.gameId) || !store || log.source !== "online-human-v1" || !log.serverVerifiedHumanMatch) return;
      pending.set(log.gameId, log); status.pending = pending.size;
      if (log.final) {
        clearTimeout(finalTimer);
        finalTimer = setTimeout(() => { void flush(); }, finalDelayMs); finalTimer.unref();
      }
    },
    close() { clearInterval(timer); clearTimeout(finalTimer); }
  };
}
module.exports = { createD1LogStore, createArchiveQueue };
