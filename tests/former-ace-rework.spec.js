const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const catalog = require("../server/card-catalog.json");
const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;
const cards = {
  tokyo_tech_bro: [5, "late", "このカードを手札から出席させたとき、自分の遅刻ゾーンにいるすべての出席者を出席させる。"],
  smoke_flare: [2, "big", "自分のデッキから1枚引く。この効果で引いたカードのコストを1減らす。ただし、1未満にはならない。"],
  forbidden_book: [5, "shogi", "自分の気力が10以下のときのみ使用できる。自分本体に3ダメージ、相手本体に5ダメージを与える。"],
  think_so: [3, "gakuyukai_item", "自分のデッキから「U太」1枚を手札に加える。その後、自分の手札にある「U太」すべてのコストを1減らす。ただし、1未満にはならない。"],
  philosophy_cheating: [5, "interference", "相手の手札を見て、その中のカード1枚を選び、[負荷]を与える。"],
  namen_tenno: [5, "design", "相手の講義室にいるヴァンパイア2人までを指名し、破壊する。"],
  brother_capital: [6, "expansion", "自分の手札からコスト2以下の出席者を好きなだけ選び、自分の講義室に出席させる。"]
};

async function prepare(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    startCardTest("brother_capital");
    scheduleOpponentAI = () => {};
    state.training.skipAnimations = true;
    state.environment = null;
    for (const side of ["player", "opponent"]) Object.assign(state.players[side], {
      hand: [], deck: [], trash: [], late: [], board: { teacher: null, seats: Array(9).fill(null) },
      will: 20, maxWill: 20, life: 20
    });
  });
}

test("7枚の本文・能力値・専攻・3枚制限・台帳・お知らせ・サーバー情報が一致する", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(ids => ids.map(id => {
    const card = createCardFromBase(id, "player");
    return { id, cost: card.cost, text: cardRulesText(card).replaceAll("\n", ""), ace: isAceCard(card),
      limit: maxCopiesForCard(id), direct: DIRECT_DECK_CARD_IDS.has(id),
      categories: Object.entries(SPECIALTY_CARD_IDS).filter(([, entries]) => entries.includes(id)).map(([category]) => category),
      update: UPDATE_HISTORY[0].changes.find(change => change.title === card.name) };
  }), Object.keys(cards));
  const ledger = fs.readFileSync(path.join(__dirname, "..", "card_rules.txt"), "utf8");
  for (const entry of result) {
    const [cost, category, text] = cards[entry.id];
    expect(entry).toMatchObject({ cost, text, ace: false, limit: 3, direct: true });
    expect(entry.categories).toContain(category);
    expect(catalog.aces).not.toContain(entry.id);
    expect(catalog.direct).toContain(entry.id);
    expect(catalog.display[entry.id].cost).toBe(cost);
    expect(entry.update.after).toContain(text);
    expect(entry.update.after).toContain("デッキ投入上限3枚");
    expect(ledger).toContain(text.replaceAll("[負荷]", "負荷"));
  }
  expect(await page.evaluate(() => getDeckEditorIds(""))).toEqual(catalog.deckOrder);
});

test("無法の食堂は一覧・編成・生成デッキから除外され、内部定義は維持する", async ({ page }) => {
  await page.goto(gameUrl);
  expect(await page.evaluate(() => ({
    retired: CARD_BASES.illegal_cafeteria.retired, ace: isAceCard(createCardFromBase("illegal_cafeteria", "player")),
    direct: DIRECT_DECK_CARD_IDS.has("illegal_cafeteria"), editor: getDeckEditorIds("").includes("illegal_cafeteria"),
    imported: createDeckCountsFromEntries({ illegal_cafeteria: 3 }).illegal_cafeteria || 0,
    built: createDeckFromCounts("player", { general_student: 3, illegal_cafeteria: 3 }).map(card => card.baseId)
  }))).toEqual({ retired: true, ace: false, direct: false, editor: false, imported: 0, built: ["general_student", "general_student", "general_student"] });
  expect(catalog.direct).not.toContain("illegal_cafeteria");
  expect(catalog.deckOrder).not.toContain("illegal_cafeteria");
  await page.locator("#homeNavDeckButton").click();
  await page.locator('[data-case-view="cards"]').click();
  await page.locator("#cardsCatalogSearch").fill("無法の食堂");
  await expect(page.locator('[data-catalog-card="illegal_cafeteria"]')).toHaveCount(0);
});

