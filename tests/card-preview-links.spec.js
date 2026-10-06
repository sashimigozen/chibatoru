const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("デッキ編成のカード詳細から能力説明を確認でき、関連カード・テスト開始も使える", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  const countsBefore = await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.counts));
  const cases = [
    ["absolute_woman", "陽気"],
    ["aggro_princess", "超陽気"],
    ["ae_student", "注目"],
    ["super_ae_student", "超注目"],
    ["president", "眠気"],
    ["yuta", "余裕"],
    ["hurried_student", "遅刻"],
    ["oni_shima_ai", "進化"],
    ["single_cell", "特殊進化"],
    ["white_student", "負荷"],
    ["earphones", "装備"]
  ];
  const modal = page.locator("#cardTestModal");
  const description = modal.locator("[data-preview-term-description]");
  for (const [baseId, term] of cases) {
    await page.locator(`[data-card-test="${baseId}"]`).click();
    await expect(modal).toBeVisible();
    await expect(description).toBeHidden();
    const link = modal.locator(`[data-preview-term="${term}"]`).first();
    await link.click();
    const expected = await page.evaluate((name) => window.__chibattle.BATTLE_CARD_TERM_DESCRIPTIONS[name], term);
    await expect(description).toHaveText(`［${term}］ ${expected}`);
    await expect(modal).toBeVisible();
    expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("deck");
    expect(await page.evaluate(() => window.__chibattle.state.pendingTestCardId)).toBe(baseId);
    if (baseId === "yuta") {
      await modal.locator('[data-preview-term="陽気"]').first().focus();
      await page.keyboard.press("Enter");
      await expect(description).toContainText("相手本体は攻撃できない");
      await expect(description).not.toContainText("体力を1回復");
      await page.screenshot({ path: test.info().outputPath("deck-ability-description.png") });
    }
    await page.locator("#cardTestCancelButton").click();
    await expect(modal).toBeHidden();
  }
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder.counts))).toBe(countsBefore);
  await page.locator('[data-card-test="padlock"]').click();
  await modal.locator('.tooltip-effect [data-related-card="key"]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("鍵");
  await expect(description).toBeHidden();
  await page.locator("#cardTestCancelButton").click();
  await page.locator('[data-card-test="general_student"]').click();
  await expect(modal.locator("[data-preview-term]")).toHaveCount(0);
  await expect(description).toBeHidden();
  await page.locator("#cardTestStartButton").click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(() => window.__chibattle.state.testCardBaseId)).toBe("general_student");
  expect(await page.evaluate(() => window.__chibattle.state.screen)).toBe("battle");
  expect(errors).toEqual([]);
});

test("説明文からトークン・進化元をたどり、戻ってもデッキや能力説明を維持する", async ({ page }) => {
  await page.goto(gameUrl);
  await page.locator("#homeNavDeckButton").click();
  await page.locator("#deckLibraryGrid .new-deck").click();
  const deckBefore = await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder));
  const modal = page.locator("#cardTestModal");
  const rules = modal.locator(".tooltip-effect");
  await page.locator('[data-card-test="gigi_blood"]').click();
  await modal.locator('[data-preview-term="進化"]').click();
  const explanation = await modal.locator('[data-preview-term-description]').innerText();
  await rules.locator('[data-related-card="grudge"]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("怨念");
  await modal.locator('[data-related-card-back]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("偽魏義ッ血");
  await expect(modal.locator('[data-preview-term-description]')).toHaveText(explanation);
  await rules.locator('[data-related-card="gitch"]').click();
  await rules.locator('[data-related-card="wood_gitch"]').first().click();
  await expect(modal.locator(".tooltip-title")).toHaveText("木っち（ぎっち）");
  await rules.locator('[data-related-card="wood_gitch"]').click();
  await modal.locator('[data-related-card-back]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("技議っち");
  await modal.locator('[data-related-card-back]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("偽魏義ッ血");
  await expect(modal.locator('[data-related-card-back]')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.deckBuilder))).toBe(deckBefore);
  await page.locator("#cardTestCancelButton").click();
  await page.locator('[data-card-test="cornering_lecturer"]').click();
  await rules.locator('[data-related-card="scary_question"]').first().focus();
  await page.keyboard.press("Enter");
  await expect(modal.locator(".tooltip-title")).toHaveText("怖い質問");
  await modal.locator('[data-related-card-back]').click();
  await expect(modal.locator(".tooltip-title")).toHaveText("ガン詰め講師");
  await page.screenshot({ path: test.info().outputPath("related-card-description.png") });
});

