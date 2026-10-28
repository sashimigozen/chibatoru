const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const gameUrl = pathToFileURL(path.join(__dirname, "..", "index.html")).href;

async function prepareEffectState(page) {
  await page.goto(gameUrl);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.startCardTest("abyss");
    api.state.environment = null;
    api.state.courseRegistration = null;
    api.state.cafeteriaEffectUntilActionTurn = -1;
    api.state.cafeteriaEffectPermanentlyActive = false;
    api.state.illegalCafeteriaResidualTurns = 0;
    api.state.temporarySeatBlocks = [];
    api.state.deckToHandLocks = [];
    ["player", "opponent"].forEach((side) => {
      const player = api.state.players[side];
      player.board = { teacher: null, seats: Array(9).fill(null) };
      player.abyssTurns = 0;
      player.internTurnsRemaining = 0;
      player.effectUseLockTurnsRemaining = 0;
      player.crabCountdown = null;
      player.designTextbookUntilTurn = 0;
      player.handCostTaxUntilActionTurn = 0;
      player.lifeShieldUntilTurn = 0;
      player.lifeFloorShields = [];
      player.maxLifeOverride = null;
    });
    api.state.players.player.abyssTurns = 2;
    api.state.players.player.internTurnsRemaining = 2;
    api.state.players.opponent.effectUseLockTurnsRemaining = 1;
    api.render();
  });
}

test("自分と相手の継続効果を分けて表示し、詳細と残り回数を確認できる", async ({ page }) => {
  await prepareEffectState(page);

  const playerEffects = page.locator("#playerActiveEffectsButton");
  const opponentEffects = page.locator("#opponentActiveEffectsButton");
  await expect(playerEffects).toContainText("自分の継続効果");
  await expect(playerEffects).toContainText("深淵・インターン");
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("2");
  await expect(opponentEffects).toContainText("相手の継続効果");
  await expect(opponentEffects).toContainText("煩わしいなぁ");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("1");

  await playerEffects.click();
  await expect(page.locator("#battleLogDrawer")).toHaveClass(/open/);
  await expect(page.locator("#battleDrawerTitle")).toHaveText("自分の継続効果");
  await expect(page.locator("#battleDrawerInspector")).toContainText("深淵");
  await expect(page.locator("#battleDrawerInspector")).toContainText("残り2回");
  await expect(page.locator("#battleDrawerInspector")).toContainText("インターン");

  await page.locator("#battleLogCloseButton").click();
  await opponentEffects.click();
  await expect(page.locator("#battleDrawerTitle")).toHaveText("相手の継続効果");
  await expect(page.locator("#battleDrawerInspector")).toContainText("煩わしいなぁ");
  await expect(page.locator("#battleDrawerInspector")).not.toContainText("深淵");
});

test("継続効果が終了すると件数と詳細がすぐに空表示へ戻る", async ({ page }) => {
  await prepareEffectState(page);

  await page.locator("#playerActiveEffectsButton").click();
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.render();
  });

  await expect(page.locator("#playerActiveEffectsSummary")).toHaveText("現在なし");
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#battleDrawerInspector")).toContainText("継続中の効果はありません");
});

test("盤面の出席者の効果を各サイドに表示し、無効化・退場にも追従する", async ({ page }) => {
  await prepareEffectState(page);
  await page.evaluate(() => {
    state.players.player.abyssTurns = 0;
    state.players.player.internTurnsRemaining = 0;
    state.players.opponent.effectUseLockTurnsRemaining = 0;
    for (const side of ["player", "opponent"]) {
      state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    }
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase("proliferating_enemy", "opponent"));
    state.players.player.board.seats[0] = makeBoardCard(createCardFromBase("uma_bone", "player"));
    state.players.player.board.seats[1] = makeBoardCard(createCardFromBase("ttb", "player"));
    state.players.player.board.seats[2] = makeBoardCard(createCardFromBase("trpg_member", "player"));
    render();
  });
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("1");
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("2");
  await page.locator("#opponentActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("増殖する敵");
  await expect(page.locator("#battleDrawerInspector")).toContainText("出席するたび");
  await expect(page.locator("#battleDrawerInspector")).not.toContainText("ウマの骨");
  await page.locator("#battleLogCloseButton").click();
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("自分のターン終了時、自分の講義室にいる融合で生成されていない出席者を2人まで指名し、それらの体力を+1する。");
  await expect(page.locator("#battleDrawerInspector")).toContainText("TTB");
  await expect(page.locator("#battleDrawerInspector")).not.toContainText("2枚ずつ生成");
  await expect(page.locator("#battleDrawerInspector")).not.toContainText("TRPGサークルメンバー");
  await page.evaluate(() => {
    state.players.player.board.seats[0].padlockEquipment = { baseId: "padlock" };
    state.players.player.board.seats[1].generatedWithoutEffects = true;
    state.players.opponent.board.seats[0] = null;
    render();
  });
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#battleDrawerInspector")).toContainText("継続中の効果はありません");
});

