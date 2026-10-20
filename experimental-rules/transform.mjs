// Transform only the response served by the isolated test server. Never write
// the generated HTML back to index.html. Anchors fail closed after upstream edits.
export function buildExperimentalHtml(source, runtime) {
  let html = source;
  function once(from, to) {
    const count = html.split(from).length - 1;
    if (count !== 1) throw new Error(`変更位置が一致しません (${count}): ${from.slice(0, 90)}`);
    html = html.replace(from, () => to);
  }
  function section(start, end, edit) {
    const a = html.indexOf(start), b = html.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`関数が見つかりません: ${start}`);
    const original = html.slice(a, b), changed = edit(original);
    if (changed === original) throw new Error(`変更できません: ${start}`);
    html = html.slice(0, a) + changed + html.slice(b);
  }
  once('<head>', '<head><link rel="stylesheet" href="/experimental-rules/style.css">');
  section('    function attendCard(', '    function resolveAttendanceStateTransitions(', s => s.replace(
    '      card.lastAttendanceSource = attendanceSource;',
    '      nrMarkAttendance(card, zone, index, attendanceSource);\n      card.lastAttendanceSource = attendanceSource;'));
  once('        copyCardAttackUsage(previous, evolved);',
    '        copyCardAttackUsage(previous, evolved);\n        nrInheritEvolution(previous, evolved);');
  section('    function resolveHorseEndTurn(', '    function fusionCopyAttendanceCandidates(', s => s.replace(
    '|| !canUsePrintedCardEffects(source)) return;', '|| !canUsePrintedCardEffects(source) || !nrInAttackArea(source)) return;'));
  once('if (!ongoingEffectsSuppressed() && card.baseId === "sick_yuta") {',
    'if (!ongoingEffectsSuppressed() && card.baseId === "sick_yuta" && nrInAttackArea(card)) {');
  section('    function resolveAggroStudentEffects(', '    function happyBlueBirdAttackTargets(', s => s.replace(
    '(targetCard) => targetCard.type === "student"', '(targetCard, targetRef) => targetRef.zone === "seat" && seatRow(targetRef.index) <= 2')
    .replaceAll('相手の学生1人をランダムに指名し、2ダメージ。', '相手の1・2行目にいる出席者1人をランダムに指名し、2ダメージ。')
    .replaceAll('相手の学生がいないため', '相手の1・2行目に出席者がいないため'));
  // The variable student randomly relocates a newly attended unit. A random
  // destination can be prohibited; vacancy/footprint failure is not removal.
  section('    function attendCard(', '    function resolveAttendanceStateTransitions(', s => {
    const a = s.indexOf('        clearBoardCardFromField(owner, "seat", index, card);', s.indexOf('getBoardCardFromRef(ref)?.baseId === "variable_student"'));
    const b = s.indexOf('\n      }\n      resolveProliferatingEnemyTriggers', a);
    if (a < 0 || b < 0) throw new Error('変数学生の移動位置が見つかりません');
    return s.slice(0, a) + '        nrRandomRelocate(card, index);' + s.slice(b);
  });
  once('        clearBoardCardFromField(targetOwner, targetZone, targetIndex, target);\n        setBoardCard(targetOwner, "teacher", null, target);',
    '        nrRelocate(target, "teacher", null, { forced: false });');
  section('      if (item.baseId === "red_ideology") {\n        ["player", "opponent"].forEach', '      if (item.baseId === "classroom_change") {', s => {
    const portal = s.indexOf('      if (item.baseId === "contrarian_portal") {');
    if (portal < 0) throw new Error('ポータル処理がありません');
    return '      if (item.baseId === "red_ideology") {\n        nrPackRows();\n        resultText = "お互いの出席者を各行の左側へ詰めました。";\n      }\n'
      + '      if (item.baseId === "contrarian_portal") {\n        nrPortal(side);\n        resultText = "自分の1行目と3行目を入れ替えました。";\n      }\n';
  });
  // Every board-to-trash departure of the seven horse fusion results splits,
  // not just destruction. Existing departure triggers/equipment remain shared.
  once('const fusionMaterials = isDestruction && !card.tokenVanished ? horseFusionMaterialEntries(card).map(entry => entry.baseId) : [];',
    'const fusionMaterials = []; // Test rules split once in moveToTrash, for every departure path.');
  once('    window.__chibattle = {', `${runtime}\n    window.__chibattle = {`);
  return html;
}