test("関連カードを参照しても対戦カードの実体と盤面・手札を変えない", async ({ page }) => {
  await page.goto(gameUrl);
  const before = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("gigi_blood");
    const source = api.state.players.player.hand.find(card => card.baseId === "gigi_blood");
    api.showBattleCardPreview(source);
    return { id: source.instanceId, players: JSON.stringify(api.state.players) };
  });
  const preview = page.locator("#battleCardPreview");
  await preview.locator('[data-preview-term="進化"]').click();
  await preview.locator('[data-related-card="grudge"]').click();
  const bounds = await preview.evaluate((element) => {
    const outer = element.getBoundingClientRect(), back = element.querySelector('[data-related-card-back]').getBoundingClientRect();
    return { inside: back.left >= outer.left && back.right <= outer.right && back.top >= outer.top && back.bottom <= outer.bottom,
      correctColumn: Boolean(element.querySelector('.battle-card-preview-detail [data-related-card-back]')) };
  });
  expect(bounds).toEqual({ inside: true, correctColumn: true });
  await preview.locator('[data-related-card-back]').click();
  expect(await page.evaluate(() => document.getElementById("battleCardPreview")._previewCard.instanceId)).toBe(before.id);
  await expect(preview.locator('[data-preview-term-description]')).toContainText("同じマス");
  expect(await page.evaluate(() => JSON.stringify(window.__chibattle.state.players))).toBe(before.players);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("general_student", "player"));
  });
  await expect(preview.locator('[data-related-card-back]')).toHaveCount(0);
});

test("カード詳細でも関連カードを開いて戻れ、閉じた後に履歴を残さない", async ({ page }) => {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    window.__chibattle.state.screen = "battle";
    window.__chibattle.render();
    openDungeonCardInfo("gigi_blood");
  });
  const modal = page.locator("#dungeonCardInfoModal");
  await modal.locator('.tooltip-effect [data-related-card="grudge"]').click();
  await expect(page.locator("#dungeonCardInfoTitle")).toHaveText("怨念");
  await modal.locator('[data-related-card-back]').click();
  await expect(page.locator("#dungeonCardInfoTitle")).toHaveText("偽魏義ッ血");
  await modal.locator('[data-preview-term="進化"]').click();
  await expect(modal.locator('[data-preview-term-description]')).toContainText("同じマス");
  await page.locator("#dungeonCardInfoCloseButton").click();
  await page.evaluate(() => openDungeonCardInfo("general_student"));
  await expect(modal.locator('[data-related-card-back]')).toHaveCount(0);
});

