import Phaser from 'phaser';
import {
  SAVE_VERSION,
  type AlertState,
  type FocusKind,
  type GameFocus,
  type GameState,
  type Horse,
  type HorseColor,
  type Language,
  type NeedKey,
  type Needs,
} from './types';

export const SAVE_KEY = 'horse-stable:v3';
export const DAYLIGHT_MS = 468_000;
export const NIGHT_MS = 4_320;
export const CYCLE_MS = DAYLIGHT_MS + NIGHT_MS;
export const LESSON_DURATION_MS = 25_000;
export const LESSON_RING = { x: 200, y: 480 };
export const WORLD_SIZE = { width: 1600, height: 1000 };
export const LAND_PAD_X = 360;
export const LAND_PAD_BOTTOM = 320;
export const NEED_KEY_COUNT = 4;
export const PADDOCK = { x: 170, y: 350, width: 980, height: 520 };
export const LESSON_QUEUE = { x: 52, y: 620, count: 4 };

export const GROWTH_MS = 120_000;
export const ADULT_LIFE_MS = 600_000;
export const BREED_MS = 45_000;
export const LESSONS_PER_ADULT_PER_DAY = 3;
export const WELL_FED = 45;
export const MIN_ADULTS = 2;
export const FOCUS_COOLDOWN_MS = 3_000;
export const IDLE_SUGGEST_MS = 14_000;

const HUNGER_DECAY = 32;
const FED_FOR_SLEEP = 55;
const ALERT_THRESHOLD = 34;
const CRITICAL_THRESHOLD = 20;
const BREED_CARE_MIN = 50;

const horseNames = ['Izar', 'Luna', 'Mendi', 'Kora', 'Nube', 'Lore', 'Sol', 'Haize', 'Mila', 'Argi'];
const colors: HorseColor[] = ['chestnut', 'bay', 'palomino', 'gray', 'black', 'paint'];

export function getDayProgress(state: GameState): number {
  return state.timeOfDay / CYCLE_MS;
}

export function isNight(state: GameState): boolean {
  return state.timeOfDay >= DAYLIGHT_MS;
}

export function getTimeLabel(state: GameState): 'morning' | 'night' {
  return isNight(state) ? 'night' : 'morning';
}

export function getDaylightRemainingMs(state: GameState): number {
  return isNight(state) ? 0 : DAYLIGHT_MS - state.timeOfDay;
}

export function getNightRemainingMs(state: GameState): number {
  return isNight(state) ? CYCLE_MS - state.timeOfDay : 0;
}

export function getTimeUntilDawnMs(state: GameState): number {
  return isNight(state) ? CYCLE_MS - state.timeOfDay : 0;
}

export function getShortestLessonRemainingMs(state: GameState): number {
  let shortest = 0;
  for (const horse of state.horses) {
    const remaining = horse.lessonRemainingMs ?? 0;
    if (remaining > 0 && (shortest === 0 || remaining < shortest)) {
      shortest = remaining;
    }
  }
  return shortest;
}

