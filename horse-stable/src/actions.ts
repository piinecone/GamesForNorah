import type { ActionDefinition, ActionId, AgeStage, GameState, Horse } from './types';
import {
  LESSON_DURATION_MS,
  LESSON_RING,
  calculateLessonPayout,
  canRemoveHorse,
  getExpansionCost,
  getLessonsLeft,
  getStableFull,
  healNeed,
  increaseValue,
  isNight,
  reduceNeed,
  refreshAlerts,
  updateFocus,
} from './state';

const FED_FOR_SLEEP = 55;

const STAGE_ACTIONS: Record<AgeStage, ActionId[]> = {
  foal: ['oats', 'carrots', 'pet', 'bathe', 'walk', 'findHome'],
  adult: ['oats', 'carrots', 'pet', 'bathe', 'walk', 'lesson', 'sleep', 'findHome'],
  elder: ['carrots', 'pet', 'retire'],
};

export const actions: ActionDefinition[] = [
  {
    id: 'oats',
    labelKey: 'oats',
    benefitKey: 'benefitOats',
    iconKey: 'icon-oats',
    getCost: () => 4,
    canUse: (state) => hasCoins(state, 4),
    apply: (state, horse) => {
      if (!horse) return {};
      state.coins -= 4;
      healNeed(horse.needs, 'hunger', 28);
      increaseValue(horse, 1);
      return helped(horse);
    },
  },
  {
    id: 'carrots',
    labelKey: 'carrots',
    benefitKey: 'benefitCarrots',
    iconKey: 'icon-carrots',
    getCost: () => 6,
    canUse: (state) => hasCoins(state, 6),
    apply: (state, horse) => {
      if (!horse) return {};
      state.coins -= 6;
      healNeed(horse.needs, 'hunger', 18);
      healNeed(horse.needs, 'affection', 10);
      increaseValue(horse, 1);
      return helped(horse);
    },
  },
  {
    id: 'sleep',
    labelKey: 'sleep',
    benefitKey: 'benefitSleep',
    iconKey: 'icon-sleep',
    getCost: () => 0,
    canUse: (state, horse) => {
      if (!horse) return 'needMoreHorses';
      if (horse.isSleeping) return 'alreadySleeping';
      if (!isNight(state)) return 'notNight';
      if (horse.needs.hunger < FED_FOR_SLEEP) return 'tooHungry';
      return null;
    },
    apply: (_state, horse) => {
      if (!horse) return {};
      horse.isSleeping = true;
      return { messageKey: 'horseSlept', messageVars: { name: horse.name }, selectedHorseId: horse.id };
    },
  },
  {
    id: 'pet',
    labelKey: 'pet',
    benefitKey: 'benefitPet',
    iconKey: 'icon-pet',
    getCost: () => 0,
    canUse: () => null,
    apply: (_state, horse) => {
      if (!horse) return {};
      healNeed(horse.needs, 'affection', 22);
      increaseValue(horse, 1);
      return helped(horse);
    },
  },
  {
    id: 'bathe',
    labelKey: 'bathe',
    benefitKey: 'benefitBathe',
    iconKey: 'icon-bathe',
    getCost: () => 8,
    canUse: (state) => hasCoins(state, 8),
    apply: (state, horse) => {
      if (!horse) return {};
      state.coins -= 8;
      healNeed(horse.needs, 'cleanliness', 35);
      increaseValue(horse, 2);
      return helped(horse);
    },
  },
  {
    id: 'walk',
    labelKey: 'walk',
    benefitKey: 'benefitWalk',
    iconKey: 'icon-walk',
    getCost: () => 0,
    canUse: () => null,
    apply: (_state, horse) => {
      if (!horse) return {};
      healNeed(horse.needs, 'exercise', 28);
      healNeed(horse.needs, 'affection', 4);
      reduceNeed(horse.needs, 'hunger', 4);
      increaseValue(horse, 2);
      return helped(horse);
    },
  },
  {
    id: 'lesson',
    labelKey: 'lesson',
    benefitKey: 'benefitLesson',
    iconKey: 'icon-lesson',
    getCost: () => 0,
    getReward: (_state, horse) => (horse ? calculateLessonPayout(horse) : 0),
    canUse: (state, horse) => {
      if (!horse || horse.ageStage !== 'adult') return 'onlyAdults';
      if (horse.isSleeping) return 'horseSleeping';
      if ((horse.lessonRemainingMs ?? 0) > 0) return 'lessonInProgress';
      if (isNight(state)) return 'notNight';
      if (getLessonsLeft(horse) <= 0) return 'lessonLimit';
      return null;
    },
    apply: (_state, horse) => {
      if (!horse) return {};
      horse.lessonRemainingMs = LESSON_DURATION_MS;
      horse.lessonsToday += 1;
      horse.wanderTarget = { ...LESSON_RING };
      return {
        messageKey: 'lessonStarted',
        messageVars: { name: horse.name },
        selectedHorseId: horse.id,
      };
    },
  },
  {
    id: 'findHome',
    labelKey: 'findHome',
    benefitKey: 'benefitFindHome',
    iconKey: 'icon-home',
    getCost: () => 0,
    getReward: (_state, horse) => Math.max(35, horse?.value ?? 35),
    canUse: (state, horse) => {
      if (!horse) return 'needMoreHorses';
      if (!canRemoveHorse(state, horse)) return 'needTwoAdults';
      return null;
    },
    apply: (state, horse) => {
      if (!horse) return {};
      const reward = Math.max(35, horse.value);
      state.coins += reward;
      state.horses = state.horses.filter((candidate) => candidate.id !== horse.id);
      return {
        messageKey: 'foundHome',
        messageVars: { name: horse.name, coins: reward },
        selectedHorseId: undefined,
      };
    },
  },
  {
    id: 'retire',
    labelKey: 'retire',
    benefitKey: 'benefitRetire',
    iconKey: 'icon-home',
    getCost: () => 0,
    getReward: (_state, horse) => Math.max(45, horse?.value ?? 45),
    canUse: (state, horse) => {
      if (!horse) return 'needMoreHorses';
      if (horse.ageStage !== 'elder') return 'onlyElders';
      if (!canRemoveHorse(state, horse)) return 'needTwoAdults';
      return null;
    },
    apply: (state, horse) => {
      if (!horse) return {};
      const reward = Math.max(45, horse.value);
      state.coins += reward;
      state.horses = state.horses.filter((candidate) => candidate.id !== horse.id);
      return {
        messageKey: 'retired',
        messageVars: { name: horse.name, coins: reward },
        selectedHorseId: undefined,
      };
    },
  },
  {
    id: 'expandStable',
    labelKey: 'expandStable',
    benefitKey: 'benefitExpand',
    iconKey: 'icon-expand',
    getCost: (state) => getExpansionCost(state),
    canUse: (state) => {
      if (!getStableFull(state)) return 'stableNotFull';
      const cost = getExpansionCost(state);
      return hasCoins(state, cost);
    },
    apply: (state) => {
      const cost = getExpansionCost(state);
      state.coins -= cost;
      state.expansions += 1;
      state.stableCapacity += 2;
      return { messageKey: 'expanded' };
    },
  },
];

export function actionsForStage(stage: AgeStage): ActionDefinition[] {
  const ids = STAGE_ACTIONS[stage];
  return actions.filter((action) => ids.includes(action.id));
}

export function applyAction(state: GameState, action: ActionDefinition, horse?: Horse) {
  const disabledReason = action.canUse(state, horse);
  if (disabledReason) {
    return { messageKey: disabledReason };
  }
  const outcome = action.apply(state, horse);
  refreshAlerts(state);
  updateFocus(state, 0, []);
  return outcome;
}

function hasCoins(state: GameState, amount: number): string | null {
  return state.coins >= amount ? null : 'noCoins';
}

function helped(horse: Horse) {
  return { messageKey: 'horseHelped', messageVars: { name: horse.name }, selectedHorseId: horse.id };
}
