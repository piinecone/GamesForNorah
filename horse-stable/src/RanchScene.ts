import Phaser from 'phaser';
import { actions, actionsForStage, applyAction } from './actions';
import { audio } from './audio/AudioManager';
import { needKeys, t } from './i18n';
import {
  CYCLE_MS,
  DAYLIGHT_MS,
  LAND_PAD_BOTTOM,
  LAND_PAD_X,
  LESSONS_PER_ADULT_PER_DAY,
  LESSON_QUEUE,
  LESSON_RING,
  PADDOCK,
  WORLD_SIZE,
  choosePaddockPoint,
  formatClockMs,
  getDayProgress,
  getDaylightRemainingMs,
  getFocusMessageKey,
  getGrowthProgress,
  getLessonsLeft,
  getShortestLessonRemainingMs,
  getSidebarLayout,
  getSidebarWidth,
  getTimeLabel,
  getTimeUntilDawnMs,
  getWorldFitZoom,
  isNight,
  loadGameState,
  saveGameState,
  shouldShowAlertBubble,
  tickGameState,
} from './state';
import type { ActionDefinition, ActionId, GameState, Horse, HorseColor, Language, NeedKey } from './types';
import type { SidebarLayout } from './state';

interface HorseView {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Ellipse;
  nameText: Phaser.GameObjects.Text;
  alert: Phaser.GameObjects.Container;
  alertBack: Phaser.GameObjects.Arc;
  alertText: Phaser.GameObjects.Text;
  selection: Phaser.GameObjects.Arc;
  rider: Phaser.GameObjects.Container;
  bodyCenterY: number;
}

interface RectHit {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ActionButtonHit extends RectHit {
  action: ActionDefinition;
  horse?: Horse;
  container?: Phaser.GameObjects.Container;
}

interface LanguageButtonHit extends RectHit {
  language: Language;
}

type DancingPlantKind = 'flower-red' | 'flower-yellow' | 'tuft' | 'spin';

const horsePalette: Record<HorseColor, { body: number; mane: number; accent: number }> = {
  chestnut: { body: 0x9b5636, mane: 0x4b2a1f, accent: 0xf3c28a },
  bay: { body: 0x6b3e2e, mane: 0x1f1714, accent: 0xe7b17b },
  palomino: { body: 0xd8aa4f, mane: 0xf6e1a0, accent: 0x8a5d2b },
  gray: { body: 0xb8b8ad, mane: 0x66665f, accent: 0xf0efe6 },
  black: { body: 0x252525, mane: 0x101010, accent: 0xd8d8d8 },
  paint: { body: 0xf1e8d0, mane: 0x4a2d21, accent: 0x935337 },
};

const barColors: Record<NeedKey, number> = {
  hunger: 0xd9a845,
  affection: 0xe06f8b,
  cleanliness: 0x56abc8,
  exercise: 0x7ebf62,
};

const HORSE_TAP_RADIUS_ADULT = 88;
const PAN_DRAG_THRESHOLD = 14;

/** Footprints for house (205,122) and stable (430,108) — keep plants outside. */
const BUILDING_RECTS = [
  { x: 189, y: 122, width: 196, height: 197 },
  { x: 406, y: 108, width: 408, height: 253 },
];

function kidsKeepOutRect(padding = 44): { x: number; y: number; width: number; height: number } {
  const { x, y, count } = LESSON_QUEUE;
  const right = x + (count - 1) * 28;
  const top = y - 52 - padding;
  return {
    x: x - padding,
    y: top,
    width: right - x + padding * 2,
    height: 52 + padding * 2 + 20,
  };
}

const SKY_COLOR = 0x87ceeb;
const SKY_COLOR_CSS = '#87ceeb';
const SKY_HEIGHT = 148;
const PLANT_OUTSIDE_PAD = 56;

const POND = { x: 1310, y: 650, rx: 115, ry: 59 };
const TREE_POINTS: [number, number][] = [
  [105, 120], [1040, 140], [1220, 235], [1370, 170], [1320, 855],
  [1180, 875], [80, 850], [1450, 510], [80, 510],
];

export class RanchScene extends Phaser.Scene {
  private state!: GameState;
  private worldRoot!: Phaser.GameObjects.Container;
  private uiRoot!: Phaser.GameObjects.Container;
  private uiCamera!: Phaser.Cameras.Scene2D.Camera;
  private sidebarWidth = 320;
  private worldZoom = 1;
  private sidebarLayout!: SidebarLayout;
  private horseViews = new Map<string, HorseView>();
  private selectedHorseId?: string;
  private sidebar!: Phaser.GameObjects.Container;
  private actionButtonHits: ActionButtonHit[] = [];
  private languageButtonHits: LanguageButtonHit[] = [];
  private musicButtonHit?: RectHit;
  private sfxButtonHit?: RectHit;
  private focusBannerHit?: RectHit;
  private messageText?: Phaser.GameObjects.Text;
  private stableMarkerGraphics?: Phaser.GameObjects.Graphics;
  private nightOverlay?: Phaser.GameObjects.Rectangle;
  private starContainer?: Phaser.GameObjects.Container;
  private birthCelebration?: Phaser.GameObjects.Container;
  private kidsContainer?: Phaser.GameObjects.Container;
  private frontKid?: Phaser.GameObjects.Container;
  private kidsLabel?: Phaser.GameObjects.Text;
  private nightOverlayAlpha = 0;
  private nextSaveAt = 0;
  private panelSnapshot = '';
  private dragStart?: { pointerX: number; pointerY: number; scrollX: number; scrollY: number };
  private dragged = false;
  private wasNight = false;
  private criticalHorseIds = new Set<string>();
  private lastUrgentAt = 0;
  private audioUnlocked = false;
  private displayedNeeds = new Map<string, Record<NeedKey, number>>();
  private needBarFills = new Map<string, Phaser.GameObjects.Rectangle[]>();
  private needBarLabels = new Map<string, Phaser.GameObjects.Text[]>();
  private needBarPulses = new Map<string, Phaser.GameObjects.Rectangle[]>();
  private sidebarClockY = 0;
  private lastFocusKey = '';
  private clouds: { sprite: Phaser.GameObjects.Image; speed: number; baseAlpha: number }[] = [];

  constructor() {
    super('RanchScene');
  }

  create(): void {
    this.state = loadGameState();
    audio.init(this);
    this.wasNight = isNight(this.state);
    document.documentElement.lang = this.state.language;

    this.worldRoot = this.add.container(0, 0);
    this.uiRoot = this.add.container(0, 0).setScrollFactor(0).setDepth(5000);

    this.uiCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCamera.setScroll(0, 0);
    this.cameras.main.ignore(this.uiRoot);
    this.uiCamera.ignore(this.worldRoot);

    this.createTextures();
    const landWidth = WORLD_SIZE.width + LAND_PAD_X * 2;
    const landHeight = WORLD_SIZE.height + LAND_PAD_BOTTOM;
    this.cameras.main.setBounds(-LAND_PAD_X, 0, landWidth, landHeight);
    this.cameras.main.setBackgroundColor(SKY_COLOR_CSS);

    this.drawWorld();
    this.createKidsQueue();
    this.createNightOverlay();
    this.createHorses();
    this.createSidebar();
    this.createInput();

    this.scale.on('resize', this.handleResize, this);
    this.handleResize();
  }

  update(time: number, delta: number): void {
    const messages = tickGameState(this.state, delta);
    for (const message of messages) {
      this.handleTickMessage(message);
    }

    const nightNow = isNight(this.state);
    if (nightNow !== this.wasNight) {
      audio.setNightMode(nightNow);
      this.wasNight = nightNow;
    }
    this.updateCriticalAlerts(time);
    this.updateNightOverlay(delta);
    this.updateClouds();
    this.updateKidsVisibility();
    this.updateHorseMovement(delta);
    this.updateHorseViews(time);
    this.updateSidebarDynamic();
    this.maybeRefreshSidebar();
    this.lerpNeedBars(delta);
    this.updateNeedHighlights(time);

    if (time >= this.nextSaveAt) {
      saveGameState(this.state);
      this.nextSaveAt = time + 4500;
    }
  }

  private handleTickMessage(message: string): void {
    if (message.startsWith('dailyCoins:')) {
      const coins = Number(message.split(':')[1]);
      this.showMessage('dailyCoins', { coins });
      this.spawnFloatingCoins(`+${coins}`, this.scale.width - this.sidebarWidth / 2, 120);
      audio.playSfx('morning');
    } else if (message.startsWith('birthCelebration:')) {
      const parts = message.split(':');
      this.syncHorseViews();
      this.showBirthCelebration(parts[1], parts[2]);
    } else if (message.startsWith('newFoal:')) {
      this.showMessage('newFoal', { name: message.split(':')[1] });
      this.syncHorseViews();
    } else if (message.startsWith('lessonComplete:')) {
      const parts = message.split(':');
      const coins = Number(parts[2]);
      this.showMessage('lessonEarned', { name: parts[1], coins });
      this.spawnFloatingCoins(`+${coins}`, this.scale.width - this.sidebarWidth / 2, 140);
      audio.playSfx('coin');
      this.bounceFrontKid();
      this.syncHorseViews();
    } else if (message.startsWith('grewUp:')) {
      const parts = message.split(':');
      this.showMessage('grewUp', { name: parts[1] });
      this.syncHorseViews();
      this.playGrowUpEffect(parts[2]);
      audio.playSfx('celebrate');
    } else if (message.startsWith('grewOld:')) {
      const parts = message.split(':');
      this.showMessage('grewOld', { name: parts[1] });
      this.syncHorseViews();
    } else if (message === 'focusDone') {
      this.showMessage('focusDone');
      audio.playSfx('celebrate');
    } else if (message === 'nightFalls') {
      this.showMessage(message);
      audio.playSfx('night');
    } else {
      this.showMessage(message);
    }
  }

  private createTextures(): void {
    this.createGrassTile();
    this.createCloudTextures();
    this.createDancingPlantTextures();
    this.createHorseTextures();
    this.createIconTextures();
  }

  private createNightOverlay(): void {
    const worldW = this.getWorldViewportWidth();
    const height = this.scale.height;
    this.nightOverlay = this.add
      .rectangle(worldW / 2, height / 2, worldW, height, 0x1a3a6e, 1)
      .setScrollFactor(0)
      .setDepth(900)
      .setAlpha(0);
    this.worldRoot.add(this.nightOverlay);

    this.starContainer = this.add.container(0, 0).setScrollFactor(0).setDepth(901).setAlpha(0);
    this.worldRoot.add(this.starContainer);
    this.layoutStars();
  }

