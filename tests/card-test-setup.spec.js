const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

test("追加カードのテスト開始時に効果条件を満たす手札・盤面・デッキを用意する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const snapshots = {};
    const testIds = [
      "tokyo_tech_bro",
      "summer_teacher",
      "brother_capital",
      "padlock",
      "crotch_febreze",
      "smoke_flare",
      "one_eyed_peek",
      "aggro_army",
      "aggro_kingdom",
      "absent_student",
      "strict_lateness_teacher",
      "scout_student",
      "ta_squad",
      "happy_blue_bird",
      "suit_student",
      "bust_suit",
      "intern",
      "king_ghidorah_bed",
      "quick_quiz_tournament",
      "tsurai_nara",
      "company_one_day",
      "enough_to_fly",
      "ii_daro_tte",
      "big_laughter",
      "lie_pekora",
      "big_wall",
      "forbidden_book",
      "philosophy_cheating",
      "think_so",
      "illegal_cafeteria",
      "namen_tenno",
      "course_registration_party"
    ];

    const boardCards = (side) => {
      const player = api.state.players[side];
      return [...player.board.seats.filter(Boolean), player.board.teacher].filter(Boolean);
    };

    testIds.forEach((baseId) => {
      api.startCardTest(baseId);
      const target = api.state.players.player.hand.find((card) => card.baseId === baseId);
      snapshots[baseId] = {
        usable: Boolean(target && api.canUseHandCardNow(target)),
        effectiveCost: target ? api.effectiveCardCost(target) : null,
        rulesText: target ? api.cardRulesText(target) : "",
        hand: api.state.players.player.hand.map((card) => card.baseId),
        deck: api.state.players.player.deck.map((card) => card.baseId),
        opponentHand: api.state.players.opponent.hand.map((card) => card.baseId),
        playerBoard: boardCards("player").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        opponentBoard: boardCards("opponent").map((card) => ({
          baseId: card.baseId,
          type: card.type,
          hp: card.currentHp
        })),
        late: api.state.players.player.late.map((entry) => entry.card.baseId),
        opponentLate: api.state.players.opponent.late.map((entry) => entry.card.baseId),
        life: api.state.players.player.life,
        maxWill: api.state.players.player.maxWill,
        playerDeckSize: api.state.players.player.deck.length,
        opponentDeckSize: api.state.players.opponent.deck.length,
        superCheerful: Boolean(target && api.hasKeyword(target, "超陽気"))
      };
    });
    return snapshots;
  });

  Object.entries(result).forEach(([baseId, snapshot]) => {
    expect(snapshot.usable, `${baseId} should be immediately usable`).toBe(true);
  });

  expect(result.tokyo_tech_bro.late).toEqual(expect.arrayContaining(["lazy_student", "cancel_student"]));
  expect(result.summer_teacher.hand).not.toEqual(expect.arrayContaining(["trendy_student", "extra_people", "kyoto_sound_i"]));
  expect(result.summer_teacher.hand).toEqual(["summer_teacher"]);
  expect(result.brother_capital.deck.slice(0, 4)).toEqual(expect.arrayContaining([
    "aggro_student", "single_cell", "ae_student", "general_student"
  ]));
  expect(result.crotch_febreze.playerBoard.filter((card) => card.baseId.includes("ae_student"))).toHaveLength(2);
  expect(result.crotch_febreze.opponentBoard.filter((card) => card.type === "teacher").length).toBeGreaterThanOrEqual(2);
  expect(result.smoke_flare.maxWill).toBe(8);
  expect(result.one_eyed_peek.opponentHand.length).toBeGreaterThan(0);
  expect(result.aggro_kingdom.hand).toEqual(expect.arrayContaining([
    "aggro_kingdom", "aggro_student", "aggro_king", "aggro_queen"
  ]));
  expect(result.aggro_kingdom.playerBoard.some((card) => card.baseId === "aggro_student")).toBe(true);
  expect(result.aggro_kingdom.opponentBoard.some((card) => card.baseId === "aggro_king")).toBe(true);
  expect(result.absent_student.playerBoard.some((card) => card.baseId === "absent_student")).toBe(true);
  expect(result.absent_student.opponentBoard.some((card) => card.type === "teacher")).toBe(true);
  expect(result.strict_lateness_teacher.hand).toEqual(expect.arrayContaining([
    "strict_lateness_teacher", "absent_student"
  ]));
  expect(result.strict_lateness_teacher.playerBoard.some((card) => card.baseId === "lazy_student")).toBe(true);
  expect(result.strict_lateness_teacher.opponentBoard.some((card) => card.baseId === "lazy_student")).toBe(true);
  expect(result.strict_lateness_teacher.late).toContain("cancel_student");
  expect(result.strict_lateness_teacher.opponentLate).toContain("eaten_student");
  expect(result.scout_student.opponentBoard).toHaveLength(0);
  expect(result.scout_student.superCheerful).toBe(true);
  expect(result.happy_blue_bird.playerBoard.filter((card) => card.baseId === "happy_blue_bird")).toHaveLength(1);
  expect(result.happy_blue_bird.opponentBoard).toEqual([
    expect.objectContaining({ baseId: "general_student", hp: 1 })
  ]);
  expect(result.suit_student.effectiveCost).toBe(6);
  expect(result.suit_student.rulesText).toContain("出席数：2人");
  expect(result.suit_student.hand.filter((baseId) => baseId === "suit_student")).toHaveLength(2);
  expect(result.suit_student.playerBoard.some((card) => card.baseId === "suit_student")).toBe(true);
  expect(result.suit_student.opponentBoard.some((card) => card.baseId === "suit_student")).toBe(true);
  expect(result.bust_suit.playerBoard.some((card) => card.baseId === "general_student")).toBe(true);
  expect(result.bust_suit.opponentBoard.some((card) => card.type === "student")).toBe(true);
  expect(result.intern.playerBoard.filter((card) => card.type === "student").length).toBeGreaterThanOrEqual(2);
  expect(result.intern.opponentBoard.filter((card) => card.type === "student").length).toBeGreaterThanOrEqual(2);
  expect(result.king_ghidorah_bed.maxWill).toBe(15);
  expect(result.king_ghidorah_bed.effectiveCost).toBe(8);
  expect(result.king_ghidorah_bed.hand.filter((baseId) => baseId === "king_ghidorah_bed")).toHaveLength(2);
  expect(result.king_ghidorah_bed.hand).toContain("general_student");
  expect(result.king_ghidorah_bed.opponentBoard.length).toBeGreaterThan(0);
  expect(result.quick_quiz_tournament.hand).toContain("general_student");
  expect(result.quick_quiz_tournament.playerBoard).toHaveLength(8);
  expect(result.quick_quiz_tournament.playerBoard.every((card) => card.type === "student")).toBe(true);
  ["tsurai_nara", "company_one_day", "enough_to_fly", "ii_daro_tte"].forEach((baseId) => {
    expect(result[baseId].hand).toEqual(expect.arrayContaining([
      "yuta", "tsurai_nara", "company_one_day", "enough_to_fly", "ii_daro_tte"
    ]));
    expect(result[baseId].rulesText).toBe("融合\n「U太」に融合する。");
  });
  expect(result.philosophy_cheating.opponentHand.filter((baseId) => ["ruler", "bento"].includes(baseId))).toHaveLength(2);
  expect(result.big_laughter.playerBoard.length).toBeGreaterThanOrEqual(4);
  expect(result.lie_pekora.playerBoard).toHaveLength(result.lie_pekora.opponentBoard.length);
  expect(result.big_wall.playerBoard.filter((card) => ["aggro_student", "general_student"].includes(card.baseId)).length).toBeGreaterThanOrEqual(2);
  expect(result.forbidden_book.life).toBeLessThanOrEqual(10);
  expect(result.think_so.deck).toContain("yuta");
  expect(result.illegal_cafeteria.hand).toContain("classroom");
  expect(result.illegal_cafeteria.playerBoard.some((card) => card.type === "vampire" && card.hp === 1)).toBe(true);
  expect(result.illegal_cafeteria.opponentBoard.some((card) => card.type === "vampire" && card.hp < 10)).toBe(true);
  expect(result.namen_tenno.opponentBoard.filter((card) => card.type === "vampire")).toHaveLength(3);
  expect(result.course_registration_party.playerDeckSize).toBeGreaterThanOrEqual(5);
  expect(result.course_registration_party.opponentDeckSize).toBeGreaterThanOrEqual(5);
});

