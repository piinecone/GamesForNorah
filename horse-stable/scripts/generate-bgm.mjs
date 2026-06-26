/**
 * Generates bgm-meadow.wav — delicate meadow chiptune.
 * Soft waltz chords + low, staccato layered touches (no shrill lead).
 *
 * Run: node scripts/generate-bgm.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'audio');
mkdirSync(outDir, { recursive: true });

const SAMPLE_RATE = 44100;
const BPM = 76;
const BEAT_SEC = 60 / BPM;

function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

/** G major / D major — soft add6 color (unchanged; these sit well) */
const CHORDS = [
  { bass: 43, tones: [67, 71, 74, 76] },
  { bass: 38, tones: [62, 66, 69, 71] },
];

/**
 * Delicate staccato touches — chord tones, mid-low register (no octave shift).
 * [midiNote, startBeat, durationBeats] — durations kept short (light taps).
 */
const TOUCHES = [
  // bar 1–2 G: gentle D–G–B arpeggio taps
  [62, 0.5, 0.28], [67, 0.85, 0.22], [71, 1.15, 0.25],
  [74, 2.0, 0.3], [71, 2.45, 0.22], [67, 2.8, 0.28],
  [62, 3.5, 0.25], [67, 3.85, 0.22], [71, 4.15, 0.28],
  [74, 5.0, 0.3], [76, 5.4, 0.22],
  // bar 3–4 D
  [62, 6.0, 0.28], [66, 6.35, 0.22], [69, 6.7, 0.25],
  [71, 7.5, 0.3], [69, 7.9, 0.22], [66, 8.25, 0.28],
  [62, 9.0, 0.25], [66, 9.35, 0.22], [69, 9.7, 0.28],
  [71, 10.5, 0.3], [69, 10.9, 0.22],
  // bar 5–6 G — slightly fuller but still short
  [67, 12.0, 0.28], [71, 12.35, 0.22], [74, 12.7, 0.25],
  [76, 13.5, 0.3], [74, 13.9, 0.22], [71, 14.25, 0.28],
  [67, 15.0, 0.25], [71, 15.35, 0.22], [74, 15.7, 0.28],
  [76, 16.5, 0.3], [74, 16.9, 0.22], [71, 17.25, 0.25],
  // bar 7–8 D
  [62, 18.0, 0.28], [66, 18.35, 0.22], [69, 18.7, 0.25],
  [71, 19.5, 0.3], [69, 19.9, 0.22],
  [62, 20.5, 0.25], [66, 20.85, 0.22], [69, 21.2, 0.28],
  [71, 22.0, 0.3], [66, 22.4, 0.22], [62, 22.75, 0.28],
  // bar 9–10 G — closing phrase, sparse
  [67, 24.0, 0.28], [74, 24.4, 0.22], [71, 24.75, 0.25],
  [67, 25.5, 0.3], [71, 25.9, 0.22],
  [74, 26.5, 0.28], [76, 26.85, 0.22], [74, 27.2, 0.25],
  [71, 28.0, 0.3], [67, 28.4, 0.22], [62, 28.75, 0.28],
  // bar 11–12 D → G turnaround
  [62, 30.0, 0.28], [69, 30.35, 0.22], [66, 30.7, 0.25],
  [62, 31.5, 0.3], [66, 31.9, 0.22],
  [67, 32.5, 0.28], [71, 32.85, 0.22], [74, 33.2, 0.25],
  [71, 34.0, 0.3], [67, 34.4, 0.22], [62, 34.75, 0.28],
  // bar 13–14 G
  [67, 36.0, 0.28], [71, 36.35, 0.22], [74, 36.7, 0.25],
  [76, 37.5, 0.3], [74, 37.9, 0.22], [71, 38.25, 0.28],
  [67, 39.0, 0.25], [71, 39.35, 0.22], [74, 39.7, 0.28],
  [71, 40.5, 0.3], [67, 40.9, 0.22],
  // bar 15–16 D
  [62, 42.0, 0.28], [66, 42.35, 0.22], [69, 42.7, 0.25],
  [71, 43.5, 0.3], [69, 43.9, 0.22],
  [62, 44.5, 0.25], [66, 44.85, 0.22], [69, 45.2, 0.28],
  [71, 46.0, 0.3], [66, 46.4, 0.22], [62, 46.75, 0.28],
  // bar 17–18 G — loop tail
  [67, 48.0, 0.28], [74, 48.4, 0.22], [71, 48.75, 0.25],
  [67, 49.5, 0.3], [71, 49.9, 0.22],
  [74, 50.5, 0.28], [76, 50.85, 0.22], [74, 51.2, 0.25],
  [71, 52.0, 0.3], [67, 52.4, 0.22], [62, 52.75, 0.28],
];

const TOTAL_BEATS = 54;
const DURATION_SEC = TOTAL_BEATS * BEAT_SEC;
const SAMPLE_COUNT = Math.floor(SAMPLE_RATE * DURATION_SEC);

function triangle(phase) {
  const x = phase % 1;
  return x < 0.5 ? 4 * x - 1 : 3 - 4 * x;
}

