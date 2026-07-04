export type ChibattleSide = "player" | "opponent";
export type ChibattleZone = "deck" | "hand" | "seat" | "teacher" | "environment" | "life" | "late" | "trash" | "board" | "unknown";

export interface AnalyticsSeat {
  index: number;
  row: number;
  column: number;
}

export interface AnalyticsCard {
  instanceId: string | null;
  cardId: string | null;
  cardName: string;
  type: string;
  cost: number | null;
  attack: number | null;
  hp: number | null;
  maxHp: number | null;
  owner: ChibattleSide | null;
}

export interface AnalyticsBoardCard extends AnalyticsCard {
  zone: ChibattleZone | null;
  seat: AnalyticsSeat | null;
  hasAttacked: boolean;
  playedOnTurn: number | null;
  keywords: string[];
}

export interface AnalyticsBoardSnapshot {
  player: {
    teacher: AnalyticsBoardCard | null;
    seats: Array<AnalyticsBoardCard | null>;
  };
  opponent: {
    teacher: AnalyticsBoardCard | null;
    seats: Array<AnalyticsBoardCard | null>;
  };
  environment: null | {
    owner: ChibattleSide | null;
    card: AnalyticsCard | null;
  };
}

export interface AnalyticsGameStart {
  gameId: string;
  version: string;
  schemaVersion: string;
  mode: "solo" | "online" | "tutorial" | "test";
  onlineRole: "host" | "guest" | "spectator" | null;
  startedAt: string;
  firstSide: ChibattleSide | null;
  decks: Record<ChibattleSide, {
    deckName: string;
    deckList: Record<string, number>;
    deckSize: number;
  }>;
}

export interface AnalyticsPlacementCandidate {
  owner: ChibattleSide | null;
  zone: ChibattleZone;
  seat: AnalyticsSeat | null;
  sameSlotLocked: boolean;
  aggroLocked: boolean;
  occupied: boolean;
  legal: boolean;
}

export interface AnalyticsActionEvent {
  schemaVersion: string;
  gameId: string | null;
  eventSeq: number;
  eventType: "action";
  recordedAt: string;
  actionTurn: number;
  phase: string;
  actionId: string;
  turn: string;
  side: ChibattleSide;
  actionType: string;
  cardId: string | null;
  cardName: string;
  cost: number | null;
  sourceZone: ChibattleZone | null;
  targetZone: ChibattleZone | string | null;
  targetSeat: AnalyticsSeat | null;
  targetCardId: string | null;
  legalCandidateCount: number | null;
  legalCandidates: unknown[];
  details: Record<string, unknown>;
}

export interface AnalyticsEffectEvent {
  schemaVersion: string;
  gameId: string | null;
  eventSeq: number;
  eventType: "effect";
  recordedAt: string;
  actionTurn: number;
  phase: string;
  turn: string;
  side: ChibattleSide | null;
  source: AnalyticsCard | null;
  effectType: string;
  randomCandidates: unknown[];
  chosenTargets: unknown[];
  damageDistribution: unknown;
  drawCount: number | null;
  trashedCards: AnalyticsCard[];
  environmentBefore: AnalyticsCard | null;
  environmentAfter: AnalyticsCard | null;
  details: Record<string, unknown>;
}

export interface AnalyticsCardStat {
  side: ChibattleSide;
  cardId: string;
  cardName: string;
  type: string;
  deckCopies: number;
  playCount: number;
  playWin: number;
  residenceTurns: number;
  damageDealt: number;
  removalContribution: number;
}

export interface AnalyticsFinal {
  winner: ChibattleSide | null;
  loser: ChibattleSide | null;
  reason: string;
  finishedAt: string;
  finalTurn: number;
  lethalCard: AnalyticsCard | null;
  finalBoard: AnalyticsBoardSnapshot;
  cardStats: AnalyticsCardStat[];
}

export type ChibattleAnalyticsEvent =
  | { eventType: "game_start"; game: AnalyticsGameStart }
  | { eventType: "order_choice"; firstSide: ChibattleSide; side: ChibattleSide }
  | { eventType: "battle_start"; firstSide: ChibattleSide; boardSnapshot: AnalyticsBoardSnapshot }
  | { eventType: "turn_start"; side: ChibattleSide; boardSnapshot: AnalyticsBoardSnapshot }
  | { eventType: "mulligan"; side: ChibattleSide; initialHand: AnalyticsCard[]; returnedCards: AnalyticsCard[]; redrawnCards: AnalyticsCard[] }
  | AnalyticsActionEvent
  | AnalyticsEffectEvent
  | { eventType: "game_end"; final: AnalyticsFinal };
