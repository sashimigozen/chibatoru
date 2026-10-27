"use strict";
const Replay = require('../online-replay.js');
const catalog = require('./card-catalog.json');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const array = value => Array.isArray(value) ? value : [];
const value = n => n === null || n === undefined ? '記録なし' : String(n);

function renderTimeline(log) {
  const events = array(log.events);
  const game = events.find(e=>e.eventType==='game_start')?.game || log.game || {};
  const firstSide = events.find(e=>e.eventType==='order_choice')?.firstSide
    || events.find(e=>e.eventType==='battle_start')?.firstSide || game.firstSide;
  const names = log.summary?.playerNames || log.playerNames || {};
  const who = side => names[side] || ({player:'プレイヤー',opponent:'対戦相手',draw:'引き分け'}[side]) || '記録なし';
  const cardName = card => typeof card === 'string' ? catalog.names?.[card] || card
    : card?.cardName || card?.name || catalog.names?.[card?.cardId || card?.baseId] || card?.cardId || card?.baseId || '名称の記録なし';
  const cardList = cards => !Array.isArray(cards) ? '<p class="muted">記録なし</p>' : cards.length ? `<ul class="log-cards">${cards.map(c=>`<li>${esc(cardName(c))}</li>`).join('')}</ul>` : '<p class="muted">なし</p>';
  const seat = (zone, index) => zone === 'teacher' ? '教卓マス' : zone === 'environment' ? '環境マス'
    : index && typeof index === 'object' && index.row != null ? `${index.row}行${index.column}列`
    : Number.isInteger(index) ? `${Math.floor(index/3)+1}行${index%3+1}列` : '';
  const knownEvent = new Map(), checks = new Map();
  // Events precede their checkpoints. If no state changed, keep the preceding checkpoint.
  let pending = null, lastCheckpoint = null, checking = false;
  for (const entry of array(log.trace?.entries)) {
    if (entry.kind === 'event') {
      if (pending != null && lastCheckpoint != null) { knownEvent.set(pending,lastCheckpoint); checks.set(pending,checking); }
      pending = entry.data?.eventSeq;
    } else if (entry.kind === 'checkpoint') {
      if (Object.hasOwn(entry.data?.changes || {}, 'lectureRoomCheck')) checking = entry.data.changes.lectureRoomCheck === true;
      lastCheckpoint = entry.seq;
      if (pending != null) { knownEvent.set(pending,entry.seq); checks.set(pending,checking); pending=null; }
    }
  }
  if (pending != null && lastCheckpoint != null) { knownEvent.set(pending,lastCheckpoint); checks.set(pending,checking); }
  const snapshots = new Map();
  const snapshot = event => {
    const seq = knownEvent.get(event?.eventSeq);
    if (seq == null) return null;
    if (!snapshots.has(seq)) {
      try { snapshots.set(seq,Replay.restore(log.trace,seq)); } catch { snapshots.set(seq,null); }
    }
    return snapshots.get(seq);
  };
  const boardHtml = board => {
    if (!board) return '<p class="muted">盤面の記録なし</p>';
    return `<div class="log-board">${['player','opponent'].map(side=>{
      const b=board[side]?.board || board[side];
      const seen=new Set();
      const cards=[];
      if(b?.teacher) cards.push(`教卓：${cardName(b.teacher)}`);
      array(b?.seats).forEach((c,i)=>{ if(!c)return; const key=c.instanceId || `${i}`; if(seen.has(key))return;seen.add(key);cards.push(`${seat('seat',i)}：${cardName(c)}${c.currentHp != null || c.hp != null ? `（攻${value(c.attack)}／体${value(c.currentHp ?? c.hp)}）`:''}`); });
      return `<div><strong>${esc(who(side))}</strong>${cards.length ? `<ul>${cards.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:'<p class="muted">出席者なし</p>'}</div>`;
    }).join('')}</div>`;
  };
  const miniClassroom = (board,side) => {
    if (!board || !Array.isArray(board.seats)) return '<div class="log-mini-missing">講義室<br>記録なし</div>';
    const slot = (card,zone,index) => {
      const position=seat(zone,index);
      const label=`${position}：${card ? cardName(card) : '空席'}`;
      return card ? `<button type="button" class="log-mini-slot occupied" aria-label="${esc(label)}"><span class="log-mini-dot" aria-hidden="true"></span><span class="log-mini-tooltip" role="tooltip">${esc(label)}</span></button>`
        : `<span class="log-mini-slot" role="img" aria-label="${esc(label)}"></span>`;
    };
    return `<figure class="log-mini-classroom ${side}" aria-label="${esc(who(side))}の講義室"><figcaption>講義室</figcaption><div class="log-mini-teacher"><span class="log-mini-label">教卓</span>${slot(board.teacher,'teacher',null)}</div><div class="log-mini-seats">${Array.from({length:9},(_,i)=>slot(board.seats[i],'seat',i)).join('')}</div></figure>`;
  };
  const countText = n => n == null ? '記録なし' : `${n}枚`;
  const metrics = (state,event) => `<div class="log-metrics">${['player','opponent'].map(side=>{
    const p=state?.players?.[side] || (event?.side===side ? event : {});
    return `<div class="log-metric-card"><div class="log-metric-copy"><strong>${esc(who(side))}</strong><span>気力 ${esc(value(p.life))}</span><span>戦意 ${esc(value(p.will))}／${esc(value(p.maxWill))}</span><span>手札 ${esc(countText(Array.isArray(p.hand)?p.hand.length:p.handCount))}</span><span>山札 ${esc(countText(Array.isArray(p.deck)?p.deck.length:p.deckCount))}</span></div>${miniClassroom(state?.players?.[side]?.board || event?.boardSnapshot?.[side],side)}</div>`;
  }).join('')}</div>`;
  const actions={draw:'ドロー',play_card:'出席',play_environment:'環境を配置',reserve_late:'遅刻ゾーンへ',evolve:'進化',use_item:'持ち物を使用',attack_card:'出席者へ攻撃',attack_life:'本体へ攻撃',lecture:'講義',fusion:'融合'};
  const effects={attendance:'効果による出席',late_resolve:'遅刻処理',damage_card:'出席者へのダメージ',damage_life:'気力へのダメージ',distributed_damage:'ランダムダメージ',heal_card:'出席者の回復',heal_life:'気力の回復',board_leave:'場を離れる'};
  const describe = e => {
    const d=e.details || {}, damage=e.damageDistribution || {};
    const card=e.cardName || (e.cardId ? cardName(e.cardId) : e.source ? cardName(e.source) : '');
    let text=`${who(e.side)}：`;
    if(e.eventType==='action') {
      text+=`${actions[e.actionType] || '行動'}${card ? `「${card}」`:''}`;
      const target=d.target || (e.targetCardId ? {cardId:e.targetCardId}:null);
      if(target)text+=` →「${cardName(target)}」`;
      const position=seat(e.targetZone,e.targetSeat);
      if(position)text+=`（${position}）`;
      if(e.cost != null && ['play_card','play_environment','use_item','reserve_late'].includes(e.actionType))text+=`／戦意${e.cost}`;
      if(d.damage != null)text+=`／ダメージ${d.damage}`;
      if(d.counterDamage != null)text+=`／反撃${d.counterDamage}`;
    } else if(e.eventType==='effect') {
      text+=`${card ? `「${card}」：`:''}${effects[e.effectType] || '効果処理'}`;
      const targets=array(e.chosenTargets).map(t=>t.side ? `${who(t.side)}の気力` : cardName(t));
      if(targets.length)text+=` → ${targets.join('、')}`;
      if(damage.dealt != null)text+=`／${damage.dealt}ダメージ`;
      if(d.healed != null)text+=`／${d.healed}回復`;
      if(e.drawCount != null)text+=`／${e.drawCount}枚ドロー`;
      if(d.targetDiedAfterDamage)text+='／破壊';
    } else if(e.eventType==='battle_start') text='対戦開始';
    else text=e.message || e.text || `その他の記録（${e.eventType || '種類不明'}）`;
    return `<li><span class="log-event-seq">${esc(e.eventSeq ? `#${e.eventSeq}`:'')}</span><span>${esc(text)}</span></li>`;
  };
  const turns=[], byAction=new Map(), counts={player:0,opponent:0};
  for(const e of events.filter(e=>e.eventType==='turn_start')) {
    const number=++counts[e.side] || turns.length+1;
    const title=typeof e.turn==='string' && /[先後]攻.*ターン/.test(e.turn) ? e.turn
      : `${firstSide ? e.side===firstSide?'先攻':'後攻' : who(e.side)}${number}ターン目`;
    const group={id:`log-turn-${turns.length+1}`,title,start:e,events:[]};
    turns.push(group);
    if(e.actionTurn != null)byAction.set(e.actionTurn,group);
  }
  let active=null;
  const others=[];
  for(const e of events) {
    if(e.eventType==='turn_start'){active=turns.find(t=>t.start===e);continue;}
    if(['game_start','coin_toss','order_choice','mulligan','game_end'].includes(e.eventType))continue;
    const group=(e.phase !== 'mulligan' && byAction.get(e.actionTurn)) || active;
    if(group)group.events.push(e);else others.push(e);
  }
  const coin=events.filter(e=>e.eventType==='coin_toss');
  const order=events.filter(e=>e.eventType==='order_choice');
  const face=key=>({heads:'表',tails:'裏',smile:'スマイル',blank:'無地',front:'表',back:'裏'}[key] || key || '記録なし');
  const sections=[{id:'log-coin',title:'コイントス',html:coin.length ? coin.map(e=>`<p>選択：${esc(face(e.call))} ／ 結果：${esc(face(e.result))} ／ 選択権：${esc(who(e.winner))}</p>`).join(''):'<p class="muted">コイントスの記録なし</p>'}];
  sections[0].html+=order.map(e=>`<p>${esc(who(e.side))}が${e.chose==='first'?'先攻':e.chose==='second'?'後攻':'順番'}を選択。先攻：${esc(who(e.firstSide))}</p>`).join('');
  sections.push({id:'log-mulligan',title:'マリガン',html:['player','opponent'].map(side=>{
    const m=events.find(e=>e.eventType==='mulligan' && e.side===side);
    if(!m)return `<h3>${esc(who(side))}</h3><p class="muted">マリガンの記録なし</p>`;
    return `<h3>${esc(who(side))}</h3><h4>最初の手札</h4>${cardList(m.initialHand)}<h4>戻したカード（${esc(value(m.returnedCount))}枚）</h4>${cardList(m.returnedCards)}<h4>引き直したカード（${esc(value(m.redrawnCount))}枚）</h4>${cardList(m.redrawnCards)}`;
  }).join('')});
  if(others.length)sections.push({id:'log-before',title:'開始前の記録',html:`<ol class="log-actions">${others.map(describe).join('')}</ol>`});
  for(const t of turns) {
    const startState=snapshot(t.start);
    const last=t.events.at(-1) || t.start;
    const endState=snapshot(last);
    const hand=startState?.players?.[t.start.side]?.hand;
    const handHtml=Array.isArray(hand) ? cardList(hand) : `<p class="muted">${esc(countText(t.start.handCount))}（内訳の記録なし）</p>`;
    const environment=endState?.environment || t.start.environment;
    const checkEvents=t.events.filter(e=>checks.get(e.eventSeq)===true);
    const actions=t.events.filter(e=>checks.get(e.eventSeq)!==true);
    sections.push({id:t.id,title:t.title,html:`<p class="log-turn-player">${esc(who(t.start.side))}</p><h3>手札（ターン開始時）</h3>${handHtml}${metrics(startState,t.start)}<h3>行動・効果</h3>${actions.length?`<ol class="log-actions">${actions.map(describe).join('')}</ol>`:'<p class="muted">行動の記録なし</p>'}`});
    sections.push({id:`${t.id}-check`,title:`講義室チェック（${t.title}の後）`,html:`${checkEvents.length?`<ol class="log-actions">${checkEvents.map(describe).join('')}</ol>`:`<p class="muted">${checks.has(t.start.eventSeq)?'効果の発動記録なし':'区切りの記録なし（効果は直前のターンに表示）'}</p>`}<details class="log-check"><summary>最終記録時点の状態</summary>${endState?metrics(endState,null):'<p class="muted">終了状態の記録なし。以下はターン開始時の盤面です。</p>'}${boardHtml(endState?.players || t.start.boardSnapshot)}<p>環境：${esc(environment?cardName(environment.card || environment):'なし')}</p></details>`});

  }
  const final=events.findLast(e=>e.eventType==='game_end')?.final || log.finalResult;
  sections.push({id:'log-result',title:'対戦結果',html:final?`<p>勝者：<strong>${esc(who(final.winner))}</strong></p><p>${esc(final.reason || '終了理由の記録なし')}</p>${boardHtml(final.finalBoard)}`:'<p class="muted">対戦終了の記録なし</p>'});
  return `<nav class="panel log-toc" aria-label="ログの目次"><h2>目次</h2><div>${sections.map(s=>`<a href="#${s.id}">${esc(s.title)}</a>`).join('')}<a href="#log-raw">元データ</a></div></nav>${sections.map(s=>`<section class="panel log-section" id="${s.id}"><h2>${esc(s.title)}</h2>${s.html}<a class="log-to-top" href="#log-toc">目次へ</a></section>`).join('')}`.replace('class="panel log-toc"','class="panel log-toc" id="log-toc"');
}
module.exports={renderTimeline};
