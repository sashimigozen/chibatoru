/* Keep the established mode controls and game state. Only their presentation
   and the local desktop folder layout are managed here. */
(() => {
  // Embed the existing menus by default; retain the folder proposal for
  // comparison without changing its saved positions.
  const folderMenu = new URLSearchParams(window.location.search).get("menu") === "folders";
  const storageKey = "chibattle-desktop-folders-v1";
  const screenIds = {
    online: "onlineScreen", soloMenu: "soloMenuScreen", soloDeck: "soloDeckScreen",
    tutorial: "tutorialScreen", dungeonEntrance: "dungeonEntranceScreen",
    dungeonDeck: "dungeonDeckScreen", dungeonFloor: "dungeonFloorScreen",
    dungeonReward: "dungeonRewardScreen"
  };
  const shell = document.createElement("section");
  shell.id = "modeComputer";
  shell.className = "mode-computer hidden";
  shell.setAttribute("aria-label", "チバトルのPC");
  shell.innerHTML = `<div class="computer-display"><div class="computer-content"></div>
    <button type="button" class="computer-switch previous" aria-label="ソロプレイへ切り替える"><img src="assets/tutorial/chevron-right.svg" alt=""></button>
    <button type="button" class="computer-switch" aria-label="ソロプレイへ切り替える"><img src="assets/tutorial/chevron-right.svg" alt=""></button>
    <div class="computer-taskbar" aria-label="ショートカット欄"></div></div>
    <div class="computer-base" aria-hidden="true"><img src="assets/tutorial/laptop-keyboard-graphite-v2.webp" alt="" draggable="false"></div><p class="computer-status" role="status" aria-live="polite"></p>`;
  elements.appRoot.append(shell);
  const content = shell.querySelector(".computer-content");
  for (const id of Object.values(screenIds)) content.append(document.getElementById(id));
  const status = shell.querySelector(".computer-status");
  const switches = [...shell.querySelectorAll(".computer-switch")];
  let positions = {};
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey));
    if (stored && typeof stored === "object" && !Array.isArray(stored)) positions = stored;
  } catch { /* Storage is optional; moving folders still works without it. */ }

  const groups = [
    { board: elements.onlineMatchActions, folders: [
      ["onlineRandomMatchButton", .04, .03], ["onlinePrivateMatchButton", .04, .54],
      ["onlineFourMatchButton", .34, .54], ["onlineSpectateButton", .34, .03]
    ] },
    { board: elements.soloMenuScreen.querySelector(".solo-mode-actions"), folders: [
      ["soloAiBattleButton", .04, .03], ["soloDungeonButton", .34, .03],
      ["soloTutorialButton", .04, .54], ["soloTrainingButton", .64, .54]
    ] }
  ];
  let candidate = null;
  let activeScreen = null;
  const suppressClick = new Set();
  const clamp = (value, limit) => Math.max(0, Math.min(value, limit));
  function limits(board, button) {
    return { x: Math.max(0, 1 - button.offsetWidth / board.clientWidth),
      y: Math.max(0, 1 - button.offsetHeight / board.clientHeight) };
  }
  function place(board, button, position) {
    if (!board.clientWidth || !board.clientHeight) return;
    const bound = limits(board, button);
    button.style.left = `${clamp(position.x, bound.x) * 100}%`;
    button.style.top = `${clamp(position.y, bound.y) * 100}%`;
  }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(positions)); }
    catch { status.textContent = "配置を保存できませんでした。"; }
  }
  function finish(cancel = false) {
    if (!candidate) return;
    const drag = candidate;
    candidate = null;
    clearTimeout(drag.timer);
    drag.button.classList.remove("is-moving");
    drag.button.removeAttribute("aria-grabbed");
    if (drag.moving) {
      if (cancel) place(drag.board, drag.button, drag.original);
      else {
        positions[drag.button.id] = drag.position;
        save();
        status.textContent = "フォルダの配置を保存しました。";
      }
    }
    if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
  }
  for (const { board, folders } of (folderMenu ? groups : [])) {
    board.classList.add("computer-desktop");
    for (const [id, x, y] of folders) {
      const button = document.getElementById(id);
      button.classList.add("computer-folder");
      const icon = document.createElement("img");
      icon.className = "computer-folder-icon";
      icon.src = "assets/tutorial/folder-closed.svg";
      icon.alt = "";
      icon.draggable = false;
      button.prepend(icon);
      const stored = positions[id];
      if (!stored || !Number.isFinite(stored.x) || !Number.isFinite(stored.y)) positions[id] = { x, y };
      // aria-disabled preserves the disabled action while allowing the folder
      // itself to be repositioned, including the two coming-soon modes.
      if (button.disabled) button.disabled = false;
      button.title = "クリックで開く・長押しで移動";
      button.addEventListener("click", (event) => {
        if ((event.detail > 0 && suppressClick.delete(id)) || button.getAttribute("aria-disabled") === "true") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
      button.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        finish(true);
        suppressClick.delete(id);
        const rect = button.getBoundingClientRect();
        const area = board.getBoundingClientRect();
        const original = { x: (rect.left - area.left) / area.width, y: (rect.top - area.top) / area.height };
        candidate = { button, board, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
          original, position: original, moving: false };
        button.setPointerCapture(event.pointerId);
        const pending = candidate;
        pending.timer = window.setTimeout(() => {
          if (candidate !== pending) return;
          pending.moving = true;
          suppressClick.add(id);
          button.classList.add("is-moving");
          button.setAttribute("aria-grabbed", "true");
          status.textContent = "フォルダを移動できます。";
        }, 450);
      });
      button.addEventListener("pointermove", (event) => {
        const drag = candidate;
        if (!drag || drag.button !== button || event.pointerId !== drag.pointerId) return;
        if (!drag.moving) {
          if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 8) {
            clearTimeout(drag.timer);
            suppressClick.add(id);
          }
          return;
        }
        event.preventDefault();
        const area = board.getBoundingClientRect();
        const bound = limits(board, button);
        drag.position = { x: clamp((event.clientX - area.left - drag.grabX) / area.width, bound.x),
          y: clamp((event.clientY - area.top - drag.grabY) / area.height, bound.y) };
        place(board, button, drag.position);
      });
      button.addEventListener("pointerup", (event) => { if (candidate?.pointerId === event.pointerId) finish(); });
      button.addEventListener("pointercancel", () => finish(true));
      button.addEventListener("lostpointercapture", () => finish(true));
      button.addEventListener("contextmenu", (event) => event.preventDefault());
      button.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { finish(true); return; }
        const offset = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }[event.key];
        if (!event.altKey || !offset) return;
        event.preventDefault();
        const bound = limits(board, button);
        const pos = positions[id];
        positions[id] = { x: clamp(pos.x + offset[0], bound.x), y: clamp(pos.y + offset[1], bound.y) };
        place(board, button, positions[id]);
        save();
      });
    }
  }
  if (folderMenu) {
    elements.soloMenuScreen.querySelector("h1").textContent = "ソロプレイ";
    elements.onlineMenuHead.querySelector("h1").textContent = "バトル";
    elements.onlinePrivateMatchButton.querySelector(".online-match-main").textContent = "プライベート";
  }
  // Existing mode descriptions remain available to assistive technology.
  const disabledModes = [elements.soloAiBattleButton, document.getElementById("onlineFourMatchButton")];
  function syncDisabled() {
    for (const button of shell.querySelectorAll(".computer-folder")) {
      const disabled = disabledModes.includes(button) || button.disabled;
      button.setAttribute("aria-disabled", String(disabled));
      button.disabled = false;
    }
  }
  function layout() {
    if (!folderMenu) return;
    for (const { board, folders } of groups) {
      for (const [id] of folders) place(board, document.getElementById(id), positions[id]);
    }
  }
  function renderDesktop() {
    const visible = Boolean(screenIds[state.screen]);
    shell.classList.toggle("hidden", !visible);
    document.body.classList.toggle("computer-active", visible);
    const menu = visible && (state.screen === "soloMenu"
      || (state.screen === "online" && !elements.onlineMatchActions.classList.contains("hidden")));
    shell.classList.toggle("desktop-open", menu && folderMenu);
    shell.classList.toggle("native-menu", menu && !folderMenu);
    if (!menu || activeScreen !== state.screen) finish(true);
    if (activeScreen !== state.screen) { activeScreen = state.screen; content.scrollTop = 0; }
    const switchLabel = state.screen === "soloMenu" ? "バトルへ切り替える" : "ソロプレイへ切り替える";
    for (const button of switches) {
      button.classList.toggle("hidden", !menu);
      button.setAttribute("aria-label", switchLabel);
    }
    syncDisabled();
    layout();
  }
  for (const button of switches) button.addEventListener("click", () => {
    if (state.screen === "soloMenu") showOnlineScreen(); else showSoloMenu();
  });
  // A single trackpad gesture switches once, not once per inertial wheel event.
  let wheel = { time: 0, distance: 0, switched: false };
  content.addEventListener("wheel", (event) => {
    if ((!shell.classList.contains("desktop-open") && !shell.classList.contains("native-menu")) || event.ctrlKey || event.defaultPrevented || candidate) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    const now = performance.now();
    if (now - wheel.time > 220) wheel = { time: now, distance: 0, switched: false };
    wheel.time = now;
    event.preventDefault();
    if (wheel.switched) return;
    wheel.distance += Math.abs(delta) * (event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? content.clientHeight : 1);
    if (wheel.distance < 48) return;
    wheel.switched = true;
    if (state.screen === "soloMenu") showOnlineScreen(); else showSoloMenu();
  }, { passive: false });
  window.addEventListener("blur", () => finish(true));
  window.addEventListener("resize", layout);
  const observer = new ResizeObserver(layout);
  for (const { board } of groups) observer.observe(board);
  window.ChibattleDesktop = { render: renderDesktop };
  renderDesktop();
})();