  private layoutStars(): void {
    if (!this.starContainer) return;
    this.starContainer.removeAll(true);
    const worldW = this.getWorldViewportWidth();
    const height = this.scale.height;
    const starPositions = [
      [0.12, 0.14], [0.28, 0.08], [0.45, 0.12], [0.62, 0.07], [0.78, 0.15],
      [0.88, 0.1], [0.2, 0.22], [0.55, 0.2], [0.72, 0.24], [0.35, 0.18],
    ];
    for (const [fx, fy] of starPositions) {
      this.starContainer.add(this.add.circle(worldW * fx, height * fy, 2, 0xffffff, 0.85));
    }
  }

  private updateNightOverlay(delta: number): void {
    if (!this.nightOverlay || !this.starContainer) return;
    const target = isNight(this.state) ? 0.42 : 0;
    const step = (delta / 1000) * 1.2;
    if (this.nightOverlayAlpha < target) {
      this.nightOverlayAlpha = Math.min(target, this.nightOverlayAlpha + step);
    } else if (this.nightOverlayAlpha > target) {
      this.nightOverlayAlpha = Math.max(target, this.nightOverlayAlpha - step);
    }
    this.nightOverlay.setAlpha(this.nightOverlayAlpha);
    this.starContainer.setAlpha(this.nightOverlayAlpha > 0.15 ? this.nightOverlayAlpha * 1.4 : 0);
  }

  private createKidsQueue(): void {
    this.kidsContainer = this.add.container(0, 0).setDepth(400);
    this.worldRoot.add(this.kidsContainer);
    const shirtColors = [0xe06f8b, 0x56abc8, 0xd9a845, 0x7ebf62];
    const { x, y, count } = LESSON_QUEUE;

    for (let i = 0; i < count; i += 1) {
      const kid = this.createKidFigure(x + i * 28, y + (i % 2) * 8, shirtColors[i % shirtColors.length]);
      this.kidsContainer.add(kid);
      if (i === 0) this.frontKid = kid;
    }

    const label = this.add.text(x + ((count - 1) * 28) / 2, y - 32, t(this.state.language, 'studentsWaiting'), {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#fff7d2',
      stroke: '#2d402a',
      strokeThickness: 3,
    }).setOrigin(0.5);
    this.kidsContainer.add(label);
    this.kidsLabel = label;
    this.updateKidsVisibility();
  }

  private createKidFigure(x: number, y: number, shirtColor: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const g = this.add.graphics();
    g.fillStyle(0xf1c18b, 1);
    g.fillCircle(0, -16, 9);
    g.fillStyle(0x4b3826, 1);
    g.fillRect(-8, -8, 16, 3);
    g.fillStyle(shirtColor, 1);
    g.fillRect(-8, -5, 16, 18);
    g.fillStyle(0x4b3826, 1);
    g.fillRect(-6, 13, 5, 10);
    g.fillRect(2, 13, 5, 10);
    container.add(g);
    return container;
  }

  private updateKidsVisibility(): void {
    this.kidsContainer?.setVisible(!isNight(this.state));
  }

  private bounceFrontKid(): void {
    if (!this.frontKid) return;
    this.tweens.killTweensOf(this.frontKid);
    this.frontKid.y = LESSON_QUEUE.y;
    this.tweens.add({
      targets: this.frontKid,
      y: LESSON_QUEUE.y - 12,
      duration: 180,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeOut',
    });
  }

  private drawWorld(): void {
    const landWidth = WORLD_SIZE.width + LAND_PAD_X * 2;
    const grassHeight = WORLD_SIZE.height - SKY_HEIGHT + LAND_PAD_BOTTOM;

    this.drawSky(landWidth);

    const grass = this.add.tileSprite(
      WORLD_SIZE.width / 2,
      SKY_HEIGHT + grassHeight / 2,
      landWidth,
      grassHeight,
      'grass-tile',
    );
    this.worldRoot.add(grass);

    const path = this.add.graphics();
    path.fillStyle(0xb8935f, 1);
    path.fillRect(260, 260, 110, 305);
    path.fillRect(330, 505, 360, 105);
    path.fillRect(680, 560, 260, 80);
    path.fillStyle(0xc9aa72, 1);
    path.fillRect(276, 260, 78, 300);
    path.fillRect(330, 522, 360, 72);
    path.fillRect(680, 576, 260, 48);
    this.worldRoot.add(path);

    this.drawHouse(205, 122);
    this.drawStable(430, 108);
    this.drawPaddock();
    this.drawPond(POND.x, POND.y);
    this.drawTrees();
    this.createDancingPlants();
    this.createClouds();
  }

  private drawSky(width: number): void {
    const g = this.add.graphics().setDepth(-5);
    g.fillStyle(SKY_COLOR, 1);
    g.fillRect(-LAND_PAD_X, 0, width, SKY_HEIGHT);
    g.fillGradientStyle(0x7ec8e8, 0x7ec8e8, 0x9fdcff, 0x9fdcff, 1);
    g.fillRect(-LAND_PAD_X, 0, width, SKY_HEIGHT);
    this.worldRoot.add(g);
  }

  private createClouds(): void {
    const specs: [string, number, number, number, number][] = [
      ['cloud-sm', 120, 42, 11, 0.88],
      ['cloud-md', 420, 58, 15, 0.92],
      ['cloud-lg', 780, 36, 9, 0.85],
      ['cloud-sm', 980, 48, 13, 0.9],
      ['cloud-md', 1320, 64, 10, 0.87],
      ['cloud-lg', 1580, 44, 12, 0.93],
      ['cloud-sm', 260, 72, 14, 0.86],
      ['cloud-md', 620, 78, 8, 0.91],
      ['cloud-lg', 1100, 68, 16, 0.84],
      ['cloud-sm', 1450, 82, 11, 0.89],
    ];

    for (const [key, x, y, speed, baseAlpha] of specs) {
      const sprite = this.add.image(x, y, key).setDepth(4).setAlpha(baseAlpha);
      this.worldRoot.add(sprite);
      this.clouds.push({ sprite, speed, baseAlpha });
    }
  }

  private updateClouds(): void {
    const cam = this.cameras.main;
    const margin = 180;
    const landWidth = WORLD_SIZE.width + LAND_PAD_X * 2;
    const wrapMin = cam.scrollX - margin;
    const wrapMax = cam.scrollX + this.getWorldViewportWidth() + margin;
    const nightDim = 1 - this.nightOverlayAlpha * 0.7;

    for (const cloud of this.clouds) {
      cloud.sprite.x += cloud.speed * (this.game.loop.delta / 1000);
      if (cloud.sprite.x > wrapMax) {
        cloud.sprite.x = wrapMin;
      }
      if (cloud.sprite.x < -LAND_PAD_X - margin) {
        cloud.sprite.x = landWidth + LAND_PAD_X - margin;
      }
      cloud.sprite.setAlpha(cloud.baseAlpha * nightDim);
    }
  }

