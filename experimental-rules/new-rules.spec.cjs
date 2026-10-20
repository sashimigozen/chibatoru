const { test, expect } = require('@playwright/test');
const { spawn } = require('node:child_process');
const path = require('node:path');
const base = 'http://127.0.0.1:4190';
let server;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  server = spawn(process.execPath, [path.join(__dirname, 'server.mjs')], { env: { ...process.env, CHIBATTLE_TEST_PORT: '4190' }, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    server.stdout.once('data', resolve);
    server.once('error', reject);
    server.once('exit', code => reject(new Error(`server exited: ${code}`)));
  });
});
test.afterAll(() => server?.kill());
test.beforeEach(async ({ page }) => {
  await page.goto(base);
  await page.waitForFunction(() => window.__newRules && document.getElementById('nrSettingsDialog')?.open);
  await page.evaluate(() => {
    document.getElementById('nrSettingsDialog').close();
    const api = window.__chibattle, nr = window.__newRules, state = api.state;
    const counts = window.ChibattleAiBattleDecks[0].counts;
    nr.startMatch(counts, counts, { will: 10 });
    // All subsequent setup cards are fixtures, not extra attendances.
    window.setupBoard = () => {
      state.actionTurn = 3; state.currentSide = 'player'; state.firstSide = 'player';
      state.environment = null; state.noAttackUntilActionTurn = 0;
      state.temporarySeatBlocks = []; state.fullLockSeatBlocks = [];
      state.pendingCardChoice = null; state.selectedAttacker = null;
      for (const side of ['player', 'opponent']) {
        state.players[side].board = { seats: Array(9).fill(null), teacher: null };
        state.players[side].hand = []; state.players[side].trash = []; state.players[side].late = [];
      }
    };
    window.put = (id, index, side = 'player', options = {}) => {
      const card = api.makeBoardCard(api.createCardFromBase(id, side));
      card.playedOnTurn = options.fresh ? state.actionTurn : 1;
      const zone = index === null ? 'teacher' : 'seat';
      nr.markAttendance(card, zone, index, 'hand');
      if (!options.fresh) { card.nrBodyReady = index === null || index < 6; card.nrEntryTurn = 1; }
      if (card.occupiedSeatSize) {
        card.seatAnchorIndex = index;
        card.occupiedSeatIndexes = [];
        for (let r = 0; r < card.occupiedSeatSize.rows; r++) for (let c = 0; c < card.occupiedSeatSize.cols; c++) {
          const i = index + r * 3 + c; card.occupiedSeatIndexes.push(i); state.players[side].board.seats[i] = card;
        }
      } else if (index === null) state.players[side].board.teacher = card;
      else state.players[side].board.seats[index] = card;
      return card;
    };
  });
  await page.waitForFunction(() => !window.__newRules.isBusy(), { timeout: 20000 });
  await page.evaluate(() => setupBoard());
});

test('1・2行目と教卓のみ攻撃可能、3行目は通常攻撃対象外', async ({ page }) => {
  const result = await page.evaluate(() => {
    const n = __newRules, a = __chibattle;
    const cards = [put('general_student', 0), put('general_student', 3), put('general_student', 6), put('general_teacher', null)];
    const rear = put('general_student', 6, 'opponent');
    a.state.selectedAttacker = n.ref(cards[0]);
    return { attack: cards.map(n.canAttack), target: n.canTargetCard('opponent', 'seat', 6), birds: n.birdTargets(cards[0]).map(e => e.card.instanceId), rear: rear.instanceId };
  });
  expect(result.attack).toEqual([true, true, false, true]);
  expect(result.target).toBe(false);
  expect(result.birds).not.toContain(result.rear);
});

test('通常移動は前後間のみ、横移動と前線内移動は禁止', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = put('general_student', 6);
    return [0, 3, 7].map(i => Boolean(__newRules.planMove(c, i)));
  });
  expect(result).toEqual([true, true, false]);
  expect(await page.evaluate(() => { setupBoard(); const c = put('general_student', 0); return [1, 3, 6].map(i => Boolean(__newRules.planMove(c, i))); })).toEqual([false, false, true]);
});