export function formatClockMs(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getHorseCareAverage(horse: Horse): number {
  const { hunger, affection, cleanliness, exercise } = horse.needs;
  return (hunger + affection + cleanliness + exercise) / 4;
}

export function calculateLessonPayout(horse: Horse): number {
  const care = getHorseCareAverage(horse);
  const min = 5;
  const max = 20;
  return Math.round(min + (max - min) * (care / 100));
}

export function completeLesson(state: GameState, horse: Horse, messages: string[]): void {
  const careBefore = getHorseCareAverage(horse);
  const coins = calculateLessonPayout(horse);
  state.coins += coins;
  horse.lessonRemainingMs = 0;
  reduceNeed(horse.needs, 'hunger', 22);
  reduceNeed(horse.needs, 'exercise', 25);
  reduceNeed(horse.needs, 'cleanliness', 20);
  if (careBefore >= 65) {
    healNeed(horse.needs, 'affection', 3);
    increaseValue(horse, 2);
  } else {
    reduceNeed(horse.needs, 'affection', 2);
    increaseValue(horse, 1);
  }
  horse.wanderTarget = choosePaddockPoint();
  messages.push(`lessonComplete:${horse.name}:${coins}:${horse.id}`);
}

export function getAdults(state: GameState): Horse[] {
  return state.horses.filter((horse) => horse.ageStage === 'adult');
}

export function getBreedingAdults(state: GameState): Horse[] {
  return getAdults(state);
}

export function getAdultCount(state: GameState): number {
  return getAdults(state).length;
}

export function canRemoveHorse(state: GameState, horse: Horse): boolean {
  if (horse.ageStage === 'adult') {
    return getAdultCount(state) > MIN_ADULTS;
  }
  return state.horses.length > MIN_ADULTS;
}

export function getLessonsLeft(horse: Horse): number {
  if (horse.ageStage !== 'adult') return 0;
  return Math.max(0, LESSONS_PER_ADULT_PER_DAY - horse.lessonsToday);
}

export function getGrowthProgress(horse: Horse): number {
  if (horse.ageStage !== 'foal') return 100;
  return clamp((horse.growthMs / GROWTH_MS) * 100, 0, 100);
}

export function getLifeProgress(horse: Horse): number {
  if (horse.ageStage !== 'adult') return horse.ageStage === 'elder' ? 100 : 0;
  return clamp((horse.lifeMs / ADULT_LIFE_MS) * 100, 0, 100);
}

function getDailyCoins(state: GameState): number {
  return 8 + state.horses.length;
}

export function createInitialState(language: Language = 'es'): GameState {
  const horses: Horse[] = [
    makeHorse('Izar', 'adult', 'chestnut', { x: 520, y: 560 }, 68),
    makeHorse('Mendi', 'adult', 'palomino', { x: 700, y: 650 }, 72),
  ];
  for (const horse of horses) {
    horse.needs.hunger = 52;
  }

  return finalizeState({
    version: SAVE_VERSION,
    coins: 120,
    day: 1,
    timeOfDay: 0,
    language,
    stableCapacity: 8,
    expansions: 0,
    horses,
    breedingProgress: 0,
    focusCooldownMs: 0,
    idleMs: 0,
    lastSavedAt: Date.now(),
  });
}

export function loadGameState(): GameState {
  const raw =
    localStorage.getItem(SAVE_KEY) ??
    localStorage.getItem('horse-stable:v2') ??
    localStorage.getItem('horse-stable:v1');
  if (!raw) {
    return createInitialState();
  }

  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      coins?: number;
      day?: number;
      timeOfDay?: number;
      language?: Language;
      stableCapacity?: number;
      expansions?: number;
      horses?: Partial<Horse>[];
      breedingProgress?: number;
      focus?: GameFocus;
      focusCooldownMs?: number;
      idleMs?: number;
      firstBirthDone?: boolean;
      lastSavedAt?: number;
    };
    if (!parsed.version || !Array.isArray(parsed.horses)) {
      return createInitialState();
    }

    let timeOfDay = finiteNumber(parsed.timeOfDay, 0);
    if (parsed.version === 1) {
      const oldDayMs = 90_000;
      const oldNightStart = 0.52;
      const progress = timeOfDay / oldDayMs;
      timeOfDay =
        progress >= oldNightStart
          ? DAYLIGHT_MS + ((progress - oldNightStart) / (1 - oldNightStart)) * NIGHT_MS
          : (progress / oldNightStart) * DAYLIGHT_MS;
    }

    return finalizeState({
      version: SAVE_VERSION,
      coins: finiteNumber(parsed.coins, 120),
      day: Math.max(1, Math.floor(finiteNumber(parsed.day, 1))),
      timeOfDay: clamp(timeOfDay, 0, CYCLE_MS - 1),
      language: isLanguage(parsed.language) ? parsed.language : 'es',
      stableCapacity: Math.max(8, Math.floor(finiteNumber(parsed.stableCapacity, 8))),
      expansions: Math.max(0, Math.floor(finiteNumber(parsed.expansions, 0))),
      horses: parsed.horses.map(normalizeHorse).slice(0, 40),
      breedingProgress: clamp(finiteNumber(parsed.breedingProgress, 0), 0, BREED_MS),
      focus: parsed.focus,
      focusCooldownMs: Math.max(0, finiteNumber(parsed.focusCooldownMs, 0)),
      idleMs: Math.max(0, finiteNumber(parsed.idleMs, 0)),
      lastSavedAt: finiteNumber(parsed.lastSavedAt, Date.now()),
    });
  } catch {
    return createInitialState();
  }
}

