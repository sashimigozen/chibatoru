/* Presentation only; the caller resolves rules at impact and owns game state. */
(() => {
  const active = new Set();
  const images = {};
  const ready = Promise.all(Object.entries({
    cover: 'assets/wonton/series-cover.jpg',
    paper: 'assets/wonton/old-paper.jpg',
    ending: 'assets/wonton/ending-brush.png'
  }).map(([key, src]) => new Promise(resolve => {
    const image = images[key] = new Image();
    image.onload = image.onerror = resolve;
    image.src = src;
  })));
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const part = (t, a, b) => clamp((t - a) / (b - a));
  const ease = n => 1 - (1 - clamp(n)) ** 3;
  const ink = '#251e1b';
  const red = '#ba302c';
  let endingStamp;

  function play({ owner, beforeCount, count, graduation, isCurrent, isVisualBusy, speed = 1 }) {
    let resolveImpact, resolveFinished;
    const impact = new Promise(resolve => { resolveImpact = resolve; });
    const finished = new Promise(resolve => { resolveFinished = resolve; });
    const canvas = document.createElement('canvas');
    canvas.className = 'wonton-book-effect';
    canvas.dataset.owner = owner;
    canvas.dataset.graduation = String(Boolean(graduation));
    canvas.dataset.beforeCount = String(beforeCount);
    canvas.dataset.count = String(count);
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', graduation
      ? `万豚記シリーズ、完。万豚記カウント${beforeCount}を参照し、0にする。`
      : `万豚記シリーズ。万豚記カウント${beforeCount}から${count}、1増加。`);
    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 320 : graduation ? 2400 : 900;
    const impactAt = reduced ? 160 : graduation ? 1850 : 570;
    const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
    let frame, impactTimer, finishTimer, loadTimer, stopped = false, startedAt = 0;
    let impacted = false, width = 0, height = 0;
    const run = { cancel: () => finish(false) };
    active.add(run);

    function atImpact() {
      if (impacted || stopped) return;
      if (!isCurrent()) { finish(false); return; }
      impacted = true;
      canvas.dataset.phase = 'impact';
      resolveImpact(true);
    }
    function finish(valid = true) {
      if (stopped) return;
      if (valid) atImpact();
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      clearTimeout(impactTimer); clearTimeout(finishTimer); clearTimeout(loadTimer);
      canvas.remove(); active.delete(run);
      resolveImpact(false); resolveFinished(valid);
    }
    function text(label, x, y, size, color = ink) {
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = '#fffaf2'; ctx.strokeText(label, x, y);
      ctx.fillStyle = color; ctx.fillText(label, x, y);
    }
    function paper(x, y, w, h) {
      if (w <= 0) return;
      if (images.paper.naturalWidth) ctx.drawImage(images.paper, x, y, w, h);
      else { ctx.fillStyle = '#f1e6d0'; ctx.fillRect(x, y, w, h); }
    }
    function ending(x, y, size) {
      if (images.ending.naturalWidth) {
        if (!endingStamp) {
          endingStamp = document.createElement('canvas');
          endingStamp.width = images.ending.naturalWidth / 2; endingStamp.height = images.ending.naturalHeight;
          const stamp = endingStamp.getContext('2d');
          stamp.drawImage(images.ending, 0, 0, endingStamp.width, endingStamp.height, 0, 0, endingStamp.width, endingStamp.height);
          stamp.globalCompositeOperation = 'source-in'; stamp.fillStyle = red;
          stamp.fillRect(0, 0, endingStamp.width, endingStamp.height);
        }
        ctx.drawImage(endingStamp, x - size / 2, y - size / 2, size, size);
      } else text('完', x, y, size * .6);
    }
    function book(x, y, size, open, flip, final, alpha) {
      ctx.save(); ctx.globalAlpha *= alpha;
      const page = size * .78, tall = size * 1.23;
      ctx.translate(x - page * (1 - open) / 2, y);
      ctx.shadowColor = '#251e1b55'; ctx.shadowBlur = 15; ctx.shadowOffsetY = 7;
      ctx.fillStyle = ink; ctx.fillRect(-page * open - 4, -tall / 2 - 4, page * (1 + open) + 8, tall + 8);
      ctx.shadowColor = 'transparent';
      paper(-page * open, -tall / 2, page * open, tall);
      paper(0, -tall / 2, page, tall);
      if (open > .3) {
        ctx.save(); ctx.globalAlpha *= .15;
        const gutter = ctx.createLinearGradient(-page * .14, 0, page * .16, 0);
        gutter.addColorStop(0, 'transparent'); gutter.addColorStop(.48, ink); gutter.addColorStop(1, 'transparent');
        ctx.fillStyle = gutter; ctx.fillRect(-page * .14, -tall / 2, page * .3, tall);
        ctx.restore();
      }
      if (final) ending(page / 2, 0, page * .98);
      else if (open < .3 && images.cover.naturalWidth) {
        ctx.save(); ctx.globalAlpha *= 1 - open / .3;
        ctx.drawImage(images.cover, 0, -tall / 2, page, tall); ctx.restore();
      }
      if (flip > 0 && flip < 1 && open > .5) {
        const edge = Math.cos(flip * Math.PI) * page, curl = Math.sin(flip * Math.PI) * tall * .1;
        const left = Math.min(0, edge), span = Math.max(.6, Math.abs(edge));
        ctx.save(); ctx.globalAlpha *= .14 * Math.sin(flip * Math.PI);
        ctx.fillStyle = ink; ctx.fillRect(left + 3, -tall / 2 + 4, span, tall); ctx.restore();
        ctx.beginPath(); ctx.moveTo(0, -tall / 2);
        ctx.quadraticCurveTo(edge * .55, -tall / 2 - curl, edge, -tall / 2 - curl * .3);
        ctx.lineTo(edge, tall / 2 - curl * .3);
        ctx.quadraticCurveTo(edge * .55, tall / 2 - curl, 0, tall / 2); ctx.closePath();
        ctx.save(); ctx.clip(); paper(left, -tall / 2 - curl, span, tall + curl);
        const fold = ctx.createLinearGradient(left, 0, left + span, 0);
        fold.addColorStop(0, flip < .5 ? 'transparent' : ink); fold.addColorStop(.5, 'transparent');
        fold.addColorStop(1, flip < .5 ? ink : 'transparent');
        ctx.globalAlpha *= .16; ctx.fillStyle = fold; ctx.fillRect(left, -tall / 2 - curl, span, tall + curl); ctx.restore();
        ctx.save(); ctx.globalAlpha *= .28; ctx.strokeStyle = ink; ctx.lineWidth = .65; ctx.stroke(); ctx.restore();
      }
      ctx.restore();
    }
    function anchor(selector, fallback) {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect?.width || !rect.height) return fallback;
      return { x: clamp(rect.left + rect.width / 2, 24, width - 24), y: clamp(rect.top + rect.height / 2, 24, height - 24) };
    }
    function draw(t) {
      const w = innerWidth, h = innerHeight, ratio = Math.min(devicePixelRatio || 1, 2);
      if (w !== width || h !== height) {
        width = w; height = h;
        canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      ctx.clearRect(0, 0, width, height);
      const x = width / 2, y = height * .44;
      const size = Math.min(180, width * .3, height * .27);
      const targetOwner = owner === 'player' ? 'opponent' : 'player';
      const target = anchor(`[data-life-target="${targetOwner}"]`, { x: width * .85, y: height * .2 });
      const counter = anchor(`#${owner}ActiveEffectsButton`, { x: width * .85, y: height * .75 });
      if (reduced) {
        book(x, y, size, 1, 0, graduation, 1);
      } else if (graduation) {
        const open = t < 350 ? ease(part(t, 0, 350)) : 1 - ease(part(t, 1450, 1650));
        book(x, y, size, open, t >= 350 && t < 1100 ? ((t - 350) / 150) % 1 : 0,
          t >= 1100 && t < 1450, 1 - part(t, 1650, 1900));
        const p = part(t, 1550, 1850);
        if (p > 0 && p < 1) for (let i = 0; i < 5; i++) {
          const q = clamp(p - i * .045);
          ctx.save(); ctx.globalAlpha = Math.sin(q * Math.PI);
          ctx.translate(x + (target.x - x) * ease(q), y + (target.y - y) * q - Math.sin(q * Math.PI) * (25 + i * 8));
          ctx.rotate(q * 4 + i * .4); paper(-9, -12, 18, 24); ctx.restore();
        }
        if (t >= 1850) {
          const p = part(t, 1850, 2400);
          ctx.save(); ctx.globalAlpha = 1 - p; ctx.strokeStyle = red; ctx.lineWidth = 2;
          for (let i = 0; i < 16; i++) {
            const a = i * Math.PI / 8, r = 25 + p * 20;
            ctx.beginPath(); ctx.moveTo(target.x + Math.cos(a) * r, target.y + Math.sin(a) * r);
            ctx.lineTo(target.x + Math.cos(a) * (r + 20), target.y + Math.sin(a) * (r + 20)); ctx.stroke();
          }
          ctx.restore();
        }
      } else {
        const leave = ease(part(t, 740, 900)), appear = ease(part(t, 0, 180));
        book(x + (counter.x - x) * leave, y + (counter.y - y) * leave,
          size * (.7 + .3 * appear) * (1 - leave * .85), 1, part(t, 180, 570), false, 1 - leave);
      }
      const reached = t >= impactAt;
      const displayed = graduation ? (reached ? 0 : beforeCount) : (reached ? count : beforeCount);
      ctx.save(); ctx.globalAlpha = reduced ? 1 : 1 - part(t, duration - 160, duration);
      text('万豚記カウント', x, y + size * .8, 14);
      text(String(displayed), x, y + size * .8 + 32, 30);
      if (!graduation && reached) text('+1', x + 42, y + size * .8 + 32, 22, red);
      ctx.restore();
      canvas.dataset.time = String(Math.round(t));
      canvas.dataset.phase = reached ? 'impact' : graduation && t >= 1100 ? 'end-page' : 'reading';
    }
    function tick(now) {
      if (stopped) return;
      if (!isCurrent()) { finish(false); return; }
      const t = Math.min(duration, (now - startedAt) * rate);
      if (t >= impactAt) atImpact();
      draw(t);
      if (t >= duration) { finish(); return; }
      frame = requestAnimationFrame(tick);
    }
    void (async () => {
      await Promise.race([ready, new Promise(resolve => { loadTimer = setTimeout(resolve, 300); })]);
      clearTimeout(loadTimer);
      if (stopped) return;
      while (!stopped && isCurrent() && isVisualBusy?.()) {
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      if (stopped) return;
      if (!isCurrent()) { finish(false); return; }
      if (!ctx) { finish(); return; }
      document.body.appendChild(canvas);
      startedAt = performance.now(); draw(0);
      impactTimer = setTimeout(atImpact, impactAt / rate);
      finishTimer = setTimeout(() => finish(isCurrent()), duration / rate + 150);
      frame = requestAnimationFrame(tick);
    })().catch(() => finish(isCurrent()));
    return { impact, finished };
  }
  function cancel() { [...active].forEach(run => run.cancel()); }
  window.ChibattleWonton = { play, cancel, ready, isBusy: () => active.size > 0 };
  window.addEventListener('pagehide', cancel);
})();