for (const side of ["player", "opponent"]) {
  test(`思ってまうは生成せず手札のU太だけ軽減し下限1を守る ${side}`, async ({ page }) => {
    await prepare(page);
    expect(await page.evaluate(side => {
      state.currentSide = side;
      const own = state.players[side];
      const item = createCardFromBase("think_so", side);
      const uta = createCardFromBase("yuta", side); uta.cost = 3;
      const cheap = createCardFromBase("yuta", side); cheap.cost = 1;
      const zero = createCardFromBase("yuta", side); zero.cost = 0;
      const other = createCardFromBase("general_student", side);
      const fetched = createCardFromBase("yuta", side); fetched.cost = 3;
      own.hand = [item, uta, cheap, zero, other]; own.deck = [fetched];
      castImmediateItem(side, item, false);
      return { costs: own.hand.map(card => effectiveCardCost(card)), size: own.hand.length, deck: own.deck.length, will: own.will };
    }, side)).toEqual({ costs: [2, 1, 0, 2, 2], size: 5, deck: 0, will: 17 });
  });

  test(`哲学の不正は任意タイプ1枚に負荷を付与し、高負荷までで止まる ${side}`, async ({ page }) => {
    await prepare(page);
    expect(await page.evaluate(side => {
      state.currentSide = side;
      const own = state.players[side], other = state.players[oppositeSide(side)];
      const target = createCardFromBase("general_teacher", oppositeSide(side));
      const untouched = createCardFromBase("ruler", oppositeSide(side));
      other.hand = [target, untouched];
      const stages = [];
      for (let i = 0; i < 3; i++) {
        const item = createCardFromBase("philosophy_cheating", side); own.hand = [item];
        resolvePhilosophyCheating(side, item, [target.instanceId], false);
        stages.push(target.handLoadLevel);
      }
      resolveHandLoadEndTurn(oppositeSide(side));
      return { stages, will: own.will, hand: other.hand.length, trash: other.trash.length, life: other.life,
        untouched: untouched.handLoadLevel || 0 };
    }, side)).toEqual({ stages: [1, 2, 2], will: 5, hand: 2, trash: 0, life: 18, untouched: 0 });
  });

  test(`なめてるのは指名した2人までだけ破壊し、本体にダメージを与えない ${side}`, async ({ page }) => {
    await prepare(page);
    expect(await page.evaluate(side => {
      state.currentSide = side;
      const own = state.players[side], other = state.players[oppositeSide(side)];
      const item = createCardFromBase("namen_tenno", side); own.hand = [item];
      ["cafeteria_lady", "vampire", "zombie", "general_student"].forEach((id, index) => {
        other.board.seats[index] = makeBoardCard(createCardFromBase(id, oppositeSide(side)));
      });
      const ids = other.board.seats.slice(0, 3).map(card => card.instanceId);
      const invalid = resolveNamenTenno(side, item, ids, false);
      const before = own.will;
      const used = resolveNamenTenno(side, item, [ids[0], ids[2]], false);
      return { invalid, before, used, will: own.will, life: other.life,
        remaining: other.board.seats.filter(Boolean).map(card => card.baseId), trash: other.trash.map(card => card.baseId) };
    }, side)).toEqual({ invalid: false, before: 20, used: true, will: 15, life: 20,
      remaining: ["vampire", "general_student"], trash: ["cafeteria_lady", "zombie"] });
  });
}

test("資本力は手札から無料で出席させ、出席時効果を発動しデッキから直接出さない", async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const own = state.players.player;
    const item = createCardFromBase("brother_capital", "player");
    const friend = createCardFromBase("best_friend", "player");
    const student = createCardFromBase("general_student", "player");
    own.will = 6; own.hand = [item, friend, student]; own.deck = [createCardFromBase("loud_student", "player")];
    resolveBrotherCapital("player", item, [friend.instanceId, student.instanceId], false);
    const pendingHand = own.hand.map(card => card.baseId);
    placePendingCopiedCardForSide("player", "seat", "player", 0);
    const fetched = own.hand.some(card => card.baseId === "loud_student");
    placePendingCopiedCardForSide("player", "seat", "player", 1);
    return { pendingHand, fetched, will: own.will, deck: own.deck.length, hand: own.hand.map(card => card.baseId),
      sources: own.board.seats.filter(Boolean).map(card => card.lastAttendanceSource), pending: Boolean(state.pendingSpecialAttendanceQueue) };
  });
  expect(result).toEqual({ pendingHand: ["best_friend", "general_student"], fetched: true, will: 0, deck: 0,
    hand: ["loud_student"], sources: ["hand", "hand"], pending: false });
});