test("継続効果は複数マスで重複せず、別個体は別件・教卓限定は教卓だけに表示する", async ({ page }) => {
  await prepareEffectState(page);
  const result = await page.evaluate(() => {
    for (const side of ["player", "opponent"]) state.players[side].board = { teacher: null, seats: Array(9).fill(null) };
    const p = state.players.player;
    const source = makeBoardCard(createCardFromBase("umaibo", "player"));
    source.seatAnchorIndex = 0;
    p.board.seats[0] = source; p.board.seats[1] = source;
    p.board.seats[2] = makeBoardCard(createCardFromBase("umaibo", "player"));
    p.board.seats[3] = makeBoardCard(createCardFromBase("president", "player"));
    p.board.teacher = makeBoardCard(createCardFromBase("pro_k", "player"));
    const lines = boardActiveEffectLines("player");
    const mismatches = Object.entries(BOARD_ONGOING_RULE_STARTS).filter(([id, start]) => !cardRulesText(createCardFromBase(id, "player")).includes(start));
    return { lines, mismatches };
  });
  expect(result.mismatches).toEqual([]);
  expect(result.lines).toHaveLength(3);
  expect(result.lines.filter(line => line.startsWith("ウマイボ："))).toHaveLength(2);
  expect(result.lines).toContain("プロ言の長：このカードが教卓マスにいるかぎり、自分の講義室にいる「TA」とつく出席者すべての体力を+1する。");
  expect(result.lines.join("\n")).not.toContain("手札に生成");
  expect(result.lines.join("\n")).not.toContain("学長：");
});

test("自身だけの能力は継続効果に載せず、他の出席者・本体へ作用する効果は残す", async ({ page }) => {
  await prepareEffectState(page);
  const result = await page.evaluate(() => {
    const excluded = ['scout_student', 'suit_student', 'yuta', 'dark_yuta', 'enemy_student',
      'protein_drinker', 'lone_wolf', 'cafeteria_lady', 'vampire', 'recovered_dark_yuta',
      'aiben', 'nyotei', 'trendy_student', 'rebirth_student', 'true_enemy', 'aggro_princess', 'acting_out_man'];
    const included = ['proliferating_enemy', 'variable_student',
      'umaibo', 'uma_bone', 'where_uma', 'maibo_bone', 'where_maibo', 'where_bone', 'rear_queen', 'ttb'];
    const errors = [];
    for (const side of ['player', 'opponent']) {
      const p = state.players[side];
      p.board = { teacher: null, seats: Array(9).fill(null) };
      for (const id of [...excluded, ...included]) {
        p.board.seats[0] = makeBoardCard(createCardFromBase(id, side));
        const count = boardActiveEffectLines(side).length;
        if (count !== (included.includes(id) ? 1 : 0)) errors.push(`${side}/${id}/${count}`);
      }
    }
    state.players.opponent.board.seats[0] = makeBoardCard(createCardFromBase('proliferating_enemy', 'opponent'));
    state.players.opponent.board.seats[1] = makeBoardCard(createCardFromBase('vampire', 'opponent'));
    render();
    return errors;
  });
  expect(result).toEqual([]);
  await page.locator('#opponentActiveEffectsButton').click();
  await expect(page.locator('#battleDrawerInspector')).toContainText('増殖する敵');
  await expect(page.locator('#battleDrawerInspector')).not.toContainText('CITヴァンパイア');
  await page.screenshot({ path: test.info().outputPath('external-ongoing-effects.png') });
});

test("複数能力のカードから自身だけの能力を除き、条件を満たす全体効果だけを表示する", async ({ page }) => {
  await prepareEffectState(page);
  const result = await page.evaluate(() => {
    const p = state.players.player;
    p.board = { teacher: null, seats: Array(9).fill(null) };
    p.board.seats[0] = makeBoardCard(createCardFromBase('sick_yuta', 'player'));
    p.board.seats[1] = makeBoardCard(createCardFromBase('tissue_distributor', 'player'));
    p.board.seats[6] = makeBoardCard(createCardFromBase('aggro_king', 'player'));
    const before = boardActiveEffectLines('player');
    state.environment = makeBoardCard(createCardFromBase('cafeteria', 'player'));
    const cafeteria = boardActiveEffectLines('player');
    state.environment = makeBoardCard(createCardFromBase('aggro_kingdom', 'player'));
    p.board.seats[5] = makeBoardCard(createCardFromBase('aggro_queen', 'player'));
    p.board.seats[2] = makeBoardCard(createCardFromBase('aggro_student', 'player'));
    const kingdom = boardActiveEffectLines('player');
    return { before, cafeteria, kingdom };
  });
  expect(result.before).toHaveLength(2);
  expect(result.before[0]).toContain('相手の出席者1人');
  expect(result.before[0]).not.toContain('装備できない');
  expect(result.cafeteria).toHaveLength(2);
  expect(result.before.join('\n')).toContain('ヴァンパイアすべての体力を+1');
  expect(result.before.join('\n')).not.toContain('さらに+1');
  expect(result.cafeteria.join('\n')).toContain('ヴァンパイアすべての体力をさらに+1');
  expect(result.cafeteria.join('\n')).not.toContain('戦意を-2');
  expect(result.kingdom.some(line => line.startsWith('アグロキング：') && line.includes('出席者すべて'))).toBe(true);
});