test("融合カードの確認から融合可能なU太だけを選んで融合する", async ({ page }) => {
  await page.goto(gameUrl);

  const targetIds = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("tsurai_nara");
    const item = api.state.players.player.hand.find((card) => card.baseId === "tsurai_nara");
    const emptyTarget = api.fusionEligibleUtasInHand("player", item)[0];
    const partialTarget = api.createCardFromBase("yuta", "player");
    partialTarget.utaFusionMaterials = [
      { baseId: "enough_to_fly", name: "飛ぶくらい" },
      { baseId: "company_one_day", name: "会社１日" }
    ];
    api.state.players.player.hand.push(partialTarget);
    api.render();
    api.showBattleCardPreview(item);
    return { emptyTargetId: emptyTarget.instanceId, partialTargetId: partialTarget.instanceId };
  });

  const preview = page.locator("#battleCardPreview");
  const fusionButton = preview.locator('[data-preview-uta-fusion="true"]');
  await expect(fusionButton).toBeVisible();
  await expect(fusionButton).toBeEnabled();
  await expect(fusionButton).toHaveText("融合する");
  await fusionButton.click();

  const choiceStage = page.locator("#threeGesturesStage");
  await expect(choiceStage).toBeVisible();
  await expect(page.locator("#threeGesturesTitle")).toContainText("辛いならの融合先");
  await expect(page.locator("#threeGesturesMessage")).toContainText("融合させる手札の「U太」");
  const candidates = page.locator("#threeGesturesHand .mulligan-card");
  await expect(candidates).toHaveCount(2);
  const emptyTarget = page.locator(`#threeGesturesHand .uta-fusion-choice-option:has([data-card-id="${targetIds.emptyTargetId}"])`);
  const partialTarget = page.locator(`#threeGesturesHand .uta-fusion-choice-option:has([data-card-id="${targetIds.partialTargetId}"])`);
  await expect(emptyTarget.locator(".card-name")).toHaveText("U太");
  await expect(emptyTarget.locator(".uta-fusion-choice-status")).toBeVisible();
  await expect(emptyTarget.locator(".uta-fusion-choice-status")).toHaveText("融合済み：なし");
  await expect(partialTarget.locator(".card-name")).toHaveText("U太");
  await expect(partialTarget.locator(".uta-fusion-choice-status")).toBeVisible();
  await expect(partialTarget.locator(".uta-fusion-choice-status")).toHaveCSS("white-space", "pre-line");
  expect(await partialTarget.locator(".uta-fusion-choice-status").textContent()).toBe("融合済み：\n会社１日\n飛ぶくらい");
  await expect(page.locator("#threeGesturesHand .mulligan-card .card-name")).toHaveText(["U太", "U太"]);

  const confirmButton = page.locator("#threeGesturesConfirmButton");
  await expect(confirmButton).toHaveText("このU太に融合する");
  await expect(confirmButton).toBeDisabled();
  await partialTarget.locator(".mulligan-card").click();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  const result = await page.evaluate(({ targetId }) => {
    const api = window.__chibattle;
    const target = api.state.players.player.hand.find((card) => card.instanceId === targetId);
    return {
      materialStillInHand: api.state.players.player.hand.some((card) => card.baseId === "tsurai_nara"),
      fusedMaterials: api.utaFusionMaterialEntries(target).map((entry) => entry.baseId),
      pendingChoice: api.state.pendingCardChoice
    };
  }, { targetId: targetIds.partialTargetId });
  expect(result.materialStillInHand).toBe(false);
  expect(result.fusedMaterials).toEqual(["tsurai_nara", "company_one_day", "enough_to_fly"]);
  expect(result.pendingChoice).toBeNull();
  await expect(choiceStage).toBeHidden();
});

