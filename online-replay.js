(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ChibattleOnlineReplay = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_BYTES = 16 * 1024 * 1024;
  const clone = value => JSON.parse(JSON.stringify(value));
  function diffValues(before, after, path, patches) {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    if (before && after && typeof before === "object" && typeof after === "object"
      && Array.isArray(before) === Array.isArray(after)) {
      for (const key of Object.keys(after)) {
        if (!(key in before)) patches.push({ path: [...path, key], value: after[key] });
        else diffValues(before[key], after[key], [...path, key], patches);
      }
      if (Array.isArray(after)) {
        if (before.length !== after.length) patches.push({ path: [...path, "length"], value: after.length });
      } else for (const key of Object.keys(before)) if (!(key in after)) patches.push({ path: [...path, key], remove: true });
    } else patches.push({ path, value: after });
  }
  function createRecorder() {
    let entries = [], previous = {}, bytes = 0, truncated = false;
    return {
      get entries() { return entries; },
      get truncated() { return truncated; },
      record(kind, data) {
        if (truncated) return;
        const entry = { seq: entries.length + 1, kind, at: new Date().toISOString(), data: clone(data) };
        const size = JSON.stringify(entry).length * 2;
        if (bytes + size > MAX_BYTES) { truncated = true; return; }
        bytes += size;
        entries.push(entry);
      },
      checkpoint(state, cause) {
        const next = clone(state), changes = {}, removed = [], patches = [];
        for (const key of Object.keys(next)) {
          if (key === "players" && previous.players) diffValues(previous.players, next.players, ["players"], patches);
          else if (JSON.stringify(next[key]) !== JSON.stringify(previous[key])) changes[key] = next[key];
        }
        for (const key of Object.keys(previous)) if (!(key in next)) removed.push(key);
        if (entries.length && !Object.keys(changes).length && !removed.length && !patches.length) return;
        this.record("checkpoint", { cause, changes, removed, patches });
        previous = next;
      }
    };
  }
  function mergeTrace(oldTrace, incoming) {
    const trace = oldTrace ? clone(oldTrace) : { schemaVersion: 1, entries: [], truncated: false };
    if (!incoming || incoming.schemaVersion !== 1 || !Array.isArray(incoming.entries)) return trace;
    let size = JSON.stringify(trace).length * 2;
    for (const raw of incoming.entries) {
      if (!Number.isSafeInteger(raw?.seq) || raw.seq < 1) { trace.invalid = true; continue; }
      if (raw.seq <= trace.entries.length) {
        if (JSON.stringify(trace.entries[raw.seq - 1]) !== JSON.stringify(raw)) trace.invalid = true;
        continue;
      }
      if (raw.seq !== trace.entries.length + 1) { trace.invalid = true; continue; }
      size += JSON.stringify(raw).length * 2;
      if (size > MAX_BYTES) { trace.truncated = true; break; }
      trace.entries.push(clone(raw));
    }
    trace.truncated = trace.truncated || Boolean(incoming.truncated);
    return trace;
  }
  function restore(trace, throughSeq = Infinity) {
    const state = {};
    for (const entry of trace?.entries || []) {
      if (entry.seq > throughSeq) break;
      if (entry.kind !== "checkpoint") continue;
      for (const key of entry.data.removed || []) delete state[key];
      for (const [key, value] of Object.entries(entry.data.changes || {})) {
        // Avoid prototype setters when reading downloaded/untrusted logs.
        Object.defineProperty(state, key, { value: clone(value), enumerable: true, writable: true, configurable: true });
      }
      for (const patch of entry.data.patches || []) {
        if (!Array.isArray(patch.path) || patch.path.some(key => ["__proto__", "constructor", "prototype"].includes(key))) continue;
        const keys = patch.path.slice(0, -1), key = patch.path.at(-1);
        let target = state;
        for (const part of keys) { target = Object.hasOwn(target || {}, part) ? target[part] : null; if (!target) break; }
        if (!target || typeof target !== "object") continue;
        if (Array.isArray(target) && key === "length") {
          if (Number.isSafeInteger(patch.value) && patch.value >= 0 && patch.value <= 10000) target.length = patch.value;
        } else if (patch.remove) delete target[key];
        else Object.defineProperty(target, key, { value: clone(patch.value), enumerable: true, writable: true, configurable: true });
      }
    }
    return state;
  }
  function learningEligibility(log) {
    const reasons = [];
    const start = log.events?.find(e => e.eventType === "game_start")?.game;
    const end = log.events?.findLast(e => e.eventType === "game_end")?.final;
    if (log.source !== "online-human-v1" || !log.serverVerifiedHumanMatch || start?.mode !== "online") reasons.push("not_verified_human_online");
    if (!log.final || !end || !["player", "opponent"].includes(end.winner)) reasons.push("not_completed_win");
    if (log.ruleId !== "normal") reasons.push("non_standard_rules");
    if (!log.trace?.entries?.some(e => e.kind === "checkpoint")) reasons.push("missing_trace");
    if (log.trace?.truncated || log.trace?.invalid) reasons.push("incomplete_trace");
    if (log.incidents?.length) reasons.push("connection_or_processing_incident");
    if (log.trace?.entries?.some(e => e.kind === "incident")) reasons.push("client_error");
    if (!log.trace?.entries?.some(e => e.kind === "checkpoint" && e.data.changes?.gameOver === true)) reasons.push("missing_final_state");
    return { eligible: reasons.length === 0, reasons, requiresReview: true };
  }
  return { createRecorder, mergeTrace, restore, learningEligibility };
});
