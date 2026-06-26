export const SAVE_VERSION = 3 as const;

export type Language = 'eu' | 'de' | 'es' | 'en';

export type NeedKey = 'hunger' | 'affection' | 'cleanliness' | 'exercise';

export type AgeStage = 'foal' | 'adult' | 'elder';

export type HorseColor = 'chestnut' | 'bay' | 'palomino' | 'gray' | 'black' | 'paint';

export type AlertState =
  | 'none'
  | 'need'
  | 'critical'
  | 'sleepy'
  | 'retire'
  | 'growFeed'
  | 'suggestPet'
  | 'suggestLesson';

export type FocusKind = AlertState;

export type ActionId =
  | 'oats'
  | 'carrots'
  | 'pet'
  | 'bathe'
  | 'walk'
  | 'lesson'
  | 'sleep'
  | 'findHome'
  | 'retire'
  | 'expandStable';

export interface Needs {
  hunger: number;
  affection: number;
  cleanliness: number;
  exercise: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Horse {
  id: string;
  name: string;
  ageStage: AgeStage;
  color: HorseColor;
  value: number;
  needs: Needs;
  alertState: AlertState;
  position: Point;
  growthMs: number;
  lifeMs: number;
  lessonsToday: number;
  /** @deprecated legacy save field */
  foalProgress?: number;
  /** @deprecated legacy save field */
  originalPair?: boolean;
  isSleeping: boolean;
  lessonRemainingMs?: number;
  wanderTarget?: Point;
}

export interface GameFocus {
  horseId: string;
  kind: FocusKind;
  needKey?: NeedKey;
}

export interface GameState {
  version: typeof SAVE_VERSION;
  coins: number;
  day: number;
  timeOfDay: number;
  language: Language;
  stableCapacity: number;
  expansions: number;
  horses: Horse[];
  breedingProgress: number;
  focus?: GameFocus;
  focusCooldownMs: number;
  idleMs: number;
  /** @deprecated legacy save field */
  firstBirthDone?: boolean;
  lastSavedAt: number;
}

export interface ActionDefinition {
  id: ActionId;
  labelKey: string;
  benefitKey: string;
  iconKey: string;
  getCost: (state: GameState, horse?: Horse) => number;
  getReward?: (state: GameState, horse?: Horse) => number;
  canUse: (state: GameState, horse?: Horse) => string | null;
  apply: (state: GameState, horse?: Horse) => ActionOutcome;
}

export interface ActionOutcome {
  messageKey?: string;
  messageVars?: Record<string, string | number>;
  selectedHorseId?: string;
}
