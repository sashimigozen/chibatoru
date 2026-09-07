const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("カード自身の能力を冒頭へまとめ、条件付き能力は本文に残す", async ({ page }) => {
  await page.goto(gameUrl);
  const texts = await page.evaluate(() => {
    const api = window.__chibattle;
    const text = (baseId) => api.cardRulesText(api.createCardFromBase(baseId, "player"));
    return {
      noAbility: text("general_student"),
      lecture: text("general_teacher"),
      cheerful: text("zombie"),
      multiple: text("big_omata"),
      conditional: text("scout_student"),
      reference: text("ta_killer"),
      late: text("adjective_student"),
      evolution: text("oni_shima_ai"),
      evolutionWithLegacyWording: text("gitch"),
      evolutionWithFlavor: text("demon_a_plus"),
      equipment: text("earphones"),
      fusion: text("double_diamond"),
      drowsy: api.formatCardRulesDisplayText(
        { baseId: "format_test_drowsy", keywords: ["眠気"] },
        "眠気を持つ。自分のターン終了時、このカードの体力を1回復する。"
      )
    };
  });

  expect(texts.noAbility).toBe("効果なし。");
  expect(texts.lecture).toBe("[講義]\n教卓マスにいるかぎり、[陽気]を持つ。");
  expect(texts.cheerful).toBe("[陽気]\nこのカードが出席者を攻撃したとき、その出席者を「ゾンビ」にする。\nヴァンパイアにはこの効果は使用しない。");
  expect(texts.multiple).toBe("[注目] [陽気]\n自分の席マスすべてを占有し、1人の出席者として扱う。\nこのカードが出席したとき、相手の講義室の出席者すべては1ターン攻撃できない。");
  expect(texts.conditional).toBe("相手の講義室に出席者がいないなら、これは[超陽気]を持つ。");
  expect(texts.reference).toBe("これは[講義]のダメージを受けない。\n手札から出席させたとき、相手のランダムな教師に1ダメージを与える。");
  expect(texts.late).toBe("[遅刻4]\nこのカードが出席したとき、50%の確率でこのカードの攻撃力を+3する。");
  expect(texts.evolution).toBe("[進化：「愛ちゃん」] [陽気]\n[進化]したとき、相手の学生すべてに1ダメージを与える。");
  expect(texts.evolutionWithLegacyWording.startsWith("[進化：「木っち（ぎっち）」]\n")).toBe(true);
  expect(texts.evolutionWithLegacyWording).not.toContain("から[進化]する");
  expect(texts.evolutionWithFlavor).toContain("\n-我が光に仇なす者よ。今この翼を以って頽落せしめん。羽ばたけ-");
  expect(texts.equipment).toBe("[装備]\n装備者は[講義]の効果を受けない。");
  expect(texts.fusion).toBe("[融合：「定規」2枚]\n相手の出席者1人または相手本体を指名し、4ダメージを与える。\n出席者を指名した場合、その出席者に隣接する別の出席者1人を指名し、2ダメージを与える。");
  expect(texts.drowsy).toBe("[眠気]\n自分のターン終了時、このカードの体力を1回復する。");
});

test("全カードで括弧を二重化せず、カード名と場所の一部を能力へ誤変換しない", async ({ page }) => {
  await page.goto(gameUrl);
  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const rows = Object.keys(api.CARD_BASES).map((baseId) => ({
      baseId,
      name: api.CARD_BASES[baseId].name,
      text: api.cardRulesText(api.createCardFromBase(baseId, "player"))
    }));
    return {
      count: rows.length,
      malformed: rows.filter((row) => /\[\[|\]\]|\[講義\]室|\[遅刻\]ゾーン/.test(row.text)),
      onDemand: rows.find((row) => row.baseId === "on_demand_business")?.text,
      strictLate: rows.find((row) => row.baseId === "strict_lateness_teacher")?.text,
      token: rows.find((row) => row.baseId === "big_omata")?.text,
      generated: rows.find((row) => row.baseId === "double_diamond")?.text,
      longText: rows.find((row) => row.baseId === "summer_teacher")?.text
    };
  });

  expect(result.count).toBeGreaterThan(200);
  expect(result.malformed).toEqual([]);
  expect(result.onDemand).toBe("講義室の学生は[講義]の効果を受けない。");
  expect(result.strictLate).toContain("講義室にいる[遅刻]を持つ学生");
  expect(result.strictLate).toContain("遅刻ゾーンにいる学生");
  expect(result.token.startsWith("[注目] [陽気]\n")).toBe(true);
  expect(result.generated.startsWith("[融合：「定規」2枚]\n")).toBe(true);
  expect(result.longText.split("\n").length).toBeGreaterThanOrEqual(6);
  expect(result.longText).toContain("このカードは[講義]を持たない。");
});

test("カード詳細は改行を表示し、能力リンクも一重の角括弧で表示する", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("general_teacher");
    api.showBattleCardPreview(api.createCardFromBase("general_teacher", "player"));
  });

  const preview = page.locator("#battleCardPreview");
  const rules = preview.locator(".battle-card-preview-rules");
  await expect(preview).toBeVisible();
  await expect(rules).toHaveCSS("white-space", "pre-line");
  await expect(rules).toContainText("[講義]\n教卓マスにいるかぎり、[陽気]を持つ。");
  await expect(rules.locator('[data-preview-term="講義"]')).toHaveText("[講義]");
  await expect(rules.locator('[data-preview-term="陽気"]')).toHaveText("[陽気]");

  const box = await preview.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});
