const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => window.__chibattle.startCardTest("gitch"));
});

test("進化2枚と怨念の数値・表示文・台帳を揃える", async ({ page }) => {
  const expected = {
    gitch: { cost: 0, attack: 1, hp: 4, text: '[進化]：「木っち（ぎっち）」\n進化したとき、自分のデッキからカードを2枚引く。その後、自分の講義室の空いているマスに効果を持たない「木っち（ぎっち）」を2人までランダムに出席させる。\nこのカードは[講義]を持たない。' },
    gigi_blood: { cost: 8, attack: 2, hp: 4, text: '[進化]：「技議っち」\n進化したとき、自分の手札すべてを「怨念」に変化させる。' },
    grudge: { cost: 1, attack: null, hp: null, text: '相手本体に2ダメージを与える。' }
  };
  expect(await page.evaluate(ids => Object.fromEntries(ids.map(id => {
    const api = window.__chibattle, c = api.createCardFromBase(id, "player");
    return [id, { cost: c.cost, attack: c.attack ?? null, hp: c.hp ?? null, text: api.cardRulesText(c) }];
  })), Object.keys(expected))).toEqual(expected);
  const rules = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  const source = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  for (const id of ["wood_gitch", "gitch", "gigi_blood", "grudge"]) {
    const line = rules.split("\n").find(line => line.trim().startsWith(id + ": "));
    expect(source).toContain(line.trim());
  }
  await page.goto(pathToFileURL(path.join(__dirname, "..", "カード管理台帳.html")).href);
  const ledger = await page.evaluate(() => CARDS.filter(c => ["wood_gitch", "gitch", "gigi_blood", "grudge"].includes(c.id)));
  expect(ledger).toHaveLength(4);
  for (const entry of ledger) {
    expect(source).toContain(entry.id + ': "' + entry.effect + '"');
  }
  expect(ledger.find(c => c.id === "grudge").availability).toBe("token");
});

for (const side of ["player", "opponent"]) {
  for (const open of [0, 1, 2, 9]) {
    test(side + "の技議っちは2枚引いた後、空き" + open + "マスへ2人まで出席する", async ({ page }) => {
      const result = await page.evaluate(({ side, open }) => {
        const api = window.__chibattle, own = api.state.players[side];
        api.state.phase = "battle"; api.state.currentSide = side; api.state.environment = null;
        own.board.seats = Array.from({ length: 9 }, () => api.makeBoardCard(api.createCardFromBase("strong_student", side)));
        own.board.teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", side));
        // 1つだけ空く場合は教卓、2つなら教卓＋席。上限の確認も行う。
        if (open > 0) own.board.teacher = null;
        for (let i = 0; i < open - 1; i++) own.board.seats[i] = null;
        own.attendancesThisTurn = 0;
        own.hand = []; own.deck = ["general_student", "ruler", "cafeteria"].map(id => api.createCardFromBase(id, side));
        const evolved = api.makeBoardCard(api.createCardFromBase("gitch", side));
        const foeBefore = JSON.stringify(api.state.players[side === "player" ? "opponent" : "player"]);
        api.resolveEvolutionEffect(side, evolved, api.state.actionTurn, { attendanceSource: "effect" });
        const generated = [...own.board.seats, own.board.teacher].filter(c => c?.baseId === "wood_gitch");
        return { hand: own.hand.map(c => c.baseId), deck: own.deck.map(c => c.baseId),
          generated: generated.length, stats: generated.map(c => [c.attack, c.currentHp, c.noLecture]),
          effectless: generated.every(c => api.cardRulesText(c) === "効果なし。" && !api.canUsePrintedCardEffects(c)),
          teacher: own.board.teacher?.baseId, sourceAttack: evolved.attack,
          foeUnchanged: foeBefore === JSON.stringify(api.state.players[side === "player" ? "opponent" : "player"]),
          pending: api.state.pendingCopiedCard };
      }, { side, open });
      expect(result.hand).toEqual(["general_student", "ruler"]);
      expect(result.deck).toEqual(["cafeteria"]);
      expect(result.generated).toBe(Math.min(2, open));
      expect(result.stats).toEqual(Array.from({ length: Math.min(2, open) }, () => [1, 1, true]));
      expect(result.effectless).toBe(true);
      if (open <= 2 && open > 0) expect(result.teacher).toBe("wood_gitch");
      expect(result.sourceAttack).toBe(1);
      expect(result.foeUnchanged).toBe(true);
      expect(result.pending).toBeNull();
    });
  }
}