test("定規の確認から融合するもう1枚を選んで融合する", async ({ page }) => {
  await page.goto(gameUrl);

  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("ruler");
    const rulers = api.state.players.player.hand.filter((card) => card.baseId === "ruler");
    const extraRuler = api.createCardFromBase("ruler", "player");
    api.state.players.player.hand.push(extraRuler, api.createCardFromBase("general_student", "player"));
    api.render();
    api.showBattleCardPreview(rulers[0]);
    return {
      sourceId: rulers[0].instanceId,
      unchosenId: rulers[1].instanceId,
      chosenId: extraRuler.instanceId
    };
  });

  const fusionButton = page.locator('#battleCardPreview [data-preview-ruler-fuse="true"]');
  await expect(fusionButton).toBeVisible();
  await expect(fusionButton).toBeEnabled();
  await expect(fusionButton).toHaveText("融合する");
  await fusionButton.click();

  const choiceStage = page.locator("#threeGesturesStage");
  await expect(choiceStage).toBeVisible();
  await expect(page.locator("#threeGesturesTitle")).toHaveText("定規の融合先");
  await expect(page.locator("#threeGesturesMessage")).toContainText("融合するもう1枚の「定規」");
  const candidates = page.locator("#threeGesturesHand .mulligan-card");
  await expect(candidates).toHaveCount(2);
  await expect(page.locator("#threeGesturesHand .mulligan-card .card-name")).toHaveText(["定規", "定規"]);
  await expect(page.locator("#threeGesturesHand")).not.toContainText("一般学生");

  const chosen = page.locator(`#threeGesturesHand .mulligan-card[data-card-id="${ids.chosenId}"]`);
  const confirmButton = page.locator("#threeGesturesConfirmButton");
  await expect(confirmButton).toHaveText("この定規と融合する");
  await expect(confirmButton).toBeDisabled();
  await chosen.click();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  const result = await page.evaluate(({ ids }) => {
    const api = window.__chibattle;
    return {
      handIds: api.state.players.player.hand.map((card) => card.instanceId),
      handBaseIds: api.state.players.player.hand.map((card) => card.baseId),
      trashIds: api.state.players.player.trash.map((card) => card.instanceId),
      pendingChoice: api.state.pendingCardChoice
    };
  }, { ids });
  expect(result.handIds).toContain(ids.unchosenId);
  expect(result.handIds).not.toContain(ids.sourceId);
  expect(result.handIds).not.toContain(ids.chosenId);
  expect(result.handBaseIds).toContain("double_diamond");
  expect(result.trashIds).toEqual(expect.arrayContaining([ids.sourceId, ids.chosenId]));
  expect(result.trashIds).not.toContain(ids.unchosenId);
  expect(result.pendingChoice).toBeNull();
  await expect(choiceStage).toBeHidden();
});

test("手札の定規をもう1枚の定規へドラッグして融合する", async ({ page }) => {
  await page.goto(gameUrl);

  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("ruler");
    const rulers = api.state.players.player.hand.filter((card) => card.baseId === "ruler");
    api.render();
    return {
      sourceId: rulers[0].instanceId,
      targetId: rulers[1].instanceId,
      eligibleIds: api.handFusionEligibleTargets("player", rulers[0]).map((card) => card.instanceId),
      fusionType: api.handFusionType("player", rulers[0], rulers[1])
    };
  });

  expect(ids.eligibleIds).toEqual([ids.targetId]);
  expect(ids.fusionType).toBe("ruler");

  const source = page.locator(`.player-hand .hand-card[data-card-id="${ids.sourceId}"]`);
  const target = page.locator(`.player-hand .hand-card[data-card-id="${ids.targetId}"]`);
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await source.dispatchEvent("pointerdown", {
    pointerId: 7,
    pointerType: "touch",
    button: 0,
    buttons: 1,
    clientX: sourceBox.x + 8,
    clientY: sourceBox.y + sourceBox.height / 2
  });
  await source.dispatchEvent("pointermove", {
    pointerId: 7,
    pointerType: "touch",
    buttons: 1,
    clientX: sourceBox.x + 22,
    clientY: sourceBox.y + sourceBox.height / 2
  });
  await expect(target).toHaveClass(/drop-ready/);
  await source.dispatchEvent("pointercancel", {
    pointerId: 7,
    pointerType: "touch",
    buttons: 0,
  });

  const fused = await page.evaluate(({ sourceId, targetId }) => (
    window.__chibattle.performHandFusionDrop(sourceId, targetId)
  ), ids);
  expect(fused).toBe(true);

  const result = await page.evaluate(({ sourceId, targetId }) => {
    const api = window.__chibattle;
    return {
      handBaseIds: api.state.players.player.hand.map((card) => card.baseId),
      handIds: api.state.players.player.hand.map((card) => card.instanceId),
      trashIds: api.state.players.player.trash.map((card) => card.instanceId)
    };
  }, ids);

  expect(result.handBaseIds).toContain("double_diamond");
  expect(result.handIds).not.toContain(ids.sourceId);
  expect(result.handIds).not.toContain(ids.targetId);
  expect(result.trashIds).toEqual(expect.arrayContaining([ids.sourceId, ids.targetId]));
});