  private drawHouse(x: number, y: number): void {
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(0x8b5a3c, 1);
    g.fillRect(x, y + 68, 164, 128);
    g.fillStyle(0xc75d3b, 1);
    g.fillTriangle(x - 16, y + 78, x + 82, y, x + 180, y + 78);
    g.fillStyle(0xf1d8a8, 1);
    g.fillRect(x + 60, y + 116, 44, 80);
    g.fillStyle(0x77b9d6, 1);
    g.fillRect(x + 18, y + 98, 36, 34);
    g.fillRect(x + 112, y + 98, 36, 34);
    this.worldRoot.add(g);
    const label = this.add.text(x + 82, y + 214, t(this.state.language, 'appName'), {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f7f4df',
      stroke: '#2c482d',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(15);
    this.worldRoot.add(label);
  }

  private drawStable(x: number, y: number): void {
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(0x704122, 1);
    g.fillRect(x, y + 62, 360, 190);
    g.fillStyle(0x9c4f28, 1);
    g.fillTriangle(x - 24, y + 72, x + 180, y, x + 384, y + 72);
    g.fillStyle(0xd69a55, 1);
    g.fillRect(x + 22, y + 98, 316, 122);
    g.lineStyle(3, 0x6b3c22, 1);
    for (let i = 0; i < 8; i += 1) {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const slotX = x + 24 + col * 84;
      const slotY = y + 98 + row * 72;
      g.strokeRect(slotX, slotY, 72, 58);
      g.fillStyle(0x4c2b1a, 1);
      g.fillRect(slotX + 28, slotY + 28, 10, 30);
      g.fillStyle(0xd69a55, 1);
    }
    this.worldRoot.add(g);
    this.drawStableCapacityMarkers();
  }

  private drawStableCapacityMarkers(): void {
    const startX = 438;
    const startY = 334;
    this.stableMarkerGraphics?.destroy();
    const g = this.add.graphics();
    this.stableMarkerGraphics = g;
    for (let i = 0; i < this.state.stableCapacity; i += 1) {
      const row = Math.floor(i / 10);
      const col = i % 10;
      const occupied = i < this.state.horses.length;
      g.fillStyle(occupied ? 0xdba657 : 0xeadbb7, 1);
      g.fillRoundedRect(startX + col * 31, startY + row * 24, 22, 15, 3);
      g.lineStyle(2, 0x6f4a2f, 1);
      g.strokeRoundedRect(startX + col * 31, startY + row * 24, 22, 15, 3);
    }
    this.worldRoot.add(g);
  }

  private drawPaddock(): void {
    const g = this.add.graphics();
    g.fillStyle(0x76b95c, 1);
    g.fillRoundedRect(PADDOCK.x, PADDOCK.y, PADDOCK.width, PADDOCK.height, 8);
    g.lineStyle(8, 0x8a633a, 1);
    g.strokeRect(PADDOCK.x, PADDOCK.y, PADDOCK.width, PADDOCK.height);
    g.lineStyle(3, 0xe4c37b, 1);
    g.strokeRect(PADDOCK.x + 12, PADDOCK.y + 24, PADDOCK.width - 24, PADDOCK.height - 48);
    g.strokeRect(PADDOCK.x + 12, PADDOCK.y + PADDOCK.height - 78, PADDOCK.width - 24, 22);
    for (let x = PADDOCK.x; x <= PADDOCK.x + PADDOCK.width; x += 64) {
      g.fillStyle(0x6e4828, 1);
      g.fillRect(x - 5, PADDOCK.y - 8, 10, 28);
      g.fillRect(x - 5, PADDOCK.y + PADDOCK.height - 20, 10, 28);
    }
    for (let y = PADDOCK.y; y <= PADDOCK.y + PADDOCK.height; y += 64) {
      g.fillStyle(0x6e4828, 1);
      g.fillRect(PADDOCK.x - 8, y - 5, 28, 10);
      g.fillRect(PADDOCK.x + PADDOCK.width - 20, y - 5, 28, 10);
    }
    this.worldRoot.add(g);
  }

  private drawPond(x: number, y: number): void {
    const g = this.add.graphics();
    g.fillStyle(0x4f9fc2, 1);
    g.fillEllipse(x, y, 230, 118);
    g.fillStyle(0x77c7d7, 0.55);
    g.fillEllipse(x - 38, y - 16, 88, 22);
    g.fillEllipse(x + 52, y + 20, 74, 18);
    this.worldRoot.add(g);
  }

  private drawTrees(): void {
    const g = this.add.graphics().setDepth(12);
    for (const [x, y] of TREE_POINTS) {
      g.fillStyle(0x5f3d22, 1);
      g.fillRect(x - 10, y + 20, 20, 44);
      g.fillStyle(0x3f7f42, 1);
      g.fillCircle(x, y + 10, 40);
      g.fillStyle(0x5ca85a, 1);
      g.fillCircle(x - 18, y - 8, 24);
      g.fillCircle(x + 20, y - 5, 25);
    }
    this.worldRoot.add(g);
  }

  private createDancingPlants(): void {
    const placements: [number, number, DancingPlantKind, number][] = [
      [85, 400, 'flower-red', 0],
      [90, 480, 'tuft', 90],
      [75, 560, 'flower-yellow', 180],
      [95, 650, 'spin', 40],
      [80, 740, 'flower-red', 220],
      [90, 820, 'tuft', 130],
      [70, 510, 'flower-yellow', 60],
      [70, 900, 'tuft', 150],
      [120, 270, 'flower-red', 300],
      [850, 268, 'spin', 80],
      [1020, 272, 'flower-yellow', 200],
      [1180, 278, 'tuft', 20],
      [320, 950, 'flower-red', 260],
      [560, 962, 'tuft', 110],
      [820, 948, 'flower-yellow', 170],
      [1080, 958, 'flower-red', 50],
      [1320, 952, 'spin', 190],
      [1230, 400, 'tuft', 240],
      [1420, 460, 'flower-yellow', 140],
      [1480, 540, 'flower-red', 70],
      [1520, 620, 'tuft', 320],
      [1380, 720, 'flower-yellow', 10],
      [1450, 820, 'flower-red', 280],
      [1280, 880, 'spin', 160],
      [1550, 480, 'tuft', 95],
      [1220, 300, 'flower-yellow', 210],
      [145, 280, 'tuft', 200],
    ];

    for (const [x, y, kind, phase] of placements) {
      if (
        this.isInsideBuilding(x, y) ||
        this.isNearKids(x, y) ||
        this.isInOrNearPaddock(x, y) ||
        this.isInPond(x, y) ||
        this.isNearTree(x, y)
      ) {
        continue;
      }
      this.spawnDancingPlant(x, y, kind, phase);
    }
  }

  private isInOrNearPaddock(x: number, y: number): boolean {
    const { x: px, y: py, width, height } = PADDOCK;
    const pad = PLANT_OUTSIDE_PAD;
    return x >= px - pad && x <= px + width + pad && y >= py - pad && y <= py + height + pad;
  }

  private isInPond(x: number, y: number, pad = 38): boolean {
    const dx = (x - POND.x) / (POND.rx + pad);
    const dy = (y - POND.y) / (POND.ry + pad);
    return dx * dx + dy * dy <= 1;
  }

  private isNearTree(x: number, y: number): boolean {
    for (const [tx, ty] of TREE_POINTS) {
      if (x >= tx - 24 && x <= tx + 24 && y >= ty + 6 && y <= ty + 72) {
        return true;
      }
      if (Phaser.Math.Distance.Between(x, y, tx, ty + 10) < 50) return true;
      if (Phaser.Math.Distance.Between(x, y, tx - 18, ty - 8) < 34) return true;
      if (Phaser.Math.Distance.Between(x, y, tx + 20, ty - 5) < 35) return true;
    }
    return false;
  }

  private isNearKids(x: number, y: number): boolean {
    const rect = kidsKeepOutRect();
    return (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    );
  }

  private isInsideBuilding(x: number, y: number, margin = 10): boolean {
    return BUILDING_RECTS.some(
      (rect) =>
        x >= rect.x - margin &&
        x <= rect.x + rect.width + margin &&
        y >= rect.y - margin &&
        y <= rect.y + rect.height + margin,
    );
  }

  private spawnDancingPlant(x: number, y: number, kind: DancingPlantKind, phaseMs: number): void {
    const container = this.add.container(x, y).setDepth(y);
    const bobGroup = this.add.container(0, 0);
    container.add(bobGroup);

    if (kind === 'spin') {
      const sprite = this.add.sprite(0, 0, 'plant-spin').setOrigin(0.5, 1);
      bobGroup.add(sprite);
      this.tweens.add({
        targets: sprite,
        y: -4,
        duration: 520,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: phaseMs,
      });
      this.tweens.add({
        targets: sprite,
        angle: 360,
        duration: 3200,
        repeat: -1,
        ease: 'Linear',
      });
    } else {
      const key = kind === 'flower-red' ? 'plant-flower-red' : kind === 'flower-yellow' ? 'plant-flower-yellow' : 'plant-tuft';
      const sprite = this.add.sprite(0, 0, key).setOrigin(0.5, 1);
      bobGroup.add(sprite);
      let raised = false;
      this.time.addEvent({
        delay: 440,
        loop: true,
        startAt: phaseMs % 440,
        callback: () => {
          raised = !raised;
          sprite.setTexture(raised ? `${key}-2` : key);
        },
      });
      this.tweens.add({
        targets: bobGroup,
        angle: { from: -5, to: 5 },
        duration: 860 + (phaseMs % 240),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        delay: phaseMs * 0.35,
      });
    }

    this.worldRoot.add(container);
  }

  private createHorses(): void {
    for (const horse of this.state.horses) {
      this.createHorseView(horse);
    }
  }

  private syncHorseViews(): void {
    const liveIds = new Set(this.state.horses.map((horse) => horse.id));
    for (const [id, view] of this.horseViews) {
      if (!liveIds.has(id)) {
        view.container.destroy();
        this.horseViews.delete(id);
        this.displayedNeeds.delete(id);
        this.needBarFills.delete(id);
      }
    }
    for (const horse of this.state.horses) {
      if (!this.horseViews.has(horse.id)) {
        this.createHorseView(horse);
      } else {
        this.refreshHorseSprite(horse);
      }
    }
    this.drawStableCapacityMarkers();
    this.renderSidebarContent();
  }

  private getHorseTextureKey(horse: Horse): string {
    if (horse.ageStage === 'foal') return `horse-${horse.color}-foal`;
    return `horse-${horse.color}-adult`;
  }

  private getHorseScale(horse: Horse): number {
    if (horse.ageStage === 'foal') return 0.72;
    if (horse.ageStage === 'elder') return 0.92;
    return 1;
  }

  /** Normalized texture Y where hooves touch the ground (see createHorseTexture). */
  private getHorseFootOriginY(ageStage: Horse['ageStage']): number {
    if (ageStage === 'foal') {
      const s = 0.78;
      return (40 * s + 16 * s) / 64;
    }
    return 56 / 64;
  }

  private layoutHorseParts(horse: Horse, view: HorseView, scale: number): void {
    view.sprite.setOrigin(0.5, this.getHorseFootOriginY(horse.ageStage));
    view.sprite.setPosition(0, 0);

    view.bodyCenterY = -24 * scale;
    view.selection.setPosition(0, view.bodyCenterY);
    view.selection.setRadius(38 * scale);

    const shadow = view.shadow;
    shadow.setPosition(0, 5 * scale);
    shadow.setSize(68 * scale, 16 * scale);

    view.rider.setPosition(0, -30 * scale);
    view.nameText.setPosition(0, 14 * scale);
    view.nameText.setFontSize(`${14 * scale}px`);
    view.alert.setPosition(18 * scale, view.bodyCenterY - 22 * scale);
  }

  private refreshHorseSprite(horse: Horse): void {
    const view = this.horseViews.get(horse.id);
    if (!view) return;
    const scale = this.getHorseScale(horse);
    view.sprite.setTexture(this.getHorseTextureKey(horse));
    view.sprite.setScale(scale);
    view.sprite.setAlpha(horse.ageStage === 'elder' ? 0.88 : 1);
    this.layoutHorseParts(horse, view, scale);
  }

  private createHorseView(horse: Horse): void {
    const container = this.add.container(horse.position.x, horse.position.y);
    this.worldRoot.add(container);
    const scale = this.getHorseScale(horse);
    const selection = this.add.circle(0, 0, 38 * scale, 0xfff2a8, 0.28).setVisible(false);
    const shadow = this.add.ellipse(0, 0, 68 * scale, 16 * scale, 0x31552b, 0.28);
    const sprite = this.add.image(0, 0, this.getHorseTextureKey(horse)).setScale(scale);
    sprite.setAlpha(horse.ageStage === 'elder' ? 0.88 : 1);
    const nameText = this.add.text(0, 0, horse.name, {
      fontFamily: 'monospace',
      fontSize: `${14 * scale}px`,
      color: '#fff7d2',
      stroke: '#2d402a',
      strokeThickness: 4,
    }).setOrigin(0.5);

    const alert = this.add.container(0, 0);
    const alertBack = this.add.circle(0, 0, 17, 0xfff0a8, 1);
    const alertText = this.add.text(0, -1, '!', {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#6b3a22',
    }).setOrigin(0.5);
    alert.add([alertBack, alertText]);

    const rider = this.createKidRider();
    container.add([selection, shadow, sprite, rider, nameText, alert]);

    const view: HorseView = {
      container,
      sprite,
      shadow,
      nameText,
      alert,
      alertBack,
      alertText,
      selection,
      rider,
      bodyCenterY: -24 * scale,
    };
    this.layoutHorseParts(horse, view, scale);
    this.horseViews.set(horse.id, view);

    const needs: Record<NeedKey, number> = {
      hunger: horse.needs.hunger,
      affection: horse.needs.affection,
      cleanliness: horse.needs.cleanliness,
      exercise: horse.needs.exercise,
    };
    this.displayedNeeds.set(horse.id, { ...needs });
  }

  private createKidRider(): Phaser.GameObjects.Container {
    const container = this.add.container(0, -28).setScale(0.85);
    const g = this.add.graphics();
    g.fillStyle(0xf1c18b, 1);
    g.fillCircle(0, -16, 9);
    g.fillStyle(0x4b3826, 1);
    g.fillRect(-8, -8, 16, 3);
    g.fillStyle(0xe06f8b, 1);
    g.fillRect(-8, -5, 16, 18);
    g.fillStyle(0x4b3826, 1);
    g.fillRect(-6, 13, 5, 10);
    g.fillRect(2, 13, 5, 10);
    container.add(g);
    container.setVisible(false);
    return container;
  }

  private createSidebar(): void {
    this.sidebar = this.add.container(0, 0);
    this.uiRoot.add(this.sidebar);
    this.renderSidebarContent();
  }

  private sidebarFont(size: number): string {
    return `${Math.max(9, Math.round(size * this.sidebarLayout.fontScale))}px`;
  }

  private countSidebarActions(horse?: Horse): number {
    if (!horse) {
      return actions.some((a) => a.id === 'expandStable') ? 1 : 0;
    }
    const stageActions = actionsForStage(horse.ageStage);
    const expandAction = actions.find((a) => a.id === 'expandStable');
    const allActions =
      expandAction && !stageActions.includes(expandAction) ? [...stageActions, expandAction] : stageActions;
    return allActions.length;
  }

  private renderSidebarContent(): void {
    this.sidebar.removeAll(true);
    this.actionButtonHits = [];
    this.languageButtonHits = [];
    this.musicButtonHit = undefined;
    this.sfxButtonHit = undefined;
    this.focusBannerHit = undefined;
    this.needBarFills.clear();
    this.needBarLabels.clear();
    this.needBarPulses.clear();

    const sw = this.sidebarWidth;
    const sh = this.scale.height;
    const safeTop = this.getSafeTop();
    const safeBottom = this.getSafeBottom();
    const x = this.scale.width - sw;
    const horse = this.getSelectedHorse();
    this.sidebarLayout = getSidebarLayout(sh, this.countSidebarActions(horse), Boolean(horse), safeTop, safeBottom);
    const layout = this.sidebarLayout;

    const bg = this.add.rectangle(x, 0, sw, sh, 0x2a4528, 0.97).setOrigin(0);
    bg.setStrokeStyle(4, 0x1a2e18);
    this.sidebar.add(bg);

    let y = safeTop + 10;

    const focusBg = this.add.rectangle(x + 12, y, sw - 24, layout.focusBannerH, 0xf6cf72, 0.95).setOrigin(0);
    focusBg.setStrokeStyle(2, 0xb47a38);
    focusBg.setName('focusBg');
    this.sidebar.add(focusBg);
    const focusText = this.add.text(x + sw / 2, y + layout.focusBannerH / 2, this.getFocusBannerText(), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(sw < 300 ? 12 : 14),
      fontStyle: 'bold',
      color: '#4a2f1b',
      align: 'center',
      wordWrap: { width: sw - 36 },
    }).setOrigin(0.5);
    focusText.setName('focusText');
    this.sidebar.add(focusText);
    this.focusBannerHit = { x: x + 12, y, width: sw - 24, height: layout.focusBannerH };
    y += layout.focusBannerH + 10;

    const stats = this.add.text(x + 14, y, this.getStatsLine(), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(13),
      color: '#f6edcf',
      lineSpacing: 4,
    });
    stats.setName('stats');
    this.sidebar.add(stats);
    y += stats.height + 10;

    this.sidebarClockY = y;
    this.drawSidebarClock(x + 14, y);
    y += 58;

    const btnY = y;
    const toggleW = 44;
    const btnH = layout.headerBtnH;
    this.musicButtonHit = { x: x + 14, y: btnY, width: toggleW, height: btnH };
    this.sidebar.add(this.createToggleButton(x + 14, btnY, toggleW, btnH, t(this.state.language, 'musicBtn'), !audio.isMusicMuted(), 0x7ebf62));
    this.sfxButtonHit = { x: x + 62, y: btnY, width: toggleW, height: btnH };
    this.sidebar.add(this.createToggleButton(x + 62, btnY, toggleW, btnH, t(this.state.language, 'sfxBtn'), !audio.isSfxMuted(), 0x56abc8));

    const codes: Language[] = ['eu', 'de', 'es', 'en'];
    const langBtnW = Math.min(44, Math.max(36, Math.floor((sw - 120) / codes.length)));
    const langStep = langBtnW + 6;
    codes.forEach((language, index) => {
      const bx = x + sw - 14 - (codes.length - index) * langStep;
      const button = this.createSmallButton(bx, btnY, langBtnW, btnH, language.toUpperCase(), language === this.state.language);
      this.sidebar.add(button);
      this.languageButtonHits.push({ language, x: bx, y: btnY, width: langBtnW, height: btnH });
    });
    y += btnH + 12;

    if (horse) {
      y = this.renderHorseCard(x, y, sw, horse);
    } else {
      y = this.renderEmptyState(x, y, sw);
    }

    this.messageText = this.add.text(x + sw / 2, sh - safeBottom - 28, '', {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(13),
      fontStyle: 'bold',
      color: '#fff8c4',
      stroke: '#28402a',
      strokeThickness: 4,
      align: 'center',
      wordWrap: { width: sw - 24 },
    }).setOrigin(0.5);
    this.sidebar.add(this.messageText);
  }

