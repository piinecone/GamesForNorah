import Phaser from 'phaser';
import { bindChipSfxContext, playChipSfx, setChipSfxMuted } from './chipSfx';
import { MUSIC_PLAYLIST } from './playlist.generated';
import type { SfxId } from './types';

const MUSIC_MUTE_KEY = 'horse-stable:musicMuted';
const SFX_MUTE_KEY = 'horse-stable:sfxMuted';
const BGM_DAY_VOLUME = 0.45;
const BGM_NIGHT_VOLUME = 0.22;

class AudioManager {
  private scene?: Phaser.Scene;
  private bgm?: Phaser.Sound.WebAudioSound;
  private playlist: readonly string[] = MUSIC_PLAYLIST;
  private trackIndex = 0;
  private musicMuted = false;
  private sfxMuted = false;
  private unlocked = false;
  private nightMode = false;
  private loadingTrack = false;

  init(scene: Phaser.Scene): void {
    this.scene = scene;
    const legacyMuted = localStorage.getItem('horse-stable:audioMuted') === 'true';
    this.musicMuted =
      localStorage.getItem(MUSIC_MUTE_KEY) === 'true' ||
      (legacyMuted && localStorage.getItem(MUSIC_MUTE_KEY) === null);
    this.sfxMuted =
      localStorage.getItem(SFX_MUTE_KEY) === 'true' ||
      (legacyMuted && localStorage.getItem(SFX_MUTE_KEY) === null);
    setChipSfxMuted(this.sfxMuted);
  }

  unlock(): void {
    if (!this.scene) return;
    bindChipSfxContext(this.scene);
    if (this.unlocked) return;
    this.unlocked = true;
    this.startBgm();
  }

  isMusicMuted(): boolean {
    return this.musicMuted;
  }

  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicMuted = !enabled;
    localStorage.setItem(MUSIC_MUTE_KEY, String(this.musicMuted));
    if (this.bgm) {
      if (this.musicMuted) {
        this.bgm.pause();
      } else {
        this.bgm.setVolume(this.nightMode ? BGM_NIGHT_VOLUME : BGM_DAY_VOLUME);
        if (!this.bgm.isPlaying) {
          this.bgm.play();
        }
      }
    } else if (!this.musicMuted && this.unlocked) {
      this.startBgm();
    }
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxMuted = !enabled;
    localStorage.setItem(SFX_MUTE_KEY, String(this.sfxMuted));
    setChipSfxMuted(this.sfxMuted);
  }

  toggleMusic(): boolean {
    this.setMusicEnabled(this.musicMuted);
    return this.musicMuted;
  }

  toggleSfx(): boolean {
    this.setSfxEnabled(this.sfxMuted);
    return this.sfxMuted;
  }

  setNightMode(isNight: boolean): void {
    if (this.nightMode === isNight || !this.bgm || this.musicMuted) {
      this.nightMode = isNight;
      return;
    }
    this.nightMode = isNight;
    const target = isNight ? BGM_NIGHT_VOLUME : BGM_DAY_VOLUME;
    this.scene?.tweens.add({
      targets: this.bgm,
      volume: target,
      duration: 1500,
      ease: 'Sine.easeInOut',
    });
  }

  playSfx(id: SfxId): void {
    if (this.sfxMuted) return;
    if (this.scene) {
      bindChipSfxContext(this.scene);
    }
    playChipSfx(id);
  }

  private trackKey(index: number): string {
    return `bgm-${index}`;
  }

  private startBgm(): void {
    if (!this.scene || this.musicMuted || this.playlist.length === 0) return;
    if (this.bgm?.isPlaying) return;
    this.trackIndex = 0;
    this.playTrack(this.trackIndex);
  }

  private playTrack(index: number): void {
    if (!this.scene || this.musicMuted || this.playlist.length === 0) return;

    const key = this.trackKey(index);
    if (this.scene.cache.audio.exists(key)) {
      this.startPlayingKey(key);
      this.prefetchTrack((index + 1) % this.playlist.length);
      return;
    }

    if (this.loadingTrack) return;
    this.loadingTrack = true;
    this.scene.load.audio(key, this.playlist[index]);
    this.scene.load.once(`filecomplete-audio-${key}`, () => {
      this.loadingTrack = false;
      if (!this.musicMuted) {
        this.startPlayingKey(key);
        this.prefetchTrack((index + 1) % this.playlist.length);
      }
    });
    this.scene.load.once('loaderror', () => {
      this.loadingTrack = false;
      if (this.playlist.length > 1) {
        this.trackIndex = (index + 1) % this.playlist.length;
        this.playTrack(this.trackIndex);
      }
    });
    this.scene.load.start();
  }

  private startPlayingKey(key: string): void {
    if (!this.scene || this.musicMuted) return;

    if (this.bgm) {
      this.bgm.stop();
      this.bgm.destroy();
      this.bgm = undefined;
    }

    this.bgm = this.scene.sound.add(key, {
      loop: false,
      volume: this.nightMode ? BGM_NIGHT_VOLUME : BGM_DAY_VOLUME,
    }) as Phaser.Sound.WebAudioSound;

    this.bgm.once('complete', () => {
      this.playNextTrack();
    });

    this.bgm.play();
  }

  private playNextTrack(): void {
    if (!this.scene || this.musicMuted || this.playlist.length === 0) return;
    this.trackIndex = (this.trackIndex + 1) % this.playlist.length;
    this.playTrack(this.trackIndex);
  }

  private prefetchTrack(index: number): void {
    if (!this.scene || this.playlist.length <= 1) return;
    const key = this.trackKey(index);
    if (this.scene.cache.audio.exists(key)) return;
    this.scene.load.audio(key, this.playlist[index]);
    this.scene.load.start();
  }
}

export const audio = new AudioManager();
