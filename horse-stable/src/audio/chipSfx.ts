import type Phaser from 'phaser';
import type { SfxId } from './types';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

interface ToneStep {
  freq: number;
  duration: number;
  wave?: OscillatorType;
  gain?: number;
}

interface SfxPreset {
  steps: ToneStep[];
  noise?: { duration: number; gain: number };
}

const presets: Record<SfxId, SfxPreset> = {
  uiTap: {
    steps: [
      { freq: 660, duration: 0.05, wave: 'triangle', gain: 0.035 },
      { freq: 880, duration: 0.04, wave: 'triangle', gain: 0.03 },
    ],
  },
  uiClose: {
    steps: [
      { freq: 740, duration: 0.06, wave: 'triangle', gain: 0.03 },
      { freq: 520, duration: 0.05, wave: 'triangle', gain: 0.025 },
    ],
  },
  uiError: {
    steps: [{ freq: 220, duration: 0.1, wave: 'triangle', gain: 0.04 }],
  },
  uiSelect: {
    steps: [
      { freq: 784, duration: 0.06, wave: 'triangle', gain: 0.04 },
      { freq: 988, duration: 0.08, wave: 'triangle', gain: 0.035 },
    ],
  },
  uiToggleOn: {
    steps: [
      { freq: 660, duration: 0.05, wave: 'triangle', gain: 0.035 },
      { freq: 880, duration: 0.06, wave: 'triangle', gain: 0.04 },
    ],
  },
  uiToggleOff: {
    steps: [
      { freq: 880, duration: 0.05, wave: 'triangle', gain: 0.035 },
      { freq: 660, duration: 0.06, wave: 'triangle', gain: 0.03 },
    ],
  },
  uiConfirm: {
    steps: [
      { freq: 784, duration: 0.06, wave: 'triangle', gain: 0.04 },
      { freq: 988, duration: 0.07, wave: 'triangle', gain: 0.04 },
      { freq: 1175, duration: 0.1, wave: 'triangle', gain: 0.035 },
    ],
  },
  uiExpand: {
    steps: [
      { freq: 523, duration: 0.07, wave: 'triangle', gain: 0.04 },
      { freq: 659, duration: 0.07, wave: 'triangle', gain: 0.04 },
      { freq: 784, duration: 0.1, wave: 'triangle', gain: 0.04 },
    ],
  },
  feed: {
    steps: [{ freq: 440, duration: 0.04, wave: 'triangle', gain: 0.03 }],
    noise: { duration: 0.06, gain: 0.03 },
  },
  pet: {
    steps: [
      { freq: 660, duration: 0.08, wave: 'triangle', gain: 0.04 },
      { freq: 880, duration: 0.1, wave: 'triangle', gain: 0.04 },
    ],
  },
  splash: {
    steps: [
      { freq: 660, duration: 0.05, wave: 'triangle', gain: 0.03 },
      { freq: 440, duration: 0.1, wave: 'triangle', gain: 0.04 },
    ],
    noise: { duration: 0.08, gain: 0.04 },
  },
  hoof: {
    steps: [
      { freq: 180, duration: 0.04, wave: 'triangle', gain: 0.04 },
      { freq: 160, duration: 0.04, wave: 'triangle', gain: 0.035 },
      { freq: 170, duration: 0.04, wave: 'triangle', gain: 0.035 },
    ],
  },
  lesson: {
    steps: [
      { freq: 660, duration: 0.08, wave: 'triangle', gain: 0.04 },
      { freq: 784, duration: 0.08, wave: 'triangle', gain: 0.04 },
      { freq: 988, duration: 0.1, wave: 'triangle', gain: 0.04 },
    ],
  },
  coin: {
    steps: [
      { freq: 988, duration: 0.06, wave: 'triangle', gain: 0.04 },
      { freq: 1318, duration: 0.12, wave: 'triangle', gain: 0.035 },
    ],
  },
  sleep: {
    steps: [
      { freq: 440, duration: 0.15, wave: 'triangle', gain: 0.03 },
      { freq: 330, duration: 0.2, wave: 'triangle', gain: 0.025 },
    ],
  },
  night: {
    steps: [
      { freq: 440, duration: 0.18, wave: 'triangle', gain: 0.03 },
      { freq: 370, duration: 0.22, wave: 'triangle', gain: 0.025 },
    ],
  },
  morning: {
    steps: [
      { freq: 660, duration: 0.1, wave: 'triangle', gain: 0.04 },
      { freq: 880, duration: 0.12, wave: 'triangle', gain: 0.04 },
      { freq: 1046, duration: 0.14, wave: 'triangle', gain: 0.035 },
    ],
  },
  celebrate: {
    steps: [
      { freq: 784, duration: 0.1, wave: 'triangle', gain: 0.05 },
      { freq: 988, duration: 0.1, wave: 'triangle', gain: 0.05 },
      { freq: 1175, duration: 0.1, wave: 'triangle', gain: 0.05 },
      { freq: 1318, duration: 0.16, wave: 'triangle', gain: 0.04 },
    ],
  },
  urgentNeed: {
    steps: [
      { freq: 880, duration: 0.08, wave: 'triangle', gain: 0.05 },
      { freq: 740, duration: 0.08, wave: 'triangle', gain: 0.05 },
      { freq: 880, duration: 0.08, wave: 'triangle', gain: 0.05 },
    ],
  },
};

let muted = false;
let context: AudioContext | undefined;

export function setChipSfxMuted(value: boolean): void {
  muted = value;
}

export function bindChipSfxContext(scene: Phaser.Scene): AudioContext | undefined {
  const manager = scene.sound as Phaser.Sound.WebAudioSoundManager;
  if ('context' in manager && manager.context) {
    context = manager.context as AudioContext;
    return context;
  }

  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return undefined;
  context ??= new AudioContextClass();
  return context;
}

export function playChipSfx(id: SfxId): void {
  if (muted || !context) return;
  if (context.state === 'suspended') {
    void context.resume();
  }

  const preset = presets[id];
  let offset = context.currentTime;

  if (preset.noise) {
    playNoise(context, offset, preset.noise.duration, preset.noise.gain);
    offset += preset.noise.duration * 0.5;
  }

  for (const step of preset.steps) {
    playTone(context, offset, step.freq, step.duration, step.wave ?? 'triangle', step.gain ?? 0.04);
    offset += step.duration * 0.85;
  }
}

function playTone(
  ctx: AudioContext,
  start: number,
  freq: number,
  duration: number,
  wave: OscillatorType,
  peakGain: number,
): void {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playNoise(ctx: AudioContext, start: number, duration: number, peakGain: number): void {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(gain);
  gain.connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}
