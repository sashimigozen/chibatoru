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
function element() {
  const classes = new Set();
  return {
    innerHTML: "", textContent: "", dataset: {}, attributes: {}, offsetWidth: 100,
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle(name, force) { const value = force ?? !classes.has(name); value ? classes.add(name) : classes.delete(name); return value; }
    },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
}
function setup(role = "guest") {
  const elements = Object.fromEntries(["battleMenuDrawer", "battleLogDrawer", "battleMenuButton", "battleLogButton", "battleTestUndoButton", "battleTestExitButton", "log", "resultOverlay"].map(name => [name, element()]));
  const inspector = element(), title = element();
  const state = {
    screen: "battle", phase: "battle", preBattleToken: 1, gameOver: false, currentSide: "player",
    gameWinner: null, gameResultOptions: {}, dungeon: { active: false, run: null },
    online: { started: true, lastSnapshotSeq: 1, localMulliganPending: false }, deckBuilder: {},
    players: { player: { mulliganUsed: true }, opponent: {} }, battleInspector: null
  };
  const c = { state, elements, document: { getElementById: id => id === "battleDrawerInspector" ? inspector : title },
    isOnlineGuest: () => role === "guest", isOnlineSpectator: () => role === "spectator", isOnlineBattle: () => true,
    resultOverlayKey: () => "result", escapeHtml: String, DUNGEON_FLOORS: {},
    nextCardInstanceId: 1, pendingAnimations: [],
    onlineTransformSnapshotForGuest: structuredClone, onlineTransformSnapshotForSpectator: structuredClone
  };
  for (const name of ["captureOnlineVisualState", "preserveOnlineThinItemChoice", "preserveOnlineCourseRegistrationChoice", "preserveOnlineCourseRegistrationConsent", "restoreOnlineGuestMulliganState", "restoreOnlineThinItemChoice", "restoreOnlineCourseRegistrationChoice", "restoreOnlineCourseRegistrationConsent", "closeItemConfirm", "hideResultOverlay", "render", "showOnlineSnapshotVisuals", "onlineSend"]) c[name] = () => {};
  vm.createContext(c);
  for (const name of ["closeBattleInspector", "setBattleDrawer", "resetBattleDrawers", "showResultOverlay", "onlineApplySnapshot"]) vm.runInContext(source(name), c);
  function open(kind) {
    if (kind === "menu" || kind === "both") c.setBattleDrawer(elements.battleMenuDrawer, true);
    if (kind !== "menu") c.setBattleDrawer(elements.battleLogDrawer, true);
    if (["trash", "late"].includes(kind)) {
      state.battleInspector = { kind, side: "player", filter: "student" };
      inspector.innerHTML = "previous battle cards";
      elements.log.classList.add("hidden");
    }
  }
  function closed() {
    for (const name of ["battleMenuDrawer", "battleLogDrawer"]) {
      assert.equal(elements[name].classList.contains("open"), false);
      assert.equal(elements[name].attributes["aria-hidden"], "true");
    }
    for (const name of ["battleMenuButton", "battleLogButton"]) assert.equal(elements[name].attributes["aria-expanded"], "false");
    for (const name of ["battleTestUndoButton", "battleTestExitButton"]) assert.equal(elements[name].classList.contains("drawer-trigger-hidden"), false);
    assert.equal(state.battleInspector, null);
    assert.equal(inspector.innerHTML, "");
    assert.equal(inspector.classList.contains("hidden"), true);
    assert.equal(elements.log.classList.contains("hidden"), false);
    assert.equal(title.textContent, "ログ");
  }
  return { c, state, elements, open, closed };
}

for (const kind of ["menu", "log", "both", "trash", "late"]) {
  test(`${kind}を開いていても勝敗表示時に閉じる`, () => {
    const { c, open, closed } = setup(); open(kind);
    c.showResultOverlay("player"); closed();
  });
}
for (const name of ["initializeGame", "startCardTest", "startTutorialBattle"]) {
  test(`${name}は初期化の最初に前のパネル状態を解除する`, () => {
    const { c, open, closed } = setup(); open("both");
    const stop = new Error("remaining initialization outside test scope");
    c.closeTeacherActionChoice = () => { throw stop; };
    vm.runInContext(source(name), c);
    assert.throws(() => c[name](), error => error === stop);
    closed();
  });
}
for (const role of ["guest", "spectator"]) {
  test(`${role}は新しい試合の同期と試合終了で閉じ、通常同期では閉じない`, () => {
    const { c, state, elements, open, closed } = setup(role);
    open("log");
    const snapshot = (seq, extra = {}) => ({ seq, state: { screen: "battle", phase: "battle", preBattleToken: state.preBattleToken, gameOver: false, ...extra } });
    c.onlineApplySnapshot(snapshot(2));
    assert.equal(elements.battleLogDrawer.classList.contains("open"), true);
    c.onlineApplySnapshot(snapshot(3, { preBattleToken: 2 })); closed();
    open("menu");
    c.onlineApplySnapshot(snapshot(4, { gameOver: true, gameWinner: "opponent" })); closed();
    open("trash");
    c.onlineApplySnapshot(snapshot(5)); closed();
  });
}
test("部屋からの開始・途中観戦も閉じ、古い同期はパネルを変更しない", () => {
  const { c, state, elements, open, closed } = setup("spectator");
  state.screen = "online"; state.online.started = false; open("late");
  c.onlineApplySnapshot({ seq: 2, state: { preBattleToken: 1, gameOver: false } }); closed();
  open("menu");
  c.onlineApplySnapshot({ seq: 1, state: { preBattleToken: 2 } });
  assert.equal(elements.battleMenuDrawer.classList.contains("open"), true);
});