test("4種類をU太へ1枚ずつ融合し、Ultimate U太の文言を残したまま勝利する", async ({ page }) => {
  await page.goto(gameUrl);

  const fusion = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.currentSide = "player";
    state.gameOver = false;
    state.aiThinking = false;
    state.actionTurn = 1;
    state.players.player.will = 10;
    state.players.player.maxWill = 10;
    state.players.player.trash = [];
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    const yuta = api.createCardFromBase("yuta", "player");
    const materials = [...api.UTA_FUSION_MATERIAL_IDS].reverse()
      .map((baseId) => api.createCardFromBase(baseId, "player"));
    state.players.player.hand = [yuta, ...materials];
    const steps = materials.map((item) => {
      const target = state.players.player.hand.find((card) => card.instanceId === yuta.instanceId);
      const used = api.castUtaFusion("player", item, target, false);
      const current = state.players.player.hand.find((card) => card.instanceId === yuta.instanceId);
      return {
        used,
        baseId: current?.baseId,
        materials: api.utaFusionMaterialEntries(current).map((entry) => entry.baseId),
        rules: api.cardRulesText(current)
      };
    });
    const ultimate = state.players.player.hand.find((card) => card.instanceId === yuta.instanceId);
    const detail = api.battleCardCurrentEffectsTemplate(ultimate);
    const trash = state.players.player.trash.map((card) => card.baseId);
    api.placeCardFromHand("player", ultimate.instanceId, "seat", "player", 0, true);
    return {
      steps,
      ultimate: {
        baseId: ultimate.baseId,
        name: ultimate.name,
        noCost: ultimate.noCost,
        attack: ultimate.attack,
        hp: ultimate.hp,
        rules: api.cardRulesText(ultimate),
        detailMarkup: detail.markup,
        fusionOrder: api.utaFusionMaterialEntries(ultimate).map((entry) => entry.baseId)
      },
      trash,
      phaseAfterAttendance: state.phase
    };
  });

  expect(fusion.steps.map((step) => step.used)).toEqual([true, true, true, true]);
  expect(fusion.steps.slice(0, 3).every((step) => step.baseId === "yuta")).toBe(true);
  expect(fusion.steps[3].baseId).toBe("ultimate_yuta");
  expect(fusion.ultimate).toEqual(expect.objectContaining({
    baseId: "ultimate_yuta",
    name: "Ultimate U太",
    noCost: true,
    attack: 13,
    hp: 13
  }));
  expect(fusion.ultimate.fusionOrder).toEqual([
    "tsurai_nara", "company_one_day", "enough_to_fly", "ii_daro_tte"
  ]);
  expect(fusion.ultimate.rules).toContain("融合済み：\n辛いなら\n会社１日\n飛ぶくらい\nいいだろって");
  expect(fusion.ultimate.rules).not.toContain("辛いなら、会社１日");
  ["辛いなら", "会社１日", "飛ぶくらい", "いいだろって"].forEach((name) => {
    expect(fusion.ultimate.rules).toContain(name);
    expect(fusion.ultimate.detailMarkup).toContain(name);
  });
  expect(fusion.ultimate.rules).not.toContain("融合：「U太」");
  expect(fusion.trash).toEqual([]);
  expect(fusion.phaseAfterAttendance).toBe("ultimateVictory");

  const expectAtScreenPosition = async (locator, horizontalRatio) => {
    const box = await locator.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(Math.abs(box.x + box.width / 2 - viewport.width * horizontalRatio)).toBeLessThan(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(2);
  };
  const tsurai = page.locator('[data-ultimate-phrase="tsurai_nara"]');
  const company = page.locator('[data-ultimate-phrase="company_one_day"]');
  const fly = page.locator('[data-ultimate-phrase="enough_to_fly"]');
  const iiDaro = page.locator('[data-ultimate-phrase="ii_daro_tte"]');

  await expect(tsurai).toHaveClass(/active/, { timeout: 2200 });
  await expectAtScreenPosition(tsurai, 0.5);
  await expect(company).toHaveClass(/active/, { timeout: 1400 });
  await expectAtScreenPosition(company, 0.25);
  await expect(page.locator('[data-ultimate-phrase="tsurai_nara"]')).not.toHaveClass(/active/);
  await expect(fly).toHaveClass(/active/, { timeout: 1400 });
  await expectAtScreenPosition(fly, 0.75);
  await expect(iiDaro).toHaveClass(/active/, { timeout: 1400 });
  await expectAtScreenPosition(iiDaro, 0.5);
  await expect(page.locator("#ultimateYutaOverlay")).toHaveClass(/all-visible/, { timeout: 1400 });
  await expect(page.locator("#ultimateYutaOverlay [data-ultimate-phrase]")).toHaveText([
    "いいだろって", "飛ぶくらい", "会社１日", "辛いなら"
  ]);
  const finalFooter = page.locator("#ultimateYutaOverlay .ultimate-yuta-footer");
  await expect(finalFooter).toHaveText("思ってまう");
  await expect(finalFooter).toHaveCSS("writing-mode", "vertical-rl");
  await expect(finalFooter).toHaveCSS("white-space", "nowrap");
  const victoryTypography = await page.locator("#ultimateYutaOverlay .ultimate-yuta-footer, #ultimateYutaOverlay [data-ultimate-phrase]").evaluateAll((columns) => (
    columns.map((column) => {
      const style = getComputedStyle(column);
      return {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        strokeWidth: style.webkitTextStrokeWidth
      };
    })
  ));
  expect(victoryTypography).toHaveLength(5);
  expect(victoryTypography.every(({ fontFamily }) => fontFamily.includes("YuKyokasho"))).toBe(true);
  expect(victoryTypography.every(({ fontWeight }) => Number(fontWeight) >= 900)).toBe(true);
  expect(victoryTypography.every(({ strokeWidth }) => Number.parseFloat(strokeWidth) > 0)).toBe(true);
  expect(await page.locator("#ultimateYutaOverlay [data-ultimate-phrase]").evaluateAll((phrases) => (
    phrases.every((phrase) => getComputedStyle(phrase).whiteSpace === "nowrap")
  ))).toBe(true);
  const finalFlyBox = await fly.boundingBox();
  expect(Math.abs(finalFlyBox.x + finalFlyBox.width / 2 - page.viewportSize().width / 2)).toBeLessThan(2);
  const finalColumnCenters = await page.locator("#ultimateYutaOverlay .ultimate-yuta-footer, #ultimateYutaOverlay [data-ultimate-phrase]").evaluateAll((columns) => (
    columns.map((column) => {
      const rect = column.getBoundingClientRect();
      return rect.left + rect.width / 2;
    })
  ));
  expect(finalColumnCenters).toEqual([...finalColumnCenters].sort((a, b) => a - b));
  await expect(page.locator("#resultOverlay")).toHaveClass(/victory/, { timeout: 2000 });
  await expect(page.locator("#ultimateYutaOverlay")).toHaveClass(/all-visible/);
  await expect(page.locator("#ultimateYutaOverlay")).not.toHaveClass(/hidden/);
});

