import type { Note } from "../core/types.ts";
import { pitchRange } from "../core/songUtils.ts";

/**
 * Choosing which slice of the keyboard is on screen.
 *
 * The user asked to control how many keys are visible (a zoom that cuts off unused ends).
 * "Auto" fits the song's used range snapped to whole octaves; a number zooms to that many
 * octaves centred on the music; "full" shows the whole 88-key piano. Pure and unit-tested.
 */

/** Lowest / highest MIDI notes on a standard 88-key piano (A0 .. C8). */
export const PIANO_LOW = 21;
export const PIANO_HIGH = 108;

/** "auto" fits the song, "full" shows 88 keys, a number = octaves to show. */
export type Zoom = "auto" | "full" | number;

/** Fallback range used when a song has no notes (C3..B5). */
const FALLBACK: [number, number] = [48, 83];

/** Round a MIDI note down to the C at or below it. */
function floorToC(midi: number): number {
  return Math.floor(midi / 12) * 12;
}

/** Snap a used range outward so it begins and ends on octave (C) boundaries. */
export function autoRange(used: [number, number] | null): [number, number] {
  if (!used) return FALLBACK;
  const low = clamp(floorToC(used[0]), PIANO_LOW, PIANO_HIGH);
  const high = clamp(floorToC(used[1] + 12) - 1, low, PIANO_HIGH);
  return [low, high];
}

/**
 * Resolve a zoom setting to a concrete [low, high] MIDI range for the given notes.
 * Number zooms are centred on the used range and clamped onto the real keyboard.
 */
export function visibleRange(notes: readonly Note[], zoom: Zoom): [number, number] {
  const used = pitchRange(notes);

  if (zoom === "full") return [PIANO_LOW, PIANO_HIGH];
  if (zoom === "auto") return autoRange(used);

  const octaves = Math.max(1, Math.round(zoom));
  const span = octaves * 12;
  const center = used ? Math.round((used[0] + used[1]) / 2) : 60;

  let low = floorToC(center - span / 2);
  let high = low + span - 1;

  // Slide the window back onto the piano if it runs off either end.
  if (low < PIANO_LOW) {
    low = PIANO_LOW;
    high = Math.min(PIANO_HIGH, low + span - 1);
  }
  if (high > PIANO_HIGH) {
    high = PIANO_HIGH;
    low = Math.max(PIANO_LOW, high - span + 1);
  }
  return [low, high];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