test("資本力で空き不足分は手札に残り、不正な選択では戦意を払わない", async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    own.board.seats = Array.from({ length: 9 }, () => makeBoardCard(createCardFromBase("general_student", "player")));
    own.board.teacher = makeBoardCard(createCardFromBase("general_teacher", "player"));
    own.board.seats[0] = null;
    const item = createCardFromBase("brother_capital", "player");
    const first = createCardFromBase("general_student", "player"), second = createCardFromBase("general_student", "player");
    own.hand = [item, first, second]; own.deck = [createCardFromBase("general_student", "player")];
    const invalid = resolveBrotherCapital("player", item, [own.deck[0].instanceId], false);
    const before = own.will;
    resolveBrotherCapital("player", item, [first.instanceId, second.instanceId], false);
    placePendingCopiedCardForSide("player", "seat", "player", 0);
    return { invalid, before, will: own.will, hand: own.hand.map(card => card.instanceId), second: second.instanceId,
      keptExpected: own.hand.length === 1 && own.hand[0].instanceId === second.instanceId,
      trash: own.trash.map(card => card.baseId), pending: Boolean(state.pendingCopiedCard || state.pendingSpecialAttendanceQueue) };
  })).toMatchObject({ invalid: false, before: 20, will: 14, keptExpected: true, trash: ["brother_capital"], pending: false });
});

test("資本力は出席者の追加選択が終わるまで次の出席を待つ", async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const own = state.players.player;
    own.pointScore = 10;
    const item = createCardFromBase("brother_capital", "player");
    const first = createCardFromBase("short_sleeve_student", "player"), next = createCardFromBase("general_student", "player");
    own.hand = [item, first, next];
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase("strong_student", "opponent"));
    resolveBrotherCapital("player", item, [first.instanceId, next.instanceId], false);
    placePendingCopiedCardForSide("player", "seat", "player", 0);
  });
  await expect.poll(() => page.evaluate(() => state.pendingCardChoice?.mode)).toBe("fusion_effect_choice");
  expect(await page.evaluate(() => state.pendingCopiedCard)).toBeNull();
  await page.evaluate(() => confirmCardChoiceSelection());
  await expect.poll(() => page.evaluate(() => state.pendingCopiedCard?.baseId)).toBe("general_student");
  await page.evaluate(() => placePendingCopiedCardForSide("player", "seat", "player", 1));
  expect(await page.evaluate(() => state.pendingSpecialAttendanceQueue)).toBeNull();
});

test("資本力は0人選択でも使用でき、CPUは手札から出席させる", async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    const item = createCardFromBase("brother_capital", "player"); own.hand = [item];
    const empty = resolveBrotherCapital("player", item, [], false);
    const enemy = state.players.opponent; state.currentSide = "opponent";
    const capital = createCardFromBase("brother_capital", "opponent");
    enemy.hand = [capital, createCardFromBase("best_friend", "opponent"), createCardFromBase("general_student", "opponent")];
    enemy.deck = [createCardFromBase("loud_student", "opponent")];
    const plan = planAiUtilityItem("opponent", capital);
    const used = useAiUtilityItem("opponent", capital, plan);
    return { empty, playerWill: own.will, used, will: enemy.will, hand: enemy.hand.map(card => card.baseId),
      source: enemy.board.seats.filter(Boolean).map(card => card.lastAttendanceSource) };
  })).toEqual({ empty: true, playerWill: 14, used: true, will: 14, hand: ["loud_student"], source: ["hand", "hand"] });
});

test("東工ニキの手札出席だけで遅刻を解放し、禁断の書物は気力条件と3/5ダメージを維持する", async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    own.late = [{ card: createCardFromBase("lazy_student", "player"), owner: "player", zone: "seat", index: 0, remaining: 3 }];
    const tech = createCardFromBase("tokyo_tech_bro", "player"); own.hand = [tech];
    placeCardFromHand("player", tech.instanceId, "seat", "player", 1, false);
    const released = own.late.length === 0 && own.board.seats[0]?.baseId === "lazy_student";
    const book = createCardFromBase("forbidden_book", "player"); own.hand = [book]; own.life = 11;
    const blocked = !canUseHandCardNow(book);
    own.life = 10; castImmediateItem("player", book, false);
    return { released, blocked, own: own.life, enemy: state.players.opponent.life, will: own.will };
  })).toEqual({ released: true, blocked: true, own: 7, enemy: 15, will: 10 });
});