test("早押しクイズ大会は通常ビンゴを再成立でも発動し、8ビンゴ追加効果は各1回にする", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const card = (baseId, owner = "player") => api.createCardFromBase(baseId, owner);
    const attendee = (baseId = "general_student", owner = "player") => api.makeBoardCard(card(baseId, owner));
    const fillDeck = (side, count = 12) => {
      state.players[side].deck = Array.from({ length: count }, () => card("general_student", side));
    };
    const reset = () => {
      state.screen = "battle";
      state.phase = "battle";
      state.gameOver = false;
      state.actionTurn = 1;
      state.environment = api.makeBoardCard(card("quick_quiz_tournament"));
      ["player", "opponent"].forEach((side) => {
        state.players[side].hand = [];
        state.players[side].trash = [];
        state.players[side].board.seats = Array(9).fill(null);
        state.players[side].board.teacher = null;
        fillDeck(side);
      });
    };

    reset();
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((index) => {
      state.players.player.board.seats[index] = attendee();
    });
    const firstCenter = attendee();
    api.attendCard("player", firstCenter, "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const firstEightBingo = {
      attack: firstCenter.attack,
      hp: firstCenter.maxHp,
      currentHp: firstCenter.currentHp,
      drawn: state.players.player.hand.length,
      completeLines: api.completeQuickQuizBingoLines("player").length
    };

    state.players.player.board.seats[4] = null;
    state.players.player.hand = [];
    fillDeck("player");
    const secondCenter = attendee();
    api.attendCard("player", secondCenter, "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const reformedEightBingo = {
      attack: secondCenter.attack,
      hp: secondCenter.maxHp,
      drawn: state.players.player.hand.length
    };

    reset();
    state.players.opponent.board.seats[0] = attendee("general_student", "opponent");
    state.players.opponent.board.seats[1] = attendee("general_student", "opponent");
    const opponentAchiever = attendee("general_student", "opponent");
    api.attendCard("opponent", opponentAchiever, "seat", 2, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const opponentHorizontal = {
      attack: opponentAchiever.attack,
      hp: opponentAchiever.maxHp,
      drawn: state.players.opponent.hand.length
    };

    reset();
    state.players.player.board.seats[0] = attendee();
    state.players.player.board.seats[1] = attendee();
    const teacher = attendee("general_teacher");
    api.attendCard("player", teacher, "teacher", null, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const teacherExcluded = {
      attack: teacher.attack,
      hp: teacher.maxHp,
      completeLines: api.completeQuickQuizBingoLines("player").length,
      drawn: state.players.player.hand.length
    };

    return { firstEightBingo, reformedEightBingo, opponentHorizontal, teacherExcluded };
  });

  expect(result.firstEightBingo).toEqual({ attack: 6, hp: 6, currentHp: 6, drawn: 5, completeLines: 8 });
  expect(result.reformedEightBingo).toEqual({ attack: 3, hp: 3, drawn: 2 });
  expect(result.opponentHorizontal).toEqual({ attack: 2, hp: 3, drawn: 0 });
  expect(result.teacherExcluded).toEqual({ attack: 1, hp: 2, completeLines: 0, drawn: 0 });
});