  private renderHorseCard(x: number, y: number, sw: number, horse: Horse): number {
    const layout = this.sidebarLayout;
    const cardBg = this.add.rectangle(x + 12, y, sw - 24, 0, 0xf7e8bd, 0.96).setOrigin(0);
    cardBg.setStrokeStyle(3, 0x7e5a33);
    this.sidebar.add(cardBg);

    const portrait = this.add.image(x + 36, y + 28, this.getHorseTextureKey(horse)).setScale(0.55);
    this.sidebar.add(portrait);

    const header = this.add.text(x + 68, y + 10, `${horse.name}`, {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(17),
      fontStyle: 'bold',
      color: '#4f321d',
    });
    this.sidebar.add(header);

    const stage = this.add.text(x + 68, y + 32, t(this.state.language, horse.ageStage), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(12),
      color: '#5c472b',
    });
    this.sidebar.add(stage);

    const valueLine = this.add.text(x + 68, y + 50, `${t(this.state.language, 'value')}: ${horse.value}`, {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(12),
      color: '#5c472b',
    });
    this.sidebar.add(valueLine);

    let cardH = 78;
    const barW = sw - 48;
    const fills: Phaser.GameObjects.Rectangle[] = [];
    const labels: Phaser.GameObjects.Text[] = [];
    const pulses: Phaser.GameObjects.Rectangle[] = [];
    needKeys.forEach((need, index) => {
      const by = y + 78 + index * layout.needRowH;
      const pulse = this.add.rectangle(x + 22, by + 10, barW + 4, 22, 0xfff8c4, 0).setOrigin(0);
      pulse.setStrokeStyle(2, 0xffd45a, 0);
      pulses.push(pulse);
      this.sidebar.add(pulse);

      const label = this.add.text(x + 24, by, t(this.state.language, need), {
        fontFamily: 'monospace',
        fontSize: this.sidebarFont(11),
        color: '#604326',
      });
      labels.push(label);
      this.sidebar.add(label);

      this.sidebar.add(this.add.rectangle(x + 24, by + 14, barW, 8, 0xc9b27c, 1).setOrigin(0));
      const displayed = this.displayedNeeds.get(horse.id)?.[need] ?? horse.needs[need];
      const fill = this.add.rectangle(x + 24, by + 14, barW * (displayed / 100), 8, barColors[need], 1).setOrigin(0);
      fills.push(fill);
      this.sidebar.add(fill);
      cardH = by + layout.needRowH;
    });
    this.needBarFills.set(horse.id, fills);
    this.needBarLabels.set(horse.id, labels);
    this.needBarPulses.set(horse.id, pulses);

    const contextY = cardH + 4;
    let contextLabel = '';
    if (horse.ageStage === 'foal') {
      contextLabel = t(this.state.language, 'growing', { percent: Math.round(getGrowthProgress(horse)) });
    } else if (horse.ageStage === 'adult') {
      contextLabel = t(this.state.language, 'lessonsLeft', {
        left: getLessonsLeft(horse),
        total: LESSONS_PER_ADULT_PER_DAY,
      });
    } else {
      contextLabel = t(this.state.language, 'readyRetire');
    }
    this.sidebar.add(this.add.text(x + 24, contextY, contextLabel, {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(11),
      color: '#604326',
    }));
    cardH = contextY + 24;

    cardBg.setSize(sw - 24, cardH - y + 8);

    const stageActions = actionsForStage(horse.ageStage);
    const expandAction = actions.find((a) => a.id === 'expandStable');
    const allActions = expandAction && !stageActions.includes(expandAction) ? [...stageActions, expandAction] : stageActions;

    const cols = layout.actionColumns;
    const gap = layout.actionGap;
    const btnH = layout.actionBtnH;
    const usableW = sw - 28;
    const btnW = cols === 2 ? (usableW - gap) / 2 : usableW;
    let ay = cardH + y - y + 12;

    allActions.forEach((action, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const ax = x + 14 + col * (btnW + gap);
      const rowY = ay + row * (btnH + gap);
      const button = this.createActionButton(action, horse, ax, rowY, btnW, btnH);
      this.sidebar.add(button);
      this.actionButtonHits.push({
        action,
        horse,
        x: ax,
        y: rowY,
        width: btnW,
        height: btnH,
        container: button,
      });
    });

    const actionRows = Math.ceil(allActions.length / cols);
    return ay + actionRows * (btnH + gap);
  }

