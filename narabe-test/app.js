/* Seven-only runtime. Never reads battle state, sends analytics, or modifies normal saves. */
(() => {
  'use strict';
  const E = window.Narabe, $ = id => document.getElementById(id);
  let socket = null, local = null, state = null, roomCode = '', cpuTimer = null, connecting = false, helloTimer = null;
  let shown = null, ownSeat = 0, epoch = 0, visualQueue = Promise.resolve(), busy = false, pending = false;
  let selected = null, cancelDrags = [], activeMove = null;
  let specialDraft=null,choiceSelection=null,choiceRevision=-1,helpOpen=false;
  let selectionPeek=false;
  const dealFlights=new Set();
  function cancelDealFlights(){for(const flight of dealFlights)flight.animation.cancel();}
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  $('endpoint').value = localHost ? `ws://${location.host}/narabe` : 'wss://chibatoru-online.onrender.com/narabe';
  try { $('name').value = sessionStorage.getItem('chibatoru-narabe-name') || 'チバトル学生'; } catch {}
  const text = (tag, content, cls) => { const el = document.createElement(tag); el.textContent = content; if (cls) el.className = cls; return el; };
  let cardsReady=false;
  function status(message) { $('status').textContent = message; $('gameStatus').textContent = message; }
  function send(data) { if (socket?.readyState === 1) socket.send(JSON.stringify(data)); }
  function setConnectionUI() {
    $('disconnected').hidden = Boolean(state); $('connected').hidden = !state;
    $('solo').disabled = !cardsReady || Boolean(socket); $('total').disabled = Boolean(state && !state.host);
    $('name').disabled = Boolean(socket); $('create').disabled = !cardsReady || connecting; $('join').disabled = !cardsReady || connecting;
  }
  function disconnect(message = '') {
    epoch++; window.ChibattleDraw.cancel();cancelDealFlights(); activeMove?.cancel(); activeMove = null;
    cancelDrags.forEach(cancel => cancel()); cancelDrags = []; shown = null; selected = null; busy = false; pending = false;
    document.body.classList.remove('narabe-playing'); document.documentElement.classList.remove('narabe-input-blocked');
    $('menuDrawer').hidden = true; $('logDrawer').hidden = true;$('cardPreview').hidden=true;
    $('specialDialog').hidden=true;$('selectionReturn').hidden=true;selectionPeek=false;specialDraft=null;helpOpen=false;choiceSelection=null;choiceRevision=-1;
    $('menuButton').setAttribute('aria-expanded','false'); $('logButton').setAttribute('aria-expanded','false');
    clearTimeout(cpuTimer); clearTimeout(helloTimer); const old = socket; socket = null;
    old?.close(); connecting = false; state = null; roomCode = ''; local = null;
    $('battle').hidden = true; $('lobby').hidden = false; setConnectionUI(); if (message) status(message);
  }
  function connect(type) {
    if (!cardsReady || socket || connecting) return;
    const endpoint = $('endpoint').value.trim();
    let url; try { url = new URL(endpoint); } catch { status('接続先URLを確認してください。'); return; }
    if (!['ws:', 'wss:'].includes(url.protocol) || (location.protocol === 'https:' && url.protocol !== 'wss:')) { status('安全なWebSocket接続先を指定してください。'); return; }
    url.pathname = '/narabe'; url.search = ''; url.hash = '';
    connecting = true; const current = socket = new WebSocket(url); setConnectionUI(); status('接続中…（無料サーバーの起動に時間がかかる場合があります）');
    helloTimer = setTimeout(() => { if (socket === current && !state) disconnect('接続できませんでした。七並べ対応サーバーへの更新、または接続先を確認してください。'); }, 65000);
    current.addEventListener('message', event => {
      if (current !== socket) return;
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.type === 'hello' && m.mode === 'narabe') send({ type, name: $('name').value, code: $('code').value });
      if (m.type === 'error') { pending=false;refreshControls();status(m.message); if (!state) disconnect(m.message); }
      if (m.type === 'state') {
        clearTimeout(helloTimer); connecting = false; state = m; roomCode = m.code; setConnectionUI(); renderRoom();
        status(m.game ? '' : '全員が準備OKになったら、ホストが開始します。'); if (m.game) queueGame(m.game, m.seat);
      }
    });
    current.addEventListener('close', () => { if (current === socket) disconnect('接続が切れました。このテスト版では再接続できません。'); });
    current.addEventListener('error', () => { if (current === socket) disconnect('接続できませんでした。接続先とサーバーの更新状況を確認してください。'); });
  }
  function renderRoom() {
    $('copy').textContent = roomCode; $('people').replaceChildren();
    state.people.forEach((p, i) => { const row = text('div', '', 'person'); row.append(text('strong', `${p.name}${i === state.seat ? '（あなた）' : ''}`), text('span', `${i === 0 ? 'ホスト · ' : ''}${p.ready ? '準備OK' : '準備中'}`)); $('people').append(row); });
    $('ready').textContent = state.people[state.seat]?.ready ? '準備を解除' : '準備OK';
    $('start').hidden = !state.host; $('start').disabled = !state.people.every(p => p.ready);
    if (state.host && Number($('total').value) < state.people.length) $('total').value = state.people.length;
  }
  function perform(action) {
    if (busy || pending || shown?.presenting) return;
    if (local) {
      if (!E.actorSeats(local).includes(0) || !E.act(local, 0, action)) return;
      queueGame(E.view(local, 0), 0);
    } else if (state?.game && shown?.actors?.includes(state.seat)) {
      pending = true; refreshControls(); send({ type: 'action', revision: shown.revision, action });
    }
  }
  function scheduleCPU() {
    clearTimeout(cpuTimer); if (!local || local.over) return;
    const seat=E.actorSeats(local).find(seat=>seat!==0);if(seat===undefined)return;
    cpuTimer = setTimeout(() => {
      const action=E.aiAction(local,seat);if(action)E.act(local,seat,action);
      queueGame(E.view(local, 0), 0);
    }, 650);
  }
  function myTurn(g = shown, seat = ownSeat) { return Boolean(g && !g.over && !g.pending && !g.presenting && g.turn === seat && g.players[seat].status === 'playing'); }
  const canPlace=c=>Boolean(shown&&!specialDraft&&!shown.choice&&E.playable(shown,ownSeat).some(card=>card.id===c.id));
  const placeAction=c=>({type:shown.turnState.ordinary<1+shown.turnState.extra?'play':'chain',cardId:c.id});
  function refreshControls() {
    document.documentElement.classList.toggle('narabe-input-blocked', busy || pending || Boolean(shown?.presenting));
    $('pass').disabled = busy || pending || !myTurn() || Boolean(specialDraft);
    $('hand').querySelectorAll('button').forEach(b => {
      b.disabled = busy || pending;
      const card=E.cards.find(c=>String(c.id)===b.dataset.cardId);
      b.classList.toggle('playable',!busy&&!pending&&myTurn()&&Boolean(card&&canPlace(card)));
    });
    $('specialHand').querySelectorAll('button').forEach(b=>{
      const usable=shown?.players[ownSeat]?.usableSpecials?.includes(b.dataset.specialId);
      b.disabled=busy||pending||!usable;b.classList.toggle('playable',!b.disabled);
    });
    if (busy) { $('turn').textContent = shown ? 'カードを処理しています' : '配札中'; $('handHelp').textContent = '演出が終わるまでお待ちください。'; }
  }
  function cardNode(c, tag = 'div') {
    c=E.cardAt(c.suit,c.rank);
    const el=text(tag,'','narabe-shell');el.dataset.baseId=c.baseId;
    const face=document.createElement('chibatoru-original-card');face.dataset.baseId=c.baseId;face.setAttribute('aria-hidden','true');
    el.append(face);return el;
  }
  function emptySeat(suit,rank) {
    const el=text('div','','empty-seat-card');
    el.append(text('span',String(rank),'slot-number'));
    el.setAttribute('aria-label',`${E.suits[suit]}・戦意${rank} 空席（配置済み・能力なし）`);return el;
  }
  function inspect(c){$('previewCard').replaceChildren(cardNode(c));$('previewName').textContent=E.cardName(c);$('cardPreview').hidden=false;}
  function targetOf(c) { return $('table').querySelector(`[data-card-id="${c.id}"]`); }
  function clearHints() { $('table').querySelectorAll('.drop-target,.drop-hover').forEach(el => el.classList.remove('drop-target','drop-hover')); }
  function select(c, button) {
    selected = c; $('hand').querySelectorAll('.selected').forEach(el => el.classList.remove('selected')); button.classList.add('selected'); clearHints();
    if (myTurn() && canPlace(c)) targetOf(c)?.classList.add('drop-target');
  }
  function fitCards() {
    const hand = $('hand');hand.style.minWidth='';
    const count=hand.children.length,width=Math.max(1,hand.clientWidth-20);
    if(count){
      const cw=hand.firstElementChild.offsetWidth,ch=hand.firstElementChild.offsetHeight;
      const capacity=Math.max(1,Math.min(count,Math.floor((width-cw)/(cw*.42))+1));
      const rows=Math.ceil(count/capacity),columns=Math.ceil(count/rows),step=columns>1?Math.min(cw*.75,(width-cw)/(columns-1)):0;
      [...hand.children].forEach((card,i)=>{const row=Math.floor(i/columns),n=Math.min(columns,count-row*columns);card.style.left=`${10+(width-cw-step*(n-1))/2+(i%columns)*step}px`;card.style.top=`${row*(ch+22)}px`;});
      hand.style.height=`${rows*ch+(rows-1)*22+5}px`;
      $('battle').style.setProperty('--hand-stack-height',`${Math.max(112,rows*ch+(rows-1)*22)}px`);
    }else{hand.style.height='var(--hand-height)';$('battle').style.removeProperty('--hand-stack-height');}
    $('players').querySelectorAll('.opponent-backs').forEach(row => {
      const n = row.children.length, cw = row.firstElementChild?.getBoundingClientRect().width || 0;
      if (n > 1) row.style.setProperty('--back-overlap',`${Math.min(20, (row.clientWidth-cw-10)/(n-1))-cw}px`);
    });
  }
  function specialNode(id,tag='button',details=false){
    const c=E.specialById.get(id),el=text(tag,'','special-card');
    if(tag==='button')el.type='button';el.dataset.specialId=id;
    el.append(text('strong',c.name));
    if(details){el.classList.add('special-details');el.append(text('span',c.text,'special-card-text'));}
    el.setAttribute('aria-label',`${c.name}：${c.text}`);el.title=c.text;return el;
  }
  function beginSpecial(id){
    if(busy||pending||!shown?.players[ownSeat]?.usableSpecials?.includes(id))return;
    specialDraft={id,params:{}};helpOpen=false;selectionPeek=false;drawSpecialDialog();
  }
  function selectOption(button,callback){button.type='button';button.onclick=callback;return button;}
  function drawSpecialDialog(){
    const dialog=$('specialDialog'),choice=shown?.choice;
    refreshControls();
    if(choice&&choiceRevision!==choice.requestId){choiceRevision=choice.requestId;choiceSelection=null;selectionPeek=false;}
    const hasSelection=Boolean(choice||specialDraft||helpOpen);
    if(!hasSelection)selectionPeek=false;
    $('selectionReturn').hidden=!hasSelection||!selectionPeek||busy;
    if(!shown||shown.presenting||busy){dialog.hidden=true;return;}
    dialog.hidden=!hasSelection||selectionPeek;if(dialog.hidden)return;
    const options=$('specialOptions');options.replaceChildren();$('specialConfirm').disabled=false;
    $('specialClose').hidden=Boolean(choice);$('specialConfirm').hidden=false;
    if(helpOpen&&!choice&&!specialDraft){
      $('specialTitle').textContent='専用カードのルール';$('specialText').textContent='全員を通して重複なしで1人3枚。自分の通常配置前に1手番1枚まで。使用後は消費し、補充はありません。通常手札が0枚であがりです。';
      E.specials.forEach(c=>options.append(specialNode(c.id,'div',true)));$('specialConfirm').hidden=true;return;
    }
    if(choice){
      $('specialTitle').textContent=choice.title;
      $('specialText').textContent=choice.kind==='info'?'この情報はあなただけに表示されます。確認を終了すると再び隠されます。':'カードを1枚選んで確定してください。全員交換と公開授業は、全員の選択が揃うまで待ちます。';
      if(choice.kind==='info'){
        choice.groups.forEach(group=>{const section=text('section','','private-hand-group');section.append(text('strong',shown.players[group.seat].name));const row=text('div','','special-options');group.cards.forEach(c=>{const card=cardNode(c);card.setAttribute('aria-label',E.cardName(c));row.append(card);});section.append(row);options.append(section);});
        $('specialConfirm').textContent='確認を終了';$('specialConfirm').onclick=()=>perform({type:'choice',requestId:choice.requestId});
      }else{
        choice.cards.forEach(c=>{const button=cardNode(c,'button');button.classList.toggle('selected',choiceSelection===c.id);button.setAttribute('aria-label',E.cardName(c));button.setAttribute('aria-pressed',String(choiceSelection===c.id));options.append(selectOption(button,()=>{choiceSelection=c.id;drawSpecialDialog();}));});
        $('specialConfirm').textContent='選んだカードで確定';$('specialConfirm').disabled=choiceSelection===null;
        $('specialConfirm').onclick=()=>perform({type:'choice',cardId:choiceSelection,requestId:choice.requestId});
      }
      return;
    }
    const {id,params}=specialDraft,c=E.specialById.get(id);
    $('specialTitle').textContent=c.name;$('specialText').textContent=c.text;
    const addPlain=(label,selected,callback)=>{const b=text('button',label,'special-option');b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));options.append(selectOption(b,callback));};
    let complete=true;
    if(['inspect','confuse','exchange','force','nominate'].includes(id)){
      if(params.targetSeat===undefined)complete=false;
      shown.players.forEach((p,i)=>{if(i!==ownSeat&&p.status==='playing')addPlain(p.name,params.targetSeat===i,()=>{params.targetSeat=i;drawSpecialDialog();});});
    }
    if(id==='block'){
      if(params.suit===undefined)complete=false;
      E.types.forEach((type,suit)=>addPlain(type.label,params.suit===suit,()=>{params.suit=suit;drawSpecialDialog();}));
    }
    if(id==='exchange'||id==='cunning'){
      if(params.cardId===undefined)complete=false;
      const row=text('div','','special-options');
      shown.players[ownSeat].hand.filter(c=>id!=='cunning'||E.canPlay(shown,c,true)).forEach(c=>{const b=cardNode(c,'button');b.setAttribute('aria-label',E.cardName(c));b.classList.toggle('selected',params.cardId===c.id);row.append(selectOption(b,()=>{params.cardId=c.id;drawSpecialDialog();}));});options.append(row);
    }
    $('specialConfirm').textContent=complete?'使用する':'対象を選んでください';$('specialConfirm').disabled=!complete;
    $('specialConfirm').onclick=()=>{const action={type:'special',specialId:id,...params};specialDraft=null;selectionPeek=false;perform(action);dialog.hidden=true;};
  }
  async function revealSpecial(before,after,token){
    const event=after.lastSpecial;
    if(!event||event.serial===before.lastSpecial?.serial)return;
    const overlay=$('specialReveal'),card=$('specialRevealCard');
    card.replaceChildren(specialNode(event.id,'div'));
    $('specialRevealName').textContent=`${after.players[event.seat].name}：${E.specialById.get(event.id).name}`;
    overlay.hidden=false;
    const target=(event.seat===ownSeat?$('specialHand'):$(`opponentInfo${event.seat}`)).getBoundingClientRect(),rect=card.getBoundingClientRect();
    card.style.setProperty('--play-target-x',`${target.x+target.width/2-rect.x-rect.width/2}px`);
    card.style.setProperty('--play-target-y',`${target.y+target.height/2-rect.y-rect.height/2}px`);
    const animation=card.animate(window.NarabeOriginalCard.playRevealFrames,{duration:1450,easing:'ease-in-out',fill:'forwards'});
    activeMove=animation;
    try{await animation.finished;}catch{}finally{overlay.hidden=true;card.replaceChildren();activeMove=null;}
    if(token!==epoch)return;
  }
  async function deal(g, seat, token) {
    $('dealSource').hidden = false;
    // Everyone receives one card simultaneously, then the next round starts.
    const hands=g.players.map((p,i) => {
      const nodes = i === seat ? [...$('hand').children] : [...$(`opponentHand${i}`).children];
      nodes.forEach(node=>{node.style.visibility='hidden';});
      return nodes.map((node,j) => ({ node, card: i === seat ? { ...p.hand[j], instanceId:`deal-${i}-${j}` } : { hidden:true, instanceId:`deal-${i}-${j}` } }));
    });
    const updateCount=(owner,count)=>{
      const target=owner===seat?$('handCount'):$(`opponentInfo${owner}`).querySelector('div>span:last-child');
      target.textContent=`${count}枚`;
      if(owner!==seat)$(`opponentHand${owner}`).setAttribute('aria-label',`${g.players[owner].name}の手札 ${count}枚`);
    };
    g.players.forEach((_,i)=>updateCount(i,0));
    for(let round=0;round<Math.max(...hands.map(h=>h.length));round++){
      if(token!==epoch)return;
      $('turn').textContent='配札中';$('handHelp').textContent=`全員へ1枚ずつ配ります（${round+1}枚目）`;
      await Promise.all(hands.map(async(hand,i)=>{
        const entry=hand[round];if(!entry)return;
        const origin=$('dealSource').querySelector('img').getBoundingClientRect(),target=entry.node.getBoundingClientRect();
        if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
          const ghost=i===seat?cardNode(entry.card):document.createElement('img');
          if(i!==seat){ghost.src='../assets/card-back.png';ghost.alt='';}
          ghost.classList.add('narabe-deal-flight');ghost.dataset.dealSeat=i;ghost.setAttribute('aria-hidden','true');
          Object.assign(ghost.style,{width:`${target.width}px`,height:`${target.height}px`,left:`${origin.x+(origin.width-target.width)/2}px`,top:`${origin.y+(origin.height-target.height)/2}px`});
          document.body.append(ghost);
          const animation=ghost.animate([{transform:'translate(0,0)',opacity:0},{opacity:1,offset:.18},{transform:`translate(${target.x-origin.x-(origin.width-target.width)/2}px,${target.y-origin.y-(origin.height-target.height)/2}px)`,opacity:1}],{duration:480,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
          const flight={animation,ghost};dealFlights.add(flight);
          try{await animation.finished;}catch{}finally{ghost.remove();dealFlights.delete(flight);}
        }
        if(token!==epoch)return;
        entry.node.style.visibility='';updateCount(i,round+1);
      }));
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)await new Promise(resolve=>setTimeout(resolve,120));
    }
    if (token===epoch) { window.ChibattleDraw.cancel(); $('dealSource').hidden = true; }
  }
  async function movePlayedCard(before, after, token) {
    const added=[];after.board.forEach((row,suit)=>row.forEach((filled,i)=>{if(filled&&!before.board[suit][i]&&E.cardAt(suit,i+1))added.push(E.cardAt(suit,i+1));}));
    if (added.length!==1 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c=added[0], seat=after.lastMove?.cardId===c.id?after.lastMove.seat:before.turn;
    const source=seat===ownSeat ? $('hand').querySelector(`[data-card-id="${c.id}"]`) : $(`opponentHand${seat}`)?.lastElementChild;
    const target=targetOf(c); if(!source||!target)return;
    const from=source.getBoundingClientRect(),to=target.getBoundingClientRect();
    const ghost=cardNode(c);ghost.classList.add('card-move-flight');ghost.setAttribute('aria-hidden','true');
    Object.assign(ghost.style,{position:'fixed',left:`${from.x}px`,top:`${from.y}px`,width:`${from.width}px`,height:`${from.height}px`,zIndex:160,pointerEvents:'none',transformOrigin:'top left'});
    document.body.append(ghost);source.style.visibility='hidden';
    try {
      activeMove=ghost.animate([{transform:'translate(0,0)'},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) scale(${to.width/from.width},${to.height/from.height})`}],{duration:360,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});
      await activeMove.finished;
    } catch {} finally { ghost.remove(); source.style.visibility=''; activeMove=null; }
  }
  async function placeStartingCards(final,seat,token){
    for(const {seat:owner,card} of final.startingCards||[]){
      if(token!==epoch)return;
      const after=structuredClone(shown),player=after.players[owner];
      after.board[card.suit][card.rank-1]=true;player.count--;
      if(owner===seat)player.hand=player.hand.filter(c=>c.id!==card.id);
      const message=`${player.name}：戦意${E.start}を場へ（${player.count+1}枚 → ${player.count}枚）`;
      $('turn').textContent='戦意5を場に並べています';$('handHelp').textContent=message;
      if(owner===seat)$('hand').querySelector(`[data-card-id="${card.id}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
      await movePlayedCard({...shown,turn:owner},after,token);
      if(token!==epoch)return;
      after.log.push(message);shown=after;renderGame(after,seat);refreshControls();
      $('turn').textContent='戦意5を場に並べています';$('handHelp').textContent=message;
      await new Promise(resolve=>setTimeout(resolve,450));
    }
  }
  function queueGame(g,seat) {
    const next=structuredClone(g),token=epoch;
    visualQueue=visualQueue.catch(()=>{}).then(async()=>{
      if(token!==epoch)return;
      busy=true;pending=false;ownSeat=seat;cancelDrags.forEach(cancel=>cancel());cancelDrags=[];clearHints();
      refreshControls();
      if (!shown) {
        shown=E.initialDealView(next,seat);renderGame(shown,seat);refreshControls();
        $('turn').textContent='配札中';await deal(shown,seat,token);
        if(token!==epoch)return;
        await placeStartingCards(next,seat,token);
        if(token!==epoch)return;
        shown=next;
        if(socket)send({type:'dealt'});
      } else { await revealSpecial(shown,next,token);if(token!==epoch)return;await movePlayedCard(shown,next,token); if(token!==epoch)return; shown=next;renderGame(next,seat); }
      busy=false;renderGame(next,seat);refreshControls();drawSpecialDialog();
      if(local)scheduleCPU();
    }).catch(()=>{if(token===epoch){busy=false;pending=false;window.ChibattleDraw.cancel();refreshControls();status('演出を中断しました。開始画面からやり直してください。');}});
  }
  function renderGame(g, seat) {
    document.body.classList.add('narabe-playing');
    $('lobby').hidden = true; $('battle').hidden = false;
    const mine = g.players[seat], operative = myTurn(g,seat);
    $('turn').textContent = g.over ? '対戦終了' : g.presenting ? '全員の配札を待っています' : g.pending ? (g.choice?'カードを選んでください':'ほかのプレイヤーの選択を待っています') : operative ? 'あなたの番です' : `${g.players[g.turn].name}の番です`;
    $('turnEffects').textContent=[g.direction===1?'順方向':'逆方向',...(g.blocks||[]).map(b=>`${E.suits[b.suit]} 配置禁止`),g.turnState?.extra?'追加配置あり':'',g.turnState?.chain?'連鎖出席':''].filter(Boolean).join(' ／ ');
    $('players').replaceChildren();
    $('players').style.setProperty('--opponent-count',g.players.length-1);
    g.players.forEach((p, i) => {
      if(i===seat)return;
      const box = text('div', '', `player${!g.over && i === g.turn ? ' active' : ''}${p.status==='eliminated'?' eliminated':''}`);
      const backs=text('div','',`opponent-backs${p.count?'':' empty'}`);backs.id=`opponentHand${i}`;backs.setAttribute('aria-label',`${p.name}の手札 ${p.count}枚`);
      for(let j=0;j<p.count;j++){const back=document.createElement('img');back.src='../assets/card-back.png';back.className='card-back';back.alt='';backs.append(back);}
      const info=text('div','','player-info');info.id=`opponentInfo${i}`;
      const counts=text('div','');counts.append(text('span',`パス：${p.passes}回`),text('span',p.rank?`${p.rank}位${p.status==='eliminated'?'（脱落）':''}`:`通常${p.count}・専用${p.specialCount}枚`));
      info.append(text('strong',p.name),counts);box.append(backs,info);$('players').append(box);
      if(p.confused)info.append(text('small','次の手番：混乱','opponent-effect'));
      if(p.revealed?.length){const row=text('div','','public-hand');p.revealed.forEach(c=>{const b=cardNode(c,'button');b.type='button';b.onclick=()=>inspect(c);b.setAttribute('aria-label',`公開：${E.cardName(c)}`);row.append(b);});box.append(row);}
    });
    const priorScroll=$('table').parentElement.scrollLeft;
    $('table').replaceChildren();
    // Display order only; suit indexes and card IDs remain unchanged for rules / networking.
    ['environment','teacher','student','vampire','item'].map(id=>E.types.findIndex(type=>type.id===id)).forEach(suit => g.board[suit].forEach((filled, index) => {
      const type=E.types[suit];
      const c=E.cardAt(suit,index+1)||{id:suit*E.ranks+index,suit,rank:index+1},missing=!E.cardAt(suit,index+1),cell=text('div','',`slot${filled?' filled':''}${missing?' empty-seat':''}`);cell.dataset.cardId=c.id;
      if(index===0)cell.dataset.rowLabel=type.label;
      if(filled)cell.append(missing?emptySeat(suit,index+1):cardNode(c));
      else cell.append(text('span',String(index+1),'slot-number'));
      cell.setAttribute('aria-label',E.cardName(c)+(filled?' 配置済み':' 空き'));cell.title=cell.getAttribute('aria-label');
      cell.onclick=()=>{if(filled&&!missing)inspect(c);else if(selected?.id===c.id&&canPlace(c))perform(placeAction(c));};
      if(filled&&!missing){cell.tabIndex=0;cell.setAttribute('role','button');cell.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();inspect(c);}};}
      $('table').append(cell);
    }));
    $('placedCount').textContent=`${E.cards.filter(c=>g.board[c.suit][c.rank-1]).length} / ${E.cards.length}（空席${E.types.length*E.ranks-E.cards.length}マス）`;
    $('table').parentElement.scrollLeft=priorScroll || Math.max(0,($('table').parentElement.scrollWidth-$('table').parentElement.clientWidth)/2);
    cancelDrags.forEach(cancel=>cancel());cancelDrags=[];
    $('hand').replaceChildren(); $('handCount').textContent = `${mine.count}枚`;
    (mine.hand || []).forEach(c => {
      const playable=operative&&E.playable(g,seat).some(card=>card.id===c.id),b=cardNode(c,'button');b.type='button';b.classList.add('hand-card','playing-card');if(playable)b.classList.add('playable');
      b.dataset.cardId=c.id;b.setAttribute('aria-label',E.cardName(c));b.title=E.cardName(c)+' — '+(playable?'クリック、または場へドラッグして出す':'持つことはできますが、今は出せません');
      b.oncontextmenu=event=>{event.preventDefault();inspect(c);};
      cancelDrags.push(window.ChibattleHandDrag.bind(b,{
        canLift:()=>!busy&&!pending&&!shown?.presenting&&!specialDraft&&!shown?.choice,
        onStart:()=>select(c,b),
        onMove:event=>{const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('.slot');$('table').querySelectorAll('.drop-hover').forEach(el=>el.classList.remove('drop-hover'));if(cell?.dataset.cardId===String(c.id)&&myTurn()&&canPlace(c))cell.classList.add('drop-hover');},
        onDrop:event=>{const cell=document.elementFromPoint(event.clientX,event.clientY)?.closest('.slot');if(cell?.dataset.cardId===String(c.id)&&myTurn()&&canPlace(c))perform(placeAction(c));},
        onFinish:clearHints,
        onClick:()=>{if(busy||pending)return;if(specialDraft||shown?.choice){inspect(c);return;}if(myTurn()&&canPlace(c))perform(placeAction(c));else{select(c,b);status(myTurn()?'そのカードは、つながり・配置禁止・追加配置の条件を満たしていません。':'ほかのプレイヤーの手番または選択中です。');}}
      }));$('hand').append(b);
    });
    $('selfName').textContent=mine.name;$('selfPasses').textContent=`パス：${mine.passes}回`;$('selfInfo').classList.toggle('active',operative);
    $('specialHand').replaceChildren(...(mine.specials||[]).map(id=>{const b=specialNode(id);b.onclick=()=>beginSpecial(id);return b;}));
    $('specialLabel').textContent=`専用カード ${mine.specialCount}枚${operative&&g.turnState.specialUsed?'・使用済み':''}`;
    $('pass').disabled = !operative || busy || pending; $('pass').textContent = g.turnState?.ordinary>0?'追加せず終了':g.turnState?.supplement?'補講で終了':mine.passes >= 3 ? 'パスして脱落' : `パス（残り${3 - mine.passes}回）`;
    $('handHelp').textContent = g.over ? '対戦が終了しました。' : mine.status !== 'playing' ? 'ほかのプレイヤーの決着を待っています。' : operative ? 'カードをクリック、または場へドラッグしてください。' : 'ほかのプレイヤーの手番です。';
    $('logs').replaceChildren(...[...g.log].reverse().map(x => text('li', x)));
    $('results').hidden = !g.over;
    if (g.over) $('rankings').replaceChildren(...[...g.players].sort((a, b) => a.rank - b.rank).map(p => text('li', `${p.name}${p.status === 'eliminated' ? '（脱落）' : ''}`)));
    fitCards();
  }
  $('solo').onclick = () => { if(!cardsReady)return;epoch++;shown=null;local = E.create(Array.from({ length: Number($('total').value) }, (_, i) => i ? `CPU ${i}` : $('name').value.trim() || 'あなた')); status(''); queueGame(E.view(local, 0), 0); };
  $('create').onclick = () => connect('create');
  $('joinForm').onsubmit = e => { e.preventDefault(); connect('join'); };
  $('ready').onclick = () => send({ type: 'ready' }); $('start').onclick = () => send({ type: 'start', total: Number($('total').value) });
  $('leave').onclick = () => disconnect('部屋を退出しました。');
  $('quit').onclick = () => { if ((local && !local.over || state?.game && !state.game.over) && !confirm('開始画面に戻りますか？ オンライン対戦中は脱落になります。')) return; disconnect(''); };
  $('resultBack').onclick=()=>disconnect('');
  $('pass').onclick = () => { if(busy||pending)return;const ending=shown?.turnState?.ordinary>0,free=shown?.turnState?.supplement;if(!ending&&!free&&shown?.players[ownSeat]?.passes>=3&&!confirm('4回目のパスで脱落します。よろしいですか？'))return;perform({type:ending?'end':'pass'}); };
  $('specialClose').onclick=()=>{if(shown?.choice)return;specialDraft=null;helpOpen=false;selectionPeek=false;drawSpecialDialog();};
  $('selectionPeek').onclick=()=>{selectionPeek=true;drawSpecialDialog();$('selectionReturn').focus();};
  $('selectionReturn').onclick=()=>{selectionPeek=false;$('cardPreview').hidden=true;drawSpecialDialog();$('selectionPeek').focus();};
  $('specialHelp').onclick=()=>{specialDraft=null;helpOpen=true;selectionPeek=false;drawSpecialDialog();};
  E.specials.forEach(c=>{$('specialRules').append(text('dt',c.name),text('dd',c.text));});
  function drawer(which,open){const id=which==='menu'?'menuDrawer':'logDrawer',button=which==='menu'?'menuButton':'logButton';if(open)$('cardPreview').hidden=true;$(id).hidden=!open;$(button).setAttribute('aria-expanded',String(open));}
  $('menuButton').onclick=()=>{drawer('log',false);drawer('menu',$('menuDrawer').hidden);};$('logButton').onclick=()=>{drawer('menu',false);drawer('log',$('logDrawer').hidden);};
  $('menuClose').onclick=()=>drawer('menu',false);$('logClose').onclick=()=>drawer('log',false);
  $('previewClose').onclick=()=>{$('cardPreview').hidden=true;};
  window.addEventListener('keydown',event=>{if(event.key==='Escape'){cancelDrags.forEach(cancel=>cancel());clearHints();drawer('menu',false);drawer('log',false);$('cardPreview').hidden=true;}});
  window.addEventListener('resize',()=>{if(shown){cancelDrags.forEach(cancel=>cancel());cancelDealFlights();activeMove?.cancel();fitCards();const panel=$('table').parentElement;panel.scrollLeft=Math.max(0,(panel.scrollWidth-panel.clientWidth)/2);}});
  $('copy').onclick = async () => { try { await navigator.clipboard.writeText(roomCode); status('部屋番号をコピーしました。'); } catch { status(`部屋番号：${roomCode}（コピーできない場合は手入力してください）`); } };
  window.addEventListener('pagehide', () => { epoch++;cancelDrags.forEach(cancel=>cancel());cancelDealFlights();activeMove?.cancel();window.ChibattleDraw.cancel();clearTimeout(cpuTimer); socket?.close(); });
  window.NarabeOriginalCard.ready.then(()=>{cardsReady=true;setConnectionUI();}).catch(()=>status('通常版のカード表示を読み込めませんでした。テストサーバーから開き直してください。'));
})();
