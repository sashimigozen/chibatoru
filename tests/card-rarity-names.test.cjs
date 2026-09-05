const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("    const CARD_RARITY_LABELS = Object.freeze(");
const end = html.indexOf("\n    function unlockDungeonCardStyle", start);
const context = {};
vm.createContext(context);
vm.runInContext(`${html.slice(start, end)}\nthis.labels = CARD_RARITY_LABELS; this.modeLabel = cardStyleModeLabel;`, context);

test("ガチャ用レアリティ名を5段階で定義する", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(context.labels)), {
    regular: "レギュラー",
    rare: "レア",
    superRare: "スーパーレア",
    ultraRare: "ウルトラレア",
    prismaRare: "プリズマレア"
  });
});

test("既存カードスタイルをレギュラー・ウルトラレア・プリズマレアとして表示する", () => {
  assert.equal(context.modeLabel("normal"), "レギュラー");
  assert.equal(context.modeLabel("reward"), "ウルトラレア");
  assert.equal(context.modeLabel("prism"), "プリズマレア");
  assert.equal(context.modeLabel("unknown"), "レギュラー");
});

test("更新情報にはレアリティ名の変更を追加しない", () => {
  const historyStart = html.indexOf("const UPDATE_HISTORY = [");
  const historyEnd = html.indexOf("const LATEST_UPDATE_VERSION", historyStart);
  const history = html.slice(historyStart, historyEnd);
  assert.doesNotMatch(history, /プリズマレア|ウルトラレアカードスタイル|レアリティ名/);
});
