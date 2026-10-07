/* Card-case screens reuse the game's card renderer, deck state and persistence.
   No sample decks or separate storage are introduced here. */
(() => {
  const screen = elements.deckScreen;
  const DECKS_PER_PAGE = 12;
  const ui = { cardPage: 0, deckPage: 0, query: "", type: "", cost: "", category: "", cardContext: [], opener: null };
  const arrow = (label, previous = false) => `<button type="button" class="case-arrow${previous ? " previous" : ""}" aria-label="${label}"><img src="assets/tutorial/chevron-right.svg" alt=""></button>`;
  const categories = [{ id: "common", name: "共通カード" }, ...SPECIALTY_DEFINITIONS];
  const categoryName = (id) => categories.find((entry) => entry.id === id)?.name || "共通カード";
  const view = () => state.deckBuilder.view;
  const paginate = (page, delta, total) => (page + delta + total) % total;
  const shell = (id) => cardShellTemplate(makePreviewCard(id, "player"));
  const head = screen.querySelector(".screen-head");
  head.querySelector("h1").textContent = "カード";
  head.insertAdjacentHTML("afterbegin", `<button type="button" class="case-back" aria-label="カードの選択画面へ戻る"><img src="assets/tutorial/chevron-right.svg" alt=""></button><img class="case-head-icon" src="assets/home/nav-card.png" alt="">`);
  head.querySelector(".case-back").addEventListener("click", () => navigate("entry"));
  screen.classList.add("card-case-screen");
  screen.insertAdjacentHTML("beforeend", `
    <section id="cardsEntryView" class="case-entry hidden" aria-label="カードのメニュー">
      <button type="button" class="case-choice" data-case-view="cards"><div class="case-choice-art">${shell("yuta")}</div><strong>カード一覧</strong><img src="assets/tutorial/chevron-right.svg" alt=""></button>
      <button type="button" class="case-choice" data-case-view="library"><div class="case-choice-art case-stack"><img src="assets/card-back.png?v=2" alt=""></div><strong>デッキ編成</strong><img src="assets/tutorial/chevron-right.svg" alt=""></button>
    </section>
    <section id="cardsCatalogView" class="case-catalog hidden">
      <div class="case-toolbar"><label>検索<input class="control" id="cardsCatalogSearch" type="search" placeholder="カード名・テキスト" aria-label="カードを検索"></label><button class="button secondary" id="cardsCatalogFilter" type="button" aria-expanded="false">絞り込み</button><span id="cardsCatalogCount"></span></div>
      <div id="cardsCatalogFilters" class="case-filters hidden">
        <label>タイプ<select class="control" data-catalog-filter="type"><option value="">すべて</option>${DECK_FILTER_TYPES.map((id) => `<option value="${id}">${labelForType(id)}</option>`).join("")}</select></label>
        <label>戦意<select class="control" data-catalog-filter="cost"><option value="">すべて</option><option value="none">なし</option>${Array.from({length:11}, (_, cost) => `<option value="${cost}">${cost === 10 ? "10以上" : cost}</option>`).join("")}</select></label>
        <label>専攻<select class="control" data-catalog-filter="category"><option value="">すべて</option>${categories.map((entry) => `<option value="${entry.id}">${entry.name}</option>`).join("")}</select></label>
        <button class="button secondary" type="button" id="cardsCatalogReset">リセット</button>
      </div>
      <div class="case-paged">${arrow("前のカードページ", true)}<div id="cardsCatalogGrid" class="case-card-grid"></div>${arrow("次のカードページ")}</div>
      <footer id="cardsCatalogPage" class="case-pagination"></footer>
    </section><div id="cardsNotice" class="case-notice" role="status"></div>`);
  screen.querySelectorAll("[data-case-view]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.caseView)));
  const catalog = document.getElementById("cardsCatalogView");
  const entry = document.getElementById("cardsEntryView");
  const catalogSearch = document.getElementById("cardsCatalogSearch");
  catalogSearch.addEventListener("input", () => { ui.query = catalogSearch.value; ui.cardPage = 0; renderCatalog(); });
  document.getElementById("cardsCatalogFilter").addEventListener("click", (event) => {
    const filters = document.getElementById("cardsCatalogFilters");
    filters.classList.toggle("hidden");
    event.currentTarget.setAttribute("aria-expanded", String(!filters.classList.contains("hidden")));
  });
  catalog.querySelectorAll("[data-catalog-filter]").forEach((select) => select.addEventListener("change", () => {
    ui[select.dataset.catalogFilter] = select.value; ui.cardPage = 0; renderCatalog();
  }));
  document.getElementById("cardsCatalogReset").addEventListener("click", () => {
    ui.type = ui.cost = ui.category = "";
    catalog.querySelectorAll("select").forEach((select) => { select.value = ""; });
    ui.cardPage = 0; renderCatalog();
  });
  catalog.querySelectorAll(".case-arrow").forEach((button, index) => button.addEventListener("click", () => {
    ui.cardPage = paginate(ui.cardPage, index ? 1 : -1, Math.max(1, Math.ceil(catalogIds().length / 20))); renderCatalog();
  }));

  // Retain the established editor controls and their event handlers.
  elements.exportDeckButton.textContent = "ファイル書き出し";
  elements.importDeckButton.textContent = "ファイル読み込み";
  elements.deckEditorBackButton.textContent = "閉じる";
  elements.saveDeckButton.textContent = "保存する";
  const editorHeader = document.createElement("div");
  editorHeader.className = "case-editor-head";
  elements.deckEditorView.prepend(editorHeader);
  editorHeader.append(elements.deckSaveNameInput, elements.deckEditorStatus, elements.deckEditorBackButton, elements.saveDeckButton);
  elements.deckSaveNameInput.setAttribute("aria-label", "デッキ名");
  elements.deckSaveNameInput.placeholder = "デッキ名";
  const fileTools = document.createElement("div");
  fileTools.className = "case-file-tools";
  fileTools.append(elements.importDeckButton, elements.exportDeckButton, elements.autoDeckButton, elements.clearDeckButton);
  elements.deckEditorView.append(fileTools);
  elements.deckEditorView.querySelector(".current-deck-panel").append(elements.deckCostCurve);

  const library = elements.deckLibraryView;
  const paged = document.createElement("div");
  paged.className = "case-paged case-deck-paged";
  paged.innerHTML = arrow("前のデッキページ", true) + arrow("次のデッキページ");
  library.insertBefore(paged, elements.deckLibraryGrid);
  paged.insertBefore(elements.deckLibraryGrid, paged.lastElementChild);
  library.insertAdjacentHTML("beforeend", `<footer id="caseDeckPage" class="case-pagination"></footer><div class="case-file-tools"><button class="button secondary" id="caseLibraryImport" type="button">ファイル読み込み</button></div>`);
  document.getElementById("caseLibraryImport").addEventListener("click", openDeckFilePicker);
  paged.querySelectorAll(".case-arrow").forEach((button, index) => button.addEventListener("click", () => {
    const pages = Math.ceil((sortedDeckLibraryNames(activeDeckCollection()).length + 1) / DECKS_PER_PAGE);
    ui.deckPage = paginate(ui.deckPage, index ? 1 : -1, pages); renderLibrary();
  }));
  [elements.deckLibrarySortKey, elements.deckLibrarySortDirection, elements.normalDeckFormatButton,
    elements.specialtyDeckFormatButton, elements.chaosDeckFormatButton].forEach((control) => control.addEventListener("click", () => { ui.deckPage = 0; }));
  [elements.deckLibrarySortKey, elements.deckLibrarySortDirection].forEach((control) => control.addEventListener("change", () => { ui.deckPage = 0; renderLibrary(); }));

  // The deck contents are a modal; they never displace the list underneath.
  const detailBackdrop = document.createElement("div");
  detailBackdrop.id = "caseDeckDetailModal";
  detailBackdrop.className = "case-modal-backdrop hidden";
  document.body.append(detailBackdrop);
  detailBackdrop.append(elements.deckLibraryDetail);
  elements.deckLibraryDetail.className = "case-deck-dialog hidden";
  elements.deckLibraryDetail.setAttribute("role", "dialog");
  elements.deckLibraryDetail.setAttribute("aria-modal", "true");
  elements.deckLibraryDetail.setAttribute("aria-labelledby", "caseDeckDetailTitle");
  detailBackdrop.addEventListener("click", (event) => { if (event.target === detailBackdrop) closeDeckDetail(); });

  // Use the game's existing interactive card-detail modal, including rarity and
  // related-card history. Its test button is only shown in the editor.
  const cardDialog = elements.cardTestModal.querySelector(".item-confirm-dialog");
  cardDialog.classList.add("case-card-dialog");
  cardDialog.insertAdjacentHTML("afterbegin", `<header class="case-modal-head"><h2>カード詳細</h2><button class="case-close" type="button" aria-label="閉じる">×</button></header>${arrow("前のカード", true)}${arrow("次のカード")}`);
  cardDialog.querySelector(".case-close").addEventListener("click", closeCardTestConfirm);
  cardDialog.querySelectorAll(".case-arrow").forEach((button, index) => button.addEventListener("click", () => {
    const context = ui.cardContext.length ? ui.cardContext : ALL_DECK_IDS;
    const current = context.indexOf(state.pendingTestCardId);
    const id = context[paginate(Math.max(0, current), index ? 1 : -1, context.length)];
    openCardTestConfirm(id);
  }));
  elements.cardTestCancelButton.textContent = "閉じる";

  function isDirty() {
    return state.screen === "deck" && view() === "editor"
      && (deckCountsFingerprint(state.deckBuilder.counts.player) !== state.deckBuilder.originalFingerprint
        || elements.deckSaveNameInput.value.trim() !== state.deckBuilder.editingName);
  }

  function confirmDiscard() {
    return new Promise((resolve) => {
      const opener = document.activeElement;
      const modal = document.createElement("dialog");
      modal.className = "case-confirm";
      modal.innerHTML = `<h2>編集を終了</h2><p>編集中の内容を破棄して戻りますか？</p><div><button class="button secondary" type="button" data-discard-cancel>キャンセル</button><button class="button" type="button" data-discard-yes>はい</button></div>`;
      document.body.append(modal);
      const finish = (answer) => { modal.close(); modal.remove(); opener?.focus(); resolve(answer); };
      modal.querySelector("[data-discard-cancel]").addEventListener("click", () => finish(false));
      modal.querySelector("[data-discard-yes]").addEventListener("click", () => finish(true));
      modal.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
      modal.showModal();
      modal.querySelector("[data-discard-cancel]").focus();
    });
  }

  async function navigate(destination) {
    if (isDirty() && !(await confirmDiscard())) return;
    closeCardTestConfirm();
    state.deckBuilder.view = destination;
    state.deckBuilder.selectedName = "";
    state.deckBuilder.pendingSpecialtyChoice = false;
    state.deckBuilder.editingName = "";
    ui.deckPage = 0;
    render();
  }

  // Protect the draft when leaving through the real home bar or home button.
  let approvedNavigation = false;
  [elements.homeNavHomeButton, elements.homeNavDeckButton, elements.homeNavBattleButton,
    elements.homeNavSoloButton, elements.deckBackHomeButton].forEach((button) => button.addEventListener("click", async (event) => {
      if (approvedNavigation || !isDirty()) return;
      event.stopImmediatePropagation();
      if (!(await confirmDiscard())) return;
      approvedNavigation = true; button.click(); approvedNavigation = false;
    }, true));

  function catalogIds() {
    return getDeckEditorIds("").filter((id) => {
      const base = CARD_BASES[id];
      return cardMatchesSearchQuery(id, ui.query, "player") && (!ui.type || base.type === ui.type)
        && (!ui.category || (base.category || "common") === ui.category)
        && (!ui.cost || (ui.cost === "none" ? base.noCost : !base.noCost && (ui.cost === "10" ? base.cost >= 10 : String(base.cost ?? 0) === ui.cost)));
    });
  }

  function openCard(id, context, opener) {
    ui.cardContext = context;
    ui.opener = opener || document.activeElement;
    hideCardTooltip();
    openCardTestConfirm(id);
    cardDialog.querySelector(".case-close").focus();
  }

  function renderCatalog() {
    const ids = catalogIds(), pages = Math.max(1, Math.ceil(ids.length / 20));
    ui.cardPage = Math.min(ui.cardPage, pages - 1);
    document.getElementById("cardsCatalogCount").textContent = `${ids.length}枚`;
    document.getElementById("cardsCatalogPage").textContent = `— Page ${ui.cardPage + 1} / ${pages} —`;
    const grid = document.getElementById("cardsCatalogGrid");
    grid.innerHTML = ids.slice(ui.cardPage * 20, ui.cardPage * 20 + 20).map((id) => `<button type="button" class="case-catalog-card" data-catalog-card="${id}" aria-label="${escapeHtml(CARD_BASES[id].name)}の詳細">${shell(id)}</button>`).join("")
      || '<p class="case-empty">条件に合うカードがありません。</p>';
    grid.querySelectorAll("[data-catalog-card]").forEach((button) => button.addEventListener("click", () => openCard(button.dataset.catalogCard, ids, button)));
    catalog.querySelectorAll(".case-arrow").forEach((button) => { button.disabled = pages <= 1; });
    scheduleCardTemplateScaleSync();
  }

  function renderLibrary() {
    const active = state.screen === "deck", editing = view() === "editor", listing = view() === "library";
    entry.classList.toggle("hidden", !active || view() !== "entry");
    catalog.classList.toggle("hidden", !active || view() !== "cards");
    library.classList.toggle("hidden", !active || !listing);
    elements.deckEditorView.classList.toggle("hidden", !active || !editing);
    screen.dataset.caseView = view();
    head.querySelector("h1").textContent = ({ entry: "カード", cards: "カード一覧", library: "デッキ編成", editor: "デッキ編集" })[view()] || "カード";
    head.querySelector(".case-back").classList.toggle("hidden", view() === "entry");
    if (!active || !listing) detailBackdrop.classList.add("hidden");
    if (!active) { closeCardTestConfirm(); return; }
    showNotice();
    if (view() === "cards") { renderCatalog(); return; }
    if (!listing) return;
    const specialty = isSpecialtyDeckFormat(), chaos = isChaosDeckFormat();
    const names = sortedDeckLibraryNames(activeDeckCollection());
    const pages = Math.ceil((names.length + 1) / DECKS_PER_PAGE);
    ui.deckPage = Math.min(ui.deckPage, pages - 1);
    elements.deckLibrarySortKey.value = state.deckBuilder.librarySort.key;
    elements.deckLibrarySortDirection.value = state.deckBuilder.librarySort.direction;
    const timeSort = ["created", "updated"].includes(state.deckBuilder.librarySort.key);
    elements.deckLibrarySortDirection.querySelector('[value="desc"]').textContent = timeSort ? "降順（新しい順）" : "降順";
    elements.deckLibrarySortDirection.querySelector('[value="asc"]').textContent = timeSort ? "昇順（古い順）" : "昇順";
    elements.normalDeckFormatButton.classList.toggle("active", !specialty && !chaos);
    elements.specialtyDeckFormatButton.classList.toggle("active", specialty);
    elements.chaosDeckFormatButton.classList.toggle("active", chaos);
    elements.deckLibraryCount.textContent = `${names.length}個`;
    elements.deckBackHomeButton.textContent = state.deckBuilder.returnScreen === "dungeonDeck" ? "戻る" : "ホーム";
    elements.deckLibraryGrid.innerHTML = "";
    names.slice(ui.deckPage * DECKS_PER_PAGE, (ui.deckPage + 1) * DECKS_PER_PAGE).forEach((name) => {
      const saved = activeDeckCollection()[name];
      const button = document.createElement("button");
      button.type = "button"; button.className = "deck-library-card case-deck-tile";
      button.title = "ダブルクリックで変更";
      button.innerHTML = `<span class="case-deck-spine" aria-hidden="true"></span><span>${escapeHtml(name)}</span><small>${deckSize(saved.counts)}枚${specialty ? ` · ${escapeHtml(categoryName(saved.specialtyId))}` : ""}</small>`;
      // Delay a single click briefly so a double click goes straight to editing.
      let timer;
      button.addEventListener("click", () => { clearTimeout(timer); timer = setTimeout(() => {
        ui.opener = button; state.deckBuilder.selectedName = name;
        if (specialty) state.deckBuilder.specialtyId = saved.specialtyId;
        render(); elements.deckLibraryDetail.querySelector(".case-close")?.focus();
      }, 240); });
      button.addEventListener("dblclick", (event) => { event.preventDefault(); clearTimeout(timer); beginExistingDeckEditor(name); });
      elements.deckLibraryGrid.append(button);
    });
    if (ui.deckPage === pages - 1) {
      const newButton = document.createElement("button");
      newButton.type = "button"; newButton.className = "deck-library-card new-deck"; newButton.textContent = "＋ 新規作成";
      newButton.addEventListener("click", () => {
        state.deckBuilder.selectedName = "";
        if (specialty) { state.deckBuilder.pendingSpecialtyChoice = true; render(); }
        else beginNewDeckEditor();
      });
      elements.deckLibraryGrid.append(newButton);
    }
    document.getElementById("caseDeckPage").textContent = `— Page ${ui.deckPage + 1} / ${pages} —`;
    paged.querySelectorAll(".case-arrow").forEach((button) => { button.disabled = pages <= 1; });
    renderSpecialtyChoice();
    renderDeckDetail(names);
  }

  function closeDeckDetail() {
    state.deckBuilder.selectedName = ""; renderLibrary(); ui.opener?.focus();
  }

  // Use the largest cards that fit all kinds, reducing their size as rows increase.
  // Observe the area rather than the viewport so the footer and dialog still fit.
  const deckContentsObserver = new ResizeObserver(([entry]) => fitDeckContents(entry.target));
  function fitDeckContents(contents) {
    const count = contents.children.length;
    if (!count || !contents.clientWidth || !contents.clientHeight) return;
    const width = contents.clientWidth - 24, height = contents.clientHeight - 24;
    const gap = 6;
    let best = { columns: 1, rows: count, cardWidth: 0 };
    for (let columns = count <= 4 ? count : 1; columns <= count; columns++) {
      const rows = Math.ceil(count / columns);
      const cardWidth = Math.min(
        (width - gap * (columns - 1)) / columns,
        ((height - gap * (rows - 1)) / rows) * 21 / 32);
      if (cardWidth > best.cardWidth || (cardWidth === best.cardWidth && rows < best.rows)) {
        best = { columns, rows, cardWidth };
      }
    }
    contents.style.setProperty("--deck-content-columns", best.columns);
    contents.style.setProperty("--deck-content-rows", best.rows);
    contents.style.setProperty("--deck-content-card-width", `${Math.max(1, Math.floor(best.cardWidth))}px`);
    scheduleCardTemplateScaleSync();
  }

  function renderDeckDetail(names) {
    deckContentsObserver.disconnect();
    const name = state.deckBuilder.selectedName, saved = activeDeckCollection()[name];
    detailBackdrop.classList.toggle("hidden", !saved);
    elements.deckLibraryDetail.classList.toggle("hidden", !saved);
    if (!saved) { elements.deckLibraryDetail.innerHTML = ""; return; }
    const ids = getDeckEditorIds(isSpecialtyDeckFormat() ? saved.specialtyId : "").filter((id) => saved.counts[id] > 0);
    elements.deckLibraryDetail.innerHTML = `<header class="case-modal-head"><h2 id="caseDeckDetailTitle">デッキ詳細</h2><button class="case-close" type="button" data-deck-close aria-label="閉じる">×</button></header>
      <div class="case-deck-detail-tools"><h2>${escapeHtml(name)}</h2><button class="button secondary" data-deck-export type="button">ファイル書き出し</button><span>${deckSize(saved.counts)}枚</span></div>
      <div class="case-deck-detail-body">${arrow("前のデッキ", true)}<div class="case-deck-contents">${ids.map((id) => `<button class="case-deck-content" type="button" data-library-card="${id}" aria-label="${escapeHtml(CARD_BASES[id].name)}、${saved.counts[id]}枚、カード詳細を表示">${cardShellTemplate(makePreviewCard(id, "player"), "deck-window-card")}<span class="deck-copy-badge case-deck-copy-count">x${saved.counts[id]}</span></button>`).join("")}</div><div class="case-reserved-space" aria-hidden="true"></div>${arrow("次のデッキ")}</div>
      <footer class="case-deck-detail-footer">${deckCurveHtml(saved.counts)}<div><button class="button warning" type="button" data-deck-remove>削除する</button><button class="button" type="button" data-deck-edit>編成する</button></div></footer>`;
    const contents = elements.deckLibraryDetail.querySelector(".case-deck-contents");
    fitDeckContents(contents);
    deckContentsObserver.observe(contents);
    elements.deckLibraryDetail.querySelector("[data-deck-close]").addEventListener("click", closeDeckDetail);
    elements.deckLibraryDetail.querySelector("[data-deck-edit]").addEventListener("click", () => beginExistingDeckEditor(name));
    elements.deckLibraryDetail.querySelector("[data-deck-remove]").addEventListener("click", () => deleteSavedDeckByName(name));
    elements.deckLibraryDetail.querySelector("[data-deck-export]").addEventListener("click", async () => {
      try { const result = await saveDeckFile(name, saved.counts); state.message = result === "cancelled" ? "書き出しをキャンセルしました。" : "デッキファイルを書き出しました。"; showNotice(); }
      catch { state.message = "デッキファイルを書き出せませんでした。"; showNotice(); }
    });
    elements.deckLibraryDetail.querySelectorAll("[data-library-card]").forEach((button) => button.addEventListener("click", () => openCard(button.dataset.libraryCard, ids, button)));
    elements.deckLibraryDetail.querySelectorAll(".case-arrow").forEach((button, index) => {
      button.disabled = names.length <= 1;
      button.addEventListener("click", () => {
        const next = names[paginate(names.indexOf(name), index ? 1 : -1, names.length)];
        state.deckBuilder.selectedName = next;
        if (isSpecialtyDeckFormat()) state.deckBuilder.specialtyId = activeDeckCollection()[next].specialtyId;
        renderLibrary();
      });
    });
  }

  function renderEditor() {
    ui.cardContext = getDeckEditorIds().filter(deckCardMatchesFilters);
    elements.deckCostCurve.innerHTML = deckCurveHtml(state.deckBuilder.counts.player);
    // The native editor card buttons still open rarity controls and card tests.
    elements.deckEditorList.querySelectorAll("[data-card-test]").forEach((button) => button.addEventListener("click", () => { ui.opener = button; }));
    showNotice();
  }

  function renderCardDetail(baseId) {
    const card = makePreviewCard(baseId, "player"), text = elements.cardTestText;
    document.getElementById("cardTestTitle").textContent = "カード詳細";
    elements.cardTestStartButton.classList.toggle("hidden", view() !== "editor");
    const title = text.querySelector(".tooltip-title");
    title.insertAdjacentHTML("afterend", `<button type="button" class="case-favorite" aria-label="好きなカードに設定" aria-pressed="${state.profile.favoriteCardId === baseId}" ${!ALL_DECK_IDS.includes(baseId) ? "disabled" : ""}>${state.profile.favoriteCardId === baseId ? "★" : "☆"}</button>`);
    text.querySelector(".case-favorite").addEventListener("click", () => {
      try {
        state.profile = savePlayerProfile({ ...state.profile, favoriteCardId: baseId, favoriteCardStyle: localCardStyleMode(baseId) });
        renderPlayerProfile(); renderCardTestConfirm(baseId);
      } catch { state.message = "好きなカードを保存できませんでした。"; showNotice(); }
    });
    text.querySelector(".tooltip-meta").textContent = `${labelForType(card.type)} / ${categoryName(card.category)} / ${card.noCost ? "戦意なし" : `戦意${card.cost}`}${!["item", "environment"].includes(card.type) ? ` / 攻 ${card.attack} / 体 ${card.hp}` : ""}`;
    const context = ui.cardContext.length ? ui.cardContext : ALL_DECK_IDS;
    cardDialog.querySelectorAll(".case-arrow").forEach((button) => { button.disabled = context.length <= 1; });
  }

  let noticeTimer, lastMessage = state.message;
  function showNotice() {
    const notice = document.getElementById("cardsNotice");
    if (!state.message || state.message === lastMessage) return;
    lastMessage = state.message;
    notice.textContent = state.message;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.textContent = ""; }, 4500);
  }

  document.addEventListener("keydown", (event) => {
    if (state.screen !== "deck") return;
    if (event.key === "Escape") {
      if (!elements.cardTestModal.classList.contains("hidden")) closeCardTestConfirm();
      else if (!detailBackdrop.classList.contains("hidden")) closeDeckDetail();
    }
    if (event.key !== "Tab") return;
    const modal = !elements.cardTestModal.classList.contains("hidden") ? cardDialog
      : !detailBackdrop.classList.contains("hidden") ? elements.deckLibraryDetail : null;
    if (!modal) return;
    const buttons = [...modal.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')].filter((node) => node.getClientRects().length);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  // All paged views share the same trackpad/wheel gesture. One gesture advances
  // one page; its inertial tail must not skip several pages or reach a lower modal.
  const pageViews = "#cardsCatalogView, #deckLibraryView, .case-deck-dialog, .case-card-dialog, .tutorial-detail";
  let gesture = { root: null, lastEvent: 0, distance: 0, direction: 0, moved: false };
  document.addEventListener("wheel", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const root = target?.closest(pageViews);
    if (!root || !root.getClientRects().length || event.ctrlKey || event.defaultPrevented
      || target.closest('input, select, textarea, [contenteditable="true"]')
      || document.querySelector("dialog[open]")) return;
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = horizontal ? event.deltaX : event.deltaY;
    if (!delta) return;
    // Keep native scrolling in long descriptions/lists, including at their ends.
    for (let node = target; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (horizontal
        ? /auto|scroll/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1
        : /auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
        gesture.root = null;
        return;
      }
      if (node === root) break;
    }
    const direction = Math.sign(delta);
    const tutorial = root.matches(".tutorial-detail");
    const button = tutorial ? elements.tutorialStageSwitch
      : root.querySelector(direction < 0 ? ".case-arrow.previous" : ".case-arrow:not(.previous)");
    if (!button || button.disabled || !button.getClientRects().length) return;
    const now = performance.now();
    // The deck dialog is rebuilt on each page, so identify gestures by the stable
    // backdrop rather than by the replaced dialog contents.
    const gestureRoot = root.closest("#caseDeckDetailModal") || root;
    if (gesture.root !== gestureRoot || now - gesture.lastEvent > 220) {
      gesture = { root: gestureRoot, lastEvent: now, distance: 0, direction, moved: false };
    }
    gesture.lastEvent = now;
    event.preventDefault();
    if (gesture.moved) return;
    if (gesture.direction !== direction) { gesture.distance = 0; gesture.direction = direction; }
    const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? root.clientHeight : 1;
    gesture.distance += Math.abs(delta) * unit;
    if (gesture.distance < 48) return;
    gesture.moved = true;
    if (tutorial && ((direction > 0 && state.tutorialMenu.stage === "quiz")
      || (direction < 0 && state.tutorialMenu.stage !== "quiz"))) return;
    button.click();
  }, { passive: false });

  window.ChibattleCards = { renderLibrary, renderEditor, renderCardDetail, confirmDiscard, isDirty,
    restoreCardFocus: () => { if (ui.opener?.isConnected) ui.opener.focus(); } };
  render();
})();
