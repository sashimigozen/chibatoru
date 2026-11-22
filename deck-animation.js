/* Presentation only: deck contents and randomness are resolved by the game. */
(() => {
  const tails = new Map(), active = new Set();
  let generation = 0;
  const barrier = side => tails.get(side) || Promise.resolve();
  function follow(side, promise) {
    const tail = Promise.resolve(promise).catch(() => {});
    tails.set(side, tail);
    tail.finally(() => { if (tails.get(side) === tail) tails.delete(side); });
    return tail;
  }
  function cancel() {
    generation += 1;
    [...active].forEach(job => job.dispose());
    tails.clear();
  }
  function play({ side, type, count = 1, cards = [], origins = [], sourceZone = 'hand', deck, hand, trash,
    face, isCurrent, isVisualBusy, syncScale }) {
    const before = barrier(side), epoch = generation;
    const nodes = [], animations = new Set();
    let disposed = false;
    const job = { dispose() {
      if (disposed) return;
      disposed = true;
      animations.forEach(animation => animation.cancel());
      nodes.forEach(node => node.remove());
      active.delete(job);
    } };
    active.add(job);
    const current = () => !disposed && epoch === generation && isCurrent();
    function ghost(width, height, card = null, total = 0) {
      const node = document.createElement('div');
      node.className = 'deck-flight';
      node.dataset.deckSide = side; node.dataset.deckPhase = type;
      node.setAttribute('aria-hidden', 'true');
      Object.assign(node.style, { width: `${width}px`, height: `${height}px` });
      // Returning hand cards always use backs. Only generated cards are public.
      node.innerHTML = card ? `<div class="deck-flight-face">${face(card)}</div>` : '<div class="deck-flight-back"></div>';
      if (total > 1) {
        const badge = document.createElement('span'); badge.className = 'deck-flight-count';
        badge.textContent = `×${total}`; node.appendChild(badge);
      }
      document.body.appendChild(node); nodes.push(node); return node;
    }
    async function animate(node, frames, duration, delay = 0) {
      if (!current()) return;
      const animation = node.animate(frames, { duration, delay, fill: 'forwards', easing: 'cubic-bezier(.4,0,.2,1)' });
      animations.add(animation);
      try { await animation.finished; } catch (_) { /* cancelled battle or resize */ }
      animations.delete(animation);
    }
    const at = (x, y, sx = 1, sy = sx, angle = 0) => `translate3d(${x}px,${y}px,0) rotate(${angle}deg) scale(${sx},${sy})`;
    const promise = (async () => {
      await before;
      await new Promise(resolve => requestAnimationFrame(resolve));
      while (current() && isVisualBusy?.()) await new Promise(resolve => setTimeout(resolve, 40));
      if (!current() || matchMedia('(prefers-reduced-motion: reduce)').matches || !deck) return;
      const end = deck.getBoundingClientRect();
      if (!end.width || !end.height) return;
      if (type === 'shuffle') {
        const width = end.width, height = end.height;
        const spread = Math.min(30, width * .42);
        const stacks = [ghost(width, height), ghost(width, height), ghost(width, height)];
        await Promise.all(stacks.map((node, index) => animate(node, [
          { transform: at(end.x + index * 2, end.y - index * 2) },
          { transform: at(end.x + (index - 1) * spread, end.y - 12 - index * 3, 1, 1, (index - 1) * 9), offset: .28 },
          { transform: at(end.x - (index - 1) * spread, end.y - 5 - index * 4, 1, 1, -(index - 1) * 7), offset: .65 },
          { transform: at(end.x + index * 1.5, end.y - index * 1.5), opacity: 1 },
          { transform: at(end.x, end.y), opacity: 0 }
        ], 660)));
        return;
      }
      if (type === 'deck-generate') {
        // Batch identical cards so ten generated copies do not take ten reveals.
        const groups = new Map();
        for (const card of cards) {
          const key = JSON.stringify([card.baseId, card.cost, card.attack, card.currentHp, card.rewardFoilStyle]);
          const group = groups.get(key) || { card, count: 0 }; group.count += 1; groups.set(key, group);
        }
        const entries = [...groups.values()];
        const width = Math.min(136, innerHeight * .23, (innerWidth - 32) / Math.max(1, entries.length * 1.14));
        const height = width * 1.5, step = width * 1.14;
        const groupWidth = width + Math.max(0, entries.length - 1) * step;
        const x = Math.max(12, Math.min(innerWidth - groupWidth - 12, end.x + end.width / 2 - groupWidth / 2));
        const y = Math.max(12, Math.min(innerHeight - height - 12, side === 'player' ? end.y - height - 24 : end.bottom + 24));
        const previews = entries.map(({ card, count }, index) => ({ node: ghost(width, height, card, count), x: x + index * step }));
        syncScale?.();
        await Promise.all(previews.map(({ node, x }) => animate(node, [
          { transform: at(x, y + 14, .92), opacity: 0 }, { transform: at(x, y), opacity: 1 }
        ], 230)));
        await Promise.all(previews.map(({ node, x }) => animate(node, [{ transform: at(x, y) }, { transform: at(x, y) }], 550)));
        if (!current()) return;
        previews.forEach(({ node }) => { node.dataset.deckPhase = 'deck-insert'; });
        await Promise.all(previews.map(({ node, x }) => animate(node, [
          { transform: at(x, y), opacity: 1 },
          { transform: at(end.x, end.y, end.width / width, end.height / height), opacity: .9, offset: .85 },
          { transform: at(end.x, end.y, end.width / width, end.height / height), opacity: 0 }
        ], 470)));
      } else if (type === 'deck-return') {
        const zone = sourceZone === 'trash' ? trash : hand;
        const fallback = zone?.getBoundingClientRect() || end;
        const width = Math.min(end.width, 84), height = width * 1.5;
        await Promise.all(Array.from({ length: Math.min(4, count) }, (_, index) => {
          const origin = origins[index] || fallback;
          const node = ghost(width, height, null, index === 0 ? count : 0);
          const x = origin.left + Math.max(0, origin.width - width) / 2 + index * 4;
          const y = Math.max(8, Math.min(innerHeight - height - 8, origin.top));
          return animate(node, [
            { transform: at(x, y, .9), opacity: 0 },
            { transform: at(x, y - 14), opacity: 1, offset: .18 },
            { transform: at(end.x, end.y, end.width / width, end.height / height), opacity: 1, offset: .88 },
            { transform: at(end.x, end.y, end.width / width, end.height / height), opacity: 0 }
          ], 500, index * 35);
        }));
      }
    })().finally(() => job.dispose());
    return follow(side, promise);
  }
  window.ChibattleDeck = { play, barrier, follow, cancel, isBusy: () => active.size > 0 || tails.size > 0 };
  addEventListener('pagehide', cancel); addEventListener('resize', cancel);
})();
