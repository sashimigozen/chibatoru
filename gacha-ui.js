/* Integrates the isolated economy with the existing renderer and save formats. */
(() => {
  "use strict";
  const C = window.ChibattleGachaCore;
  const lock = navigator.locks?.request ? (name, work) => navigator.locks.request(name, { mode: "exclusive" }, work) : null;
  const random = () => { const n = new Uint32Array(1); crypto.getRandomValues(n); return n[0] / 4294967296; };
  const store = new C.Store(localStorage, lock, random);
  const screen = document.createElement("section");
  screen.id = "gachaScreen"; screen.className = "screen gacha-screen hidden";
  elements.homeNavigation.before(screen);
  const ui = { packId: C.PACKS[0].id, busy: false, error: "", dragging: false, tearX: null, modal: null, opener: null, jobs: new Map() };
  const escape = escapeHtml;
  const modeName = { normal: "レギュラー", rare: "R", superRare: "SR", ultraRare: "UR" };
  const japanesePackNames = { cynical: '冷笑伝承', endless: '終わらぬ闘争', awakening: '究極覚醒', echoes: '研究残響' };
  const packTitle = (p) => `<span class="gacha-pack-title"><strong>${escape(p.name)}</strong><small>- ${japanesePackNames[p.id]} -</small></span>`;
  const packet = (p, extra = "") => `<div class="gacha-packet ${extra}" style="--pack-color:${p.color}"><span>CHIBATTLE</span><img src="assets/home/nav-card.png" alt="">${packTitle(p)}<small>5 CARDS</small></div>`;
  const card = (c) => {
    // Explicit result style, independent of the owner's selected appearance.
    const preview = makePreviewCard(c.baseId, "player"); preview.profileStyleMode = c.mode;
    return cardShellTemplate(preview);
  };
  const robot = '<div class="gacha-robot" aria-hidden="true"><div class="gacha-robot-head"><i></i><i></i><b></b></div><div class="gacha-robot-body"></div><span class="gacha-robot-arm left"></span><span class="gacha-robot-arm right"></span></div>';
  const furniture = `<div class="gacha-furniture" aria-hidden="true">${[0,1].map(() => '<div class="gacha-table-set"><i class="chair left"></i><i class="table"></i><i class="chair right"></i></div>').join('')}${robot}</div>`;
  function read() { if (window.chibattleGachaRecoveryError) throw new Error(window.chibattleGachaRecoveryError); return store.read(); }
  function mergeOwnedStyles() {
    unlockedExtraCardStyles = mergeExtraCardStyleUnlocks(unlockedExtraCardStyles, read().owned);
  }
  function project() {
    mergeOwnedStyles();
    if (!Object.keys(read().owned).length) return;
    // Do not overwrite another tab's latest selected appearance while granting.
    const cached = readDungeonCardStyleStorage();
    cached.cardUnlocks = mergeExtraCardStyleUnlocks(normalizeExtraCardStyleUnlocks(cached), read().owned);
    try { localStorage.setItem(DUNGEON_CARD_STYLE_STORAGE_KEY, JSON.stringify(cached)); }
    catch { ui.error = "取得結果は保存済みです。カード表示の保存に失敗したため、再表示時に復旧します。"; }
  }
  async function operate(work, { projectStyles = false } = {}) {
    if (ui.busy) return false;
    ui.busy = true; ui.error = ""; renderGacha();
    try { await work(); if (projectStyles) project(); return true; }
    catch (error) {
      ui.error = error.message || "保存できませんでした。";
      if (document.documentElement.classList.contains("gacha-recovering")) document.documentElement.classList.add("gacha-recovery-failed");
      return false;
    }
    finally { ui.busy = false; render(); refreshModal(); }
  }
  function featuredPages(p) {
    return [p.ur.filter(id => CARD_BASES[id].type === 'student'), p.ur.filter(id => CARD_BASES[id].type !== 'student')];
  }
  function featuredCards(p) {
    const ids = featuredPages(p)[ui.featuredPage || 0];
    const singleStudentRow = p.id === 'cynical' && !(ui.featuredPage || 0);
    const rows = ids.length > 4 && !singleStudentRow ? 2 : 1, columns = Math.ceil(ids.length / rows);
    return `<div class="gacha-featured-grid" style="--columns:${columns};--rows:${rows}">${ids.map((baseId) => `<button type="button" data-gacha-detail="${baseId}" aria-label="${escape(CARD_BASES[baseId].name)}の詳細を見る">${card({ baseId, mode: "ultraRare" })}</button>`).join("")}</div>`;
  }
  function stopFeatured() {
    clearTimeout(ui.featuredTimer); ui.featuredTimer = null;
  }
  function scheduleFeatured(p) {
    if (ui.featuredTimer) return;
    ui.featuredTimer = setTimeout(() => {
      ui.featuredTimer = null;
      const cards = screen.querySelector('.gacha-featured-cards');
      if (state.screen !== 'gacha' || screen.dataset.phase !== 'shop' || !cards || ui.packId !== p.id) return;
      // Keep focused cards stable while a keyboard user is inspecting them.
      if (!document.hidden && !ui.busy && !ui.modal && !cards.contains(document.activeElement)) {
        ui.featuredPage = 1 - (ui.featuredPage || 0);
        cards.innerHTML = featuredCards(p);
        scheduleCardTemplateScaleSync();
      }
      scheduleFeatured(p);
    }, 5000);
  }
  function featured(p) {
    if (ui.featuredPackId !== p.id) {
      stopFeatured(); ui.featuredPackId = p.id; ui.featuredPage = 0;
    }
    return `<div class="gacha-featured" aria-label="ピックアップURカード"><div class="gacha-tv-display"><h2>PICK UP</h2><div class="gacha-featured-cards">${featuredCards(p)}</div></div></div>`;
  }
  function pendingView(q) {
    const p = C.PACKS.find((p) => p.id === q.packId), row = q.results[q.index];
    const status = `${q.index + 1} / ${q.results.length} パック`;
    if (q.phase === "handoff") return `<div class="gacha-handoff">${robot}<button type="button" data-gacha-receive aria-label="パックを受け取る">${packet(p, q.results.length === 10 ? "gacha-pack-stack" : "")}</button></div>`;
    if (q.phase === "tear") return `<div class="gacha-tear-stage"><div class="gacha-sealed">${packet(p)}<button class="gacha-tear-line" type="button" data-gacha-tear aria-label="点線に沿ってドラッグして開封。Enterでも開封できます"><i></i></button></div></div>`;
    if (q.phase === "summary") return `<div class="gacha-summary"><h2>獲得カード</h2><div class="gacha-summary-grid" tabindex="0" aria-label="獲得カード一覧">${q.results.map((pack, i) => `<section class="gacha-summary-pack">${q.results.length > 1 ? `<h3>${i + 1}パック目</h3>` : ''}<div class="gacha-summary-pack-cards">${pack.map((c) => `<button type="button" data-gacha-detail="${c.baseId}" data-result-mode="${c.mode}" aria-label="${escape(CARD_BASES[c.baseId].name)} ${modeName[c.mode]}">${card(c)}</button>`).join("")}</div></section>`).join("")}</div><button class="gacha-return" type="button" data-gacha-finish>ショップに戻る</button></div>`;
    const viewKey = `${q.id}:${q.index}`;
    const previous = ui.flipKey === viewKey ? ui.flipCount : q.revealed;
    ui.flipKey = viewKey; ui.flipCount = q.revealed;
    const special = q.urPause ? row[q.revealed - 1] : null;
    return `<div class="gacha-reveal-stage">${robot}<p class="gacha-pack-progress">${status}</p><div class="gacha-counter-cards">${row.map((c, i) => `<button class="gacha-result ${i < q.revealed ? 'is-revealed' : ''} ${i >= previous && i < q.revealed ? 'just-revealed' : ''}" type="button" data-gacha-reveal="${i}" aria-label="${i < q.revealed ? `${escape(CARD_BASES[c.baseId].name)} ${modeName[c.mode]}` : `${i + 1}枚目をめくる`}" ${q.urPause || ui.busy ? "disabled" : ""}><span class="gacha-flip-stage"><span class="gacha-card-back gacha-card-face"></span><span class="gacha-card-front gacha-card-face">${card(c)}</span></span></button>`).join("")}</div>${special ? `<div class="gacha-ur-moment" role="dialog" aria-modal="true" aria-label="UR獲得"><div class="gacha-ur-halo">${card(special)}</div><button class="button" type="button" data-gacha-ur-continue>続ける</button></div>` : '<div class="gacha-reveal-actions" aria-hidden="true"></div>'}</div>`;
  }
  function renderGacha() {
    ui.dealing = false;
    const visible = state.screen === "gacha";
    screen.classList.toggle("hidden", !visible);
    document.body.classList.remove("gacha-opening");
    if (!visible) { stopFeatured(); return; }
    let saved;
    try { saved = read(); }
    catch (e) { stopFeatured(); screen.innerHTML = `<div class="gacha-error" role="alert">${escape(e.message)}</div>`; return; }
    const p = C.PACKS.find((p) => p.id === ui.packId), progress = saved.packs[p.id];
    const exchangePack = C.PACKS.find((p) => saved.packs[p.id].tickets > 0);
    const q = saved.pending;
    document.body.classList.toggle("gacha-opening", Boolean(q));
    screen.dataset.phase = q?.phase || 'shop';
    screen.innerHTML = `<header class="gacha-head"><h1>ショップ</h1><div class="gacha-head-actions"><strong class="gacha-cp">${saved.cp} CP</strong><button class="button secondary" type="button" data-gacha-rates>提供割合</button>${q && q.phase !== "summary" ? '<button class="button secondary" type="button" data-gacha-skip>スキップ</button>' : ""}</div></header><p class="gacha-error ${ui.error ? "" : "hidden"}" role="alert">${escape(ui.error)}</p>${q ? pendingView(q) : `<div class="gacha-shop-layout"><aside class="gacha-pack-list" aria-label="パック一覧"><h2>パック一覧</h2>${C.PACKS.map((x) => `<button type="button" data-gacha-pack="${x.id}" aria-pressed="${x.id === p.id}"><span>${escape(x.name)}</span></button>`).join("")}</aside>${featured(p)}<div class="gacha-purchase-panel"><div>${packet(p)}</div><section><div class="gacha-purchase-buttons"><button class="button" type="button" data-gacha-buy="1" ${ui.busy || saved.cp < 5 || exchangePack ? "disabled" : ""}>1パック · 5 CP</button><button class="button" type="button" data-gacha-buy="10" ${ui.busy || saved.cp < 50 || exchangePack ? "disabled" : ""}>10パック · 50 CP</button>${exchangePack ? `<button class="button" type="button" data-gacha-exchange="${exchangePack.id}">URを交換する</button>` : ""}</div><p>UR交換 ${progress.total % 200} / 200</p></section></div>${furniture}</div>`}`;
    // The button labels expose revealed names, not the hidden front-face text.
    screen.querySelectorAll('[data-gacha-pack]').forEach(button => {
      button.innerHTML = packTitle(C.PACKS.find(p => p.id === button.dataset.gachaPack));
    });
    const dealKey = q && `${q.id}:${q.index}`;
    if (q?.phase === 'cards' && q.revealed === 0 && ui.dealKey !== dealKey) {
      ui.dealKey = dealKey;
      ui.dealing = true;
      const buttons = [...screen.querySelectorAll('[data-gacha-reveal]')];
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const animations = buttons.map((button, i) => {
        button.disabled = true;
        return button.animate([
          { opacity: 0, transform: 'translateY(26px) scale(.82)' },
          { opacity: 1, transform: 'translateY(-8px) scale(1.04)', offset: .65 },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: reduced ? 0 : 280, delay: reduced ? 0 : i * 140, easing: 'ease-out', fill: 'both' });
      });
      Promise.all(animations.map(animation => animation.finished)).then(() => {
        if (!buttons[0]?.isConnected) return;
        ui.dealing = false;
        buttons.forEach(button => { button.disabled = ui.busy; });
      }).catch(() => {});
    }
    screen.querySelectorAll('.gacha-card-face').forEach(face => face.setAttribute('aria-hidden', 'true'));
    scheduleCardTemplateScaleSync();
    if (q) stopFeatured(); else scheduleFeatured(p);
  }
  window.addEventListener('pagehide', stopFeatured);
  async function open() {
    if (ui.busy) return;
    if (window.ChibattleCards?.isDirty() && !(await window.ChibattleCards.confirmDiscard())) return;
    closeCardTestConfirm(); hideCardTooltip();
    state.screen = "gacha"; render();
  }
  function modal(title, html, kind = "") {
    closeModal(); ui.opener = document.activeElement;
    const el = document.createElement("dialog"); el.className = "gacha-dialog"; el.dataset.kind = kind;
    el.setAttribute("aria-label", title);
    el.innerHTML = `<header><h2>${escape(title)}</h2><button class="button secondary" type="button" data-gacha-close>閉じる</button></header><div class="gacha-dialog-body">${html}</div><p class="gacha-dialog-error" role="alert"></p>`;
    document.body.append(el); ui.modal = el;
    el.addEventListener("click", handleClick);
    el.addEventListener("cancel", (e) => { if (ui.busy) e.preventDefault(); else closeModal(); });
    el.showModal(); el.querySelector("button")?.focus(); scheduleCardTemplateScaleSync();
    return el;
  }
  function closeModal() { if (ui.busy) return; ui.modal?.close(); ui.modal?.remove(); ui.modal = null; ui.opener?.focus(); }
  function giftHtml() {
    const gifts = Object.entries(read().gifts).filter(([, g]) => !g.claimed);
    return gifts.length ? `<ul class="gacha-gifts">${gifts.map(([id, g]) => `<li><span>${escape(g.label)}<strong>${g.amount} CP</strong></span><button class="button" type="button" data-gacha-claim="${id}">受け取る</button></li>`).join("")}</ul><button class="button" type="button" data-gacha-claim="all">一括受け取り</button>` : "<p>プレゼントはありません。</p>";
  }
  function gifts() { try { modal("プレゼント", giftHtml(), "gifts"); } catch (e) { ui.error = e.message; render(); } }
  function exchangeHtml(id) {
    const p = C.PACKS.find((p) => p.id === id);
    return `<h3>${escape(p.name)}</h3><p>交換するURを選んでください。残り ${read().packs[id].tickets} 回</p><div class="gacha-exchange-grid">${p.ur.map((baseId) => `<button type="button" data-gacha-redeem="${baseId}" data-pack-id="${id}" aria-label="${escape(CARD_BASES[baseId].name)}と交換">${card({ baseId, mode: "ultraRare" })}<span>${escape(CARD_BASES[baseId].name)}</span></button>`).join("")}</div>`;
  }
  function refreshModal() {
    if (!ui.modal) return;
    const body = ui.modal.querySelector(".gacha-dialog-body");
    if (ui.modal.dataset.kind === "gifts") body.innerHTML = giftHtml();
    if (ui.modal.dataset.kind.startsWith("exchange:")) {
      const id = ui.modal.dataset.kind.split(":")[1];
      if (read().packs[id].tickets) body.innerHTML = exchangeHtml(id);
      else closeModal();
    }
    ui.modal?.querySelector(".gacha-dialog-error")?.replaceChildren(document.createTextNode(ui.error));
    scheduleCardTemplateScaleSync();
  }
  function updatePending(fn) { return store.transact((s) => { if (!s.pending) throw new Error("開封済みです。"); fn(s.pending, s); }); }
  async function reveal(index) {
    const q = read().pending;
    if (!q || q.phase !== "cards" || q.urPause || index !== q.revealed || index >= 5 || ui.busy || ui.dealing) return;
    await operate(() => updatePending((p) => {
      if (p.phase !== "cards" || p.urPause || p.revealed !== index) throw new Error("開封状態が更新されました。もう一度お試しください。");
      p.revealed++; p.urPause = p.results[p.index][index].mode === "ultraRare";
    }));
  }
  async function skip() {
    ui.dragging = false; ui.dragTarget = -1; ui.tearX = null;
    await operate(() => updatePending((p) => {
      p.phase = "summary"; p.index = p.results.length - 1;
      p.revealed = 5; p.urPause = false;
    }));
  }
  // A quick continuous drag can cross several cards between storage commits.
  // Queue the furthest visited slot, but stop and discard the queue at every UR.
  function queueDrag(index) {
    ui.dragTarget = Math.max(ui.dragTarget ?? -1, index);
    drainDrag();
  }
  async function drainDrag() {
    if (ui.busy || (ui.dragTarget ?? -1) < 0) return;
    const q = read().pending;
    if (!q || q.phase !== "cards" || q.urPause || q.revealed > ui.dragTarget) { ui.dragTarget = -1; return; }
    const ok = await operate(() => updatePending((p) => {
      if (p.phase !== "cards" || p.urPause) return;
      while (p.revealed < 5 && p.revealed <= ui.dragTarget) {
        if (p.results[p.index][p.revealed++].mode === "ultraRare") { p.urPause = true; break; }
      }
    }));
    if (!ok) ui.dragTarget = -1;
    else drainDrag();
  }
  async function nextPack() {
    await operate(() => updatePending((p) => {
      if (p.phase !== "cards" || p.revealed !== 5 || p.urPause) return;
      if (p.index + 1 < p.results.length) { p.index++; p.revealed = 0; p.phase = "tear"; }
      else p.phase = "summary";
    }));
  }
  async function handleClick(event) {
    const advanceKey = ui.advanceClickKey;
    ui.advanceClickKey = null;
    const pending = read().pending;
    if (!event.target.closest('button,a,input,select,textarea,label,[role="button"]')
      && event.detail > 0 && !ui.busy && !ui.modal && pending?.phase === "cards" && pending.revealed === 5 && !pending.urPause
      && advanceKey === `${pending.id}:${pending.index}`) {
      await nextPack(); return;
    }
    const button = event.target.closest("button"); if (!button) return;
    if (button.hasAttribute("data-gacha-close")) { closeModal(); return; }
    if (ui.busy) return;
    if (button.dataset.gachaPack) { ui.packId = button.dataset.gachaPack; renderGacha(); }
    else if (button.dataset.gachaBuy) await operate(() => store.buy(ui.packId, Number(button.dataset.gachaBuy), crypto.randomUUID()), { projectStyles: true });
    else if (button.hasAttribute("data-gacha-receive")) await operate(() => updatePending((p) => { if (p.phase === "handoff") p.phase = "tear"; }));
    else if (button.hasAttribute("data-gacha-tear")) {
      // Keyboard activation, not an accidental click after a short drag.
      if (event.detail === 0) await openSeal();
    }
    else if (button.hasAttribute("data-gacha-reveal")) await reveal(Number(button.dataset.gachaReveal));
    else if (button.hasAttribute("data-gacha-ur-continue")) await operate(() => updatePending((p) => { p.urPause = false; }));
    else if (button.hasAttribute("data-gacha-skip")) await skip();
    else if (button.hasAttribute("data-gacha-finish")) await operate(() => store.transact((s) => {
      if (s.pending?.phase !== "summary") throw new Error("結果を確認してください。"); s.pending = null;
    }));
    else if (button.hasAttribute("data-gacha-rates")) modal("提供割合", `<table><thead><tr><th>レアリティ</th><th>1〜4枚目</th><th>5枚目</th></tr></thead><tbody>${C.MODES.map((mode, i) => `<tr><th>${modeName[mode]}</th><td>${C.WEIGHTS[0][i] / 1000}%</td><td>${C.WEIGHTS[1][i] / 1000}%</td></tr>`).join("")}</tbody></table><p>同じレアリティの収録カードは均等に排出されます。</p><p>10パック連続でSR以上が出なかった場合、10パック目の5枚目をSR（99%）またはUR（1%）に変更します。保証・200パックごとのUR交換はパック別です。</p><p>重複補償はありません。Regularはすべて利用可能です。</p><button class="button secondary" type="button" data-gacha-contents>収録カードを見る</button>`);
    else if (button.hasAttribute("data-gacha-contents")) {
      const p = C.PACKS.find((x) => x.id === ui.packId);
      modal(p.name, `<div class="gacha-contents-list">${p.cards.map((id) => `<button type="button" data-gacha-detail="${id}">${escape(CARD_BASES[id].name)}${p.ur.includes(id) ? " · UR対象" : ""}</button>`).join("")}</div>`);
    }
    else if (button.dataset.gachaExchange) modal("UR交換", exchangeHtml(button.dataset.gachaExchange), `exchange:${button.dataset.gachaExchange}`);
    else if (button.dataset.gachaRedeem) await operate(() => store.transact((s) => C.exchange(s, button.dataset.packId, button.dataset.gachaRedeem)), { projectStyles: true });
    else if (button.dataset.gachaClaim) await operate(() => store.transact((s) => C.claim(s, button.dataset.gachaClaim === "all" ? null : button.dataset.gachaClaim)));
    else if (button.dataset.gachaDetail) {
      if (ui.modal) closeModal(); openCardTestConfirm(button.dataset.gachaDetail);
    }
    else if (button.hasAttribute("data-gacha-export")) await exportBackup();
    else if (button.hasAttribute("data-gacha-restore")) await restoreBackup();
  }
  function openSeal() {
    if (read().pending?.phase !== "tear") return;
    return operate(async () => {
      const sealed = screen.querySelector('.gacha-sealed');
      const packet = sealed?.querySelector('.gacha-packet');
      const line = sealed?.querySelector('[data-gacha-tear]');
      if (packet && line) {
        const bounds = sealed.getBoundingClientRect();
        const cut = line.getBoundingClientRect();
        const split = (cut.top + cut.height / 2 - bounds.top) / bounds.height * 100;
        const strip = packet.cloneNode(true);
        strip.classList.add('gacha-cut-strip');
        strip.setAttribute('aria-hidden', 'true');
        strip.style.clipPath = `inset(0 0 ${100 - split}% 0)`;
        packet.style.clipPath = `inset(${split}% 0 0 0)`;
        line.hidden = true;
        sealed.append(strip);
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        await strip.animate([
          { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
          { transform: 'translate(5%,-4%) rotate(5deg)', opacity: 1, offset: .3 },
          { transform: 'translate(30%,18%) rotate(22deg)', opacity: 0 }
        ], { duration: reduced ? 0 : 550, easing: 'ease-in', fill: 'forwards' }).finished;
      }
      await updatePending((p) => { if (p.phase === "tear") { p.phase = "cards"; p.revealed = 0; } });
    });
  }
  screen.addEventListener("click", handleClick);
  screen.addEventListener("pointerdown", (e) => {
    const pending = read().pending;
    // Capture readiness before this gesture, so the final flip cannot also advance.
    ui.advanceClickKey = e.button === 0 && !ui.busy && !ui.modal && pending?.phase === "cards" && pending.revealed === 5 && !pending.urPause
      ? `${pending.id}:${pending.index}` : null;
    if (ui.busy || ui.dealing || e.button !== 0) return;
    if (pending?.phase === "cards" && pending.revealed === 5) return;
    const line = e.target.closest("[data-gacha-tear]");
    if (line) { ui.tearX = e.clientX; screen.setPointerCapture(e.pointerId); e.preventDefault(); }
    const target = e.target.closest("[data-gacha-reveal]");
    if (target) { ui.dragging = true; screen.setPointerCapture(e.pointerId); queueDrag(Number(target.dataset.gachaReveal)); }
  });
  screen.addEventListener("pointermove", (e) => {
    if (ui.busy || ui.dealing) return;
    const line = screen.querySelector('[data-gacha-tear]');
    if (line && (e.buttons & 1) && ui.tearX === null) {
      const r = line.getBoundingClientRect();
      const margin = Math.max(80, r.width * .35);
      if (e.clientX >= r.left - margin && e.clientX <= r.right + margin && e.clientY >= r.top && e.clientY <= r.bottom) {
        ui.tearX = e.clientX;
        screen.setPointerCapture(e.pointerId);
      }
    }
    if (ui.tearX !== null) {
      if (line && Math.abs(e.clientX - ui.tearX) >= line.getBoundingClientRect().width * .6) { ui.tearX = null; openSeal(); }
    }
    if (ui.dragging) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-gacha-reveal]");
      if (target) queueDrag(Number(target.dataset.gachaReveal));
    }
  });
  const stopDrag = () => { ui.tearX = null; ui.dragging = false; };
  screen.addEventListener("pointerup", (e) => {
    if (ui.dragging) {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-gacha-reveal]");
      if (target) queueDrag(Number(target.dataset.gachaReveal));
    }
    stopDrag();
  });
  screen.addEventListener("pointercancel", () => { ui.advanceClickKey = null; stopDrag(); });
  function migrationSpecialties() {
    const pending = loadPendingDungeonReward()?.specialtyId;
    return [...new Set([...Object.keys(unlockedDungeonCardStyles).filter((id) => unlockedDungeonCardStyles[id] === true), ...(pending ? [pending] : [])])].filter((id) => id !== 'king_ghidorah_bed' && DUNGEON_CARD_STYLE_REWARDS[id])
      .map((id) => ({ id, name: specialtyDefinition(id)?.name || DUNGEON_CARD_STYLE_REWARDS[id].label }));
  }
  async function migrateLegacy() {
    const specialties = migrationSpecialties();
    await store.transact((s) => C.migrate(s, specialties));
  }
  function recordBattleResult(winner) {
    if (winner !== "player" || state.testMode || state.tutorial?.active || state.tutorial?.chapterId || state.training.active || state.online.started || state.online.role || state.screen !== "battle") return;
    let award;
    if (state.dungeon.active) {
      const run = state.dungeon.run;
      if (run && [5, 10].includes(run.floor)) award = { id: `dungeon:${run.specialtyId}:${run.floor}`, amount: run.floor === 5 ? 50 : 100 };
    } else if (state.analytics?.game?.gameId && state.analytics.game.mode === "solo") award = { id: `ai:${state.analytics.game.gameId}`, amount: 5 };
    if (!award || ui.jobs.has(award.id)) return;
    // Capture before the existing dungeon code advances/clears the run.
    const job = store.transact((s) => C.reward(s, award)).then(() => { ui.jobs.delete(award.id); renderGacha(); }).catch((e) => {
      ui.error = `CP報酬を保存できませんでした：${e.message}`;
      // Retry is explicit in Data Management; never silently drop the award.
      ui.jobs.set(award.id, award); renderGacha();
    });
    ui.jobs.set(award.id, job);
  }
  function collectProjection() { return Object.fromEntries(C.BACKUP_KEYS.map((key) => [key, localStorage.getItem(key)])); }
  async function checksum(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) => n.toString(16).padStart(2, "0")).join("");
  }
  function dataDialog() {
    modal("データ管理", `<p>CP・ガチャ進捗・プレゼント・カード設定・保存デッキ・プロフィールを保存します。</p><button class="button" type="button" data-gacha-export>ファイル書き出し</button><label class="button secondary gacha-import-label">ファイル読み込み<input type="file" accept=".chibasave,application/json" id="gachaBackupInput"></label><p class="gacha-backup-note">読み込みは現在のデータを置き換えます。古いファイルへ戻すとCPや進捗も戻ります。以前の .chibaclear は従来のクリアデータ読み込みをご利用ください。</p><div id="gachaBackupConfirm"></div>${ui.jobs.size ? '<button class="button secondary" type="button" id="gachaRetryRewards">CP報酬の保存を再試行</button>' : ""}`, "backup");
    ui.modal.querySelector("#gachaBackupInput").accept = '.chibasave,.chibagift,application/json';
    ui.modal.querySelector("#gachaBackupInput").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        if (file.size > 12000000) throw new Error("ファイルが大きすぎます。");
        const data = JSON.parse(await file.text());
        if (data.format === 'chibattle-personal-gift') {
          ui.backup = null;
          const ok = await operate(() => store.transact(s => C.receivePersonalGift(s, data)));
          if (ok) ui.modal.querySelector('#gachaBackupConfirm').textContent = 'プレゼントボックスを確認してください。';
          return;
        }
        if (data.format !== "chibattle-full-save" || data.version !== 1 || data.checksum !== await checksum(data.payload)) throw new Error("ファイルの形式が違うか、破損しています。");
        C.validate(data.payload.economy); validateBackupProjection(data.payload.projection);
        ui.backup = data.payload;
        ui.modal.querySelector("#gachaBackupConfirm").innerHTML = `<p>${data.payload.economy.cp} CPのデータで置き換えますか？</p><button class="button" type="button" data-gacha-restore>はい</button>`;
      } catch (err) { ui.modal.querySelector(".gacha-dialog-error").textContent = err.message; ui.backup = null; }
    });
    ui.modal.querySelector("#gachaRetryRewards")?.addEventListener("click", async () => {
      await operate(async () => { for (const [id, award] of ui.jobs) if (award?.amount) { await store.transact((s) => C.reward(s, award)); ui.jobs.delete(id); } });
    });
  }
  function validateBackupProjection(data) {
    C.validateProjection(data);
    if (C.BACKUP_KEYS.some((key) => !Object.hasOwn(data, key))) throw new Error("バックアップの項目が不足しています。");
    for (const key of [SAVED_DECK_STORAGE_KEY, SPECIALTY_DECK_STORAGE_KEY, CHAOS_DECK_STORAGE_KEY]) {
      if (data[key] === null) continue;
      const decks = JSON.parse(data[key]);
      if (!decks || typeof decks !== "object" || Array.isArray(decks)) throw new Error("デッキの保存形式が不正です。");
      for (const entry of Object.values(decks)) {
        const counts = entry?.counts || entry;
        if (!counts || typeof counts !== "object" || Array.isArray(counts) || Object.entries(counts).some(([id, n]) => !(CARD_BASES[id] || CARD_BASES[LEGACY_CARD_BASE_ID_ALIASES[id]]) || !Number.isInteger(n) || n < 0 || n > 60)) throw new Error("デッキのカードが不正です。");
      }
    }
    const style = data[DUNGEON_CARD_STYLE_STORAGE_KEY] && JSON.parse(data[DUNGEON_CARD_STYLE_STORAGE_KEY]);
    if (style) {
      for (const [id, mode] of Object.entries(style.selected || {})) if (!CARD_BASES[id] || !["normal", "rare", "superRare", "ultraRare", "secretRare", "reward", "prism"].includes(mode)) throw new Error("カード設定が不正です。");
      for (const [id, modes] of Object.entries(style.cardUnlocks || {})) if (!CARD_BASES[id] || !modes || Array.isArray(modes) || Object.entries(modes).some(([m, v]) => !["rare", "superRare", "ultraRare", "secretRare", "reward"].includes(m) || v !== true)) throw new Error("カード解放データが不正です。");
    }
    if (data[PLAYER_PROFILE_STORAGE_KEY] !== null) {
      const profile = JSON.parse(data[PLAYER_PROFILE_STORAGE_KEY]);
      if (!profile || typeof profile !== "object" || (profile.favoriteCardId && !CARD_BASES[profile.favoriteCardId])) throw new Error("プロフィールが不正です。");
    }
  }
  async function exportBackup() {
    await operate(async () => {
      if (!lock) throw new Error("安全な保存ロックが利用できません。");
      await lock(C.KEY, async () => {
        project();
        const payload = { economy: read(), projection: collectProjection() };
        validateBackupProjection(payload.projection);
        const data = { format: "chibattle-full-save", version: 1, payload, checksum: await checksum(payload) };
        downloadTextFile("chibattle-backup.chibasave", JSON.stringify(data), "application/json");
      });
    });
  }
  async function restoreBackup() {
    if (!ui.backup) return;
    await operate(async () => {
      if (window.ChibattleCards?.isDirty() && !(await window.ChibattleCards.confirmDiscard())) return;
      validateBackupProjection(ui.backup.projection);
      await store.restore(ui.backup.economy, ui.backup.projection);
      document.documentElement.classList.add("gacha-recovering");
      await lock(C.KEY, () => C.recover(localStorage)); location.reload();
    });
  }
  document.getElementById("homeNavGachaButton").addEventListener("click", open);
  document.getElementById("homeGiftsButton").addEventListener("click", async () => { await operate(migrateLegacy); gifts(); });
  document.getElementById("profileDataButton").addEventListener("click", dataDialog);
  // The shared lock serializes purchases/claims/imports across tabs. On storage
  // changes only replay ownership; never publish another tab's selected mode.
  window.addEventListener("storage", (e) => {
    if (e.key !== C.KEY) return;
    try { mergeOwnedStyles(); render(); refreshModal(); } catch (err) { ui.error = err.message; renderGacha(); }
  });
  function renderStatus() {
    try {
      const count = Object.values(read().gifts).filter((g) => !g.claimed).length;
      const button = document.getElementById("homeGiftsButton"); button.title = count ? `プレゼント ${count}件` : "プレゼント";
      button.setAttribute("aria-label", button.title); button.classList.toggle("gacha-has-gifts", count > 0);
    } catch (e) { ui.error = e.message; }
  }
  window.ChibattleGacha = { render: () => { renderGacha(); renderStatus(); }, mergeOwnedStyles, recordBattleResult };
  window.chibattleGachaRecoveryReady.then(async () => {
    try {
      if (read().recovery) return; // The protected startup recovery will reload.
      for (const p of C.PACKS) if (p.cards.length !== p.count || p.cards.some((id) => !CARD_BASES[id]) || p.ur.some((id) => !p.cards.includes(id))) throw new Error("収録カードの照合に失敗しました。");
      project(); await migrateLegacy(); renderStatus();
    } catch (e) { ui.error = e.message; }
  });
  renderStatus();
})();