test('移動は行動権を消費し、講義・追加攻撃に置き換わらない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('absolute_woman', 6);
    const moved = __newRules.move(c, 0);
    return { moved, attack: __newRules.canAttack(c), action: c.nrAction, again: __newRules.planMove(c, 7) };
  })).toMatchObject({ moved: true, attack: false, action: 'move', again: null });
});

test('入れ替えは双方の行動権を消費する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = put('general_student', 0), b = put('general_student', 6);
    b.hasAttacked = true;
    const blocked = !__newRules.planMove(a, 6);
    b.hasAttacked = false;
    const moved = __newRules.move(a, 6);
    return { blocked, moved, actions: [a.nrAction, b.nrAction], positions: [__newRules.ref(a).index, __newRules.ref(b).index] };
  })).toEqual({ blocked: true, moved: true, actions: ['move', 'move'], positions: [6, 0] });
});

test('攻撃禁止でも通常移動できる', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = put('general_student', 6); card.attackLockedPermanently = true;
    return { move: Boolean(__newRules.planMove(card, 0)), attack: __newRules.canAttack(card) };
  })).toEqual({ move: true, attack: false });
});

test('教卓は通常移動不可、能力による出入りは可能', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = put('general_teacher', null);
    const manual = __newRules.planMove(card, 6);
    const effect = __newRules.relocate(card, 'seat', 6);
    return { manual, effect, index: __newRules.ref(card).index, action: card.nrAction || null };
  })).toEqual({ manual: null, effect: true, index: 6, action: null });
});

test('前へ能力移動したターンは本体攻撃待機、次の自分の開始で解放', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('general_student', 6);
    __newRules.relocate(c, 'seat', 0);
    const before = __newRules.canHitLife(c);
    __chibattle.state.actionTurn++;
    __newRules.startTurn('player');
    return { before, after: __newRules.canHitLife(c) };
  })).toEqual({ before: false, after: true });
});

test('超陽気は初回前線出席のみ即時本体攻撃、後退後は陽気相当', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('aggro_princess', 0, 'player', { fresh: true });
    const first = __newRules.canHitLife(c);
    __newRules.relocate(c, 'seat', 6); __newRules.relocate(c, 'seat', 0);
    return { first, after: __newRules.canHitLife(c), unit: __newRules.canAttack(c) };
  })).toEqual({ first: true, after: false, unit: true });
});

test('3行目へ直接出席した超陽気も前へ出ると陽気相当', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('aggro_princess', 6, 'player', { fresh: true });
    __newRules.relocate(c, 'seat', 0);
    return { life: __newRules.canHitLife(c), unit: __newRules.canAttack(c) };
  })).toEqual({ life: false, unit: true });
});

test('1行目限定を強制的に後ろへ送ると破壊ではなく校外へ送る', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('acting_out_man_2', 0);
    const result = __newRules.relocate(c, 'seat', 6);
    return { result, ref: __newRules.ref(c), trash: __chibattle.state.players.player.trash.map(c => [c.baseId, c.directlyDestroyed]) };
  })).toEqual({ result: true, ref: null, trash: [['acting_out_man_2', false]] });
});

test('任意では禁止席を選べず、強制移動なら校外、満席なら移動不成立', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = __chibattle, n = __newRules, c = put('general_student', 6);
    a.state.temporarySeatBlocks = [{ owner: 'player', index: 0 }];
    const manual = n.planMove(c, 0);
    const voluntaryEffect = n.relocate(c, 'seat', 0, { forced: false });
    put('general_student', 1);
    const occupied = n.relocate(c, 'seat', 1);
    const forced = n.relocate(c, 'seat', 0);
    return { manual, voluntaryEffect, occupied, forced, gone: !n.ref(c) };
  })).toEqual({ manual: null, voluntaryEffect: false, occupied: false, forced: true, gone: true });
});