for (const width of [1440, 390]) {
  test(`通常のカードテストで哲学の選択を操作できる ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(gameUrl);
    await page.locator("#homeNavDeckButton").click();
    await page.locator('[data-case-view="cards"]').click();
    await page.locator("#cardsCatalogSearch").fill("哲学の不正");
    await page.locator('[data-catalog-card="philosophy_cheating"]').click();
    await page.locator("#cardTestStartButton").click();
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    await page.evaluate(() => beginItemUse(state.players.player.hand.find(card => card.baseId === "philosophy_cheating")));
    expect(await page.evaluate(() => ({ min: state.pendingCardChoice.min, max: state.pendingCardChoice.max, types: state.pendingCardChoice.cards.map(card => card.type) })))
      .toEqual({ min: 1, max: 1, types: ["item", "item", "student", "environment"] });
    await page.screenshot({ path: test.info().outputPath(`philosophy-${width}.png`) });
    await page.evaluate(() => {
      toggleCardChoiceCard(state.pendingCardChoice.cards[3].instanceId);
      confirmCardChoiceSelection();
    });
    await expect.poll(() => page.evaluate(() => state.players.opponent.hand[3].handLoadLevel)).toBe(1);
    expect(errors).toEqual([]);
  });
}

for (const id of ["tokyo_tech_bro", "forbidden_book", "think_so", "namen_tenno", "brother_capital"]) {
  test(`一覧のテストから開始状態を変更せず効果を使える ${id}`, async ({ page }) => {
    await page.goto(gameUrl);
    const name = await page.evaluate(id => CARD_BASES[id].name, id);
    await page.locator("#homeNavDeckButton").click();
    await page.locator('[data-case-view="cards"]').click();
    await page.locator("#cardsCatalogSearch").fill(name);
    await page.locator(`[data-catalog-card="${id}"]`).click();
    await page.locator("#cardTestStartButton").click();
    await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
    if (id === "tokyo_tech_bro") {
      await page.evaluate(() => placeCardFromHand("player", state.players.player.hand.find(card => card.baseId === "tokyo_tech_bro").instanceId, "seat", "player", 2, true));
      await expect.poll(() => page.evaluate(() => state.players.player.late.length)).toBe(0);
      expect(await page.evaluate(() => state.players.player.board.seats.slice(0, 3).map(card => card?.baseId)))
        .toEqual(["lazy_student", "cancel_student", "tokyo_tech_bro"]);
      return;
    }
    await page.evaluate(id => beginItemUse(state.players.player.hand.find(card => card.baseId === id)), id);
    if (id === "forbidden_book") {
      await expect.poll(() => page.evaluate(() => state.players.player.life)).toBe(7);
    } else if (id === "think_so") {
      await expect.poll(() => page.evaluate(() => state.players.player.hand.filter(card => card.baseId === "yuta").map(card => effectiveCardCost(card)).sort()))
        .toEqual([1, 2, 2]);
    } else if (id === "namen_tenno") {
      await page.evaluate(() => {
        state.pendingCardChoice.cards.slice(0, 2).forEach(card => toggleCardChoiceCard(card.instanceId));
        confirmCardChoiceSelection();
      });
      await expect.poll(() => page.evaluate(() => listBoardRefs("opponent").map(getBoardCardFromRef).filter(card => card.type === "vampire").length)).toBe(1);
    } else {
      await page.evaluate(() => {
        ["best_friend", "general_student"].forEach(id => toggleCardChoiceCard(state.pendingCardChoice.cards.find(card => card.baseId === id).instanceId));
        confirmCardChoiceSelection();
      });
      for (const index of [0, 1]) {
        await expect.poll(() => page.evaluate(() => Boolean(state.pendingCopiedCard))).toBe(true);
        await expect.poll(() => page.evaluate(() => battlePresentationBusy())).toBe(false);
        await page.evaluate(index => placePendingCopiedCard("seat", "player", index), index);
      }
      expect(await page.evaluate(() => state.players.player.will)).toBe(4);
      expect(await page.evaluate(() => state.players.player.hand.some(card => card.baseId === "loud_student"))).toBe(true);
    }
  });
}

test("東工ニキの効果出席では遅刻を解放せず、出席先が埋まったカードは校外へ送る", async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => {
    const own = state.players.player;
    own.late = [{ card: createCardFromBase("lazy_student", "player"), owner: "player", zone: "seat", index: 0, remaining: 3 }];
    attendCard("player", makeBoardCard(createCardFromBase("tokyo_tech_bro", "player")), "seat", 1, { attendanceSource: ATTENDANCE_SOURCE.EFFECT });
    const pending = own.late.length;
    own.board.seats[0] = makeBoardCard(createCardFromBase("general_student", "player"));
    attendCard("player", makeBoardCard(createCardFromBase("tokyo_tech_bro", "player")), "seat", 2, { attendanceSource: ATTENDANCE_SOURCE.HAND });
    return { pending, remaining: own.late.length, kept: own.board.seats[0].baseId, trash: own.trash.map(card => card.baseId) };
  })).toEqual({ pending: 1, remaining: 0, kept: "general_student", trash: ["lazy_student"] });
});
