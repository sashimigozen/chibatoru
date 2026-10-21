#!/usr/bin/env node
import fs from "node:fs";
import Replay from "../online-replay.js";
const [file, gameId, sequence] = process.argv.slice(2);
if (!file) throw new Error("Usage: node tools/replay-online-battle.mjs <backup.json> <gameId> [trace-sequence]");
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const log = Array.isArray(data.logs) ? data.logs.find(log => log.gameId === gameId) : data;
if (!log?.trace) throw new Error("指定した試合の詳細記録がありません。");
console.log(JSON.stringify({ gameId: log.gameId, learning: Replay.learningEligibility(log),
  timeline: log.trace.entries.map(e => ({ seq: e.seq, kind: e.kind, at: e.at, cause: e.data?.cause,
    eventType: e.data?.eventType, actionType: e.data?.actionType })),
  state: Replay.restore(log.trace, sequence === undefined ? Infinity : Number(sequence)) }, null, 2));
