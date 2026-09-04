const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("    function renderBattleInspector() {");
const end = html.indexOf("    function setBattleDrawer(", start);

function setup() {
  const card = (id, name, type, cost, extra = {}) => ({ baseId: id, instanceId: id, name, type, cost, ...extra });
  const cards = [card("s1", "学生", "student", 2), card("i", "鍵", "item", 0), card("s2", "学生", "student", 2), card("t", "教師", "teacher", 3)];
  const clicks = new Map();
  const panel = { innerHTML: "", classList: { remove() {} }, querySelectorAll(selector) {
    const attr = selector.slice(1, -1);
    const key = attr.replace(/^data-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return [...this.innerHTML.matchAll(new RegExp(`${attr}="([^"]+)"`, "g"))].map(match => ({
      dataset: { [key]: match[1] }, addEventListener(_, fn) { clicks.set(`${attr}:${match[1]}`, fn); }
    }));
  } };
  const title = {};
  const context = {
    state: { battleInspector: { kind: "trash", side: "player", filter: "all" }, players: { player: { trash: cards, late: [] }, opponent: { trash: [card("e", "相手の持ち物", "item", 4)], late: [] } } },
    CARD_BASES: {}, document: { getElementById: id => id === "battleDrawerInspector" ? panel : title },
    elements: { log: { classList: { add() {} } } }, escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
    cloneTutorialValue: structuredClone, cardVisualClass: () => "", cardTemplate: card => { card.previewOnly = true; return "<span>existing card template</span>"; },
    scheduleCardTemplateScaleSync() {}, showBattleCardPreview(card) { context.preview = card; }, slotShortLabel: () => "1行1列"
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  return { context, panel, title, render: () => context.renderBattleInspector(), click: (attr, value) => clicks.get(`data-inspector-${attr}:${value}`)() };
}

test("全インラインスクリプトの構文が正しい", () => {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/.test(match[1]) || /type=["']application\//.test(match[1])) continue;
    new vm.Script(match[2]);
  }
});
test("同名スタック・タイプの実枚数・戦意0を含む昇順見出しを表示", () => {
  const { panel, render } = setup(); render();
  assert.equal((panel.innerHTML.match(/data-inspector-card=/g) || []).length, 3);
  assert.match(panel.innerHTML, /学生 2枚/);
  assert.match(panel.innerHTML, /すべて 4枚/);
  assert.match(panel.innerHTML, /×2/);
  assert.deepEqual([...panel.innerHTML.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(m => m[1]), ["戦意 0", "戦意 2", "戦意 3"]);
});
test("相手への切り替えとタイプ絞り込み、カード詳細の参照", () => {
  const { context, panel, title, render, click } = setup(); render();
  click("side", "opponent");
  assert.equal(title.textContent, "相手の校外");
  assert.match(panel.innerHTML, /すべて 1枚/);
  click("filter", "student");
  assert.match(panel.innerHTML, /カードはありません/);
  click("filter", "item"); click("card", "e");
  assert.equal(context.preview.instanceId, "e");
});
test("縮小カード描画でも校外の実カードを変更しない", () => {
  const { context, render } = setup(); const before = JSON.stringify(context.state.players);
  render(); assert.equal(JSON.stringify(context.state.players), before);
});
test("基本戦意で分類し、戦意なしは最後に表示", () => {
  const { context, panel, render } = setup();
  context.CARD_BASES.s1 = { cost: 2 };
  context.state.players.player.trash[0].cost = 8;
  context.state.players.player.trash.push({ baseId: "u", instanceId: "u", name: "Ultimate U太", type: "student", noCost: true });
  render();
  assert.deepEqual([...panel.innerHTML.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(m => m[1]), ["戦意 0", "戦意 2", "戦意 3", "戦意なし"]);
});
test("空の校外の0枚表示と、遅刻一覧をスタックしないこと", () => {
  const { context, panel, render } = setup();
  context.state.players.player.trash = []; render();
  assert.equal((panel.innerHTML.match(/0枚/g) || []).length, 6);
  context.state.battleInspector.kind = "late";
  context.state.players.player.late = [1, 2].map(n => ({ card: { name: "遅刻学生", instanceId: `late${n}` }, remaining: n, zone: "seat", index: 0 }));
  render();
  assert.equal((panel.innerHTML.match(/data-inspector-card=/g) || []).length, 2);
  assert.doesNotMatch(panel.innerHTML, /battle-inspector-cost|battle-inspector-count|data-inspector-side/);
});
