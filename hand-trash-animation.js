/* Visuals only: the existing rules have already moved these public cards. */
(() => {
  const active = new Set();
  function cancel() { [...active].forEach(flight => flight.dispose()); }
  function play({ side, entries, destination, face, isCurrent, isVisualBusy, syncScale, source = 'hand' }) {
    if (!destination || !isCurrent() || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const fromDeck = source === 'deck';
    const columns = Math.min(8, entries.length), rows = Math.ceil(entries.length / columns);
    const flights = entries.filter(entry => entry.rect?.width > 0).map(({ card, rect }, index) => {
      const width = fromDeck ? Math.min(120, innerWidth / (columns * 1.15), innerHeight * .45 / (rows * 1.5))
        : Math.min(side === 'player' ? rect.width : 120, innerWidth / (entries.length * 1.15));
      const height = width * 1.5;
      const ghost = document.createElement('div');
      ghost.className = `draw-flight ${fromDeck ? 'deck-trash-flight' : 'hand-trash-flight'}`;
      ghost.dataset.trashSide = side;
      ghost.dataset.cardId = card.instanceId;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.style.cssText = `width:${width}px;height:${height}px;opacity:0`;
      ghost.innerHTML = `<div class="draw-flight-turn"><div class="draw-flight-back"></div><div class="draw-flight-front">${face(card)}</div></div>`;
      const turn = ghost.firstElementChild;
      turn.style.transform = side === 'player' && !fromDeck ? 'rotateY(180deg)' : 'rotateY(0deg)';
      document.body.appendChild(ghost);
      const animations = new Set();
      let disposed = false;
      const flight = { dispose() {
        if (disposed) return;
        disposed = true; animations.forEach(animation => animation.cancel());
        ghost.remove(); active.delete(flight);
      } };
      active.add(flight);
      const valid = () => !disposed && isCurrent();
      const at = (x, y, scale = 1) => `translate3d(${x}px,${y}px,0) scale(${scale})`;
      // Preserve each selected card's actual hand position; spread very close
      // opponent backs just enough to make every revealed card readable.
      const center = entries.reduce((sum, entry) => sum + entry.rect.x + entry.rect.width / 2, 0) / entries.length;
      const groupWidth = columns * width + (columns - 1) * 12;
      const groupX = Math.max(8, Math.min(innerWidth - groupWidth - 8, center - groupWidth / 2));
      const x = fromDeck ? groupX + index % columns * (width + 12)
        : side === 'player' ? rect.x : Math.max(8, Math.min(innerWidth - width - 8, center + (index - (entries.length - 1) / 2) * (width + 12) - width / 2));
      const groupHeight = rows * height + (rows - 1) * 12;
      const y = fromDeck ? Math.max(8, Math.min(innerHeight - groupHeight - 8,
        side === 'player' ? rect.y - groupHeight - 20 : rect.y + rect.height + 20)) + Math.floor(index / columns) * (height + 12)
        : Math.max(8, Math.min(innerHeight - height - 8,
        side === 'player' ? rect.y - height - 20 : rect.y + rect.height + 20));
      const origin = at(rect.x, rect.y, rect.width / width), stage = at(x, y);
      ghost.style.transform = origin;
      async function animate(element, frames, options) {
        if (!valid()) throw new Error('cancelled');
        const animation = element.animate(frames, { fill: 'forwards', ...options });
        animations.add(animation); await animation.finished; animations.delete(animation);
      }
      const promise = (async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        while (valid() && isVisualBusy()) await new Promise(resolve => setTimeout(resolve, 50));
        if (!valid()) return;
        ghost.style.opacity = '1'; ghost.dataset.trashPhase = 'moving';
        await Promise.all([
          animate(ghost, [{ transform: origin }, { transform: stage }], { duration: 800, easing: 'ease-in-out' }),
          side === 'opponent' || fromDeck ? animate(turn, [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }], { delay: 200, duration: 500, easing: 'ease-in-out' }) : Promise.resolve()
        ]);
        ghost.dataset.trashPhase = 'preview';
        await animate(ghost, [{ transform: stage }, { transform: stage }], { duration: fromDeck || side === 'opponent' ? 600 : 400 });
        const end = destination.getBoundingClientRect();
        ghost.dataset.trashPhase = 'leaving';
        await animate(ghost, [{ transform: stage, opacity: 1 }, { transform: at(end.x, end.y, end.width / width), opacity: .15 }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
      })().catch(() => {});
      return { flight, promise };
    });
    Promise.all(flights.map(entry => entry.promise)).finally(() => flights.forEach(entry => entry.flight.dispose()));
    syncScale?.();
  }
  window.ChibattleHandTrash = { play, cancel, isBusy: () => active.size > 0 };
  addEventListener('pagehide', cancel); addEventListener('resize', cancel);
})();