test("エキストラの皆さんは左上から1人ずつ出席し、その都度ビンゴを解決する", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const { state } = api;
    const card = (baseId) => api.createCardFromBase(baseId, "player");
    state.screen = "battle";
    state.phase = "battle";
    state.gameOver = false;
    state.actionTurn = 1;
    state.environment = api.makeBoardCard(card("quick_quiz_tournament"));
    state.players.player.hand = [];
    state.players.player.deck = Array.from({ length: 12 }, () => card("general_student"));
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;

    const progress = [];
    const statsDuringAttendance = [];
    let previousCount = -1;
    const sample = () => {
      const occupied = state.players.player.board.seats
        .map((entry, index) => (entry ? index : null))
        .filter((index) => index !== null);
      if (occupied.length === previousCount) return;
      previousCount = occupied.length;
      progress.push(occupied);
      statsDuringAttendance.push(state.players.player.board.seats.filter(Boolean).map((entry) => ({
        attack: entry.attack, hp: entry.maxHp
      })));
    };
    sample();
    const sampler = window.setInterval(sample, 25);
    const extraPeople = api.makeBoardCard(card("extra_people"));
    api.attendCard("player", extraPeople, "teacher", null, {
      attendanceSource: api.ATTENDANCE_SOURCE.HAND
    });
    api.render();
    await api.waitForOrderedAttendance();
    sample();
    window.clearInterval(sampler);

    return {
      progress,
      statsDuringAttendance,
      resolving: state.resolvingOrderedAttendance,
      stats: state.players.player.board.seats.map((entry) => ({
        attack: entry.attack,
        hp: entry.maxHp
      })),
      drawn: state.players.player.hand.length,
      sourceStats: { attack: extraPeople.attack, hp: extraPeople.maxHp }
    };
  });

  expect(result.progress).toEqual(Array.from({ length: 10 }, (_entry, count) => (
    Array.from({ length: count }, (_seat, index) => index)
  )));
  expect(result.resolving).toBe(false);
  expect(result.statsDuringAttendance.flat().every((entry) => entry.attack === 1 && entry.hp === 1)).toBe(true);
  expect(result.stats[2]).toEqual({ attack: 1, hp: 2 });
  expect(result.stats[5]).toEqual({ attack: 1, hp: 2 });
  expect(result.stats[6]).toEqual({ attack: 2, hp: 1 });
  expect(result.stats[7]).toEqual({ attack: 2, hp: 1 });
  expect(result.stats[8]).toEqual({ attack: 5, hp: 5 });
  expect(result.drawn).toBe(5);
  expect(result.sourceStats).toEqual({ attack: 2, hp: 2 });
});

test("早押しクイズ大会はカード演出後にカチッ演出、強化、8ビンゴを順に出す", async ({ page }) => {
  await page.goto(gameUrl);

  const achieverId = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const card = (baseId) => api.createCardFromBase(baseId, "player");
    state.screen = "battle";
    state.phase = "battle";
    state.gameOver = false;
    state.actionTurn = 1;
    state.environment = api.makeBoardCard(card("quick_quiz_tournament"));
    state.players.player.hand = [];
    state.players.player.deck = Array.from({ length: 8 }, () => card("general_student"));
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    [0, 1, 2, 3, 5, 6, 7, 8].forEach((index) => {
      state.players.player.board.seats[index] = api.makeBoardCard(card("general_student"));
    });
    api.render();
    const achiever = api.makeBoardCard(card("general_student"));
    api.showCardPlayAnimation(achiever, "board");
    api.attendCard("player", achiever, "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    api.render();
    return achiever.instanceId;
  });

  const achiever = page.locator(`[data-card-id="${achieverId}"]`);
  await expect(page.locator("#playRevealOverlay")).not.toHaveClass(/hidden/);
  await expect(page.locator(".quick-quiz-click-effect")).toHaveCount(0);
  await expect(achiever.locator(".board-change-effect.buff")).toHaveCount(0);
  await expect(page.locator("#turnOverlay")).not.toHaveText("BINGO!!");

  await expect(page.locator(".quick-quiz-click-effect").first()).toBeVisible({ timeout: 2000 });
  await expect(page.locator("#playRevealOverlay")).toHaveClass(/hidden/);
  await expect(achiever.locator(".board-change-effect.buff")).toBeVisible({ timeout: 700 });
  await expect(achiever.locator(".board-change-feedback")).toHaveAttribute("aria-label", /ビンゴ強化/);
  await expect(page.locator("#turnOverlay")).toHaveText("BINGO!!", { timeout: 1000 });
  await expect(page.locator("#turnOverlay")).toHaveClass(/bingo-announcement/);
  await expect(page.locator("#turnOverlay")).toHaveClass(/show/);
});