test("閉鎖・遅刻予約マスを追加出席先に選ばない", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    own.board.seats.fill(null); own.board.teacher = null; own.hand = [];
    api.state.environment = api.createCardFromBase("seat_rules", "player");
    own.late = [{ card: api.createCardFromBase("general_teacher", "player"), zone: "teacher", owner: "player", index: null, remaining: 1 }];
    api.resolveEvolutionEffect("player", api.makeBoardCard(api.createCardFromBase("gitch", "player")));
    return { teacher: own.board.teacher, closed: [1, 4, 7].map(i => own.board.seats[i]), count: own.board.seats.filter(Boolean).length };
  })).toEqual({ teacher: null, closed: [null, null, null], count: 2 });
});

for (const side of ["player", "opponent"]) {
  test(side + "の偽魏義ッ血は進化時だけ全手札を怨念に変化する", async ({ page }) => {
    expect(await page.evaluate(side => {
      const api = window.__chibattle, own = api.state.players[side];
      own.hand = ["wood_gitch", "general_student", "ruler", "cafeteria"].map(id => api.createCardFromBase(id, side));
      const before = own.hand.map(c => c.instanceId), foe = side === "player" ? "opponent" : "player";
      const foeBefore = JSON.stringify(api.state.players[foe]), trashBefore = JSON.stringify(own.trash);
      const c = api.makeBoardCard(api.createCardFromBase("gigi_blood", side));
      api.resolveAttendEffects(side, c, "seat", 0, { fromHand: true });
      const attendUnchanged = own.hand.every(c => c.baseId !== "grudge");
      api.resolveEvolutionEffect(side, c, api.state.actionTurn, { attendanceSource: "effect" });
      return { attendUnchanged, idsPreserved: own.hand.every((c, i) => c.instanceId === before[i]),
        cards: own.hand.map(c => [c.baseId, c.cost, c.token, c.owner]),
        foeUnchanged: foeBefore === JSON.stringify(api.state.players[foe]),
        trashUnchanged: trashBefore === JSON.stringify(own.trash), pending: api.state.pendingCopiedCard };
    }, side)).toEqual({ attendUnchanged: true, idsPreserved: true,
      cards: Array.from({ length: 4 }, () => ["grudge", 1, true, side]),
      foeUnchanged: true, trashUnchanged: true, pending: null });
  });
}

test("空手札でも進化を終え、肩代わり効果は残らない", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    own.hand = [];
    own.board.seats[0] = api.makeBoardCard(api.createCardFromBase("gitch", "player"));
    const gigi = api.makeBoardCard(api.createCardFromBase("gigi_blood", "player"));
    own.board.seats[1] = gigi;
    api.resolveEvolutionEffect("player", gigi);
    api.destroyBoardCard({ owner: "player", zone: "seat", index: 1 });
    return { hand: own.hand.length, protected: own.board.seats[1], gitch: own.board.seats[0]?.baseId };
  })).toEqual({ hand: 0, protected: null, gitch: "gitch" });
});

for (const side of ["player", "opponent"]) {
  test(side + "の怨念は1戦意で本体2ダメージ、トークンなので校外に残らない", async ({ page }) => {
    expect(await page.evaluate(side => {
      const api = window.__chibattle, own = api.state.players[side], other = side === "player" ? "opponent" : "player";
      api.state.currentSide = side;
      own.will = 1; own.trash = [];
      own.hand = [api.createCardFromBase("grudge", side)];
      api.state.players[other].life = 20;
      const used = api.castImmediateItem(side, own.hand[0], false);
      return { used, will: own.will, life: api.state.players[other].life, hand: own.hand.length, trash: own.trash.length };
    }, side)).toEqual({ used: true, will: 0, life: 18, hand: 0, trash: 0 });
  });
}

