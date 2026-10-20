    // This file is injected into the existing game's lexical scope ONLY by
    // experimental-rules/server.mjs. Production never loads it.
    const nr = { active: false, pilot: 1, observing: false, pendingAction: null };
    const nrConfirmStorageKey = "chibattle-experimental-confirmations-v1";
    const nrConfirmSettings = { attack: true, move: true };
    try {
      const saved = JSON.parse(localStorage.getItem(nrConfirmStorageKey) || "null");
      for (const key of ["attack", "move"]) if (typeof saved?.[key] === "boolean") nrConfirmSettings[key] = saved[key];
    } catch (_) { /* Keep both confirmations enabled when storage is unavailable. */ }
    const nrPairIds = new Set(Object.values(HORSE_PAIR_RESULTS));

    function nrRef(card) {
      if (!card?.owner) return null;
      return listBoardRefs(card.owner).find(ref => getBoardCardFromRef(ref)?.instanceId === card.instanceId) || null;
    }
    function nrInAttackArea(card, ref = nrRef(card)) {
      if (!card || !ref) return false;
      if (ref.zone === "teacher") return true;
      return ref.zone === "seat" && occupiedSeatIndexesFor(card, ref.index).some(index => index < 6);
    }
    function nrLocation(ref) { return `${ref.zone}:${ref.index ?? ""}`; }
    function nrMarkAttendance(card, zone, index, source) {
      if (zone === "environment") return;
      card.nrLocation = `${zone}:${index ?? ""}`;
      card.nrBodyReady = false;
      card.nrEntryTurn = state.actionTurn;
      card.nrSuperLost = zone === "seat" && !occupiedSeatIndexesFor(card, index).some(i => i < 6);
      delete card.nrAction;
    }
    function nrInheritEvolution(previous, evolved) {
      ["nrLocation", "nrBodyReady", "nrEntryTurn", "nrSuperLost", "nrAction"].forEach(key => {
        if (Object.hasOwn(previous, key)) evolved[key] = previous[key];
      });
      evolved.playedOnTurn = previous.playedOnTurn;
    }
    function nrObserve() {
      if (nr.observing) return;
      nr.observing = true;
      try {
        ["player", "opponent"].forEach(side => listBoardRefs(side).forEach(ref => {
          const card = getBoardCardFromRef(ref);
          const front = nrInAttackArea(card, ref);
          if (card.nrLocation === undefined) {
            card.nrLocation = nrLocation(ref);
            card.nrEntryTurn = card.playedOnTurn ?? state.actionTurn;
            card.nrBodyReady = front && card.playedOnTurn < state.actionTurn;
            card.nrSuperLost = !front;
          } else if (card.nrLocation !== nrLocation(ref)) {
            if (!front) { card.nrBodyReady = false; card.nrSuperLost = true; }
            card.nrLocation = nrLocation(ref);
          }
        }));
      } finally { nr.observing = false; }
    }
    function nrCanHitLife(card) {
      nrObserve();
      return nrInAttackArea(card) && (card.nrBodyReady
        || (card.playedOnTurn === state.actionTurn && !card.nrSuperLost && hasKeyword(card, "超陽気")));
    }
    function nrActionAvailable(card) {
      return card && !["move", "lecture"].includes(card.nrAction)
        && cardAttacksUsedThisTurn(card) === 0
        && !isPadlocked(card)
        && (card.playedOnTurn !== state.actionTurn || hasKeyword(card, "陽気"));
    }
    function nrPositionAllowed(card, zone, index) {
      if (card.frontRowOnly && (zone !== "seat" || seatRow(index) !== 1)) return false;
      if (card.rowOnly && (zone !== "seat" || seatRow(index) !== card.rowOnly)) return false;
      if (card.baseId === "seat_taking_group" && (zone !== "seat" || index !== 4)) return false;
      if (card.baseId === "small_omata" && zone !== "teacher") return false;
      if (zone === "teacher") return true; // Effects may move students here.
      const indexes = occupiedSeatIndexesFor(card, index);
      return indexes.length > 0 && indexes.every(i => !isSeatBlocked(card.owner, i) && !isSeatClosedByAggro(card.owner, i)
        && !(ongoingEnvironmentBaseId() === "full_lock" && state.fullLockSeatBlocks.some(block => block.owner === card.owner && block.index === i)));
    }
    function nrFits(card, zone, index, ignored = new Set()) {
      if (zone === "teacher") {
        const occupant = state.players[card.owner].board.teacher;
        return !card.occupiedSeatSize && (!occupant || ignored.has(occupant.instanceId));
      }
      const indexes = occupiedSeatIndexesFor(card, index);
      return indexes.length > 0 && indexes.every(i => {
        const occupant = state.players[card.owner].board.seats[i];
        return !occupant || ignored.has(occupant.instanceId);
      });
    }
    function nrPut(card, zone, index) {
      if (zone === "seat" && card.occupiedSeatSize) placeMultiSeatCard(card.owner, index, card);
      else setBoardCard(card.owner, zone, index, card);
    }
    function nrCheckMoved(card) {
      const ref = nrRef(card);
      if (!ref) return;
      nrObserve();
      if (!nrPositionAllowed(card, ref.zone, ref.index)) {
        // Positional illegality is a rule departure, not destruction, and is
        // not prevented by a padlock or immunity to other cards' effects.
        destroyBoardCard(ref, { reason: "出席できない位置への移動", showDestroyFeedback: false,
          isDestruction: false, ignorePadlock: true, ignoreAibenNyoteiEffectImmunity: true });
      }
    }
    function nrRelocate(card, zone, index, { forced = true } = {}) {
      const from = nrRef(card);
      if (!from || !nrFits(card, zone, index, new Set([card.instanceId]))) return false;
      if (!forced && !nrPositionAllowed(card, zone, index)) return false;
      nrObserve();
      clearBoardCardFromField(card.owner, from.zone, from.index, card);
      nrPut(card, zone, index);
      nrCheckMoved(card);
      return true;
    }
    function nrRandomRelocate(card, oldIndex) {
      if (isAibenNyoteiEffectImmune(card)) return false;
      const ignored = new Set([card.instanceId]);
      const candidates = Array.from({ length: 9 }, (_, i) => i)
        .filter(i => i !== oldIndex && nrFits(card, "seat", i, ignored));
      if (!candidates.length) return false;
      return nrRelocate(card, "seat", candidates[Math.floor(Math.random() * candidates.length)], { forced: true });
    }
    function nrPortal(side) {
      const board = state.players[side].board.seats;
      // Retain the current card's multi-row restriction until its adjustment
      // is agreed; the card itself remains available in the test collection.
      if (listBoardRefs(side).some(ref => getBoardCardFromRef(ref)?.occupiedSeatSize?.rows > 1)) return false;
      nrObserve();
      const moved = [...new Map([...board.slice(0, 3), ...board.slice(6, 9)].filter(Boolean).map(card => [card.instanceId, card])).values()];
      for (let col = 0; col < 3; col++) [board[col], board[6 + col]] = [board[6 + col], board[col]];
      moved.forEach(card => {
        const index = board.findIndex(entry => entry?.instanceId === card.instanceId);
        if (card.occupiedSeatSize) {
          card.seatAnchorIndex = index;
          card.occupiedSeatIndexes = occupiedSeatIndexesFor(card, index);
        }
        if (card.baseId === "aggro_king" && index !== 6) card.aggroKingTurns = 0;
      });
      moved.sort((a, b) => nrRef(a).index - nrRef(b).index).forEach(nrCheckMoved);
      return true;
    }
    function nrPackRows() {
      nrObserve();
      ["player", "opponent"].forEach(side => {
        const cards = listBoardRefs(side).filter(ref => ref.zone === "seat")
          .sort((a, b) => a.index - b.index).map(getBoardCardFromRef);
        cards.forEach(card => {
          const ref = nrRef(card);
          if (!ref) return;
          const first = Math.floor(ref.index / 3) * 3;
          for (let index = first; index < ref.index; index++) {
            if (nrFits(card, "seat", index, new Set([card.instanceId]))) {
              nrRelocate(card, "seat", index, { forced: true }); break;
            }
          }
        });
      });
    }
    function nrPlanMove(card, destination) {
      const from = nrRef(card);
      if (!from || from.zone !== "seat" || destination < 0 || destination > 8 || !nrActionAvailable(card)) return null;
      const target = state.players[card.owner].board.seats[destination];
      if (target?.instanceId === card.instanceId) return null;
      const targetRef = target ? nrRef(target) : null;
      const anchor = targetRef?.index ?? destination;
      const fromFront = nrInAttackArea(card, from);
      const toFront = nrInAttackArea(card, { owner: card.owner, zone: "seat", index: anchor });
      if (fromFront === toFront || !nrPositionAllowed(card, "seat", anchor)) return null;
      const ignored = new Set([card.instanceId, target?.instanceId].filter(Boolean));
      if (!nrFits(card, "seat", anchor, ignored)) return null;
      if (target) {
        if (!nrActionAvailable(target) || !nrPositionAllowed(target, "seat", from.index)
          || !nrFits(target, "seat", from.index, ignored)) return null;
        const a = occupiedSeatIndexesFor(card, anchor), b = occupiedSeatIndexesFor(target, from.index);
        if (a.some(i => b.includes(i))) return null;
        if (nrInAttackArea(target, targetRef) === nrInAttackArea(target, { owner: card.owner, zone: "seat", index: from.index })) return null;
      }
      return { card, from, target, targetRef, anchor };
    }
    function nrMove(card, destination) {
      if (battleNewActionBlocked() || card?.owner !== state.currentSide) return false;
      const plan = nrPlanMove(card, destination);
      if (!plan) return false;
      nrObserve();
      clearBoardCardFromField(card.owner, "seat", plan.from.index, card);
      if (plan.target) clearBoardCardFromField(card.owner, "seat", plan.targetRef.index, plan.target);
      nrPut(card, "seat", plan.anchor);
      card.nrAction = "move";
      if (plan.target) { nrPut(plan.target, "seat", plan.from.index); plan.target.nrAction = "move"; }
      nrObserve();
      applyBoardAuras();
      addLog(`${card.name}を${seatRow(plan.anchor)}行${seatCol(plan.anchor) + 1}列へ${plan.target ? "入れ替え" : "移動"}しました。`);
      clearSelections(); render();
      return true;
    }

    // Existing UI, combat, damage, equipment and card effects remain in use.
    const nrOriginal = { canAttack, canAttackSilently, canSelectedAttackerTargetLife,
      attackLifeForCurrentSide, isAllowedAttackTarget, listAttentionCards,
      lectureTargetEntries, performTeacherLecture, startTurn, resetAttackFlags,
      render, renderPlayerBoard, cardRulesText, createSlot, createBoardCard, handleBoardCardClick,
      attackCard, attackLife, battleNewActionBlocked,
      happyBlueBirdAttackTargets, initializeGame, moveToTrash, castItemOnCard, canUseItemOnBoardTarget };
    moveToTrash = (owner, card, options = {}) => {
      const materials = card && !card.tokenVanished ? horseFusionMaterialEntries(card).map(entry => entry.baseId) : [];
      const result = nrOriginal.moveToTrash(owner, card, options);
      if (result && materials.length) materials.forEach(baseId => {
        nrOriginal.moveToTrash(owner, createCardFromBase(baseId, owner), {
          sourceZone: "generated", reason: "融合素材", suppressToast: true
        });
      });
      return result;
    };
    battleNewActionBlocked = () => Boolean(nr.pendingAction) || nrOriginal.battleNewActionBlocked();
    canAttackSilently = function(card) {
      return Boolean(card && nrInAttackArea(card) && !["move", "lecture"].includes(card.nrAction) && nrOriginal.canAttackSilently(card));
    };
    canAttack = function(card) {
      if (!nrInAttackArea(card) || ["move", "lecture"].includes(card?.nrAction)) {
        state.message = !nrInAttackArea(card) ? "3行目からは攻撃できません。" : "この出席者は行動済みです。";
        return false;
      }
      return nrOriginal.canAttack(card);
    };
    listAttentionCards = owner => nrOriginal.listAttentionCards(owner).filter(card => nrInAttackArea(card));
    listAttackPriorityCards = owner => {
      const cards = listAttentionCards(owner), supers = cards.filter(card => hasKeyword(card, "超注目"));
      return supers.length ? supers : cards;
    };
    isAllowedAttackTarget = (owner, target) => nrInAttackArea(target) && nrOriginal.isAllowedAttackTarget(owner, target);
    canSelectedAttackerTargetLife = (side, options = {}) => {
      const card = options.attacker || getSelectedAttackCard();
      return Boolean(card && nrCanHitLife(card) && nrOriginal.canSelectedAttackerTargetLife(side, options));
    };
    attackLifeForCurrentSide = async side => {
      const card = getBoardCardFromRef(state.selectedAttacker);
      if (card && !nrCanHitLife(card)) {
        state.message = "本体への攻撃は、攻撃可能エリアで次の自分のターンを迎えてから可能です。";
        render(); return false;
      }
      return nrOriginal.attackLifeForCurrentSide(side);
    };
    lectureTargetEntries = (side, teacher) => nrOriginal.lectureTargetEntries(side, teacher).filter(entry => nrInAttackArea(entry.card, entry.ref));
    performTeacherLecture = (side, ref, options = {}) => {
      const card = getBoardCardFromRef(ref);
      const result = nrOriginal.performTeacherLecture(side, ref, { ...options, renderAfter: false });
      if (result && card) card.nrAction = "lecture";
      if (options.renderAfter !== false) render();
      return result;
    };
    happyBlueBirdAttackTargets = attacker => {
      // An ability attack is not stopped by ordinary Attention. Super
      // Attention only redirects among targets actually within its range.
      const entries = listBoardRefs(oppositeSide(attacker.owner)).map(ref => ({ ref, card: getBoardCardFromRef(ref) }))
        .filter(({ card, ref }) => card && nrInAttackArea(card, ref)
          && canAibenNyoteiAttackTarget(attacker, card) && !isDesignDomainAttackBlocked(attacker, card)
          && !(card.untargetableUntilTurn && card.untargetableUntilTurn >= state.actionTurn));
      const supers = entries.filter(entry => hasKeyword(entry.card, "超注目"));
      return supers.length ? supers : entries;
    };
    effectTargetEntries = (sourceSide, targetSide, predicate = null) => {
      const entries = listBoardRefs(targetSide).map(ref => ({ ref, card: getBoardCardFromRef(ref) }))
        .filter(entry => entry.card && !isAibenNyoteiEffectImmune(entry.card) && (!predicate || predicate(entry.card, entry.ref)));
      const supers = entries.filter(entry => hasKeyword(entry.card, "超注目"));
      return sourceSide && sourceSide !== targetSide && supers.length ? supers : entries;
    };
    moveOpponentThirdRowStudents = owner => {
      const cards = listBoardRefs(owner).filter(ref => ref.zone === "seat" && seatRow(ref.index) === 3)
        .map(getBoardCardFromRef).filter(card => card?.type === "student" && !isAibenNyoteiEffectImmune(card));
      cards.forEach(card => {
        const destination = [0, 1, 2].find(i => nrFits(card, "seat", i, new Set([card.instanceId])) && nrPositionAllowed(card, "seat", i));
        if (destination !== undefined) nrRelocate(card, "seat", destination, { forced: false });
      });
    };
    canUseItemOnBoardTarget = (item, owner, zone, index) => {
      const card = getBoardCard(owner, zone, index);
      if (item?.baseId === "attitude" && card && (!nrPositionAllowed(card, "teacher", null) || !nrFits(card, "teacher", null))) return false;
      return nrOriginal.canUseItemOnBoardTarget(item, owner, zone, index);
    };
    castItemOnCard = (side, item, owner, zone, index, renderAfter) => {
      const card = getBoardCard(owner, zone, index);
      if (item?.baseId === "attitude" && card && (!nrPositionAllowed(card, "teacher", null) || !nrFits(card, "teacher", null))) return false;
      return nrOriginal.castItemOnCard(side, item, owner, zone, index, renderAfter);
    };
    resetAttackFlags = side => {
      nrOriginal.resetAttackFlags(side);
      listBoardRefs(side).forEach(ref => { delete getBoardCardFromRef(ref).nrAction; });
    };

    // Two human sides share one browser. Flip the existing perspective before
    // the next turn starts, so all existing hand/choice/target controls work.
    function nrFlipPerspective() {
      const seen = new WeakSet();
      const flip = value => {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        const hasPlayer = Object.hasOwn(value, "player"), hasOpponent = Object.hasOwn(value, "opponent");
        if (hasPlayer || hasOpponent) {
          const a = value.player, b = value.opponent;
          delete value.player; delete value.opponent;
          if (hasOpponent) value.player = b;
          if (hasPlayer) value.opponent = a;
        }
        Object.keys(value).forEach(key => {
          if (value[key] === "player") value[key] = "opponent";
          else if (value[key] === "opponent") value[key] = "player";
          else flip(value[key]);
        });
      };
      // Do not flip profiles, saved decks, settings or the underlying save.
      Object.keys(state).filter(key => !["deckBuilder", "profile", "playerProfile", "online", "soloSelection", "training", "dungeon", "analytics"].includes(key)).forEach(key => {
        if (state[key] === "player") state[key] = "opponent";
        else if (state[key] === "opponent") state[key] = "player";
        else flip(state[key]);
      });
      nr.pilot = nr.pilot === 1 ? 2 : 1;
      nrCloseActionConfirmation();
      SIDES.player = `プレイヤー${nr.pilot}`;
      SIDES.opponent = `プレイヤー${nr.pilot === 1 ? 2 : 1}`;
      boardVisualSnapshots.clear();
      clearSelections();
    }
    startTurn = side => {
      if (nr.active && side === "opponent") { nrFlipPerspective(); side = "player"; }
      nrObserve();
      listBoardRefs(side).forEach(ref => {
        const card = getBoardCardFromRef(ref);
        if (nrInAttackArea(card, ref) && card.nrEntryTurn < state.actionTurn) card.nrBodyReady = true;
      });
      return nrOriginal.startTurn(side);
    };
    scheduleOpponentAI = () => { state.aiThinking = false; };

    cardRulesText = card => {
      let text = nrOriginal.cardRulesText(card);
      if (nrPairIds.has(card?.baseId)) text = text.replace(/自分のターン終了時、/, "自分のターン終了時、これが攻撃可能エリアにいるなら、");
      if (card?.baseId === "sick_yuta") text = text.replace("自分のターン終了時、相手", "自分のターン終了時、これが攻撃可能エリアにいるなら、相手");
      if (card?.baseId === "aggro_queen") text = text.replace("相手の学生1人", "相手の1・2行目にいる出席者1人");
      return text;
    };
    Object.assign(BATTLE_CARD_TERM_DESCRIPTIONS, {
      "超陽気": "手札から攻撃可能エリアへ出席したターン、相手本体にも攻撃できる。3行目を経由した場合は陽気相当となる。能力で明示的に付与された場合も、その出席ターンの本体攻撃が可能。",
      "陽気": "出席したターンでも、攻撃可能エリアから出席者を攻撃するか、通常移動できる。移動しても行動権・攻撃回数は回復しない。",
      "注目": "攻撃可能エリアにいる間、相手の直接攻撃の対象を制限する。3行目では攻撃のデコイとして働かない。",
      "超注目": "攻撃可能エリアでは攻撃のデコイとして働く。3行目でも、対象範囲内の効果を引き受ける。効果の対象範囲を広げることはない。",
      "講義": "教卓にいる行動可能な教師が、攻撃の代わりに行う。相手の攻撃可能エリアにいる、対象となる出席者すべてに1ダメージを与える。3行目には届かない。"
    });

    function nrStatus(card) {
      if (["move", "lecture"].includes(card.nrAction)) return "行動済み";
      if (!nrInAttackArea(card)) return "3行目";
      return nrCanHitLife(card) ? "本体攻撃可" : "本体攻撃待機";
    }
    function nrSelectedActor() {
      if (state.selectedHandId || battleChoicePending() || state.currentSide !== "player") return null;
      const card = getBoardCardFromRef(state.selectedAttacker);
      return card?.owner === "player" ? card : null;
    }
    function nrSetConfirmation(key, enabled) {
      if (!["attack", "move"].includes(key)) return;
      nrConfirmSettings[key] = Boolean(enabled);
      try { localStorage.setItem(nrConfirmStorageKey, JSON.stringify(nrConfirmSettings)); } catch (_) { /* Session setting still works. */ }
      const checkbox = document.getElementById(key === "attack" ? "nrConfirmAttack" : "nrConfirmMove");
      if (checkbox) checkbox.checked = nrConfirmSettings[key];
    }
    function nrActionSnapshot(kind, target) {
      const actor = nrSelectedActor(), ref = actor && nrRef(actor);
      if (!actor || !ref) return null;
      const destination = target.zone === "life" ? null : getBoardCard(target.owner, target.zone, target.index);
      return { kind, actorId: actor.instanceId, actorRef: { ...ref },
        target: { ...target }, targetId: destination?.instanceId || null,
        turn: state.actionTurn, token: state.preBattleToken, pilot: nr.pilot };
    }
    function nrValidAction(action) {
      if (!action || state.screen !== "battle" || state.phase !== "battle" || state.gameOver || state.currentSide !== "player"
        || action.turn !== state.actionTurn || action.token !== state.preBattleToken || action.pilot !== nr.pilot
        || nrOriginal.battleNewActionBlocked() || state.pendingCardPlay || state.resolvingOrderedAttendance) return false;
      const actor = getBoardCardFromRef(action.actorRef), selected = nrSelectedActor();
      if (!actor || actor.instanceId !== action.actorId || selected?.instanceId !== action.actorId) return false;
      const target = action.target;
      if (target.zone !== "life") {
        const current = getBoardCard(target.owner, target.zone, target.index);
        if ((current?.instanceId || null) !== action.targetId) return false;
      }
      if (action.kind === "move") return target.owner === "player" && target.zone === "seat" && Boolean(nrPlanMove(actor, target.index));
      if (!canAttackSilently(actor) || target.owner !== "opponent") return false;
      return target.zone === "life" ? canSelectedAttackerTargetLife(target.owner)
        : canSelectedAttackerTargetCard(target.owner, target.zone, target.index);
    }
    function nrCloseActionConfirmation() {
      nr.pendingAction = null;
      const dialog = document.getElementById("nrActionDialog");
      if (dialog?.open) dialog.close();
    }
    function nrExecuteAction(action) {
      if (!nrValidAction(action)) {
        state.message = "盤面や行動状況が変わったため、操作を取り消しました。";
        render(); return false;
      }
      if (action.kind === "move") return nrMove(getBoardCardFromRef(action.actorRef), action.target.index);
      if (action.target.zone === "life") return attackLifeForCurrentSide(action.target.owner);
      return nrOriginal.attackCard(action.target.owner, action.target.zone, action.target.index);
    }
    function nrRequestAction(kind, target) {
      if (nr.pendingAction) return false;
      const action = nrActionSnapshot(kind, target);
      if (!nrValidAction(action)) {
        state.message = kind === "move" ? "そこへは移動・入れ替えできません。" : "その対象には攻撃できません。";
        render(); return false;
      }
      if (!nrConfirmSettings[kind]) return nrExecuteAction(action);
      const actor = getBoardCardFromRef(action.actorRef), destination = target.zone === "life" ? null : getBoardCard(target.owner, target.zone, target.index);
      const swapping = kind === "move" && destination;
      document.getElementById("nrActionTitle").textContent = kind === "attack" ? "攻撃の確認" : swapping ? "入れ替えの確認" : "移動の確認";
      document.getElementById("nrActionMessage").textContent = kind === "attack"
        ? `${actor.name}で${destination?.name || "相手本体"}を攻撃しますか？`
        : swapping ? `${actor.name}と${destination.name}を入れ替えますか？`
          : `${actor.name}を${seatRow(target.index)}行${seatCol(target.index) + 1}列へ移動しますか？`;
      document.getElementById("nrActionAccept").textContent = kind === "attack" ? "攻撃する" : swapping ? "入れ替える" : "移動する";
      nr.pendingAction = action;
      document.getElementById("nrActionDialog").showModal();
      nrRefreshUi();
      return true;
    }
    renderPlayerBoard = (owner, teacherLane, seatGrid) => {
      nrOriginal.renderPlayerBoard(owner, teacherLane, seatGrid);
      const opponent = owner === "opponent";
      seatGrid.classList.add("nr-separated-grid", opponent ? "nr-opponent-grid" : "nr-player-grid");
      elements.opponentBoardPanel.classList.add("nr-room-inset");
      // Insert one narrow, real grid track at the front/rear boundary. The
      // opponent's visual rows are reversed. Keep hit targets and multi-seat
      // overlays on the same tracks instead of translating cards separately.
      const track = visualRow => opponent ? (visualRow === 1 ? 1 : visualRow + 1) : (visualRow === 3 ? 4 : visualRow);
      [...seatGrid.querySelectorAll(":scope > .slot")].forEach((slot, position) => {
        slot.style.gridRow = String(track(Math.floor(position / 3) + 1));
        slot.style.gridColumn = String(position % 3 + 1);
      });
      seatGrid.querySelectorAll(".multi-seat-board-card").forEach(card => {
        const [start, end] = card.style.gridRow.split("/").map(Number);
        card.style.gridRow = `${track(start)} / ${track(end - 1) + 1}`;
      });
    };
    createBoardCard = (card, owner, zone, index) => {
      const button = nrOriginal.createBoardCard(card, owner, zone, index);
      button.dataset.nrStatus = nrStatus(card);
      button.title = `${card.name}：${nrStatus(card)}`;
      const actor = nrSelectedActor();
      button.classList.toggle("nr-action-source", owner === "player" && actor?.instanceId === card.instanceId);
      button.classList.toggle("nr-move-target", owner === "player" && zone === "seat" && Boolean(actor && nrPlanMove(actor, index)));
      return button;
    };
    createSlot = (zone, owner, index, label) => {
      const slot = nrOriginal.createSlot(zone, owner, index, label);
      if (zone === "seat") slot.classList.add(index >= 6 ? "nr-rear" : "nr-front");
      const actor = nrSelectedActor();
      slot.classList.toggle("nr-move-target", zone === "seat" && owner === "player" && Boolean(actor && nrPlanMove(actor, index)));
      slot.addEventListener("click", event => {
        if (event.target.closest(".board-card") || !nrSelectedActor() || owner !== "player") return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!battleNewActionBlocked()) nrRequestAction("move", { owner, zone, index });
      }, true);
      return slot;
    };
    handleBoardCardClick = (owner, zone, index = null) => {
      // Hand plays and effect target choices must retain priority over board
      // actions. In particular, choosing a friendly sacrifice is not a move.
      if (state.selectedHandId || battleChoicePending() || battleNewActionBlocked()
        || state.phase !== "battle" || state.gameOver || state.currentSide !== "player") {
        return nrOriginal.handleBoardCardClick(owner, zone, index);
      }
      const actor = nrSelectedActor(), card = getBoardCard(owner, zone, index);
      if (owner === "opponent" && actor) return nrRequestAction("attack", { owner, zone, index });
      if (owner === "player" && card) {
        if (actor?.instanceId === card.instanceId) { clearSelections(); render(); return; }
        if (actor && zone === "seat" && nrPlanMove(actor, index)) return nrRequestAction("move", { owner, zone, index });
      }
      return nrOriginal.handleBoardCardClick(owner, zone, index);
    };
    attackLife = side => {
      if (!state.selectedHandId && !battleChoicePending() && !battleNewActionBlocked() && nrSelectedActor()) {
        return nrRequestAction("attack", { owner: side, zone: "life", index: null });
      }
      return nrOriginal.attackLife(side);
    };

    function nrDeckChoices() {
      const saved = Object.entries(state.deckBuilder.savedDecks || {}).map(([name, deck]) => ({ name, counts: deck.counts }));
      const ai = (window.ChibattleAiBattleDecks || []).map(deck => ({ name: `対戦用：${deck.name}`, counts: deck.counts }));
      return [...saved, ...ai];
    }
    function nrStartMatch(firstCounts, secondCounts, options = {}) {
      nrCloseActionConfirmation();
      nr.active = true; nr.pilot = 1;
      state.training.active = false; state.training.replayRemaining = 0;
      state.dungeon.active = false;
      resetTutorialState();
      state.deckBuilder.counts.player = { ...firstCounts };
      state.deckBuilder.counts.opponent = { ...secondCounts };
      state.screen = "battle";
      nrOriginal.initializeGame({ ruleId: "normal", deferPreBattle: true });
      state.phase = "battle"; state.currentSide = "player"; state.firstSide = "player"; state.actionTurn = 1;
      state.aiThinking = false;
      SIDES.player = "プレイヤー1"; SIDES.opponent = "プレイヤー2";
      state.players.player.turnsTaken = 0;
      state.players.opponent.turnsTaken = 0;
      const will = Math.max(1, Math.min(10, Number(options.will) || 1));
      ["player", "opponent"].forEach(side => {
        state.players[side].maxWill = will - 1;
        state.players[side].will = will - 1;
        for (let i = 0; i < 5; i++) drawOne(side, false);
      });
      startTurn("player");
      render();
    }

    function nrSetupUi() {
      if (document.getElementById("nrToolbar")) return;
      const bar = document.createElement("aside");
      bar.id = "nrToolbar";
      bar.innerHTML = '<strong>新ルール TEST</strong><span id="nrPilot"></span><button id="nrSettings" type="button">テスト設定</button>';
      document.body.appendChild(bar);
      const dialog = document.createElement("dialog"); dialog.id = "nrSettingsDialog";
      dialog.innerHTML = `<form method="dialog"><header><h2>新ルール・ローカルテスト</h2><button aria-label="閉じる">×</button></header>
        <p>本番とは別の保存領域です。両側を手動操作し、ターン終了で操作側が切り替わります。</p>
        <label>プレイヤー1のデッキ<select id="nrDeck1"></select></label>
        <label>プレイヤー2のデッキ<select id="nrDeck2"></select></label>
        <label>開始時の最大戦意<select id="nrWill"><option value="1">1（通常）</option><option value="5">5</option><option value="10">10</option></select></label>
        <button type="button" id="nrStart">対戦開始</button>
        <fieldset class="nr-confirm-settings"><legend>操作確認</legend>
          <label><input id="nrConfirmAttack" type="checkbox">攻撃前に確認する</label>
          <label><input id="nrConfirmMove" type="checkbox">移動・入れ替え前に確認する</label>
        </fieldset>
        <hr><label>カード名<input id="nrCardName" list="nrAllCards" autocomplete="off"><datalist id="nrAllCards"></datalist></label>
        <button type="button" id="nrAddCard">操作側の手札へ追加</button><output id="nrAddStatus"></output>
        <details><summary>デッキファイルを読み込む</summary><input id="nrImport" type="file" accept=".json,.chibasave,application/json"><output id="nrImportStatus"></output></details>
        <details><summary>調整カード・今回の適用内容</summary><p>講義：相手の1・2行目と教卓のみ。クイーン：相手の1・2行目の出席者。病に臥すU太・融合6種の終了時効果：攻撃可能エリア限定。</p><p>声が大きい集団、アイベン、にょてい、後ろにいるクイーン、逆張りポータル、アグロキングダムの未決定部分は現行効果で使用できます。ポータルの既存の複数行カード制限も維持しています。</p></details>
        <p class="nr-note">試作版 0.29.0-test.1 ／ オンライン・CP報酬の検証対象外。対戦開始時のコイントス・マリガンは省略し、先攻はプレイヤー1です。</p>
      </form>`;
      document.body.appendChild(dialog);
      const confirmation = document.createElement("dialog");
      confirmation.id = "nrActionDialog";
      confirmation.setAttribute("aria-labelledby", "nrActionTitle");
      confirmation.setAttribute("aria-describedby", "nrActionMessage");
      confirmation.innerHTML = '<h2 id="nrActionTitle"></h2><p id="nrActionMessage"></p><div class="nr-action-buttons"><button id="nrActionCancel" type="button">キャンセル</button><button id="nrActionAccept" type="button"></button></div>';
      document.body.appendChild(confirmation);
      confirmation.querySelector("#nrActionCancel").onclick = () => { nrCloseActionConfirmation(); render(); };
      confirmation.addEventListener("cancel", event => { event.preventDefault(); nrCloseActionConfirmation(); render(); });
      confirmation.querySelector("#nrActionAccept").onclick = () => {
        const action = nr.pendingAction;
        if (!action) return;
        nrCloseActionConfirmation();
        void nrExecuteAction(action);
      };
      for (const [key, id] of [["attack", "nrConfirmAttack"], ["move", "nrConfirmMove"]]) {
        const checkbox = document.getElementById(id);
        checkbox.checked = nrConfirmSettings[key];
        checkbox.onchange = () => nrSetConfirmation(key, checkbox.checked);
      }
      const refresh = () => {
        const decks = nrDeckChoices();
        ["nrDeck1", "nrDeck2"].forEach(id => {
          const select = document.getElementById(id), previous = select.value;
          select.replaceChildren(...decks.map((deck, i) => new Option(deck.name, String(i))));
          if (previous) select.value = previous;
        });
      };
      bar.querySelector("#nrSettings").onclick = () => { refresh(); dialog.showModal(); };
      dialog.querySelector("#nrStart").onclick = () => {
        const decks = nrDeckChoices();
        const a = decks[document.getElementById("nrDeck1").value], b = decks[document.getElementById("nrDeck2").value];
        if (!a || !b) return;
        dialog.close(); nrStartMatch(a.counts, b.counts, { will: document.getElementById("nrWill").value });
      };
      dialog.querySelector("#nrAllCards").replaceChildren(...Object.values(CARD_BASES).map(base => new Option(base.name, base.name)));
      dialog.querySelector("#nrAddCard").onclick = () => {
        const entry = Object.entries(CARD_BASES).find(([id, base]) => base.name === document.getElementById("nrCardName").value || id === document.getElementById("nrCardName").value);
        const output = document.getElementById("nrAddStatus");
        if (!nr.active || !entry || battleNewActionBlocked()) { output.textContent = "対戦開始後、処理が終わってからカードを選んでください。"; return; }
        state.players.player.hand.push(createCardFromBase(entry[0], "player"));
        output.textContent = `${entry[1].name}を追加しました。`; render();
      };
      dialog.querySelector("#nrImport").onchange = async event => {
        const output = document.getElementById("nrImportStatus");
        try {
          const data = JSON.parse(await event.target.files[0].text());
          const decks = data.decks || data.savedDecks || data.deckBuilder?.savedDecks;
          const candidates = decks && typeof decks === "object" ? Object.entries(decks) : [[data.name || event.target.files[0].name.replace(/\.[^.]+$/, ""), data]];
          let count = 0;
          for (const [name, deck] of candidates) {
            const raw = deck.counts || deck.cards || deck.deck || deck;
            let counts = {};
            if (Array.isArray(raw)) raw.forEach(entry => { const id = typeof entry === "string" ? entry : entry.baseId || entry.id; if (CARD_BASES[id]) counts[id] = (counts[id] || 0) + (Number(entry.count) || 1); });
            else if (raw && typeof raw === "object") Object.entries(raw).forEach(([id, n]) => { if (CARD_BASES[id] && Number(n) > 0) counts[id] = Math.min(100, Math.floor(Number(n))); });
            if (Object.keys(counts).length) { state.deckBuilder.savedDecks[name] = { counts }; count++; }
          }
          if (!count) throw new Error("カードIDと枚数を読み取れませんでした");
          refresh(); output.textContent = `${count}デッキをテスト用に読み込みました（このページ内のみ）。`;
        } catch (error) { output.textContent = `読み込み失敗：${error.message}`; }
      };
      refresh(); nrRefreshUi(); dialog.showModal();
      // Presentation completion does not always render the underlying game.
      // Keep pending confirmation validity in sync without rebuilding the
      // board mid-effect.
      window.setInterval(nrRefreshUi, 200);
    }
    function nrRefreshUi() {
      const bar = document.getElementById("nrToolbar");
      if (!bar) return;
      bar.querySelector("#nrPilot").textContent = nr.active ? `操作：プレイヤー${nr.pilot}` : "本番とは別環境";
      if (nr.pendingAction && !nrValidAction(nr.pendingAction)) nrCloseActionConfirmation();
    }
    render = () => { nrObserve(); nrOriginal.render(); nrRefreshUi(); };
    window.__newRules = { version: "0.29.0-test.1", nr, inAttackArea: nrInAttackArea, canHitLife: nrCanHitLife,
      planMove: nrPlanMove, move: nrMove, relocate: nrRelocate, portal: nrPortal, observe: nrObserve,
      markAttendance: nrMarkAttendance, startMatch: nrStartMatch, flipPerspective: nrFlipPerspective,
      ref: nrRef, lectureTargets: lectureTargetEntries, positionAllowed: nrPositionAllowed,
      effectTargets: effectTargetEntries, birdTargets: happyBlueBirdAttackTargets, cardText: cardRulesText,
      isBusy: battleNewActionBlocked, actAvailable: nrActionAvailable, startTurn: side => startTurn(side),
      lecture: (side, ref) => performTeacherLecture(side, ref), checkMoved: nrCheckMoved,
      inheritEvolution: nrInheritEvolution, canAttack: card => canAttackSilently(card),
      aggroEndTurn: side => resolveAggroStudentEffects(side),
      castItem: (side, item, owner, zone, index) => castItemOnCard(side, item, owner, zone, index, false),
      attackLife: side => attackLifeForCurrentSide(side), canTargetCard: canSelectedAttackerTargetCard };
    document.addEventListener("DOMContentLoaded", nrSetupUi, { once: true });
