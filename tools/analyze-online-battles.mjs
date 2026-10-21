#!/usr/bin/env node
import fs from "node:fs";
import Replay from "../online-replay.js";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Usage: node tools/analyze-online-battles.mjs <backup.json> [more.json]");
const games = new Map();
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const log of Array.isArray(data.logs) ? data.logs : [data]) {
    const old = games.get(log.gameId);
    if (!old || (log.trace?.entries.length || 0) > (old.trace?.entries.length || 0)) games.set(log.gameId, log);
  }
}
const report = { purpose: "human-online-review", automaticAiUpdate: false, candidates: [], excluded: [], cards: {} };
for (const log of games.values()) {
  const quality = Replay.learningEligibility(log);
  if (!quality.eligible) { report.excluded.push({ gameId: log.gameId, reasons: quality.reasons }); continue; }
  const start = log.events.find(e => e.eventType === "game_start").game;
  const end = log.events.findLast(e => e.eventType === "game_end").final;
  const actions = log.events.filter(e => e.eventType === "action");
  report.candidates.push({ gameId: log.gameId, version: start.clientRelease, winner: end.winner,
    turns: end.finalTurn, actionCount: actions.length, checkpoints: log.trace.entries.filter(e => e.kind === "checkpoint").length });
  for (const event of actions) {
    if (!event.cardId) continue;
    const card = report.cards[event.cardId] ||= { uses: 0, usesByWinner: 0, positions: {} };
    card.uses++;
    if (event.side === end.winner) card.usesByWinner++;
    if (event.targetSeat) {
      const seat = `${event.targetSeat.row}-${event.targetSeat.column}`;
      card.positions[seat] = (card.positions[seat] || 0) + 1;
    }
  }
}
// Counts are review hints, not causal card strength or an instruction to change AI weights.
console.log(JSON.stringify(report, null, 2));