test('移動しなければ後から禁止された席の出席者は残る', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('general_student', 0);
    __chibattle.state.temporarySeatBlocks = [{ owner: 'player', index: 0 }];
    __newRules.observe(); __chibattle.render();
    return Boolean(__newRules.ref(c));
  })).toBe(true);
});

test('複数マスは1人、2行目を含めば前線、禁止マスに一部重なると校外', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('loud_members', 3);
    const front = __newRules.inAttackArea(c), refs = __chibattle.state.players.player.board.seats.filter(x => x?.instanceId === c.instanceId).length;
    __chibattle.state.temporarySeatBlocks = [{ owner: 'player', index: 5 }];
    const moved = __newRules.relocate(c, 'seat', 4);
    return { front, refs, moved, gone: !__newRules.ref(c) };
  })).toEqual({ front: true, refs: 4, moved: true, gone: true });
});

test('講義の対象は相手の1・2行目と教卓だけ、後列は除外', async ({ page }) => {
  expect(await page.evaluate(() => {
    const teacher = put('general_teacher', null);
    put('general_student', 0, 'opponent'); put('general_student', 3, 'opponent');
    put('general_student', 6, 'opponent'); put('general_student', null, 'opponent');
    return __newRules.lectureTargets('player', teacher).map(e => e.ref.zone === 'teacher' ? 'teacher' : e.ref.index);
  })).toEqual(['teacher', 0, 3]);
});

test('3行目の超注目は範囲内の効果のみ誘導し、前線限定効果を不発にしない', async ({ page }) => {
  expect(await page.evaluate(() => {
    put('super_ae_student', 6, 'opponent'); put('general_student', 0, 'opponent');
    const all = __newRules.effectTargets('player', 'opponent').map(e => e.ref.index);
    const front = __newRules.effectTargets('player', 'opponent', (c, r) => __newRules.inAttackArea(c, r)).map(e => e.ref.index);
    return { all, front };
  })).toEqual({ all: [6], front: [0] });
});

test('ポータルはセット交換し、攻撃・行動状況を維持、後列送りで本体資格を失う', async ({ page }) => {
  expect(await page.evaluate(() => {
    const a = put('general_student', 0), b = put('general_student', 6);
    a.hasAttacked = true;
    __newRules.portal('player');
    return { positions: [__newRules.ref(a).index, __newRules.ref(b).index], used: a.hasAttacked,
      ready: [__newRules.canHitLife(a), __newRules.canHitLife(b)], attacks: [__newRules.canAttack(a), __newRules.canAttack(b)] };
  })).toEqual({ positions: [6, 0], used: true, ready: [false, false], attacks: [false, true] });
});

test('ポータルで校外へ送られる融合出席者も素材へ分解する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('umaibo', 0);
    __chibattle.state.temporarySeatBlocks = [{ owner: 'player', index: 6 }];
    __newRules.portal('player');
    return { gone: !__newRules.ref(c), materials: __chibattle.state.players.player.trash.map(x => x.baseId).sort() };
  })).toEqual({ gone: true, materials: ['fusion_maibo', 'fusion_uma'] });
});

test('進化は行動済み・本体資格・超陽気の制限状態を引き継ぐ', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('yuta', 0); c.nrAction = 'move'; c.nrBodyReady = false; c.nrSuperLost = true;
    const evolved = __chibattle.makeBoardCard(__chibattle.createCardFromBase('dark_yuta', 'player'));
    __newRules.inheritEvolution(c, evolved);
    return { action: evolved.nrAction, ready: evolved.nrBodyReady, lost: evolved.nrSuperLost, turn: evolved.playedOnTurn };
  })).toEqual({ action: 'move', ready: false, lost: true, turn: 1 });
});

