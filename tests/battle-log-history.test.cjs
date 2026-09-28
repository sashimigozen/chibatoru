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