export function saveGameState(state: GameState): void {
  state.lastSavedAt = Date.now();
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function tickGameState(state: GameState, deltaMs: number): string[] {
  const messages: string[] = [];
  const dayPortion = deltaMs / CYCLE_MS;

  for (const horse of state.horses) {
    const lessonRemaining = horse.lessonRemainingMs ?? 0;
    if (lessonRemaining > 0) {
      horse.lessonRemainingMs = Math.max(0, lessonRemaining - deltaMs);
      if (horse.lessonRemainingMs === 0) {
        completeLesson(state, horse, messages);
      }
    }
  }

  for (const horse of state.horses) {
    if (horse.isSleeping) continue;
    horse.needs.hunger = clamp(horse.needs.hunger - HUNGER_DECAY * dayPortion, 0, 100);
    horse.needs.affection = clamp(horse.needs.affection - 8 * dayPortion, 0, 100);
    horse.needs.cleanliness = clamp(horse.needs.cleanliness - 14 * dayPortion, 0, 100);
    horse.needs.exercise = clamp(horse.needs.exercise - 11 * dayPortion, 0, 100);
  }

  for (const horse of state.horses) {
    if (horse.ageStage === 'foal' && horse.needs.hunger >= WELL_FED) {
      horse.growthMs += deltaMs;
      if (horse.growthMs >= GROWTH_MS) {
        horse.ageStage = 'adult';
        horse.growthMs = GROWTH_MS;
        horse.lifeMs = 0;
        increaseValue(horse, 8);
        messages.push(`grewUp:${horse.name}:${horse.id}`);
      }
    } else if (horse.ageStage === 'adult') {
      horse.lifeMs += deltaMs;
      if (horse.lifeMs >= ADULT_LIFE_MS) {
        horse.ageStage = 'elder';
        horse.lifeMs = ADULT_LIFE_MS;
        messages.push(`grewOld:${horse.name}:${horse.id}`);
      }
    }
  }

  tickBreeding(state, deltaMs, messages);

  state.timeOfDay += deltaMs;
  while (state.timeOfDay >= CYCLE_MS) {
    state.timeOfDay -= CYCLE_MS;
    state.day += 1;
    const dailyCoins = getDailyCoins(state);
    state.coins += dailyCoins;
    messages.push(`dailyCoins:${dailyCoins}`);
    for (const horse of state.horses) {
      horse.isSleeping = false;
      horse.lessonsToday = 0;
    }
  }

  refreshAlerts(state);
  updateFocus(state, deltaMs, messages);
  return messages;
}

function tickBreeding(state: GameState, deltaMs: number, messages: string[]): void {
  if (getStableFull(state)) return;
  const adults = getBreedingAdults(state);
  if (adults.length < 2) return;

  const averageCare =
    adults.reduce((sum, horse) => sum + getHorseCareAverage(horse), 0) / adults.length;
  if (averageCare < BREED_CARE_MIN) return;

  const careFactor = clamp((averageCare - BREED_CARE_MIN) / (100 - BREED_CARE_MIN), 0.35, 1);
  state.breedingProgress += deltaMs * careFactor;
  if (state.breedingProgress < BREED_MS) return;

  state.breedingProgress = 0;
  if (getStableFull(state)) {
    messages.push('stableFull');
    return;
  }

  const foal = makeFoal(state);
  state.horses.push(foal);
  messages.push(`newFoal:${foal.name}`);
  messages.push(`birthCelebration:${foal.name}:${foal.id}`);
}

export function getStableFull(state: GameState): boolean {
  return state.horses.length >= state.stableCapacity;
}

export function getExpansionCost(state: GameState): number {
  return 120 + state.expansions * 70;
}

export function healNeed(needs: Needs, key: keyof Needs, amount: number): void {
  needs[key] = clamp(needs[key] + amount, 0, 100);
}

export function reduceNeed(needs: Needs, key: keyof Needs, amount: number): void {
  needs[key] = clamp(needs[key] - amount, 0, 100);
}

export function increaseValue(horse: Horse, amount: number): void {
  horse.value = Math.max(10, Math.round(horse.value + amount));
}

function getLowestNeed(horse: Horse): NeedKey {
  const entries = needKeys.map((key) => [key, horse.needs[key]] as const);
  entries.sort((a, b) => a[1] - b[1]);
  return entries[0][0];
}

function getNeedValue(horse: Horse, key: NeedKey): number {
  return horse.needs[key];
}

const needKeys: NeedKey[] = ['hunger', 'affection', 'cleanliness', 'exercise'];

interface FocusCandidate {
  horse: Horse;
  kind: FocusKind;
  priority: number;
  needKey?: NeedKey;
}

function buildFocusCandidates(state: GameState): FocusCandidate[] {
  const candidates: FocusCandidate[] = [];

  for (const horse of state.horses) {
    if (horse.isSleeping) continue;

    if (Object.values(horse.needs).some((value) => value < CRITICAL_THRESHOLD)) {
      candidates.push({
        horse,
        kind: 'critical',
        priority: 100,
        needKey: getLowestNeed(horse),
      });
      continue;
    }

    if (horse.ageStage === 'elder') {
      candidates.push({ horse, kind: 'retire', priority: 80 });
      continue;
    }

    if (horse.ageStage === 'foal' && horse.needs.hunger < WELL_FED) {
      candidates.push({ horse, kind: 'growFeed', priority: 70, needKey: 'hunger' });
      continue;
    }

    if (Object.values(horse.needs).some((value) => value < ALERT_THRESHOLD)) {
      candidates.push({
        horse,
        kind: 'need',
        priority: 60,
        needKey: getLowestNeed(horse),
      });
      continue;
    }

    if (isNight(state) && horse.needs.hunger >= FED_FOR_SLEEP) {
      candidates.push({ horse, kind: 'sleepy', priority: 30 });
    }
  }

  return candidates;
}

function pickBestCandidate(candidates: FocusCandidate[]): FocusCandidate | undefined {
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const aNeed = a.needKey ? getNeedValue(a.horse, a.needKey) : 100;
    const bNeed = b.needKey ? getNeedValue(b.horse, b.needKey) : 100;
    return aNeed - bNeed;
  })[0];
}