test("カードテストの進化元・手札とAI評価が新効果に対応する", async ({ page }) => {
  expect(await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("gitch");
    const gitch = { source: api.state.players.player.board.seats[4].baseId,
      next: api.state.players.player.hand.some(c => c.baseId === "gigi_blood") };
    api.startCardTest("gigi_blood");
    const gigi = { source: api.state.players.player.board.seats[4].baseId,
      variety: new Set(api.state.players.player.hand.map(c => c.type)).size >= 3 };
    const own = api.state.players.opponent;
    own.hand = [api.createCardFromBase("grudge", "opponent")]; own.will = 1;
    api.state.currentSide = "opponent"; api.state.players.player.life = 2;
    const item = own.hand[0];
    return { gitch, gigi, lethalScore: api.scoreAiItem(item) > 100,
      deckHasToken: "grudge" in api.state.deckBuilder.counts.player };
  })).toEqual({ gitch: { source: "wood_gitch", next: true }, gigi: { source: "gitch", variety: true },
    lethalScore: true, deckHasToken: false });
});

test("進化演出の完了を待ち、AIが変化後の怨念でリーサルを取る", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.evaluate(() => {
    const api = window.__chibattle, state = api.state;
    state.preBattleToken += 1000; state.testMode = false; state.currentSide = "opponent";
    state.actionTurn = 8; state.phase = "battle"; state.gameOver = false;
    state.training = { ...state.training, active: true, leftController: "human", speed: 4, paused: false, skipAnimations: false };
    for (const side of ["player", "opponent"]) {
      const own = state.players[side];
      own.board.seats.fill(null); own.board.teacher = null; own.hand = []; own.trash = [];
      own.late = []; own.deck = Array.from({ length: 10 }, () => api.createCardFromBase("general_student", side));
      own.will = own.maxWill = 10; own.attendancesThisTurn = 0; own.life = 20;
    }
    const own = state.players.opponent;
    own.board.seats[4] = api.makeBoardCard(api.createCardFromBase("gitch", "opponent"));
    own.board.seats[4].playedOnTurn = 7;
    own.board.seats[4].hasAttacked = true;
    own.board.seats[4].attacksUsedThisTurn = 1;
    own.hand = ["gigi_blood", "cafeteria", "wood_gitch"].map(id => api.createCardFromBase(id, "opponent"));
    state.players.player.life = 4;
    api.runOpponentAI();
  });
  await expect.poll(() => page.evaluate(() => window.__chibattle.state.players.player.life), { timeout: 15000 }).toBe(0);
  expect(await page.evaluate(() => {
    const api = window.__chibattle;
    return { evolved: api.state.players.opponent.board.seats[4]?.baseId, hand: api.state.players.opponent.hand.length,
      will: api.state.players.opponent.will, winner: api.state.winner };
  })).toMatchObject({ evolved: "gigi_blood", hand: 0, will: 0 });
  expect(errors).toEqual([]);
});

test("カードテストから技議っちを進化させ、表示手札と盤面を確認する", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.evaluate(() => {
    const api = window.__chibattle, own = api.state.players.player;
    api.state.phase = "battle"; api.state.currentSide = "player";
    const card = own.hand.find(c => c.baseId === "gitch");
    api.playCard(card.instanceId, "seat", "player", 4);
  });
  await expect.poll(() => page.evaluate(() => {
    const own = window.__chibattle.state.players.player;
    return { parent: own.board.seats[4]?.baseId, wood: [...own.board.seats, own.board.teacher].filter(c => c?.baseId === "wood_gitch").length };
  })).toEqual({ parent: "gitch", wood: 2 });
  await expect(page.locator("#playerHand")).toContainText("偽魏義ッ血");
  expect(errors).toEqual([]);
});