test("早押しクイズ大会の通常ビンゴは成立した3枚だけにカチッ演出を出す", async ({ page }) => {
  await page.goto(gameUrl);

  const ids = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const card = (baseId) => api.createCardFromBase(baseId, "player");
    state.screen = "battle";
    state.phase = "battle";
    state.gameOver = false;
    state.actionTurn = 1;
    state.environment = api.makeBoardCard(card("quick_quiz_tournament"));
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    [0, 1].forEach((index) => {
      state.players.player.board.seats[index] = api.makeBoardCard(card("general_student"));
    });
    api.render();
    const achiever = api.makeBoardCard(card("general_student"));
    api.showCardPlayAnimation(achiever, "board");
    api.attendCard("player", achiever, "seat", 2, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    api.render();
    return state.players.player.board.seats.slice(0, 3).map((entry) => entry.instanceId);
  });

  await expect(page.locator(".quick-quiz-click-effect")).toHaveCount(0);
  await expect(page.locator(".quick-quiz-click-effect")).toHaveCount(3, { timeout: 2000 });
  for (const instanceId of ids) {
    await expect(page.locator(`[data-card-id="${instanceId}"] > .quick-quiz-click-effect`)).toBeVisible();
  }
  await expect(page.locator("#turnOverlay")).not.toHaveText("BINGO!!");
});

test("TA隊長は手札から2行目へ出席した場合だけ残りの空きマスへTAを出席させる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(async () => {
    const api = window.__chibattle;
    const { state } = api;
    const reset = () => {
      state.screen = "battle";
      state.phase = "battle";
      state.gameOver = false;
      state.actionTurn = 1;
      state.players.player.board.seats = Array(9).fill(null);
      state.players.player.board.teacher = null;
      state.players.opponent.board.seats = Array(9).fill(null);
      state.players.opponent.board.teacher = null;
    };
    const squad = () => api.makeBoardCard(api.createCardFromBase("ta_squad", "player"));

    reset();
    const placementCard = api.createCardFromBase("ta_squad", "player");
    const placement = {
      secondRow: api.canPlaceCard("player", placementCard, "seat", "player", 4),
      firstRow: api.canPlaceCard("player", placementCard, "seat", "player", 1),
      teacher: api.canPlaceCard("player", placementCard, "teacher", "player", null)
    };

    api.attendCard("player", squad(), "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    await api.waitForOrderedAttendance();
    const handAttendance = state.players.player.board.seats.map((card) => card?.baseId || null);
    const sources = state.players.player.board.seats.map((card) => card?.lastAttendanceSource || null);

    reset();
    api.attendCard("player", squad(), "seat", 4, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    const effectAttendance = state.players.player.board.seats.map((card) => card?.baseId || null);

    return {
      placement,
      cardName: placementCard.name,
      rules: api.cardRulesText(placementCard),
      handAttendance,
      sources,
      effectAttendance
    };
  });

  expect(result.placement).toEqual({ secondRow: true, firstRow: false, teacher: false });
  expect(result.cardName).toBe("TA隊長");
  expect(result.rules).toContain("「TA」を1人ずつ出席させる");
  expect(result.handAttendance.slice(3, 6)).toEqual(["ta", "ta_squad", "ta"]);
  expect(result.handAttendance.filter((baseId) => baseId === "ta")).toHaveLength(2);
  expect(result.handAttendance.filter((baseId) => baseId === "ta_squad")).toHaveLength(1);
  expect(result.sources.slice(3, 6)).toEqual(["generated", "hand", "generated"]);
  expect(result.effectAttendance.filter((baseId) => baseId === "ta_squad")).toHaveLength(1);
  expect(result.effectAttendance.filter((baseId) => baseId === "ta")).toHaveLength(0);
});

test("幸せの青い鳥は本体を攻撃せず、攻撃で倒した位置へ相手所有の基本5/5を出席させる", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    const reset = () => {
      state.phase = "battle";
      state.currentSide = "player";
      state.gameOver = false;
      state.testMode = true;
      state.actionTurn = 2;
      state.noAttackUntilActionTurn = 0;
      state.players.player.turnsTaken = 2;
      state.players.opponent.turnsTaken = 1;
      state.players.player.board.seats = Array(9).fill(null);
      state.players.player.board.teacher = null;
      state.players.player.trash = [];
      state.players.opponent.board.seats = Array(9).fill(null);
      state.players.opponent.board.teacher = null;
      state.players.opponent.trash = [];
    };
    const bird = (owner = "player") => {
      const card = api.makeBoardCard(api.createCardFromBase("happy_blue_bird", owner));
      card.playedOnTurn = 0;
      return card;
    };
    const weakStudent = () => {
      const card = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
      card.playedOnTurn = 0;
      card.currentHp = 1;
      return card;
    };

    reset();
    const automaticBird = bird();
    state.players.player.board.seats[0] = automaticBird;
    state.players.opponent.board.seats[4] = weakStudent();
    state.selectedAttacker = { owner: "player", zone: "seat", index: 0 };
    const canAttackLife = api.canSelectedAttackerTargetLife("opponent");
    state.selectedAttacker = null;
    api.resolveHappyBlueBirdEndTurnAttacks("player");
    const automaticSpawn = state.players.opponent.board.seats[4];
    const automaticTrash = state.players.opponent.trash.map((card) => card.baseId);

    reset();
    const manualBird = bird();
    state.players.player.board.seats[0] = manualBird;
    state.players.opponent.board.teacher = weakStudent();
    const manualResult = api.resolveCardAttackWithBoardCleanup(manualBird, {
      owner: "opponent",
      zone: "teacher",
      index: null
    });
    const manualSpawn = state.players.opponent.board.teacher;

    reset();
    const nonLethalBird = bird();
    state.players.player.board.seats[0] = nonLethalBird;
    const durableTarget = api.makeBoardCard(api.createCardFromBase("loud_student", "opponent"));
    durableTarget.playedOnTurn = 0;
    state.players.opponent.board.seats[4] = durableTarget;
    const nonLethalResult = api.resolveCardAttackWithBoardCleanup(nonLethalBird, {
      owner: "opponent",
      zone: "seat",
      index: 4
    });
    const nonLethalTarget = state.players.opponent.board.seats[4];

    reset();
    const spentBird = bird();
    spentBird.hasAttacked = true;
    state.players.player.board.seats[0] = spentBird;
    state.players.opponent.board.seats[4] = weakStudent();
    api.resolveHappyBlueBirdEndTurnAttacks("player");

    return {
      canAttackLife,
      automatic: {
        attackerHasAttacked: automaticBird.hasAttacked,
        baseId: automaticSpawn?.baseId,
        owner: automaticSpawn?.owner,
        attack: automaticSpawn?.attack,
        hp: automaticSpawn?.currentHp,
        opponentTrash: automaticTrash
      },
      manual: {
        result: manualResult,
        baseId: manualSpawn?.baseId,
        owner: manualSpawn?.owner,
        attack: manualSpawn?.attack,
        hp: manualSpawn?.currentHp
      },
      nonLethal: {
        result: nonLethalResult,
        baseId: nonLethalTarget?.baseId,
        hp: nonLethalTarget?.currentHp
      },
      spentTarget: state.players.opponent.board.seats[4]?.baseId
    };
  });

  expect(result.canAttackLife).toBe(false);
  expect(result.automatic).toMatchObject({
    attackerHasAttacked: true,
    baseId: "happy_blue_bird",
    owner: "opponent",
    attack: 5,
    hp: 5,
    opponentTrash: ["general_student"]
  });
  expect(result.manual).toMatchObject({
    result: { targetDefeated: true, birdSummoned: true },
    baseId: "happy_blue_bird",
    owner: "opponent",
    attack: 5,
    hp: 5
  });
  expect(result.nonLethal).toMatchObject({
    result: { targetDefeated: false, birdSummoned: false },
    baseId: "loud_student",
    hp: 4
  });
  expect(result.spentTarget).toBe("general_student");
});

