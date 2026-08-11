// Generates a small public-domain demo MIDI (Twinkle Twinkle Little Star) with a
// right-hand melody and a simple left-hand bass, so the app has something to load.
// Run: node scripts/makeSample.mjs
import pkg from "@tonejs/midi";
const { Midi } = pkg;
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const beat = 0.5; // seconds per quarter note (120 bpm)

// Right-hand melody: [midi, beats]
const melody = [
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
  [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
  [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
];

// Left-hand bass root per bar (each bar = 4 beats): C, F, C, G, C, G, C, F, C, G, C
const barRoots = [48, 53, 48, 55, 48, 55, 48, 53, 48, 55, 48, 43];

const midi = new Midi();
midi.name = "Twinkle Twinkle Little Star";

const right = midi.addTrack();
let t = 0;
for (const [pitch, beats] of melody) {
  right.addNote({ midi: pitch, time: t, duration: beat * beats * 0.95, velocity: 0.8 });
  t += beat * beats;
}

const left = midi.addTrack();
const totalBeats = melody.reduce((s, [, b]) => s + b, 0);
const bars = Math.ceil(totalBeats / 4);
for (let bar = 0; bar < bars; bar++) {
  const root = barRoots[bar % barRoots.length];
  // Two half-notes per bar for a gentle bass.
  left.addNote({ midi: root, time: bar * 4 * beat, duration: beat * 2 * 0.95, velocity: 0.7 });
  left.addNote({ midi: root, time: (bar * 4 + 2) * beat, duration: beat * 2 * 0.95, velocity: 0.7 });
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, "twinkle-twinkle.mid");
writeFileSync(outPath, Buffer.from(midi.toArray()));
console.log("Wrote", outPath);