function sine(phase) {
  return Math.sin(phase * Math.PI * 2);
}

/** Fast staccato envelope — light touch, no sustain */
function touchEnvelope(progress) {
  const attack = 0.08;
  const release = 0.55;
  if (progress < attack) return progress / attack;
  if (progress > 1 - release) return Math.max(0, (1 - progress) / release);
  return 0.35;
}

/** Chord pads — slightly longer envelope */
function padEnvelope(progress, attack = 0.06, release = 0.4) {
  if (progress < attack) return progress / attack;
  if (progress > 1 - release) return Math.max(0, (1 - progress) / release);
  return 1;
}

const pcm = new Float32Array(SAMPLE_COUNT);

function addSample(index, value) {
  if (index >= 0 && index < SAMPLE_COUNT) {
    pcm[index] += value;
  }
}

/** Three soft sine layers: root, fifth below, octave below — very quiet */
function addDelicateTouch(midi, startBeat, durBeats) {
  const layers = [
    { midi, gain: 0.022, wave: sine },
    { midi: midi - 7, gain: 0.014, wave: sine },
    { midi: midi - 12, gain: 0.011, wave: sine },
  ];

  const start = Math.floor(startBeat * BEAT_SEC * SAMPLE_RATE);
  const len = Math.max(1, Math.floor(durBeats * BEAT_SEC * SAMPLE_RATE));

  for (const layer of layers) {
    if (layer.midi < 48) continue;
    const hz = midiToHz(layer.midi);
    for (let i = 0; i < len; i += 1) {
      const progress = i / len;
      const env = touchEnvelope(progress);
      const t = i / SAMPLE_RATE;
      addSample(start + i, layer.wave(t * hz) * layer.gain * env);
    }
  }
}

const totalBars = Math.ceil(TOTAL_BEATS / 3);
for (let bar = 0; bar < totalBars; bar += 1) {
  const barStart = bar * 3;
  const chord = CHORDS[bar % 2];
  const bassHz = midiToHz(chord.bass);

  const b1Start = Math.floor(barStart * BEAT_SEC * SAMPLE_RATE);
  const b1Len = Math.floor(BEAT_SEC * SAMPLE_RATE);
  for (let i = 0; i < b1Len; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = padEnvelope(i / b1Len, 0.02, 0.35);
    addSample(b1Start + i, sine(t * bassHz) * 0.06 * env);
  }

  for (const beatOffset of [1, 2]) {
    const start = Math.floor((barStart + beatOffset) * BEAT_SEC * SAMPLE_RATE);
    const len = Math.floor(BEAT_SEC * SAMPLE_RATE * 0.95);
    for (let i = 0; i < len; i += 1) {
      const t = i / SAMPLE_RATE;
      const env = padEnvelope(i / len, 0.06, 0.4);
      let mix = 0;
      for (const tone of chord.tones) {
        mix += triangle(t * midiToHz(tone)) * 0.012;
      }
      addSample(start + i, mix * env);
    }
  }
}

for (const [midi, startBeat, durBeats] of TOUCHES) {
  addDelicateTouch(midi, startBeat, durBeats);
}

const fadeSamples = Math.floor(0.45 * SAMPLE_RATE);
for (let i = 0; i < fadeSamples; i += 1) {
  const fadeOut = i / fadeSamples;
  const fadeIn = 1 - fadeOut;
  pcm[i] *= fadeIn + 0.02;
  pcm[SAMPLE_COUNT - fadeSamples + i] *= fadeOut + 0.02;
}

let peak = 0;
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  peak = Math.max(peak, Math.abs(pcm[i]));
}
const gain = peak > 0 ? 0.92 / peak : 1;
for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  pcm[i] *= gain;
}

const wavBuffer = Buffer.alloc(44 + SAMPLE_COUNT * 2);
wavBuffer.write('RIFF', 0);
wavBuffer.writeUInt32LE(36 + SAMPLE_COUNT * 2, 4);
wavBuffer.write('WAVE', 8);
wavBuffer.write('fmt ', 12);
wavBuffer.writeUInt32LE(16, 16);
wavBuffer.writeUInt16LE(1, 20);
wavBuffer.writeUInt16LE(1, 22);
wavBuffer.writeUInt32LE(SAMPLE_RATE, 24);
wavBuffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
wavBuffer.writeUInt16LE(2, 32);
wavBuffer.writeUInt16LE(16, 34);
wavBuffer.write('data', 36);
wavBuffer.writeUInt32LE(SAMPLE_COUNT * 2, 40);

for (let i = 0; i < SAMPLE_COUNT; i += 1) {
  wavBuffer.writeInt16LE(Math.floor(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
}

writeFileSync(join(outDir, 'bgm-meadow.wav'), wavBuffer);
console.log(`Wrote ${join(outDir, 'bgm-meadow.wav')}`);
console.log(`  Delicate meadow chiptune · ${BPM} BPM · ${DURATION_SEC.toFixed(1)}s loop · ${SAMPLE_RATE} Hz`);