test("スーツを着た学生は出席元と再出席を数えて戦意が下がり、教師のダメージを受けない", async ({ page }) => {
  await page.goto(gameUrl);

  const result = await page.evaluate(() => {
    const api = window.__chibattle;
    const { state } = api;
    state.screen = "battle";
    state.phase = "battle";
    state.actionTurn = 2;
    state.suitStudentAttendanceCount = 0;
    state.players.player.board.seats = Array(9).fill(null);
    state.players.player.board.teacher = null;
    state.players.opponent.board.seats = Array(9).fill(null);
    state.players.opponent.board.teacher = null;

    const discounted = api.createCardFromBase("suit_student", "player");
    const costs = [api.effectiveCardCost(discounted)];
    const sameCard = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    api.attendCard("player", sameCard, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.HAND });
    costs.push(api.effectiveCardCost(discounted));

    state.players.player.board.seats[0] = null;
    api.attendCard("player", sameCard, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.EFFECT });
    costs.push(api.effectiveCardCost(discounted));

    const fromDeck = api.makeBoardCard(api.createCardFromBase("suit_student", "opponent"));
    api.attendCard("opponent", fromDeck, "seat", 0, { attendanceSource: api.ATTENDANCE_SOURCE.DECK });
    costs.push(api.effectiveCardCost(discounted));

    const fromLate = api.makeBoardCard(api.createCardFromBase("suit_student", "opponent"));
    api.attendCard("opponent", fromLate, "seat", 1, { attendanceSource: api.ATTENDANCE_SOURCE.LATE });
    costs.push(api.effectiveCardCost(discounted));

    const trackedCount = state.suitStudentAttendanceCount;
    const dynamicText = api.cardRulesText(discounted);
    state.suitStudentAttendanceCount = 20;
    const minimumCost = api.effectiveCardCost(discounted);

    const teacher = api.makeBoardCard(api.createCardFromBase("general_teacher", "opponent"));
    const attackTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const attackDamage = api.dealDamageToCard(attackTarget, 9, teacher, { combat: true });
    const attackHp = attackTarget.currentHp;

    const lectureTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const lecturePreview = api.previewFinalDamageToCard(lectureTarget, 9, teacher, { damageKind: "lecture" });
    const lectureDamage = api.dealDamageToCard(lectureTarget, 9, teacher, { damageKind: "lecture" });
    const lectureHp = lectureTarget.currentHp;

    const student = api.makeBoardCard(api.createCardFromBase("general_student", "opponent"));
    const studentTarget = api.makeBoardCard(api.createCardFromBase("suit_student", "player"));
    const studentDamage = api.dealDamageToCard(studentTarget, 1, student, { combat: true });

    return {
      costs,
      count: trackedCount,
      dynamicText,
      minimumCost,
      attackDamage,
      attackHp,
      lecturePreview,
      lectureDamage,
      lectureHp,
      studentDamage,
      studentHp: studentTarget.currentHp
    };
  });

  expect(result.costs).toEqual([8, 7, 6, 5, 4]);
  expect(result.count).toBe(4);
  expect(result.dynamicText).toContain("\n出席数：4人");
  expect(result.minimumCost).toBe(0);
  expect(result.attackDamage).toBe(0);
  expect(result.attackHp).toBe(1);
  expect(result.lecturePreview).toBe(0);
  expect(result.lectureDamage).toBe(0);
  expect(result.lectureHp).toBe(1);
  expect(result.studentDamage).toBe(1);
  expect(result.studentHp).toBe(0);
});