function pickIdleSuggestion(state: GameState): GameFocus | undefined {
  const awake = state.horses.filter((horse) => !horse.isSleeping);
  if (awake.length === 0) return undefined;

  const lessonHorse = awake.find(
    (horse) =>
      horse.ageStage === 'adult' &&
      getLessonsLeft(horse) > 0 &&
      (horse.lessonRemainingMs ?? 0) === 0 &&
      !isNight(state),
  );
  if (lessonHorse) {
    return { horseId: lessonHorse.id, kind: 'suggestLesson' };
  }

  const petHorse = awake.sort((a, b) => getHorseCareAverage(a) - getHorseCareAverage(b))[0];
  return { horseId: petHorse.id, kind: 'suggestPet' };
}

function focusStillValid(state: GameState, focus: GameFocus): boolean {
  const horse = state.horses.find((candidate) => candidate.id === focus.horseId);
  if (!horse || horse.isSleeping) return false;

  switch (focus.kind) {
    case 'critical':
      return Object.values(horse.needs).some((value) => value < CRITICAL_THRESHOLD);
    case 'retire':
      return horse.ageStage === 'elder';
    case 'growFeed':
      return horse.ageStage === 'foal' && horse.needs.hunger < WELL_FED;
    case 'need':
      return Object.values(horse.needs).some((value) => value < ALERT_THRESHOLD);
    case 'sleepy':
      return isNight(state) && horse.needs.hunger >= FED_FOR_SLEEP;
    case 'suggestLesson':
      return (
        horse.ageStage === 'adult' &&
        getLessonsLeft(horse) > 0 &&
        (horse.lessonRemainingMs ?? 0) === 0 &&
        !isNight(state)
      );
    case 'suggestPet':
      return true;
    default:
      return false;
  }
}

