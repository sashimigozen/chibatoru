const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function source(name) {
  const start = html.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1);
  const end = html.indexOf("\n    }", start);
  return html.slice(start, end + 6);
}

test("対戦ログを40件で切らず、試合開始時の記録まで保持する", () => {
  const context = {
    state: { log: [] },
    normalizeLectureRoomText: String
  };
  vm.createContext(context);
  vm.runInContext(source("addLog"), context);

  for (let index = 1; index <= 60; index += 1) {
    context.addLog(`ログ${index}`);
  }

  assert.equal(context.state.log.length, 60);
  assert.equal(context.state.log.at(-1), "ログ1");
  assert.equal(context.state.log[0], "ログ60");
});

test("負荷・高負荷のダメージと対象は対戦ログへ残し、非公開のカード名は残さない", () => {
  const dealt = [];
  const logs = [];
  const context = {
    state: {
      players: {
        player: { life: 20, hand: [{ name: "負荷カード", handLoadLevel: 1 }, { name: "高負荷カード", handLoadLevel: 2 }, { name: "通常カード", handLoadLevel: 0 }] },
        opponent: { life: 20, hand: [{ name: "相手の負荷カード", handLoadLevel: 1 }, { name: "相手の高負荷カード", handLoadLevel: 2 }] }
      }
    },
    SIDES: { player: "あなた", opponent: "相手" },
    damagePlayer: (side, damage) => {
      dealt.push({ side, damage });
      context.state.players[side].life -= damage;
    },
    addLog: (message) => logs.push(message)
  };
  vm.createContext(context);
  vm.runInContext(source("resolveHandLoadEndTurn"), context);

  context.resolveHandLoadEndTurn("player");
  context.resolveHandLoadEndTurn("opponent");

  assert.deepEqual(dealt, [
    { side: "player", damage: 1 },
    { side: "player", damage: 2 },
    { side: "opponent", damage: 1 },
    { side: "opponent", damage: 2 }
  ]);
  assert.deepEqual(logs, [
    "[負荷]：あなた本体に1ダメージ。",
    "[高負荷]：あなた本体に2ダメージ。",
    "[負荷]：相手本体に1ダメージ。",
    "[高負荷]：相手本体に2ダメージ。"
  ]);
  assert.ok(logs.every((message) => !message.includes("カード")));
  // ダメージ無効化時は、受けなかったダメージを受けたと記録しない。
  logs.length = 0;
  context.damagePlayer = () => {};
  context.resolveHandLoadEndTurn("player");
  assert.deepEqual(logs, ["[負荷]：あなた本体に0ダメージ。", "[高負荷]：あなた本体に0ダメージ。"]);
});

test("過去ログを読んでいる間は位置を保ち、末尾では最新ログを追従する", () => {
  const makeLog = ({ childElementCount, scrollTop, scrollHeight, clientHeight }) => ({
    childElementCount,
    scrollTop,
    scrollHeight,
    clientHeight,
    innerHTML: "",
    appendChild() {}
  });
  const context = {
    state: { log: ["最初", "最新"] },
    elements: { log: makeLog({ childElementCount: 2, scrollTop: 40, scrollHeight: 300, clientHeight: 100 }) },
    document: { createElement: () => ({ classList: { add() {} } }) },
    renderLogMessage() {}
  };
  vm.createContext(context);
  vm.runInContext(source("renderLog"), context);

  context.renderLog();
  assert.equal(context.elements.log.scrollTop, 40);

  context.elements.log = makeLog({ childElementCount: 2, scrollTop: 198, scrollHeight: 300, clientHeight: 100 });
  context.renderLog();
  assert.equal(context.elements.log.scrollTop, 300);
});