test('融合の終了時効果は3行目では不発、通常移動した2行目では発動', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const a = __chibattle, n = __newRules;
    const c = put('where_bone', 6), life = a.state.players.opponent.life;
    a.resolveStudentEndTurnEffects('player');
    await new Promise(r => setTimeout(r, 100));
    const rear = a.state.players.opponent.life;
    n.move(c, 3);
    a.resolveStudentEndTurnEffects('player');
    await new Promise(r => setTimeout(r, 100));
    return { rearDamage: life - rear, frontDamage: rear - a.state.players.opponent.life };
  });
  expect(result).toEqual({ rearDamage: 0, frontDamage: 3 });
});

test('盤面クリックで移動でき、ターン終了後はプレイヤー2を手動操作できる', async ({ page }) => {
  await page.evaluate(() => { put('general_student', 6); __chibattle.render(); });
  await expect(page.locator('#nrMove')).toHaveCount(0);
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await expect(page.locator('.slot[data-owner="player"][data-index="3"]')).toHaveClass(/nr-move-target/);
  await page.locator('.slot[data-owner="player"][data-index="3"]').click();
  await expect(page.locator('#nrActionDialog')).toBeVisible();
  await page.locator('#nrActionAccept').click();
  await expect(page.locator('.slot[data-owner="player"][data-index="3"] .board-card')).toHaveCount(1);
  await page.evaluate(() => __chibattle.endTurn());
  await page.waitForFunction(() => __newRules.nr.pilot === 2 && __chibattle.state.currentSide === 'player');
  await expect(page.locator('#nrPilot')).toContainText('プレイヤー2');
});

test('テスト版の本文に位置条件と講義対象の適用内容を表示する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const c = id => __newRules.cardText(__chibattle.createCardFromBase(id, 'player'));
    return { horse: c('umaibo'), sick: c('sick_yuta'), queen: c('aggro_queen'), final: c('where_uma_bone_maibo') };
  });
  expect(result.horse).toContain('攻撃可能エリア');
  expect(result.sick).toContain('攻撃可能エリア');
  expect(result.queen).toContain('1・2行目');
  expect(result.final).not.toContain('攻撃可能エリア');
});

test('アグロクイーンは前2行の出席者を対象とし、3行目と教卓には当たらない', async ({ page }) => {
  expect(await page.evaluate(() => {
    put('aggro_queen', 5);
    const target = put('general_teacher', 3, 'opponent');
    const rear = put('general_student', 6, 'opponent');
    const podium = put('general_teacher', null, 'opponent');
    const before = [target.currentHp, rear.currentHp, podium.currentHp];
    __newRules.aggroEndTurn('player');
    return before.map((hp, i) => hp - [target, rear, podium][i].currentHp);
  })).toEqual([2, 0, 0]);
});

test('病に臥すU太の終了時効果は後列で停止し、前線で感染させる', async ({ page }) => {
  expect(await page.evaluate(() => {
    const source = put('sick_yuta', 6), target = put('general_student', 0, 'opponent');
    __chibattle.resolveStudentEndTurnEffects('player');
    const rear = target.illnessEquipments?.length || 0;
    __newRules.relocate(source, 'seat', 0);
    __chibattle.resolveStudentEndTurnEffects('player');
    return { rear, front: target.illnessEquipments?.length || 0 };
  })).toEqual({ rear: 0, front: 1 });
});

test('講義は後列にダメージを与えず、講義後は行動済み', async ({ page }) => {
  expect(await page.evaluate(() => {
    const t = put('general_teacher', null), front = put('general_student', 3, 'opponent'), rear = put('general_student', 6, 'opponent');
    const used = __newRules.lecture('player', __newRules.ref(t));
    return { used, front: front.currentHp, rear: rear.currentHp, action: t.nrAction, attack: __newRules.canAttack(t) };
  })).toEqual({ used: true, front: 1, rear: 2, action: 'lecture', attack: false });
});

