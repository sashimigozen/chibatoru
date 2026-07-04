#!/usr/bin/env node
import fs from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node tools/analyze-analytics.mjs <log.jsonl> [more.jsonl]");
  process.exit(1);
}

const events = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      events.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`${file}:${index + 1}: invalid JSONL: ${error.message}`);
    }
  });
}

const games = new Map();
const ensureGame = (gameId) => {
  const id = gameId || "unknown";
  if (!games.has(id)) {
    games.set(id, {
      gameId: id,
      start: null,
      end: null,
      actions: [],
      effects: [],
      mulligans: []
    });
  }
  return games.get(id);
};

for (const event of events) {
  const game = ensureGame(event.gameId || event.game?.gameId);
  if (event.eventType === "game_start") game.start = event.game;
  if (event.eventType === "game_end") game.end = event.final;
  if (event.eventType === "action") game.actions.push(event);
  if (event.eventType === "effect") game.effects.push(event);
  if (event.eventType === "mulligan") game.mulligans.push(event);
}

const makeCounter = () => Object.create(null);
const inc = (counter, key, amount = 1) => {
  const safeKey = key || "unknown";
  counter[safeKey] = (counter[safeKey] || 0) + amount;
};
const rate = (wins, total) => total ? wins / total : 0;

const summary = {
  gameCount: games.size,
  completedGameCount: 0,
  deckWinRates: makeCounter(),
  deckGames: makeCounter(),
  firstSide: {
    player: { games: 0, wins: 0, winRate: 0 },
    opponent: { games: 0, wins: 0, winRate: 0 }
  },
  averageWinningTurn: 0,
  cards: makeCounter(),
  cardAdoptionGames: makeCounter(),
  cardPlayGames: makeCounter(),
  cardPlays: makeCounter(),
  cardMulliganReturns: makeCounter(),
  positionPlays: makeCounter(),
  positionWins: makeCounter(),
  late: {
    reservations: makeCounter(),
    success: makeCounter(),
    failureReasons: makeCounter(),
    smartMeHits: 0,
    aggroLockFailures: 0
  },
  attention: {
    absorbedAttacks: 0,
    estimatedProtectedDamage: 0
  },
  environments: {
    plays: makeCounter(),
    overwrites: makeCounter(),
    wins: makeCounter()
  },
  actionChoiceData: []
};

let winningTurnTotal = 0;
let winningTurnCount = 0;

for (const game of games.values()) {
  const winner = game.end?.winner || null;
  if (game.end) {
    summary.completedGameCount += 1;
    if (Number.isFinite(game.end.finalTurn)) {
      winningTurnTotal += game.end.finalTurn;
      winningTurnCount += 1;
    }
  }

  for (const side of ["player", "opponent"]) {
    const deck = game.start?.decks?.[side];
    if (!deck) continue;
    const deckName = deck.deckName || `${side} deck`;
    inc(summary.deckGames, deckName);
    if (winner === side) inc(summary.deckWinRates, deckName);
    Object.keys(deck.deckList || {}).forEach((cardId) => inc(summary.cardAdoptionGames, cardId));
  }

  const firstSide = game.start?.firstSide;
  if (firstSide && summary.firstSide[firstSide]) {
    summary.firstSide[firstSide].games += 1;
    if (winner === firstSide) summary.firstSide[firstSide].wins += 1;
  }

  const playedThisGame = new Set();
  for (const action of game.actions) {
    const cardId = action.cardId || "unknown";
    if (action.actionType === "play_card" || action.actionType === "play_environment" || action.actionType === "reserve_late" || action.actionType === "evolve") {
      inc(summary.cardPlays, cardId);
      playedThisGame.add(cardId);
      if (action.targetSeat) {
        const key = `${cardId}@${action.targetSeat.row}-${action.targetSeat.column}`;
        inc(summary.positionPlays, key);
        if (winner === action.side) inc(summary.positionWins, key);
      }
      if (action.actionType === "reserve_late") inc(summary.late.reservations, cardId);
      if (action.actionType === "play_environment") {
        inc(summary.environments.plays, cardId);
        if (action.details?.environmentBefore) inc(summary.environments.overwrites, cardId);
        if (winner === action.side) inc(summary.environments.wins, cardId);
      }
    }
    if (action.actionType === "use_item" && cardId === "smart_me") summary.late.smartMeHits += 1;
    if (action.details?.forcedByAttention) {
      summary.attention.absorbedAttacks += 1;
      summary.attention.estimatedProtectedDamage += Number(action.details.damage || 0);
    }
    if (Number.isFinite(action.legalCandidateCount)) {
      summary.actionChoiceData.push({
        gameId: game.gameId,
        turn: action.turn,
        side: action.side,
        actionType: action.actionType,
        cardId,
        legalCandidateCount: action.legalCandidateCount
      });
    }
  }

  playedThisGame.forEach((cardId) => inc(summary.cardPlayGames, cardId));

  for (const mulligan of game.mulligans) {
    for (const card of mulligan.returnedCards || []) inc(summary.cardMulliganReturns, card.cardId);
  }

  for (const effect of game.effects) {
    if (effect.effectType === "late_resolve") {
      const cardId = effect.source?.cardId || "unknown";
      if (effect.details?.success) inc(summary.late.success, cardId);
      else {
        inc(summary.late.failureReasons, effect.details?.failureReason || "unknown");
        if (effect.details?.aggroLocked) summary.late.aggroLockFailures += 1;
      }
    }
  }
}

for (const deckName of Object.keys(summary.deckWinRates)) {
  summary.deckWinRates[deckName] = rate(summary.deckWinRates[deckName], summary.deckGames[deckName]);
}
for (const deckName of Object.keys(summary.deckGames)) {
  if (!(deckName in summary.deckWinRates)) summary.deckWinRates[deckName] = 0;
}
for (const side of ["player", "opponent"]) {
  summary.firstSide[side].winRate = rate(summary.firstSide[side].wins, summary.firstSide[side].games);
}
summary.averageWinningTurn = winningTurnCount ? winningTurnTotal / winningTurnCount : 0;

const cardIds = new Set([
  ...Object.keys(summary.cardAdoptionGames),
  ...Object.keys(summary.cardPlayGames),
  ...Object.keys(summary.cardPlays),
  ...Object.keys(summary.cardMulliganReturns)
]);
summary.cardTable = [...cardIds].sort().map((cardId) => ({
  cardId,
  adoptionGames: summary.cardAdoptionGames[cardId] || 0,
  playGames: summary.cardPlayGames[cardId] || 0,
  playCount: summary.cardPlays[cardId] || 0,
  mulliganReturnCount: summary.cardMulliganReturns[cardId] || 0,
  adoptionRate: rate(summary.cardAdoptionGames[cardId] || 0, games.size * 2),
  playRateWhenAdopted: rate(summary.cardPlayGames[cardId] || 0, summary.cardAdoptionGames[cardId] || 0)
}));

summary.positionTable = Object.keys(summary.positionPlays).sort().map((key) => ({
  key,
  playCount: summary.positionPlays[key],
  winRate: rate(summary.positionWins[key] || 0, summary.positionPlays[key])
}));

console.log(JSON.stringify(summary, null, 2));
