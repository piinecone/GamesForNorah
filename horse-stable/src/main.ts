import Phaser from 'phaser';
import { RanchScene } from './RanchScene';
import './styles.css';

function viewportSize(): { width: number; height: number } {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

const initial = viewportSize();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: initial.width,
  height: initial.height,
  backgroundColor: '#87ceeb',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },
  input: {
    activePointers: 3,
  },
  scene: [RanchScene],
};

const game = new Phaser.Game(config);

const refreshScale = () => {
  game.scale.refresh();
};

window.addEventListener('resize', refreshScale);
window.visualViewport?.addEventListener('resize', refreshScale);
window.visualViewport?.addEventListener('scroll', refreshScale);