test('能力による攻撃は前線の注目を無視するが、前線の超注目には従う', async ({ page }) => {
  expect(await page.evaluate(() => {
    const bird = put('happy_blue_bird', 0);
    put('ae_student', 0, 'opponent'); put('general_student', 3, 'opponent');
    const attention = __newRules.birdTargets(bird).map(e => e.ref.index);
    put('super_ae_student', 1, 'opponent');
    return { attention, superAttention: __newRules.birdTargets(bird).map(e => e.ref.index) };
  })).toEqual({ attention: [0, 3], superAttention: [1] });
});

test('全ロックで禁止された空き席への強制移動も校外送りになる', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('general_student', 6);
    __chibattle.state.environment = __chibattle.createCardFromBase('full_lock', 'player');
    __chibattle.state.fullLockSeatBlocks = [{ owner: 'player', index: 0 }];
    const moved = __newRules.relocate(c, 'seat', 0);
    return { moved, gone: !__newRules.ref(c) };
  })).toEqual({ moved: true, gone: true });
});

test('任意の教卓移動で位置限定カードを校外へ送ることはできない', async ({ page }) => {
  expect(await page.evaluate(() => {
    const c = put('acting_out_man_2', 0, 'opponent');
    const item = __chibattle.createCardFromBase('attitude', 'player');
    __chibattle.state.players.player.hand.push(item);
    const before = __chibattle.state.players.player.will;
    const used = __newRules.castItem('player', item, 'opponent', 'seat', 0);
    return { used, remains: Boolean(__newRules.ref(c)), spent: before - __chibattle.state.players.player.will };
  })).toEqual({ used: false, remains: true, spent: 0 });
});

test('本体攻撃の実行側でも待機を検証し、UIだけの制限にしない', async ({ page }) => {
  expect(await page.evaluate(async () => {
    const c = put('general_student', 6);
    __newRules.relocate(c, 'seat', 0);
    __chibattle.state.selectedAttacker = __newRules.ref(c);
    const before = __chibattle.state.players.opponent.life;
    await __newRules.attackLife('opponent');
    await new Promise(r => setTimeout(r, 50));
    return { damage: before - __chibattle.state.players.opponent.life, used: c.hasAttacked };
  })).toEqual({ damage: 0, used: false });
});

test('能力で後列を攻撃された出席者は通常どおり反撃する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const attacker = put('general_teacher', 0), rear = put('general_teacher', 6, 'opponent');
    __chibattle.resolveCardAttackWithBoardCleanup(attacker, __newRules.ref(rear));
    return [attacker.currentHp, rear.currentHp];
  })).toEqual([1, 1]);
});

