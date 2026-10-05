const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const rawRules = "このカードを手札から出席させたとき、自分の手札に効果を持たない「木っち（ぎっち）」1枚を生成する。このカードは講義を持たない。";

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("wood_gitch");
    api.state.phase = "battle";
    api.state.currentSide = "player";
    api.state.players.player.board.teacher = null;
  });
});

test("木っちの定義・表示・本文を揃える", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, card = api.createCardFromBase("wood_gitch", "player");
    return { cost: card.cost, attack: card.attack, hp: card.hp, noLecture: card.noLecture, text: api.cardRulesText(card) };
  })).toEqual({ cost: 3, attack: 1, hp: 1, noLecture: true,
    text: "このカードを手札から出席させたとき、自分の手札に効果を持たない「木っち（ぎっち）」1枚を生成する。\nこのカードは[講義]を持たない。" });
  for (const file of ["index.html", "card_rules.txt"]) {
    expect(fs.readFileSync(path.join(__dirname, "..", file), "utf8")).toContain('wood_gitch: "' + rawRules + '"');
  }
});

for (const side of ["player", "opponent"]) {
  for (const empty of [false, true]) {
    test(side + "の手札出席は他の手札を変えず1枚生成する（空手札=" + empty + "）", async ({ page }) => {
      expect(await page.evaluate(({ side, empty }) => {
        const api = window.__chibattle, own = api.state.players[side];
        api.state.currentSide = side;
        own.will = 10;
        own.board.teacher = null;
        const source = api.createCardFromBase("wood_gitch", side), other = api.createCardFromBase("general_student", side);
        own.hand = empty ? [source] : [source, other];
        const placed = api.placeCardFromHand(side, source.instanceId, "teacher", side, null, false);
        return { placed, hand: own.hand.map(c => c.baseId), otherUnchanged: empty || own.hand[0] === other,
          fresh: own.hand.at(-1).instanceId !== source.instanceId, pending: api.state.pendingCardChoice,
          text: api.cardRulesText(own.hand.at(-1)), effects: api.canUsePrintedCardEffects(own.hand.at(-1)),
          noLecture: own.hand.at(-1).noLecture };
      }, { side, empty })).toEqual({ placed: true, hand: empty ? ["wood_gitch"] : ["general_student", "wood_gitch"],
        otherUnchanged: true, fresh: true, pending: null, text: "効果なし。", effects: false, noLecture: true });
    });
  }
}

test("効果による出席では手札生成しない", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    own.hand = [];
    const card = api.makeBoardCard(api.createCardFromBase("wood_gitch", "player"));
    const placed = api.attendCard("player", card, "teacher", null, { attendanceSource: "generated" });
    return { placed: Boolean(placed), hand: own.hand.length, lecture: card.noLecture };
  })).toEqual({ placed: true, hand: 0, lecture: true });
});

test("生成された木っちのカード確認には効果なしだけを表示する", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    const normal = api.createCardFromBase("wood_gitch", "player");
    own.will = 10; own.hand = [normal];
    api.placeCardFromHand("player", normal.instanceId, "teacher", "player", null, false);
    api.showBattleCardPreview(own.hand[0]);
  });
  const rules = page.locator("#battleCardPreview .battle-card-preview-rules");
  await expect(rules).toBeVisible();
  await expect(rules).toHaveText("効果なし。");
  await expect(rules.locator('[data-preview-term="講義"]')).toHaveCount(0);
});

for (const side of ["player", "opponent"]) {
  test(side + "の生成された木っちは校外回収後も効果なしで、講義せず進化できる", async ({ page }) => {
    expect(await page.evaluate(side => {
      const api = window.__chibattle, own = api.state.players[side];
      api.state.currentSide = side; api.state.environment = null;
      own.will = 10; own.attendancesThisTurn = 0;
      own.board.seats.fill(null); own.board.teacher = null; own.trash = [];
      const normal = api.createCardFromBase("wood_gitch", side);
      own.hand = [normal];
      api.placeCardFromHand(side, normal.instanceId, "seat", side, 0, false);
      // Exercise the same JSON transport used by snapshots, then recovery from 校外.
      const generated = JSON.parse(JSON.stringify(own.hand.pop()));
      api.moveToTrash(side, generated);
      own.hand.push(own.trash.pop());
      const placed = api.placeCardFromHand(side, generated.instanceId, "teacher", side, null, false);
      const attendee = own.board.teacher;
      attendee.playedOnTurn = api.state.actionTurn - 1;
      const effectless = { text: api.cardRulesText(attendee), effects: api.canUsePrintedCardEffects(attendee),
        lecture: api.canTeacherChooseLecture({ owner: side, zone: "teacher", index: null }), hand: own.hand.length };
      const evolution = api.createCardFromBase("gitch", side);
      own.hand = [evolution];
      const evolved = api.placeCardFromHand(side, evolution.instanceId, "teacher", side, null, false);
      return { placed, effectless, evolved, id: own.board.teacher.baseId,
        evolutionEffects: api.canUsePrintedCardEffects(own.board.teacher) };
    }, side)).toEqual({ placed: true, effectless: { text: "効果なし。", effects: false, lecture: false, hand: 0 },
      evolved: true, id: "gitch", evolutionEffects: true });
  });
}

test("オンラインゲストは変化先選択を出さず通常の出席を送信する", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, sent = [];
    const source = api.state.players.player.hand.find(c => c.baseId === "wood_gitch");
    Object.assign(api.state.online, { connected: true, started: true, role: "guest", clientId: "guest-test", isApplyingRemote: false,
      conn: { open: true, send: value => sent.push(value) } });
    api.playCard(source.instanceId, "teacher", "player", null);
    return { pending: api.state.pendingCardChoice, commands: sent.filter(m => m.command).map(m => m.command.type) };
  })).toEqual({ pending: null, commands: ["playCard"] });
});
