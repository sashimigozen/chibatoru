const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
test.beforeEach(async ({page}) => {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    startCardTest('acting_out_man'); scheduleOpponentAI = () => {};
    state.training.skipAnimations = true; state.phase = 'battle'; state.actionTurn = 8;
    state.currentSide = 'player'; state.environment = null;
    for (const side of ['player','opponent']) Object.assign(state.players[side], {
      board: { teacher: null, seats: Array(9).fill(null) }, hand: [], deck: [], trash: [],
      will: 20, maxWill: 20, life: 20, attendancesThisTurn: 0 });
  });
});
test('本文・基本値・分類が一致する', async ({page}) => {
  const result = await page.evaluate(() => {
    const c = createCardFromBase('acting_out_man','player');
    return {stats:[c.cost,c.attack,c.hp], design:SPECIALTY_CARD_IDS.design.includes(c.baseId), text:cardRulesText(c)};
  });
  expect(result.stats).toEqual([4,3,3]); expect(result.design).toBe(true);
  expect(result.text).toBe('このカードを手札から出席させたとき、相手の3行目にいる学生すべてと、自分の講義室にいる学生すべてに1ダメージ。\n自分の講義室にこのカード以外の「アクティングアウト」とつく学生がいるなら、1ターンに2回攻撃できる。\nさらに学生への攻撃なら、攻撃中は攻撃力を+1し、反撃を受けない。');
});
for (const side of ['player','opponent']) {
  for (const withWoman of [false, true]) test(`実際の出席後にマン自身を含む範囲へダメージ、ウーマンとの連携 ${side} ${withWoman}`, async ({ page }) => {
    const result = await page.evaluate(({ side, withWoman }) => {
      const other = oppositeSide(side), own = state.players[side], enemy = state.players[other];
      state.currentSide = side;
      const woman = withWoman ? makeBoardCard(createCardFromBase('acting_out_woman', side)) : null;
      if (woman) own.board.seats[0] = woman;
      const ally = makeBoardCard(createCardFromBase('general_student', side)); own.board.seats[6] = ally;
      const ownTeacherStudent = makeBoardCard(createCardFromBase('general_student', side)); own.board.teacher = ownTeacherStudent;
      const front = makeBoardCard(createCardFromBase('general_student', other)); enemy.board.seats[0] = front;
      const middle = makeBoardCard(createCardFromBase('general_student', other)); enemy.board.seats[3] = middle;
      const rear = makeBoardCard(createCardFromBase('general_student', other)); enemy.board.seats[6] = rear;
      const rearTeacher = makeBoardCard(createCardFromBase('general_teacher', other)); enemy.board.seats[7] = rearTeacher;
      const teacherStudent = makeBoardCard(createCardFromBase('general_student', other)); enemy.board.teacher = teacherStudent;
      const man = makeBoardCard(createCardFromBase('acting_out_man', side));
      const entered = attendCard(side, man, 'seat', 1, { attendanceSource: ATTENDANCE_SOURCE.HAND });
      return { entered: Boolean(entered), man: man.currentHp, woman: woman?.currentHp ?? null,
        own: [ally.currentHp, ownTeacherStudent.currentHp],
        enemy: [front.currentHp, middle.currentHp, rear.currentHp, rearTeacher.currentHp, teacherStudent.currentHp],
        attacks: cardAttackLimit(man), ongoing: boardActiveEffectLines(side) };
    }, { side, withWoman });
    expect(result).toMatchObject({ entered: true, man: withWoman ? 3 : 2, woman: withWoman ? 3 : null,
      own: [1,1], enemy: [2,2,1,2,2], attacks: withWoman ? 2 : 1 });
    if (withWoman) {
      expect(result.ongoing.join('')).toContain('このカード以外の「アクティングアウト」とつく出席者がいるなら');
      expect(result.ongoing.join('')).toContain('すべてが学生から受けるダメージを-2する');
    }
  });
  test(`3行目にまたがる大型学生は1人として1回だけダメージ ${side}`, async ({ page }) => {
    const result = await page.evaluate(side => {
      const other = oppositeSide(side);
      const large = makeBoardCard(createCardFromBase('loud_members', other));
      placeMultiSeatCard(other, 3, large);
      const before = large.currentHp;
      const man = makeBoardCard(createCardFromBase('acting_out_man', side));
      attendCard(side, man, 'seat', 0, { attendanceSource: ATTENDANCE_SOURCE.HAND });
      return { before, after: large.currentHp };
    }, side);
    expect(result.before - result.after).toBe(1);
  });
  test(`手札出席だけ相手3行目と自分の学生へ1ダメージ ${side}`, async ({page}) => {
    const result = await page.evaluate(side => {
      const other = oppositeSide(side);
      const students = ['general_student','general_student'].map(id => makeBoardCard(createCardFromBase(id,other)));
      students.forEach((c,i) => state.players[other].board.seats[i === 0 ? 0 : 6] = c);
      const teacher = makeBoardCard(createCardFromBase('general_teacher',other)); state.players[other].board.teacher = teacher;
      const c = makeBoardCard(createCardFromBase('acting_out_man',side)); state.players[side].board.seats[0] = c;
      resolveAttendEffects(side,c,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.EFFECT});
      const effectHp = students.map(c=>c.currentHp);
      resolveAttendEffects(side,c,'seat',0,{attendanceSource:ATTENDANCE_SOURCE.HAND});
      return {effectHp, handHp:students.map(c=>c.currentHp), ownHp:c.currentHp, teacherHp:teacher.currentHp, limited:isAttendanceLimited(other)};
    },side);
    expect(result).toEqual({effectHp:[2,2],handHp:[2,1],ownHp:2,teacherHp:2,limited:false});
  });
  test(`自身以外の味方学生だけが条件で、途中の出入りに追従 ${side}`, async ({page}) => {
    const r = await page.evaluate(side => {
      const p = state.players[side];
      const c = makeBoardCard(createCardFromBase('acting_out_man',side)); c.playedOnTurn=0; p.board.seats[0]=c;
      const alone=cardAttackLimit(c); markCardAttackUsed(c);
      const exhausted=canAttackSilently(c);
      const friend=makeBoardCard(createCardFromBase('acting_out_woman',side)); p.board.seats[1]=friend; applyBoardAuras();
      const gained={limit:cardAttackLimit(c),ready:canAttackSilently(c),flag:c.hasAttacked};
      p.board.seats[1]=null; applyBoardAuras(); const lost=canAttackSilently(c);
      p.board.seats[1]=friend; applyBoardAuras(); markCardAttackUsed(c);
      const used=cardAttacksUsedThisTurn(c), afterTwo=canAttackSilently(c);
      resetCardAttackUsage(c); friend.type='teacher'; const teacher=cardAttackLimit(c);
      p.board.seats[1]=null; state.players[oppositeSide(side)].board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man_2',oppositeSide(side)));
      const enemy=cardAttackLimit(c);
      p.board.seats[1]=makeBoardCard(createCardFromBase('acting_out_man',side)); c.padlockEquipment={baseId:'padlock'};
      return {alone,exhausted,gained,lost,used,afterTwo,teacher,enemy,suppressed:cardAttackLimit(c)};
    },side);
    expect(r).toEqual({alone:1,exhausted:false,gained:{limit:2,ready:true,flag:false},lost:false,used:2,afterTwo:false,teacher:1,enemy:1,suppressed:1});
  });
  test(`学生への攻撃のみ4ダメージ・反撃なし、永続加算しない ${side}`, async ({page}) => {
    const r=await page.evaluate(side=>{
      const other=oppositeSide(side), p=state.players[side];
      const c=makeBoardCard(createCardFromBase('acting_out_man',side));p.board.seats[0]=c;
      const friend=makeBoardCard(createCardFromBase('acting_out_woman',side));p.board.seats[1]=friend;
      // Use no damage-reduction aura while retaining the name condition.
      friend.baseId='acting_out_man_2';
      const target=makeBoardCard(createCardFromBase('general_student',other));target.currentHp=10;target.maxHp=10;target.attack=8;
      state.players[other].board.seats[0]=target;
      const prediction={damage:cardAttackDamage(c,target),counter:aiAttackCounterDamage(c,target)};
      resolveCardAttack(c,target);resolveCardAttack(c,target);
      const student={hp:target.currentHp,ownHp:c.currentHp,attack:c.attack};
      const teacher=makeBoardCard(createCardFromBase('general_teacher',other));teacher.currentHp=10; teacher.attack=1;
      resolveCardAttack(c,teacher);
      const teacherResult={hp:teacher.currentHp,ownHp:c.currentHp,attack:c.attack};
      const before=state.players[other].life;resolveLifeAttack(c,other);
      p.board.seats[1]=null;c.currentHp=3;target.currentHp=10;target.attack=1;resolveCardAttack(c,target);
      return {prediction,student,teacherResult,face:before-state.players[other].life,alone:{hp:target.currentHp,ownHp:c.currentHp,attack:c.attack}};
    },side);
    expect(r).toEqual({prediction:{damage:4,counter:0},student:{hp:2,ownHp:3,attack:3},teacherResult:{hp:7,ownHp:2,attack:3},face:3,alone:{hp:7,ownHp:2,attack:3}});
  });
}
