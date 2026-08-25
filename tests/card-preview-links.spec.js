const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("カード確認の効果文でカード名・能力・タイプを直接確認できる", async ({ page }) => {
  await page.goto(gameUrl);

  const markupChecks = await page.evaluate(() => {
    const api = window.__chibattle;
    const markup = (baseId) => api.battleCardRulesMarkup(api.createCardFromBase(baseId, "player"));
    const wall = markup("big_wall");
    const padlock = markup("padlock");
    const trpgMember = markup("trpg_member");
    const yuta = markup("yuta");
    const removedTerms = [
      "攻撃力", "防御力", "体力", "戦意", "気力",
      "講義室", "教卓マス", "教師マス", "席マス", "環境マス", "校外エリア", "遅刻ゾーン",
      "出席者", "デッキ", "手札", "出席", "装備", "進化"
    ];
    return {
      lectureRoomRemainsPlainText: wall.includes("講義室")
        && !wall.includes('data-preview-term="講義室"')
        && !wall.includes('data-preview-term="講義"'),
      studentTypeLinked: trpgMember.includes('data-preview-type-term="student"'),
      relatedCardLinked: padlock.includes('data-related-card="key"'),
      lectureAbilityLinked: padlock.includes('data-preview-term="講義"'),
      equipmentAndEvolutionRemainPlainText: padlock.includes("装備")
        && padlock.includes("進化")
        && !padlock.includes('data-preview-term="装備"')
        && !padlock.includes('data-preview-term="進化"')
        && !("装備" in api.BATTLE_CARD_TERM_DESCRIPTIONS)
        && !("進化" in api.BATTLE_CARD_TERM_DESCRIPTIONS),
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
});
