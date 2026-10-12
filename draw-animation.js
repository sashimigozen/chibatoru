/* Presentation only. Cards are already drawn by the game's existing rules. */
(() => {
  const active = new Set();
  const queues = new Map();
  function cancel() { [...active].forEach(flight => flight.dispose()); queues.clear(); }
  function sync() { [...active].forEach(flight => flight.sync()); }
  function play({ side, cards, deck, life, canReveal, face, isCurrent, isVisualBusy, syncScale, obtained = false }) {
    if (!cards.length || (!obtained && !deck) || !isCurrent() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const start = deck?.getBoundingClientRect() || cards[0].node.getBoundingClientRect();
    if (!start.width || !start.height) return;
    deck?.classList.remove('draw-anim');
    const compactDraw = !obtained && !canReveal;
    const width = Math.min(120, innerHeight * .15, innerWidth * .2 / (cards.length * 1.1),
      compactDraw ? Math.min(start.width, ...cards.map(({ node }) => node.getBoundingClientRect().width)) : Infinity);
    const height = width * 1.5;
    const step = width * 1.1;
    const groupWidth = width + (cards.length - 1) * step;
    const anchor = life?.getBoundingClientRect() || start;
    const groupX = Math.max(12, Math.min(innerWidth - groupWidth - 12,
      side === 'player' ? anchor.left - groupWidth - 18 : anchor.right + 18));
    const stageY = Math.max(12, Math.min(innerHeight - height - 12, anchor.top));
    // Generated cards originate at the visible hand's right edge, not the deck.
    const handRects = [...cards[0].node.parentElement.children].map(node => node.getBoundingClientRect())
      .filter(rect => rect.width && rect.height);
    const handRight = Math.max(...handRects.map(rect => rect.right));
    const handTop = Math.min(...handRects.map(rect => rect.top));
    const handBottom = Math.max(...handRects.map(rect => rect.bottom));
    const generatedX = Math.max(12, Math.min(innerWidth - groupWidth - 12, handRight - groupWidth));
    const generatedY = Math.max(12, Math.min(innerHeight - height - 12,
      side === 'player' ? handTop - height - 16 : handBottom + 16));
    // Queue whole draw batches; all cards in a batch share the same timeline.
    const before = queues.get(side) || Promise.resolve();
    const batch = [], flights = [];
    cards.forEach(({ node, card, getNode }, index) => {
      // Repeated renders replace the hand DOM; keep only one visible copy.
      if ([...active].some(flight => flight.side === side && card.instanceId && flight.id === card.instanceId)) return;
      const reveal = !card.hidden && (canReveal || (obtained && card.publicHandAddition));
      const ghost = document.createElement('div');
      ghost.className = 'draw-flight';
      if (obtained) ghost.classList.add('hand-add-flight');
      ghost.dataset.drawSide = side;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.width = `${width}px`; ghost.style.height = `${height}px`;
      ghost.style.opacity = '0';
      // Never put a hidden opponent card's name, text or image in the DOM.
      ghost.innerHTML = `<div class="draw-flight-turn"><div class="draw-flight-back"></div>${reveal ? `<div class="draw-flight-front">${face(card)}</div>` : ''}</div>`;
      document.body.appendChild(ghost);
      const turn = ghost.firstElementChild, running = new Set();
      let target = node;
      const hidden = new Map();
      let disposed = false;
      const flight = { side, id: card.instanceId, sync() {
        const latest = getNode?.() || (getNode ? null : node);
        if (!latest || !isCurrent()) { flight.dispose(); return; }
        target = latest;
        if (!hidden.has(target)) hidden.set(target, target.style.visibility);
        target.style.visibility = 'hidden';
        target.classList.remove('draw-anim');
      }, dispose() {
        if (disposed) return;
        disposed = true; running.forEach(animation => animation.cancel());
        ghost.remove(); hidden.forEach((visibility, element) => { element.style.visibility = visibility; }); active.delete(flight);
      } };
      active.add(flight);
      flights.push(flight);
      flight.sync();
      const at = (x, y, sx = 1, sy = sx, angle = 0) => `translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(${sx},${sy})`;
      const generated = obtained && (card.publicHandAddition || card.generatedHandAddition);
      const handStart = node.getBoundingClientRect();
      const origin = generated
        ? at(handRight - handStart.width, handStart.y, handStart.width / width, handStart.height / height)
        : at(start.x, start.y, start.width / width, start.height / height);
      const stageX = (generated ? generatedX : groupX) + index * step;
      const previewY = generated ? generatedY : stageY;
      ghost.style.transform = obtained && !generated ? at(stageX, previewY) : origin;
      if (obtained && reveal) turn.style.transform = 'rotateY(180deg)';
      const current = () => !disposed && target.isConnected && isCurrent();
      async function animate(element, keyframes, options) {
        if (!current()) throw new Error('draw cancelled');
        const animation = element.animate(keyframes, { fill: 'forwards', ...options });
        running.add(animation);
        await animation.finished;
        running.delete(animation);
      }
      batch.push((async () => {
        await before;
        // Let queued play/effect presentations start before testing their state.
        await new Promise(resolve => requestAnimationFrame(resolve));
        while (current() && isVisualBusy?.()) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!current()) return;
        ghost.style.opacity = '1';
        ghost.dataset.drawPhase = 'moving';
        const movement = generated ? animate(ghost, [
          { transform: origin, opacity: 0 },
          { transform: at(stageX, previewY), opacity: 1 }
        ], { duration: 400, easing: 'cubic-bezier(.22,.7,.25,1)' }) : obtained ? Promise.resolve() : animate(ghost, [
          { transform: origin },
          { transform: at(start.x + (side === 'player' ? 24 : -24), start.y - 32, start.width / width, start.height / height, side === 'player' ? 18 : -18), offset: .22 },
          { transform: at(stageX, stageY - 8, 1, 1, side === 'player' ? 8 : -8), offset: .78 },
          { transform: at(stageX, stageY) }
        ], { duration: 360, easing: 'cubic-bezier(.22,.7,.25,1)' });
        // Turn during the journey rather than adding a separate step on arrival.
        const turning = reveal && !obtained ? animate(turn, [
          { transform: 'rotateY(0deg)' },
          { transform: 'rotateY(180deg)' }
        ], { delay: 60, duration: 260, easing: 'ease-in-out' }) : Promise.resolve();
        await Promise.all([movement, turning]);
        ghost.dataset.drawPhase = 'preview';
        await animate(ghost, [{ transform: at(stageX, previewY) }, { transform: at(stageX, previewY) }], { duration: obtained ? 650 : reveal ? 180 : 100 });
        if (!current()) return;
        ghost.dataset.drawPhase = 'returning';
        const end = target.getBoundingClientRect();
        const returnMovement = animate(ghost, [
          { transform: at(stageX, previewY) },
          { transform: at(end.x, end.y, end.width / width, end.height / height) }
        ], { duration: obtained ? 800 : 300, easing: 'cubic-bezier(.4,0,.2,1)' });
        const returnTurning = obtained && reveal && !canReveal ? animate(turn, [
          { transform: 'rotateY(180deg)' },
          { transform: 'rotateY(360deg)' }
        ], { delay: 100, duration: 650, easing: 'ease-in-out' }) : Promise.resolve();
        await Promise.all([returnMovement, returnTurning]);
      })().catch(() => {}));
    });
    const previous = Promise.all(batch).finally(() => flights.forEach(flight => flight.dispose()));
    queues.set(side, previous);
    previous.finally(() => { if (queues.get(side) === previous) queues.delete(side); });
    syncScale?.();
  }
  window.ChibattleDraw = { play, cancel, sync, isBusy: () => active.size > 0 };
  window.addEventListener('pagehide', cancel);
  window.addEventListener('resize', cancel);
})();