test('手札から校外へ送られた融合出席者も、一度だけ素材へ分解する', async ({ page }) => {
  expect(await page.evaluate(() => {
    const card = __chibattle.createCardFromBase('where_bone', 'player');
    __chibattle.state.players.player.hand.push(card);
    __chibattle.moveHandCardToTrash('player', card);
    return __chibattle.state.players.player.trash.map(c => c.baseId).sort();
  })).toEqual(['fusion_bone', 'fusion_where']);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1280, height: 800 }]) {
  test(`3行目を小さく分離し、相手側を外枠内へ下げる ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.evaluate(() => __chibattle.render());
    const result = await page.evaluate(() => {
      const rect = element => element.getBoundingClientRect();
      const slot = (owner, index) => rect(document.querySelector(`.slot[data-owner="${owner}"][data-index="${index}"]`));
      const own2 = slot('player', 3), own3 = slot('player', 6), opp2 = slot('opponent', 3), opp3 = slot('opponent', 6);
      const shell = document.querySelector('.game-shell');
      const shellRect = rect(shell), scale = shellRect.height / shell.offsetHeight;
      const frameTop = shellRect.top + parseFloat(getComputedStyle(shell, '::before').top) * scale;
      return { ownGap: own3.top - own2.bottom, opponentGap: opp2.top - opp3.bottom,
        slotHeight: own2.height, frameClearance: opp3.top - frameTop };
    });
    expect(result.ownGap).toBeGreaterThan(4);
    expect(result.opponentGap).toBeGreaterThan(4);
    expect(result.ownGap).toBeLessThan(result.slotHeight * .15);
    expect(result.opponentGap).toBeLessThan(result.slotHeight * .15);
    expect(result.frameClearance).toBeGreaterThan(10);
  });
}

test('分離した3行目にまたがる大型カードも座席と位置・高さが一致する', async ({ page }) => {
  const result = await page.evaluate(() => {
    const own = put('loud_members', 3), opponent = put('loud_members', 3, 'opponent');
    __chibattle.render();
    return [own, opponent].map(card => {
      const grid = document.getElementById(card.owner === 'player' ? 'playerSeatGrid' : 'opponentSeatGrid');
      const bounds = card.occupiedSeatIndexes.map(index => grid.querySelector(`.slot[data-index="${index}"]`).getBoundingClientRect());
      const overlay = grid.querySelector('.multi-seat-board-card').getBoundingClientRect();
      return { top: Math.abs(overlay.top - Math.min(...bounds.map(r => r.top))),
        bottom: Math.abs(overlay.bottom - Math.max(...bounds.map(r => r.bottom))),
        left: Math.abs(overlay.left - Math.min(...bounds.map(r => r.left))),
        right: Math.abs(overlay.right - Math.max(...bounds.map(r => r.right))) };
    });
  });
  for (const differences of result) for (const value of Object.values(differences)) expect(value).toBeLessThan(1);
});

test('相手をクリックすると攻撃確認を表示し、キャンセルでは攻撃も行動権消費もしない', async ({ page }) => {
  await page.evaluate(() => { put('general_teacher', 0); put('general_teacher', 3, 'opponent'); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="0"] .board-card').click();
  await page.locator('.slot[data-owner="opponent"][data-index="3"] .board-card').click();
  await expect(page.locator('#nrActionTitle')).toHaveText('攻撃の確認');
  expect(await page.evaluate(() => __chibattle.state.players.opponent.board.seats[3].currentHp)).toBe(2);
  await page.locator('#nrActionCancel').click();
  expect(await page.evaluate(() => ({ used: __chibattle.state.players.player.board.seats[0].hasAttacked, hp: __chibattle.state.players.opponent.board.seats[3].currentHp }))).toEqual({ used: false, hp: 2 });
  await page.locator('.slot[data-owner="opponent"][data-index="3"] .board-card').click();
  await page.locator('#nrActionAccept').click();
  await page.waitForFunction(() => __chibattle.state.players.opponent.board.seats[3]?.currentHp === 1);
  expect(await page.evaluate(() => __chibattle.state.players.player.board.seats[0].hasAttacked)).toBe(true);
});

test('移動確認のキャンセル・Escでは位置と行動権を維持する', async ({ page }) => {
  await page.evaluate(() => { put('general_student', 6); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await page.locator('.slot[data-owner="player"][data-index="0"]').click();
  await expect(page.locator('#nrActionTitle')).toHaveText('移動の確認');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => ({ source: Boolean(__chibattle.state.players.player.board.seats[6]), dest: __chibattle.state.players.player.board.seats[0], action: __chibattle.state.players.player.board.seats[6].nrAction || null }))).toEqual({ source: true, dest: null, action: null });
  await expect(page.locator('#nrActionDialog')).not.toBeVisible();
});

test('自分の出席者をクリックして入れ替えを確認し、両方の行動権を消費する', async ({ page }) => {
  await page.evaluate(() => { put('general_student', 6); put('protein_drinker', 0); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await page.locator('.slot[data-owner="player"][data-index="0"] .board-card').click();
  await expect(page.locator('#nrActionTitle')).toHaveText('入れ替えの確認');
  await page.locator('#nrActionAccept').click();
  expect(await page.evaluate(() => [0, 6].map(i => ({ id: __chibattle.state.players.player.board.seats[i].baseId, action: __chibattle.state.players.player.board.seats[i].nrAction })))).toEqual([{ id: 'general_student', action: 'move' }, { id: 'protein_drinker', action: 'move' }]);
});

test('攻撃確認と移動確認は独立して設定・保存できる', async ({ page }) => {
  await page.locator('#nrSettings').click();
  await expect(page.locator('#nrConfirmAttack')).toBeChecked();
  await expect(page.locator('#nrConfirmMove')).toBeChecked();
  await page.locator('#nrConfirmMove').uncheck();
  await expect(page.locator('#nrConfirmAttack')).toBeChecked();
  await page.reload();
  await expect(page.locator('#nrConfirmAttack')).toBeChecked();
  await expect(page.locator('#nrConfirmMove')).not.toBeChecked();
  await page.locator('#nrConfirmAttack').uncheck();
  await page.locator('#nrConfirmMove').check();
  await page.reload();
  await expect(page.locator('#nrConfirmAttack')).not.toBeChecked();
  await expect(page.locator('#nrConfirmMove')).toBeChecked();
});

test('移動確認だけを切ると即座に移動でき、攻撃確認は残る', async ({ page }) => {
  await page.locator('#nrSettings').click();
  await page.locator('#nrConfirmMove').uncheck();
  await page.locator('#nrSettingsDialog button[aria-label="閉じる"]').click();
  await page.evaluate(() => { put('general_student', 6); put('general_teacher', 1); put('general_teacher', 3, 'opponent'); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await page.locator('.slot[data-owner="player"][data-index="0"]').click();
  await expect(page.locator('#nrActionDialog')).not.toBeVisible();
  await expect(page.locator('.slot[data-owner="player"][data-index="0"] .board-card')).toHaveCount(1);
  await page.locator('.slot[data-owner="player"][data-index="1"] .board-card').click();
  await page.locator('.slot[data-owner="opponent"][data-index="3"] .board-card').click();
  await expect(page.locator('#nrActionTitle')).toHaveText('攻撃の確認');
});

test('攻撃確認だけを切ると即座に攻撃でき、移動確認は残る', async ({ page }) => {
  await page.locator('#nrSettings').click();
  await page.locator('#nrConfirmAttack').uncheck();
  await page.locator('#nrSettingsDialog button[aria-label="閉じる"]').click();
  await page.evaluate(() => { put('general_teacher', 0); put('general_teacher', 3, 'opponent'); put('general_student', 6); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="0"] .board-card').click();
  await page.locator('.slot[data-owner="opponent"][data-index="3"] .board-card').click();
  await expect(page.locator('#nrActionDialog')).not.toBeVisible();
  await page.waitForFunction(() => !__newRules.isBusy() && __chibattle.state.players.opponent.board.seats[3]?.currentHp === 1);
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await page.locator('.slot[data-owner="player"][data-index="4"]').click();
  await expect(page.locator('#nrActionTitle')).toHaveText('移動の確認');
});

test('確認中にターンや対象が変わった場合は実行せず確認を閉じる', async ({ page }) => {
  await page.evaluate(() => { put('general_student', 6); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="6"] .board-card').click();
  await page.locator('.slot[data-owner="player"][data-index="0"]').click();
  await expect(page.locator('#nrActionDialog')).toBeVisible();
  await page.evaluate(() => { __chibattle.state.actionTurn++; });
  await expect(page.locator('#nrActionDialog')).not.toBeVisible();
  expect(await page.evaluate(() => Boolean(__chibattle.state.players.player.board.seats[6]))).toBe(true);
});

test('本体へのクリックも攻撃確認し、キャンセルではダメージを与えない', async ({ page }) => {
  await page.evaluate(() => { put('general_student', 0); __chibattle.render(); });
  await page.locator('.slot[data-owner="player"][data-index="0"] .board-card').click();
  await page.locator('#opponentLifeTarget').click();
  await expect(page.locator('#nrActionMessage')).toContainText('相手本体');
  const life = await page.evaluate(() => __chibattle.state.players.opponent.life);
  await page.locator('#nrActionCancel').click();
  expect(await page.evaluate(() => __chibattle.state.players.opponent.life)).toBe(life);
});
