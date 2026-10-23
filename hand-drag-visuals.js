/* Shared presentation primitives. Drop rules remain owned by each game mode. */
(() => {
  'use strict';
  function create(source) {
    const ghost = source.cloneNode(true);
    ghost.classList.add('drag-ghost-card');
    ghost.classList.remove('dragging-source');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.tabIndex = -1;
    document.body.appendChild(ghost);
    return ghost;
  }
  function move(ghost, x, y) {
    if (!ghost) return;
    ghost.style.left = `${x}px`; ghost.style.top = `${y}px`;
  }
  function bind(source, { canLift = () => true, onStart, onMove, onDrop, onFinish, onClick, threshold = 8 }) {
    let pointer = null, ghost = null, blockedUntil = 0;
    function finish(event, cancel = false) {
      if (!pointer) return;
      const wasDragging = Boolean(ghost);
      if (wasDragging) {
        blockedUntil = performance.now() + 250;
        if (!cancel) onDrop?.(event);
      }
      ghost?.remove(); ghost = null; source.classList.remove('dragging-source');
      document.documentElement.classList.remove('hand-card-dragging');
      try { source.releasePointerCapture(pointer.id); } catch {}
      pointer = null;
      if (wasDragging) onFinish?.();
    }
    source.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !canLift()) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      try { source.setPointerCapture(event.pointerId); } catch {}
    });
    source.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (!canLift()) { finish(event, true); return; }
      if (!ghost && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= threshold) {
        ghost = create(source); source.classList.add('dragging-source');
        document.documentElement.classList.add('hand-card-dragging'); onStart?.();
      }
      if (ghost) { event.preventDefault(); move(ghost, event.clientX, event.clientY); onMove?.(event); }
    });
    source.addEventListener('pointerup', event => finish(event));
    source.addEventListener('pointercancel', event => finish(event, true));
    source.addEventListener('lostpointercapture', event => finish(event, true));
    source.addEventListener('click', event => { if (performance.now() < blockedUntil) { event.preventDefault(); return; } onClick?.(event); });
    return () => finish({}, true);
  }
  window.ChibattleHandDrag = { create, move, bind };
})();