  private renderEmptyState(x: number, y: number, sw: number): number {
    const adults = this.state.horses.filter((h) => h.ageStage === 'adult').length;
    const foals = this.state.horses.filter((h) => h.ageStage === 'foal').length;
    const summary = this.add.text(x + sw / 2, y + 20, t(this.state.language, 'herdSummary', {
      count: this.state.horses.length,
      adults,
      foals,
    }), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(14),
      color: '#e8dfc0',
      align: 'center',
      wordWrap: { width: sw - 28 },
    }).setOrigin(0.5, 0);
    this.sidebar.add(summary);

    const tip = this.add.text(x + sw / 2, y + 60, t(this.state.language, 'selectHorse'), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(13),
      color: '#c8e8a8',
      align: 'center',
      wordWrap: { width: sw - 28 },
    }).setOrigin(0.5, 0);
    this.sidebar.add(tip);

    const expand = actions.find((a) => a.id === 'expandStable');
    if (expand) {
      const btnH = this.sidebarLayout.actionBtnH;
      const button = this.createActionButton(expand, undefined, x + 14, y + 100, sw - 28, btnH);
      this.sidebar.add(button);
      this.actionButtonHits.push({ action: expand, x: x + 14, y: y + 100, width: sw - 28, height: btnH });
      return y + 100 + btnH + 12;
    }
    return y + 100;
  }

  private drawSidebarClock(x: number, y: number): void {
    const barW = this.sidebarWidth - 40;
    const barH = 8;
    const progress = getDayProgress(this.state);
    const dayFraction = DAYLIGHT_MS / CYCLE_MS;

    const g = this.add.graphics();
    g.fillStyle(0x2a4a6e, 1);
    g.fillRoundedRect(x, y, barW, barH, 4);
    if (progress <= dayFraction) {
      g.fillStyle(0xf6cf72, 1);
      g.fillRoundedRect(x, y, barW * (progress / dayFraction), barH, 4);
    } else {
      g.fillStyle(0xf6cf72, 1);
      g.fillRoundedRect(x, y, barW * dayFraction, barH, 4);
      g.fillStyle(0x8899cc, 1);
      const nightProgress = (progress - dayFraction) / (1 - dayFraction);
      g.fillRoundedRect(x + barW * dayFraction, y, barW * (1 - dayFraction) * nightProgress, barH, 4);
    }
    g.setName('clockArc');
    this.sidebar.add(g);

    const phaseText = this.add.text(x, y + 12, t(this.state.language, getTimeLabel(this.state)), {
      fontFamily: 'monospace',
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#fff3c6',
    });
    phaseText.setName('clockPhase');
    this.sidebar.add(phaseText);

    const countdownText = this.add.text(x, y + 28, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#e8dfc0',
    });
    countdownText.setName('clockCountdown');
    this.sidebar.add(countdownText);

    const eventText = this.add.text(x, y + 44, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#c8e8a8',
    });
    eventText.setName('clockEvent');
    this.sidebar.add(eventText);
  }

  private createToggleButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    on: boolean,
    color: number,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, height, on ? color : 0x547546, 1).setOrigin(0);
    bg.setStrokeStyle(2, on ? 0xfff5bd : 0xbfd494);
    const text = this.add.text(width / 2, height / 2, label, {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(16),
      fontStyle: 'bold',
      color: on ? '#3c2b16' : '#fff5cb',
    }).setOrigin(0.5);
    container.add([bg, text]);
    return container;
  }

  private createSmallButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    active: boolean,
  ): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, height, active ? 0xf6cf72 : 0x547546, 1).setOrigin(0);
    bg.setStrokeStyle(2, active ? 0xfff5bd : 0xbfd494);
    const text = this.add.text(width / 2, height / 2, label, {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(13),
      fontStyle: 'bold',
      color: active ? '#3c2b16' : '#fff5cb',
    }).setOrigin(0.5);
    container.add([bg, text]);
    return container;
  }

  private createActionButton(
    action: ActionDefinition,
    horse: Horse | undefined,
    x: number,
    y: number,
    width: number,
    height: number,
  ): Phaser.GameObjects.Container {
    const disabledReason = action.canUse(this.state, horse);
    const enabled = disabledReason === null;
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, height, enabled ? 0xfff7d6 : 0xb8b1a0, 1).setOrigin(0);
    bg.setStrokeStyle(2, enabled ? 0xb47a38 : 0x8a8171);
    const icon = this.add.image(20, height / 2, action.iconKey).setScale(this.sidebarLayout.actionBtnH < 44 ? 0.75 : 0.9);
    const label = this.add.text(42, height < 44 ? 6 : 8, t(this.state.language, action.labelKey), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(13),
      fontStyle: 'bold',
      color: enabled ? '#4a2f1b' : '#6f675d',
    });
    const cost = action.getCost(this.state, horse);
    const reward = action.getReward?.(this.state, horse) ?? 0;
    const costText = reward > 0 ? `+${reward} ${t(this.state.language, 'coinsShort')}` : cost > 0 ? `-${cost} ${t(this.state.language, 'coinsShort')}` : '';
    const detail = disabledReason ? t(this.state.language, disabledReason) : `${t(this.state.language, action.benefitKey)} ${costText}`;
    const detailY = height < 44 ? 22 : 28;
    const detailText = this.add.text(42, detailY, detail.trim(), {
      fontFamily: 'monospace',
      fontSize: this.sidebarFont(10),
      color: enabled ? '#6a4a2b' : '#756e65',
    });
    detailText.setCrop(0, 0, Math.max(50, width - 48), height < 44 ? 14 : 16);
    container.add([bg, icon, label, detailText]);
    container.setAlpha(enabled ? 1 : 0.72);
    return container;
  }

  private getStatsLine(): string {
    return `${t(this.state.language, 'coins')}: ${this.state.coins}\n${t(this.state.language, 'day')}: ${this.state.day}  ·  ${t(this.state.language, 'stable')}: ${this.state.horses.length}/${this.state.stableCapacity}`;
  }

  private getHighlightNeed(horse: Horse): NeedKey | null {
    if (this.state.focusCooldownMs > 0) return null;
    if (!this.state.focus || this.state.focus.horseId !== horse.id) return null;
    switch (this.state.focus.kind) {
      case 'growFeed':
        return 'hunger';
      case 'critical':
      case 'need':
        return this.state.focus.needKey ?? null;
      case 'suggestPet':
        return 'affection';
      default:
        return null;
    }
  }

  private getRecommendedActionId(horse: Horse): ActionId | null {
    if (this.state.focusCooldownMs > 0) return null;
    if (!this.state.focus || this.state.focus.horseId !== horse.id) return null;

    const need = this.getHighlightNeed(horse);
    if (need) {
      const map: Record<NeedKey, ActionId> = {
        hunger: 'oats',
        affection: 'pet',
        cleanliness: 'bathe',
        exercise: 'walk',
      };
      return map[need];
    }
    if (this.state.focus.kind === 'retire') return 'retire';
    if (this.state.focus.kind === 'suggestLesson') return 'lesson';
    if (this.state.focus.kind === 'sleepy') return 'sleep';
    return null;
  }

  private updateNeedHighlights(time: number): void {
    const horse = this.getSelectedHorse();
    const pulse = 0.55 + 0.45 * Math.sin(time / 220);
    const highlightNeed = horse ? this.getHighlightNeed(horse) : null;
    const recommendedAction = horse ? this.getRecommendedActionId(horse) : null;

    const focusBg = this.sidebar.getByName('focusBg') as Phaser.GameObjects.Rectangle | null;
    if (focusBg) {
      if (highlightNeed || recommendedAction) {
        focusBg.setFillStyle(0xfff0a8, 0.95 + pulse * 0.04);
        focusBg.setStrokeStyle(2, pulse > 0.85 ? 0xff8844 : 0xb47a38);
      } else if (this.state.focusCooldownMs > 0) {
        focusBg.setFillStyle(0xc8e8a8, 0.95);
        focusBg.setStrokeStyle(2, 0x7ebf62);
      } else {
        focusBg.setFillStyle(0xf6cf72, 0.95);
        focusBg.setStrokeStyle(2, 0xb47a38);
      }
    }

    if (horse) {
      const labels = this.needBarLabels.get(horse.id) ?? [];
      const pulses = this.needBarPulses.get(horse.id) ?? [];
      needKeys.forEach((need, index) => {
        const active = need === highlightNeed;
        labels[index]?.setColor(active ? '#fff8c4' : '#604326');
        labels[index]?.setFontStyle(active ? 'bold' : '');
        if (pulses[index]) {
          pulses[index].setFillStyle(0xfff8c4, active ? 0.22 + pulse * 0.28 : 0);
          pulses[index].setStrokeStyle(2, 0xffd45a, active ? 0.35 + pulse * 0.45 : 0);
        }
      });
    }

    for (const hit of this.actionButtonHits) {
      if (!hit.container) continue;
      const bg = hit.container.list[0] as Phaser.GameObjects.Rectangle;
      const active = horse && hit.horse?.id === horse.id && hit.action.id === recommendedAction;
      if (active) {
        hit.container.setScale(1 + pulse * 0.03);
        bg.setFillStyle(pulse > 0.85 ? 0xfff0a8 : 0xfff7d6);
        bg.setStrokeStyle(2, 0xff8844);
      } else {
        hit.container.setScale(1);
        const disabledReason = hit.action.canUse(this.state, hit.horse);
        const enabled = disabledReason === null;
        bg.setFillStyle(enabled ? 0xfff7d6 : 0xb8b1a0);
        bg.setStrokeStyle(2, enabled ? 0xb47a38 : 0x8a8171);
      }
    }
  }

  private getFocusBannerText(): string {
    if (this.state.focusCooldownMs > 0) {
      return t(this.state.language, 'focusDone');
    }
    const key = getFocusMessageKey(this.state);
    if (!key || !this.state.focus) {
      return t(this.state.language, 'selectHorse');
    }
    const horse = this.state.horses.find((h) => h.id === this.state.focus?.horseId);
    if (!horse) return t(this.state.language, 'selectHorse');
    return t(this.state.language, key, { name: horse.name });
  }

  private updateSidebarDynamic(): void {
    const stats = this.sidebar.getByName('stats') as Phaser.GameObjects.Text | null;
    if (stats) stats.setText(this.getStatsLine());

    const focusText = this.sidebar.getByName('focusText') as Phaser.GameObjects.Text | null;
    const focusKey = `${this.state.focus?.horseId}:${this.state.focus?.kind}:${this.state.focusCooldownMs}`;
    if (focusText && focusKey !== this.lastFocusKey) {
      focusText.setText(this.getFocusBannerText());
      this.lastFocusKey = focusKey;
    }

    const clockPhase = this.sidebar.getByName('clockPhase') as Phaser.GameObjects.Text | null;
    if (clockPhase) clockPhase.setText(t(this.state.language, getTimeLabel(this.state)));

    const clockCountdown = this.sidebar.getByName('clockCountdown') as Phaser.GameObjects.Text | null;
    if (clockCountdown) {
      const remaining = isNight(this.state) ? getTimeUntilDawnMs(this.state) : getDaylightRemainingMs(this.state);
      const key = isNight(this.state) ? 'untilDawn' : 'untilNight';
      clockCountdown.setText(t(this.state.language, key, { time: formatClockMs(remaining) }));
    }

    const clockEvent = this.sidebar.getByName('clockEvent') as Phaser.GameObjects.Text | null;
    if (clockEvent) {
      const lessonRemaining = getShortestLessonRemainingMs(this.state);
      clockEvent.setText(
        lessonRemaining > 0 ? t(this.state.language, 'lessonEnds', { time: formatClockMs(lessonRemaining) }) : '',
      );
    }

    const clockArc = this.sidebar.getByName('clockArc') as Phaser.GameObjects.Graphics | null;
    if (clockArc) {
      clockArc.clear();
      const x = this.scale.width - this.sidebarWidth + 14;
      const y = this.sidebarClockY;
      const barW = this.sidebarWidth - 40;
      const barH = 8;
      const progress = getDayProgress(this.state);
      const dayFraction = DAYLIGHT_MS / CYCLE_MS;
      clockArc.fillStyle(0x2a4a6e, 1);
      clockArc.fillRoundedRect(x, y, barW, barH, 4);
      if (progress <= dayFraction) {
        clockArc.fillStyle(0xf6cf72, 1);
        clockArc.fillRoundedRect(x, y, barW * (progress / dayFraction), barH, 4);
      } else {
        clockArc.fillStyle(0xf6cf72, 1);
        clockArc.fillRoundedRect(x, y, barW * dayFraction, barH, 4);
        clockArc.fillStyle(0x8899cc, 1);
        const nightProgress = (progress - dayFraction) / (1 - dayFraction);
        clockArc.fillRoundedRect(x + barW * dayFraction, y, barW * (1 - dayFraction) * nightProgress, barH, 4);
      }
    }
  }

  private maybeRefreshSidebar(): void {
    const horse = this.getSelectedHorse();
    const snapshot = horse
      ? [
          horse.needs.hunger,
          horse.needs.affection,
          horse.needs.cleanliness,
          horse.needs.exercise,
          horse.growthMs,
          horse.lifeMs,
          horse.value,
          horse.isSleeping,
          horse.lessonRemainingMs ?? 0,
          horse.lessonsToday,
          horse.ageStage,
          isNight(this.state),
          this.state.coins,
        ].join('|')
      : `empty|${this.state.horses.length}|${this.state.coins}`;
    if (snapshot !== this.panelSnapshot) {
      this.panelSnapshot = snapshot;
      this.renderSidebarContent();
    }
  }

  private lerpNeedBars(delta: number): void {
    const horse = this.getSelectedHorse();
    if (!horse) return;
    const fills = this.needBarFills.get(horse.id);
    if (!fills) return;
    const displayed = this.displayedNeeds.get(horse.id);
    if (!displayed) return;
    const barW = this.sidebarWidth - 48;
    const lerpFactor = Math.min(1, delta / 200);
    needKeys.forEach((need, index) => {
      const target = horse.needs[need];
      displayed[need] += (target - displayed[need]) * lerpFactor;
      fills[index]?.setSize(barW * (displayed[need] / 100), 8);
    });
  }

  private createInput(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragStart = {
        pointerX: pointer.x,
        pointerY: pointer.y,
        scrollX: this.cameras.main.scrollX,
        scrollY: this.cameras.main.scrollY,
      };
      this.dragged = false;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || !this.dragStart) return;
      const dx = pointer.x - this.dragStart.pointerX;
      const dy = pointer.y - this.dragStart.pointerY;
      if (Math.abs(dx) + Math.abs(dy) > PAN_DRAG_THRESHOLD) {
        this.dragged = true;
      }
      if (this.dragged && !this.isPointerOverSidebar(pointer)) {
        this.cameras.main.scrollX = this.dragStart.scrollX - dx / this.worldZoom;
        this.cameras.main.scrollY = this.dragStart.scrollY - dy / this.worldZoom;
      }
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const wasDrag = this.dragged;
      this.dragStart = undefined;
      this.dragged = false;

      if (!this.audioUnlocked) {
        audio.unlock();
        this.audioUnlocked = true;
      }

      if (wasDrag) return;

      if (this.birthCelebration) {
        this.dismissBirthCelebration();
        return;
      }

      if (this.isPointerOverSidebar(pointer)) {
        this.handleSidebarTap(pointer);
        return;
      }

      const picked = this.pickHorseAtPointer(pointer);
      if (picked) {
        this.selectHorse(picked.id);
        return;
      }
    });
  }

  private handleSidebarTap(pointer: Phaser.Input.Pointer): void {
    if (this.hitTest(pointer, this.musicButtonHit)) {
      const nowMuted = audio.toggleMusic();
      audio.playSfx(nowMuted ? 'uiToggleOff' : 'uiToggleOn');
      this.renderSidebarContent();
      return;
    }
    if (this.hitTest(pointer, this.sfxButtonHit)) {
      const nowMuted = audio.toggleSfx();
      audio.playSfx(nowMuted ? 'uiToggleOff' : 'uiToggleOn');
      this.renderSidebarContent();
      return;
    }

    const langHit = this.languageButtonHits.find((h) => this.hitTest(pointer, h));
    if (langHit) {
      this.setLanguage(langHit.language);
      audio.playSfx('uiTap');
      return;
    }

    if (this.hitTest(pointer, this.focusBannerHit) && this.state.focus && this.state.focusCooldownMs <= 0) {
      this.selectHorse(this.state.focus.horseId);
      this.centerOnHorse(this.state.focus.horseId);
      audio.playSfx('uiSelect');
      return;
    }

    const buttonHit = this.actionButtonHits.find((h) => this.hitTest(pointer, h));
    if (buttonHit) {
      this.executePanelAction(buttonHit.action, buttonHit.horse);
    }
  }

  private hitTest(pointer: Phaser.Input.Pointer, hit?: RectHit): boolean {
    if (!hit) return false;
    return (
      pointer.x >= hit.x &&
      pointer.x <= hit.x + hit.width &&
      pointer.y >= hit.y &&
      pointer.y <= hit.y + hit.height
    );
  }

  private pickHorseAtPointer(pointer: Phaser.Input.Pointer): Horse | undefined {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    let best: Horse | undefined;
    let bestDist = Infinity;

    for (const horse of this.state.horses) {
      const scale = this.getHorseScale(horse);
      const radius = HORSE_TAP_RADIUS_ADULT * scale;
      const view = this.horseViews.get(horse.id);
      const bodyY = horse.position.y + (view?.bodyCenterY ?? -24 * scale);
      const dx = world.x - horse.position.x;
      const dy = world.y - bodyY;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        best = horse;
      }
    }
    return best;
  }

  private selectHorse(id: string): void {
    this.selectedHorseId = id;
    audio.playSfx('uiSelect');
    this.updateHorseViews(this.time.now);
    this.panelSnapshot = '';
    this.renderSidebarContent();
    this.centerOnHorse(id);
  }

  private centerOnHorse(id: string): void {
    if (this.worldZoom < 1) return;
    const horse = this.state.horses.find((h) => h.id === id);
    if (!horse) return;
    const worldW = this.getWorldViewportWidth();
    const visibleW = worldW / this.worldZoom;
    const visibleH = this.scale.height / this.worldZoom;
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: horse.position.x - visibleW / 2,
      scrollY: horse.position.y - visibleH / 2,
      duration: 600,
      ease: 'Sine.easeInOut',
    });
  }

  private updateHorseMovement(delta: number): void {
    const seconds = delta / 1000;
    for (const horse of this.state.horses) {
      if (horse.isSleeping) continue;
      const inLesson = (horse.lessonRemainingMs ?? 0) > 0;
      if (inLesson) {
        if (
          !horse.wanderTarget ||
          Phaser.Math.Distance.Between(horse.position.x, horse.position.y, horse.wanderTarget.x, horse.wanderTarget.y) > 12
        ) {
          horse.wanderTarget = { ...LESSON_RING };
        }
      } else if (
        !horse.wanderTarget ||
        Phaser.Math.Distance.Between(horse.position.x, horse.position.y, horse.wanderTarget.x, horse.wanderTarget.y) < 8
      ) {
        horse.wanderTarget = choosePaddockPoint();
      }
      const target = horse.wanderTarget;
      const angle = Phaser.Math.Angle.Between(horse.position.x, horse.position.y, target.x, target.y);
      const speed = inLesson ? 20 : horse.ageStage === 'foal' ? 38 : horse.ageStage === 'elder' ? 18 : 27;
      const step = speed * seconds;
      const distance = Phaser.Math.Distance.Between(horse.position.x, horse.position.y, target.x, target.y);
      if (distance <= step) {
        horse.position.x = target.x;
        horse.position.y = target.y;
      } else {
        horse.position.x += Math.cos(angle) * step;
        horse.position.y += Math.sin(angle) * step;
      }
    }
  }

  private updateHorseViews(time: number): void {
    for (const horse of this.state.horses) {
      const view = this.horseViews.get(horse.id);
      if (!view) continue;
      view.container.setPosition(horse.position.x, horse.position.y);
      view.container.setDepth(horse.position.y);
      const selected = horse.id === this.selectedHorseId;
      view.selection.setVisible(selected);
      if (selected) {
        view.selection.setScale(1 + Math.sin(time / 300) * 0.08);
      }
      view.sprite.setFlipX((horse.wanderTarget?.x ?? horse.position.x) < horse.position.x);
      view.sprite.setAlpha(horse.isSleeping ? 0.55 : horse.ageStage === 'elder' ? 0.88 : 1);
      view.sprite.setY(horse.ageStage === 'elder' ? Math.sin(time / 800) * 0.4 : 0);
      view.rider.setVisible((horse.lessonRemainingMs ?? 0) > 0);

      const showAlert = shouldShowAlertBubble(this.state, horse);
      view.alert.setVisible(showAlert && !horse.isSleeping);
      if (showAlert) {
        const bounceSpeed = this.state.focus?.kind === 'critical' ? 120 : 190;
        const bounceAmp = this.state.focus?.kind === 'critical' ? 7 : 5;
        const alertBaseY = view.bodyCenterY - 22 * this.getHorseScale(horse);
        view.alert.y = alertBaseY + Math.sin(time / bounceSpeed) * bounceAmp;
        this.styleAlertBubble(view, this.state.focus?.kind ?? horse.alertState);
      }

      view.nameText.setText(horse.name);
    }
  }

  private styleAlertBubble(view: HorseView, kind: string): void {
    if (kind === 'retire') {
      view.alertBack.setFillStyle(0xc8a8ff);
      view.alertText.setText('↑');
    } else if (kind === 'growFeed') {
      view.alertBack.setFillStyle(0xa8e8a8);
      view.alertText.setText('♥');
    } else if (kind === 'sleepy') {
      view.alertBack.setFillStyle(0xc8a8ff);
      view.alertText.setText('z');
    } else if (kind === 'critical') {
      view.alertBack.setFillStyle(0xff3333);
      view.alertText.setText('!');
    } else if (kind === 'suggestPet' || kind === 'suggestLesson') {
      view.alertBack.setFillStyle(0xffd4a8);
      view.alertText.setText('★');
    } else {
      view.alertBack.setFillStyle(0xfff0a8);
      view.alertText.setText('!');
    }
  }

  private updateCriticalAlerts(time: number): void {
    const currentCritical = new Set(
      this.state.horses.filter((horse) => horse.alertState === 'critical').map((horse) => horse.id),
    );
    for (const id of currentCritical) {
      if (!this.criticalHorseIds.has(id)) {
        audio.playSfx('urgentNeed');
        this.lastUrgentAt = time;
      }
    }
    if (currentCritical.size > 0 && time - this.lastUrgentAt > 8000) {
      audio.playSfx('urgentNeed');
      this.lastUrgentAt = time;
    }
    this.criticalHorseIds = currentCritical;
  }

  private showBirthCelebration(name: string, foalId: string): void {
    this.birthCelebration?.destroy();
    const sw = this.sidebarWidth;
    const width = this.scale.width;
    const height = this.scale.height;
    const worldW = this.getWorldViewportWidth();

    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(6000);
    this.uiRoot.add(overlay);

    const dim = this.add.rectangle(worldW / 2, height / 2, worldW, height, 0x000000, 0.45);
    const panel = this.add.rectangle(width - sw / 2, height / 2, sw - 20, 300, 0xf7e8bd, 0.98);
    panel.setStrokeStyle(4, 0x7e5a33);

    const foal = this.state.horses.find((horse) => horse.id === foalId);
    const foalColor = foal?.color ?? 'chestnut';
    const foalSprite = this.add.image(width - sw / 2, height / 2 - 20, `horse-${foalColor}-foal`).setScale(1.3);

    for (let i = 0; i < 12; i += 1) {
      const px = width - sw / 2 + Phaser.Math.Between(-100, 100);
      const py = height / 2 + Phaser.Math.Between(-120, 80);
      const star = this.add.circle(px, py, Phaser.Math.Between(2, 5), Phaser.Math.RND.pick([0xffd4a8, 0xa8e8a8, 0xffa8c8, 0xf6cf72]));
      overlay.add(star);
      this.tweens.add({
        targets: star,
        y: py - 40,
        alpha: 0,
        duration: Phaser.Math.Between(800, 1400),
        delay: i * 80,
        ease: 'Sine.easeOut',
      });
    }

    const title = this.add.text(width - sw / 2, height / 2 - 100, t(this.state.language, 'birthTitle'), {
      fontFamily: 'monospace',
      fontSize: '22px',
      fontStyle: 'bold',
      color: '#4f321d',
      align: 'center',
    }).setOrigin(0.5);

    const subtitle = this.add.text(width - sw / 2, height / 2 + 60, t(this.state.language, 'newFoal', { name }), {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#5c472b',
      align: 'center',
    }).setOrigin(0.5);

    const hint = this.add.text(width - sw / 2, height / 2 + 100, t(this.state.language, 'tapToContinue'), {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#8a6a42',
    }).setOrigin(0.5);

    overlay.add([dim, panel, foalSprite, title, subtitle, hint]);
    this.birthCelebration = overlay;
    audio.playSfx('celebrate');

    if (foal) {
      this.selectedHorseId = foal.id;
      this.centerOnHorse(foal.id);
      this.panelSnapshot = '';
      this.renderSidebarContent();
      this.updateHorseViews(this.time.now);
    }

    this.time.delayedCall(4000, () => {
      if (this.birthCelebration === overlay) {
        this.dismissBirthCelebration();
      }
    });
  }

  private dismissBirthCelebration(): void {
    this.birthCelebration?.destroy();
    this.birthCelebration = undefined;
  }

  private playGrowUpEffect(horseId: string): void {
    const view = this.horseViews.get(horseId);
    if (!view) return;
    this.tweens.add({
      targets: view.sprite,
      scaleX: view.sprite.scaleX * 1.3,
      scaleY: view.sprite.scaleY * 1.3,
      duration: 300,
      yoyo: true,
      ease: 'Back.easeOut',
    });
    for (let i = 0; i < 6; i += 1) {
      const spark = this.add.circle(view.container.x, view.container.y - 30, 3, 0xfff2a8);
      this.worldRoot.add(spark);
      this.tweens.add({
        targets: spark,
        x: spark.x + Phaser.Math.Between(-30, 30),
        y: spark.y - Phaser.Math.Between(20, 50),
        alpha: 0,
        duration: 600,
        delay: i * 50,
        onComplete: () => spark.destroy(),
      });
    }
    this.refreshHorseSprite(this.state.horses.find((h) => h.id === horseId)!);
  }

  private spawnFloatingCoins(text: string, x: number, y: number): void {
    const floater = this.add.text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'bold',
      color: '#fff8c4',
      stroke: '#28402a',
      strokeThickness: 4,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(5500);
    this.uiRoot.add(floater);
    this.tweens.add({
      targets: floater,
      y: y - 40,
      alpha: 0,
      duration: 1200,
      ease: 'Sine.easeOut',
      onComplete: () => floater.destroy(),
    });
  }

  private showMessage(key: string, vars: Record<string, string | number> = {}): void {
    if (!this.messageText) return;
    this.messageText.setText(t(this.state.language, key, vars));
    this.tweens.killTweensOf(this.messageText);
    this.messageText.setAlpha(1);
    this.tweens.add({
      targets: this.messageText,
      alpha: 0,
      duration: 500,
      delay: 2600,
      ease: 'Sine.easeInOut',
    });
  }

  private getSelectedHorse(): Horse | undefined {
    return this.state.horses.find((horse) => horse.id === this.selectedHorseId);
  }

  private setLanguage(language: Language): void {
    if (this.state.language === language) return;
    this.state.language = language;
    document.documentElement.lang = language;
    saveGameState(this.state);
    if (this.kidsLabel) {
      this.kidsLabel.setText(t(language, 'studentsWaiting'));
    }
    this.panelSnapshot = '';
    this.renderSidebarContent();
  }

  private executePanelAction(action: ActionDefinition, horse?: Horse): void {
    const disabledReason = action.canUse(this.state, horse);
    if (disabledReason) {
      this.showMessage(disabledReason);
      audio.playSfx('uiError');
      return;
    }
    const selectedBefore = this.selectedHorseId;
    const outcome = applyAction(this.state, action, horse);
    this.selectedHorseId = outcome.selectedHorseId ?? selectedBefore;
    if (!this.state.horses.some((candidate) => candidate.id === this.selectedHorseId)) {
      this.selectedHorseId = this.state.horses[0]?.id;
    }
    if (outcome.messageKey) {
      this.showMessage(outcome.messageKey, outcome.messageVars);
    }
    this.playActionSfx(action.id);
    if (action.id === 'lesson') this.bounceFrontKid();
    if (action.id === 'findHome' || action.id === 'retire') {
      const coins = outcome.messageVars?.coins;
      if (coins) this.spawnFloatingCoins(`+${coins}`, this.scale.width - this.sidebarWidth / 2, 140);
    }
    this.syncHorseViews();
    saveGameState(this.state);
  }

  private playActionSfx(actionId: ActionDefinition['id']): void {
    const map: Partial<Record<ActionDefinition['id'], import('./audio/types').SfxId>> = {
      oats: 'feed',
      carrots: 'feed',
      pet: 'pet',
      bathe: 'splash',
      walk: 'hoof',
      lesson: 'lesson',
      sleep: 'sleep',
      findHome: 'uiConfirm',
      retire: 'uiConfirm',
      expandStable: 'uiExpand',
    };
    audio.playSfx(map[actionId] ?? 'uiTap');
  }

  private isPointerOverSidebar(pointer: Phaser.Input.Pointer): boolean {
    return pointer.x >= this.scale.width - this.sidebarWidth;
  }

  private getWorldViewportWidth(): number {
    return this.scale.width - this.sidebarWidth;
  }

  private fitWorldCamera(): void {
    const worldW = this.getWorldViewportWidth();
    const height = this.scale.height;
    this.worldZoom = getWorldFitZoom(worldW, height);
    const cam = this.cameras.main;
    cam.setZoom(this.worldZoom);
    cam.centerOn(PADDOCK.x + PADDOCK.width / 2, PADDOCK.y + PADDOCK.height / 2 - 40);
  }

  private handleResize(): void {
    this.sidebarWidth = getSidebarWidth(this.scale.width, this.scale.height);
    const worldW = this.getWorldViewportWidth();
    const height = this.scale.height;

    this.cameras.main.setViewport(0, 0, worldW, height);
    this.uiCamera.setViewport(0, 0, this.scale.width, height);
    this.uiCamera.setSize(this.scale.width, height);

    if (this.nightOverlay) {
      this.nightOverlay.setPosition(worldW / 2, height / 2);
      this.nightOverlay.setSize(worldW, height);
    }
    this.layoutStars();
    this.fitWorldCamera();
    this.panelSnapshot = '';
    this.renderSidebarContent();
  }

  private getSafeTop(): number {
    return Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)')) || 0;
  }

  private getSafeBottom(): number {
    return Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)')) || 0;
  }

  private createGrassTile(): void {
    if (this.textures.exists('grass-tile')) return;
    const g = this.add.graphics();
    g.fillStyle(0x6fad55, 1);
    g.fillRect(0, 0, 32, 32);
    g.fillStyle(0x7bbb60, 1);
    g.fillRect(3, 4, 4, 2);
    g.fillRect(19, 9, 5, 2);
    g.fillRect(11, 23, 3, 2);
    g.fillStyle(0x5f9f4c, 1);
    g.fillRect(26, 22, 3, 3);
    g.fillRect(7, 15, 2, 3);
    g.generateTexture('grass-tile', 32, 32);
    g.destroy();
  }

  private createCloudTextures(): void {
    this.createCloudTexture('cloud-sm', 72, 36, [
      [18, 22, 14],
      [34, 18, 16],
      [52, 22, 13],
      [36, 28, 11],
    ]);
    this.createCloudTexture('cloud-md', 104, 44, [
      [24, 26, 17],
      [46, 20, 20],
      [72, 24, 18],
      [52, 32, 14],
      [34, 30, 12],
    ]);
    this.createCloudTexture('cloud-lg', 136, 52, [
      [30, 30, 20],
      [58, 24, 24],
      [92, 28, 21],
      [72, 38, 16],
      [48, 36, 15],
      [22, 34, 13],
    ]);
  }

  private createCloudTexture(
    key: string,
    width: number,
    height: number,
    puffs: [number, number, number][],
  ): void {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.95);
    for (const [cx, cy, radius] of puffs) {
      g.fillCircle(cx, cy, radius);
    }
    g.fillStyle(0xe8f4ff, 0.55);
    for (const [cx, cy, radius] of puffs) {
      g.fillCircle(cx - 2, cy - 3, radius * 0.55);
    }
    g.generateTexture(key, width, height);
    g.destroy();
  }

  private createDancingPlantTextures(): void {
    this.createDancingPlantPair('plant-flower-red', (g, lift) => {
      g.fillStyle(0x1f6b28, 1);
      g.fillRect(12, 18 + lift, 4, 12);
      g.fillStyle(0x2d9a38, 1);
      g.fillRect(8, 22 + lift, 6, 3);
      g.fillRect(14, 24 + lift, 6, 3);
      g.fillStyle(0xe62828, 1);
      g.fillCircle(14, 10 + lift, 8);
      g.fillStyle(0xffd54a, 1);
      g.fillCircle(14, 10 + lift, 4);
      g.fillStyle(0xffffff, 0.9);
      g.fillRect(10, 7 + lift, 3, 3);
    });
    this.createDancingPlantPair('plant-flower-yellow', (g, lift) => {
      g.fillStyle(0x1f6b28, 1);
      g.fillRect(12, 18 + lift, 4, 12);
      g.fillStyle(0x2d9a38, 1);
      g.fillRect(9, 21 + lift, 5, 3);
      g.fillRect(14, 23 + lift, 5, 3);
      g.fillStyle(0xf5c518, 1);
      g.fillCircle(14, 10 + lift, 8);
      g.fillStyle(0xff8a1f, 1);
      g.fillCircle(14, 10 + lift, 4);
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(11, 7 + lift, 2, 2);
    });
    this.createDancingPlantPair('plant-tuft', (g, lift) => {
      g.fillStyle(0x24752c, 1);
      g.fillRect(13, 20 + lift, 3, 8);
      g.fillStyle(0x39a842, 1);
      g.fillCircle(8, 16 + lift, 6);
      g.fillCircle(14, 13 + lift, 7);
      g.fillCircle(20, 16 + lift, 6);
      g.fillStyle(0x5fd06a, 1);
      g.fillCircle(11, 14 + lift, 3);
      g.fillCircle(17, 11 + lift, 3);
    });
    if (!this.textures.exists('plant-spin')) {
      const g = this.add.graphics();
      g.fillStyle(0x2a8a34, 1);
      g.fillRect(14, 18, 4, 10);
      g.fillStyle(0xff5a7a, 1);
      g.fillCircle(16, 10, 5);
      g.fillCircle(16, 22, 5);
      g.fillCircle(10, 16, 5);
      g.fillCircle(22, 16, 5);
      g.fillStyle(0xffeb80, 1);
      g.fillCircle(16, 16, 4);
      g.generateTexture('plant-spin', 32, 32);
      g.destroy();
    }
  }

  private createDancingPlantPair(
    key: string,
    draw: (g: Phaser.GameObjects.Graphics, lift: number) => void,
  ): void {
    for (const [suffix, lift] of [['', 0], ['-2', -3]] as const) {
      const texKey = `${key}${suffix}`;
      if (this.textures.exists(texKey)) continue;
      const g = this.add.graphics();
      draw(g, lift);
      g.generateTexture(texKey, 28, 32);
      g.destroy();
    }
  }

  private createHorseTextures(): void {
    (Object.keys(horsePalette) as HorseColor[]).forEach((color) => {
      this.createHorseTexture(color, 'adult');
      this.createHorseTexture(color, 'foal');
    });
  }

  private createHorseTexture(color: HorseColor, age: 'adult' | 'foal'): void {
    const key = `horse-${color}-${age}`;
    if (this.textures.exists(key)) return;
    const palette = horsePalette[color];
    const g = this.add.graphics();
    const s = age === 'foal' ? 0.78 : 1;
    g.fillStyle(palette.accent, color === 'paint' ? 1 : 0);
    if (color === 'paint') {
      g.fillRect(22, 20, 24, 16);
      g.fillRect(48, 28, 12, 14);
    }
    g.fillStyle(palette.body, 1);
    g.fillRect(18, 22, 42 * s, 20 * s);
    g.fillRect(52 * s, 14, 18 * s, 16 * s);
    g.fillRect(62 * s, 20, 12 * s, 14 * s);
    g.fillRect(22, 40 * s, 8 * s, 16 * s);
    g.fillRect(48 * s, 40 * s, 8 * s, 16 * s);
    g.fillStyle(palette.mane, 1);
    g.fillRect(50 * s, 12, 8 * s, 22 * s);
    g.fillRect(8, 26, 14 * s, 8 * s);
    g.fillStyle(0x1b1714, 1);
    g.fillRect(66 * s, 23, 3, 3);
    g.fillStyle(0xf0d9b5, 1);
    g.fillRect(67 * s, 30, 5, 3);
    g.generateTexture(key, 82, 64);
    g.destroy();
  }

  private createIconTextures(): void {
    this.createIcon('icon-oats', (g) => {
      g.fillStyle(0x9a6735, 1);
      g.fillRect(6, 22, 28, 8);
      g.fillStyle(0xdab26c, 1);
      g.fillCircle(13, 19, 4);
      g.fillCircle(21, 17, 4);
      g.fillCircle(28, 20, 4);
    });
    this.createIcon('icon-carrots', (g) => {
      g.fillStyle(0xf08a2d, 1);
      g.fillTriangle(14, 12, 30, 18, 18, 34);
      g.fillStyle(0x4f9a42, 1);
      g.fillRect(12, 8, 4, 9);
      g.fillRect(18, 7, 4, 10);
    });
    this.createIcon('icon-sleep', (g) => {
      g.fillStyle(0x6a5acd, 1);
      g.fillCircle(20, 18, 10);
      g.fillStyle(0xd4c4ff, 1);
      g.fillCircle(16, 16, 3);
      g.fillStyle(0xf9efcf, 1);
      g.fillRect(26, 10, 8, 3);
      g.fillRect(30, 8, 3, 6);
    });
    this.createIcon('icon-pet', (g) => {
      g.fillStyle(0xf1c18b, 1);
      g.fillRect(12, 12, 8, 22);
      g.fillRect(20, 15, 12, 8);
      g.fillRect(27, 11, 5, 6);
    });
    this.createIcon('icon-bathe', (g) => {
      g.fillStyle(0x4ea5d3, 1);
      g.fillCircle(14, 22, 7);
      g.fillCircle(27, 17, 5);
      g.fillStyle(0xa8e7f5, 1);
      g.fillCircle(16, 19, 2);
    });
    this.createIcon('icon-walk', (g) => {
      g.fillStyle(0x4b3826, 1);
      g.fillRect(11, 12, 8, 18);
      g.fillRect(18, 25, 14, 6);
      g.fillStyle(0x7dbf62, 1);
      g.fillRect(25, 9, 5, 5);
      g.fillRect(7, 32, 5, 5);
    });
    this.createIcon('icon-lesson', (g) => {
      g.fillStyle(0x7f4c2b, 1);
      g.fillRect(8, 22, 22, 10);
      g.fillRect(26, 18, 8, 14);
      g.fillStyle(0xe1b46d, 1);
      g.fillCircle(12, 14, 7);
      g.fillStyle(0xf08a2d, 1);
      g.fillRect(10, 8, 8, 6);
    });
    this.createIcon('icon-home', (g) => {
      g.fillStyle(0xc65f42, 1);
      g.fillTriangle(7, 20, 20, 8, 33, 20);
      g.fillStyle(0xf2d6a1, 1);
      g.fillRect(10, 20, 22, 15);
      g.fillStyle(0x7a4a2f, 1);
      g.fillRect(18, 25, 6, 10);
    });
    this.createIcon('icon-expand', (g) => {
      g.fillStyle(0xa06a38, 1);
      g.fillRect(8, 25, 26, 6);
      g.fillRect(18, 11, 6, 24);
      g.fillStyle(0xe5c17c, 1);
      g.fillRect(25, 9, 8, 8);
    });
  }

  private createIcon(key: string, draw: (g: Phaser.GameObjects.Graphics) => void): void {
    if (this.textures.exists(key)) return;
    const g = this.add.graphics();
    g.fillStyle(0xf9efcf, 1);
    g.fillRoundedRect(0, 0, 40, 40, 5);
    draw(g);
    g.generateTexture(key, 40, 40);
    g.destroy();
  }
}
