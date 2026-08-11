import type { InputSource, NoteInputHandler } from "./InputSource.ts";

/**
 * Fallback input using the computer keyboard, so the app is testable without a MIDI piano.
 * Two rows map to a chromatic span; Z / X shift the octave. Not meant to replace a real
 * keyboard — just to let us develop and demo the game logic anywhere.
 */

// Physical key -> semitone offset from the base note (C).
const KEY_OFFSETS: Record<string, number> = {
  a: 0, // C
  w: 1, // C#
  s: 2, // D
  e: 3, // D#
  d: 4, // E
  f: 5, // F
  t: 6, // F#
  g: 7, // G
  y: 8, // G#
  h: 9, // A
  u: 10, // A#
  j: 11, // B
  k: 12, // C
  o: 13, // C#
  l: 14, // D
};

export class ComputerKeyboardInput implements InputSource {
  private handler: NoteInputHandler | null = null;
  private baseMidi = 60; // C4
  private readonly held = new Set<string>();

  connect(handler: NoteInputHandler): void {
    this.handler = handler;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  disconnect(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.handler = null;
    this.held.clear();
  }

  private midiFor(key: string): number | null {
    const offset = KEY_OFFSETS[key];
    return offset === undefined ? null : this.baseMidi + offset;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();

    if (key === "z") {
      this.baseMidi = Math.max(24, this.baseMidi - 12);
      return;
    }
    if (key === "x") {
      this.baseMidi = Math.min(96, this.baseMidi + 12);
      return;
    }

    const midi = this.midiFor(key);
    if (midi === null || this.held.has(key)) return;
    this.held.add(key);
    e.preventDefault();
    this.handler?.noteOn(midi, 0.8);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    const midi = this.midiFor(key);
    if (midi === null || !this.held.has(key)) return;
    this.held.delete(key);
    this.handler?.noteOff(midi);
  };
}