export function updateFocus(state: GameState, deltaMs: number, messages: string[]): void {
  if (state.focusCooldownMs > 0) {
    state.focusCooldownMs = Math.max(0, state.focusCooldownMs - deltaMs);
    state.idleMs = 0;
    if (state.focusCooldownMs === 0) {
      state.focus = undefined;
    }
    return;
  }

  const pressing = buildFocusCandidates(state);
  if (pressing.length > 0) {
    state.idleMs = 0;
    if (state.focus && focusStillValid(state, state.focus)) {
      return;
    }
    if (state.focus && !focusStillValid(state, state.focus)) {
      messages.push('focusDone');
      state.focusCooldownMs = FOCUS_COOLDOWN_MS;
      state.focus = undefined;
      return;
    }
    const best = pickBestCandidate(pressing);
    if (best) {
      state.focus = { horseId: best.horse.id, kind: best.kind, needKey: best.needKey };
    }
    return;
  }

  if (state.focus && !focusStillValid(state, state.focus)) {
    if (state.focus.kind !== 'suggestPet' && state.focus.kind !== 'suggestLesson') {
      messages.push('focusDone');
      state.focusCooldownMs = FOCUS_COOLDOWN_MS;
    }
    state.focus = undefined;
    state.idleMs = 0;
    return;
  }

  if (state.focus?.kind === 'suggestPet' || state.focus?.kind === 'suggestLesson') {
    if (!focusStillValid(state, state.focus)) {
      state.focus = undefined;
      state.idleMs = 0;
    }
    return;
  }

  state.idleMs += deltaMs;
  if (state.idleMs >= IDLE_SUGGEST_MS) {
    state.focus = pickIdleSuggestion(state);
    if (state.focus) {
      state.idleMs = 0;
    }
  }
}

export function getFocusMessageKey(state: GameState): string | null {
  if (state.focusCooldownMs > 0) return 'focusDone';
  if (!state.focus) return null;

  const horse = state.horses.find((candidate) => candidate.id === state.focus?.horseId);
  if (!horse) return null;

  switch (state.focus.kind) {
    case 'critical':
    case 'need':
      return state.focus.needKey === 'hunger'
        ? 'focusFeed'
        : state.focus.needKey === 'affection'
          ? 'focusPet'
          : state.focus.needKey === 'cleanliness'
            ? 'focusBathe'
            : 'focusWalk';
    case 'retire':
      return 'focusRetire';
    case 'growFeed':
      return 'focusGrowFeed';
    case 'suggestPet':
      return 'focusIdlePet';
    case 'suggestLesson':
      return 'focusIdleLesson';
    case 'sleepy':
      return 'focusSleep';
    default:
      return null;
  }
}

export function refreshAlerts(state: GameState): GameState {
  for (const horse of state.horses) {
    let alertState: AlertState = 'none';
    if (horse.isSleeping) {
      alertState = 'none';
    } else if (Object.values(horse.needs).some((value) => value < CRITICAL_THRESHOLD)) {
      alertState = 'critical';
    } else if (horse.ageStage === 'elder') {
      alertState = 'retire';
    } else if (horse.ageStage === 'foal' && horse.needs.hunger < WELL_FED) {
      alertState = 'growFeed';
    } else if (Object.values(horse.needs).some((value) => value < ALERT_THRESHOLD)) {
      alertState = 'need';
    } else if (isNight(state) && horse.needs.hunger >= FED_FOR_SLEEP) {
      alertState = 'sleepy';
    }
    horse.alertState = alertState;
  }

  return state;
}

