const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../online-replay.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function goodLog() {
  const r = R.createRecorder();
  r.checkpoint({ players: { player: { hand: ['secret'], deck: ['a', 'b'] } }, gameOver: false }, 'start');
  r.record('random', { value: 0.2 });
  r.checkpoint({ players: { player: { hand: ['secret', 'b'], deck: ['a'] } }, gameOver: true }, 'end');
  return { gameId: 'g', source: 'online-human-v1', serverVerifiedHumanMatch: true, ruleId: 'normal', final: true,
    trace: { schemaVersion: 1, entries: r.entries }, events: [
      { eventType: 'game_start', game: { mode: 'online' } },
      { eventType: 'game_end', final: { winner: 'player' } }
    ] };
}
test('immutable private checkpoints restore hand, deck order and intermediate state', () => {
  const log = goodLog();
  assert.deepEqual(R.restore(log.trace, 1).players.player.hand, ['secret']);
  assert.deepEqual(R.restore(log.trace).players.player.deck, ['a']);
  assert.equal(R.restore(log.trace).gameOver, true);
  assert.equal(R.learningEligibility(log).eligible, true);
});
test('numbered chunks merge retries without duplicate actions; missing/conflicting entries rejected for learning', () => {
  const log = goodLog();
  const first = { schemaVersion: 1, entries: log.trace.entries.slice(0, 2) };
  let trace = R.mergeTrace(null, first);
  trace = R.mergeTrace(trace, first);
  trace = R.mergeTrace(trace, { schemaVersion: 1, entries: log.trace.entries.slice(2) });
  assert.deepEqual(R.restore(trace), R.restore(log.trace));
  assert.equal(trace.entries.length, 3);
  assert.equal(R.learningEligibility({ ...log, trace }).eligible, true);
  const gap = R.mergeTrace(null, { schemaVersion: 1, entries: [log.trace.entries[2]] });
  assert.equal(gap.invalid, true);
});
for (const mode of ['solo', 'training', 'dungeon', 'test', 'tutorial']) {
  test(`${mode} never qualifies even if a payload claims to be online`, () => {
    const log = goodLog(); log.events[0].game.mode = mode;
    assert.equal(R.learningEligibility(log).eligible, false);
  });
}
test('unfinished, disconnected, failed, truncated and legacy logs are excluded', () => {
  for (const patch of [{ final: false }, { incidents: [{ type: 'disconnect' }] },
    { source: undefined }, { serverVerifiedHumanMatch: false }, { trace: null },
    { trace: { ...goodLog().trace, truncated: true } }, { ruleId: 'chaos' }]) {
    assert.equal(R.learningEligibility({ ...goodLog(), ...patch }).eligible, false);
  }
  const log = goodLog(); log.trace.entries.push({ kind: 'incident' });
  assert.equal(R.learningEligibility(log).eligible, false);
});

test('analysis and restore tools read an exported backup and ignore CPU logs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'online-replay-tools-'));
  try {
    const file = path.join(dir, 'backup.json');
    const log = goodLog();
    const cpu = goodLog(); cpu.gameId = 'cpu'; cpu.events[0].game.mode = 'solo';
    fs.writeFileSync(file, JSON.stringify({ logs: [log, cpu, log] }));
    const analyze = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '../tools/analyze-online-battles.mjs'), file], { encoding: 'utf8' }));
    assert.equal(analyze.candidates.length, 1);
    assert.equal(analyze.excluded.length, 1);
    assert.equal(analyze.automaticAiUpdate, false);
    const replay = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '../tools/replay-online-battle.mjs'), file, 'g', '1'], { encoding: 'utf8' }));
    assert.deepEqual(replay.state.players.player.hand, ['secret']);
    assert.equal(replay.state.gameOver, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