test("効果のある環境を両者の継続効果へ表示し、上書きすると入れ替わる", async ({ page }) => {
  test.setTimeout(60000);
  await prepareEffectState(page);
  const environments = await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.state.players.opponent.effectUseLockTurnsRemaining = 0;
    api.state.fullLockSeatBlocks = ["player", "opponent"].flatMap((owner) => [0, 1, 2].map((index) => ({ owner, index })));
    return Object.entries(api.CARD_BASES).filter(([, card]) => card.type === "environment" && card.name !== "一般教室" && !card.submission)
      .map(([id, card]) => ({ id, name: card.name }));
  });
  for (const environment of environments) {
    await page.evaluate((id) => {
      const api = window.__chibattle;
      api.state.environment = api.makeBoardCard(api.createCardFromBase(id, "player"));
      api.render();
    }, environment.id);
    for (const side of ["player", "opponent"]) {
      await expect(page.locator(`#${side}ActiveEffectsSummary`)).toContainText(environment.name);
      await expect(page.locator(`#${side}ActiveEffectsCount`)).toHaveText("1");
      await page.locator(`#${side}ActiveEffectsButton`).click();
      await expect(page.locator("#battleDrawerInspector")).toContainText(environment.name);
      if (environment.id === "academic_move" && side === "player") {
        await page.screenshot({ path: test.info().outputPath("academic-move-effects.png") });
      }
      await page.locator("#battleLogCloseButton").click();
    }
  }
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("classroom", "player"));
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("0");
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("継続中の効果はありません");
});

test("アカデミックムーブの退場は環境変更後も対象の側だけに表示する", async ({ page }) => {
  await prepareEffectState(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.abyssTurns = 0;
    api.state.players.player.internTurnsRemaining = 0;
    api.state.players.opponent.effectUseLockTurnsRemaining = 0;
    api.state.players.player.board.seats = Array(9).fill(null);
    api.state.players.player.board.teacher = null;
    const card = api.makeBoardCard(api.createCardFromBase("general_student", "player"));
    card.academicMoveMarked = true;
    api.state.players.player.board.seats[0] = card;
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsSummary")).toContainText("アカデミックムーブ");
  await expect(page.locator("#opponentActiveEffectsCount")).toHaveText("0");
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("出席者1人");
  await expect(page.locator("#battleDrawerInspector")).toContainText("自分のターン終了時");
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.players.player.board.seats[0] = null;
    api.render();
  });
  await expect(page.locator("#playerActiveEffectsCount")).toHaveText("0");
});

test("図書館の手札を送る効果は設置した側だけ、学友会は残り回数も表示する", async ({ page }) => {
  await prepareEffectState(page);
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("meguro_library", "opponent"));
    api.render();
  });
  await page.locator("#playerActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("環境を設置した相手だけ");
  await page.locator("#battleLogCloseButton").click();
  await page.locator("#opponentActiveEffectsButton").click();
  await expect(page.locator("#battleDrawerInspector")).toContainText("自分のターン終了時、手札1枚");
  await page.evaluate(() => {
    const api = window.__chibattle;
    api.state.environment = api.makeBoardCard(api.createCardFromBase("student_council", "player"));
    api.state.environment.councilTurnsUntilTransform = 1;
    api.render();
  });
  await expect(page.locator("#battleDrawerInspector")).toContainText("あと1回");
  await expect(page.locator("#battleDrawerInspector")).toContainText("体力を+2");
});

test("継続効果ボタンはデスクトップとスマートフォンの盤面内に収まる", async ({ page }) => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await prepareEffectState(page);
    const boxes = await page.locator(".battle-active-effects").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }));
    expect(boxes).toHaveLength(2);
    boxes.forEach((box) => {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width);
      expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    });
  }
});

test("相手の継続効果とターン表示の上辺が画面の拡大縮小後も揃う", async ({ page }) => {
  await prepareEffectState(page);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1122, height: 768 },
    { width: 900, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => {
      const effects = document.getElementById("opponentActiveEffectsButton").getBoundingClientRect();
      const turn = document.querySelector(".battle-v16-turn").getBoundingClientRect();
      return Math.abs(effects.top - turn.top);
    })).toBeLessThan(0.5);
  }
});