export function shouldShowAlertBubble(state: GameState, horse: Horse): boolean {
  if (!state.focus || state.focusCooldownMs > 0) return false;
  return state.focus.horseId === horse.id;
}

export function choosePaddockPoint(): { x: number; y: number } {
  return {
    x: Phaser.Math.Between(PADDOCK.x + 70, PADDOCK.x + PADDOCK.width - 70),
    y: Phaser.Math.Between(PADDOCK.y + 70, PADDOCK.y + PADDOCK.height - 70),
  };
}

function makeHorse(
  name: string,
  ageStage: Horse['ageStage'],
  color: HorseColor,
  position: Horse['position'],
  value: number,
): Horse {
  return {
    id: createId(),
    name,
    ageStage,
    color,
    value,
    needs: {
      hunger: 82,
      affection: 68,
      cleanliness: 76,
      exercise: 62,
    },
    alertState: 'none',
    position,
    growthMs: 0,
    lifeMs: ageStage === 'adult' ? Phaser.Math.Between(0, ADULT_LIFE_MS * 0.2) : 0,
    lessonsToday: 0,
    isSleeping: false,
    lessonRemainingMs: 0,
    wanderTarget: choosePaddockPoint(),
  };
}

function makeFoal(state: GameState): Horse {
  const used = new Set(state.horses.map((horse) => horse.name));
  const name =
    horseNames.find((candidate) => !used.has(candidate)) ??
    horseNames[Phaser.Math.Between(0, horseNames.length - 1)];
  return makeHorse(
    name,
    'foal',
    colors[Phaser.Math.Between(0, colors.length - 1)],
    choosePaddockPoint(),
    32,
  );
}

function normalizeHorse(value: Partial<Horse>): Horse {
  const fallback = makeHorse('Izar', 'adult', 'chestnut', choosePaddockPoint(), 50);
  const lessonRemainingMs = Math.max(0, finiteNumber(value.lessonRemainingMs, 0));
  let ageStage: Horse['ageStage'] = 'adult';
  if (value.ageStage === 'foal' || value.ageStage === 'adult' || value.ageStage === 'elder') {
    ageStage = value.ageStage;
  }

  return {
    id: typeof value.id === 'string' ? value.id : fallback.id,
    name: typeof value.name === 'string' ? value.name : fallback.name,
    ageStage,
    color: isHorseColor(value.color) ? value.color : fallback.color,
    value: Math.max(10, Math.round(finiteNumber(value.value, fallback.value))),
    needs: {
      hunger: clamp(finiteNumber(value.needs?.hunger, fallback.needs.hunger), 0, 100),
      affection: clamp(finiteNumber(value.needs?.affection, fallback.needs.affection), 0, 100),
      cleanliness: clamp(finiteNumber(value.needs?.cleanliness, fallback.needs.cleanliness), 0, 100),
      exercise: clamp(finiteNumber(value.needs?.exercise, fallback.needs.exercise), 0, 100),
    },
    alertState: 'none',
    position: {
      x: clamp(
        finiteNumber(value.position?.x, fallback.position.x),
        PADDOCK.x + 30,
        PADDOCK.x + PADDOCK.width - 30,
      ),
      y: clamp(
        finiteNumber(value.position?.y, fallback.position.y),
        PADDOCK.y + 30,
        PADDOCK.y + PADDOCK.height - 30,
      ),
    },
    growthMs: clamp(finiteNumber(value.growthMs, ageStage === 'foal' ? 0 : GROWTH_MS), 0, GROWTH_MS),
    lifeMs: clamp(
      finiteNumber(value.lifeMs, ageStage === 'adult' ? Phaser.Math.Between(0, ADULT_LIFE_MS * 0.3) : 0),
      0,
      ADULT_LIFE_MS,
    ),
    lessonsToday: Math.max(0, Math.floor(finiteNumber(value.lessonsToday, 0))),
    isSleeping: value.isSleeping === true,
    lessonRemainingMs,
    wanderTarget: value.wanderTarget
      ? {
          x: clamp(
            finiteNumber(value.wanderTarget.x, fallback.wanderTarget?.x ?? fallback.position.x),
            PADDOCK.x + 30,
            PADDOCK.x + PADDOCK.width - 30,
          ),
          y: clamp(
            finiteNumber(value.wanderTarget.y, fallback.wanderTarget?.y ?? fallback.position.y),
            PADDOCK.y + 30,
            PADDOCK.y + PADDOCK.height - 30,
          ),
        }
      : choosePaddockPoint(),
  };
}