test("カード確認の効果文でカード名・能力・タイプを直接確認できる", async ({ page }) => {
  await page.goto(gameUrl);

  const markupChecks = await page.evaluate(() => {
    const api = window.__chibattle;
    const markup = (baseId) => api.battleCardRulesMarkup(api.createCardFromBase(baseId, "player"));
    const wall = markup("big_wall");
    const padlock = markup("padlock");
    const trpgMember = markup("trpg_member");
    const yuta = markup("yuta");
    const evolution = markup("oni_shima_ai");
    const specialEvolution = markup("single_cell");
    const loadedCard = api.createCardFromBase("general_student", "player");
    loadedCard.handLoadLevel = 1;
    api.state.players.player.hand = [loadedCard];
    const load = api.battleCardRulesMarkup(loadedCard);
    loadedCard.handLoadLevel = 2;
    const highLoad = api.battleCardRulesMarkup(loadedCard);
    const removedTerms = [
      "攻撃力", "防御力", "体力", "戦意", "気力",
      "講義室", "教卓マス", "教師マス", "席マス", "環境マス", "校外エリア", "遅刻ゾーン",
      "出席者", "デッキ", "手札", "出席"
    ];
    return {
      lectureRoomRemainsPlainText: wall.includes("講義室")
        && !wall.includes('data-preview-term="講義室"')
        && !wall.includes('data-preview-term="講義"'),
      studentTypeLinked: trpgMember.includes('data-preview-type-term="student"'),
      relatedCardLinked: padlock.includes('data-related-card="key"'),
      lectureAbilityLinked: padlock.includes('data-preview-term="講義"'),
      equipmentLinked: padlock.includes('data-preview-term="装備"'),
      evolutionLinked: evolution.includes('data-preview-term="進化"'),
      specialEvolutionLinked: specialEvolution.includes('data-preview-term="特殊進化"'),
      loadLinked: load.includes('data-preview-term="負荷"'),
      highLoadLinked: highLoad.includes('data-preview-term="高負荷"'),
      keywordLinked: yuta.includes('data-preview-term="余裕"')
        && yuta.includes('data-preview-term="陽気"'),
      handAndAttendanceRemainPlainText: trpgMember.includes("手札")
        && trpgMember.includes("出席")
        && !trpgMember.includes('data-preview-term="手札"')
        && !trpgMember.includes('data-preview-term="出席"')
        && !("手札" in api.BATTLE_CARD_TERM_DESCRIPTIONS)
        && !("出席" in api.BATTLE_CARD_TERM_DESCRIPTIONS),
      removedTermsHaveNoDescriptions: removedTerms.every((term) => !(term in api.BATTLE_CARD_TERM_DESCRIPTIONS)
        && api.BATTLE_CARD_PLAIN_TERMS.includes(term)),
      lectureAbilityStillHasDescription: Boolean(api.BATTLE_CARD_TERM_DESCRIPTIONS.講義)
    };
  });
  Object.entries(markupChecks).forEach(([name, passed]) => expect(passed, name).toBe(true));

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.screen = "battle";
    api.state.phase = "battle";
    api.render();
    api.showBattleCardPreview(api.createCardFromBase("padlock", "player"));
  });
  await page.locator('[data-preview-term="講義"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("1ダメージ");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("padlock", "player"));
  });
  await page.locator('[data-related-card="key"]').click();
  await expect.poll(() => page.evaluate(() => document.getElementById("battleCardPreview")._previewCard?.baseId)).toBe("key");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("trpg_member", "player"));
  });
  await page.locator('[data-preview-type-term="student"]').click();
  await expect(page.locator(".battle-card-type-help-heading")).toContainText("学生");
  await expect(page.locator(".battle-card-type-help-copy")).toContainText("席マス");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("yuta", "player"));
  });
  await page.locator('[data-preview-term="余裕"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("体力を1回復");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("padlock", "player"));
  });
  await page.locator('[data-preview-term="装備"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("1人につき1枚");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("oni_shima_ai", "player"));
  });
  await page.locator('[data-preview-term="進化"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("同じマス");

  await page.evaluate(() => {
    const api = window.__chibattle;
    api.showBattleCardPreview(api.createCardFromBase("single_cell", "player"));
  });
  await page.locator('[data-preview-term="特殊進化"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("戦意を使わず");

  await page.evaluate(() => {
    const api = window.__chibattle;
    const loaded = api.createCardFromBase("general_student", "player");
    loaded.handLoadLevel = 1;
    api.state.players.player.hand = [loaded];
    api.showBattleCardPreview(loaded);
  });
  await page.locator('[data-preview-term="負荷"]').click();
  await expect(page.locator("[data-preview-term-description]")).toContainText("自分本体に1ダメージ");
});