function finalizeState(state: GameState): GameState {
  refreshAlerts(state);
  updateFocus(state, 0, []);
  return state;
}

function isHorseColor(value: unknown): value is HorseColor {
  return typeof value === 'string' && colors.includes(value as HorseColor);
}

function isLanguage(value: unknown): value is Language {
  return value === 'eu' || value === 'de' || value === 'es' || value === 'en';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `horse-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getWorldBounds(): { width: number; height: number } {
  return { width: WORLD_SIZE.width, height: WORLD_SIZE.height };
}

/** Zoom to fill the world viewport (cover), avoiding letterbox bars on tall/narrow panels. */
export function getWorldFitZoom(viewportW: number, viewportH: number): number {
  const bounds = getWorldBounds();
  const cover = Math.max(viewportW / bounds.width, viewportH / bounds.height);
  return Math.min(cover, 1);
}

export interface SidebarLayout {
  actionBtnH: number;
  needRowH: number;
  actionColumns: 1 | 2;
  actionGap: number;
  fontScale: number;
  focusBannerH: number;
  headerBtnH: number;
}

const SIDEBAR_LAYOUT_TIERS: SidebarLayout[] = [
  { actionBtnH: 48, needRowH: 28, actionColumns: 1, actionGap: 6, fontScale: 1, focusBannerH: 52, headerBtnH: 32 },
  { actionBtnH: 40, needRowH: 22, actionColumns: 1, actionGap: 5, fontScale: 0.9, focusBannerH: 46, headerBtnH: 32 },
  { actionBtnH: 40, needRowH: 22, actionColumns: 2, actionGap: 5, fontScale: 0.85, focusBannerH: 44, headerBtnH: 30 },
  { actionBtnH: 40, needRowH: 22, actionColumns: 2, actionGap: 4, fontScale: 0.85, focusBannerH: 40, headerBtnH: 30 },
];

function estimateSidebarHeight(layout: SidebarLayout, actionCount: number, hasHorse: boolean): number {
  const toggles = layout.headerBtnH + 12;
  let total = 10 + layout.focusBannerH + 10 + 50 + 10 + 58 + toggles;

  if (hasHorse) {
    const cardTop = 78;
    const needs = NEED_KEY_COUNT * layout.needRowH;
    const context = 24;
    const actionRows = layout.actionColumns === 1 ? actionCount : Math.ceil(actionCount / 2);
    const actions = actionRows * (layout.actionBtnH + layout.actionGap);
    total += cardTop + needs + context + 12 + actions + 20;
  } else {
    total += 160;
  }

  return total + 40;
}

export function getSidebarLayout(
  screenH: number,
  actionCount: number,
  hasHorse: boolean,
  safeTop = 0,
  safeBottom = 0,
): SidebarLayout {
  const available = screenH - safeTop - safeBottom;
  for (const tier of SIDEBAR_LAYOUT_TIERS) {
    if (estimateSidebarHeight(tier, actionCount, hasHorse) <= available) {
      return tier;
    }
  }
  return SIDEBAR_LAYOUT_TIERS[SIDEBAR_LAYOUT_TIERS.length - 1]!;
}

export function getSidebarWidth(screenWidth: number, screenHeight?: number): number {
  if (screenHeight !== undefined && screenHeight > screenWidth) {
    return clamp(Math.floor(screenWidth * 0.28), 220, 280);
  }
  return clamp(Math.floor(screenWidth * 0.3), 260, 320);
}
