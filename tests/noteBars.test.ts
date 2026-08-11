import { describe, it, expect } from "vitest";
import { nextRepeatStarts, noteBarTop } from "../src/render/noteBars.ts";

const note = (midi: number, time: number) => ({ midi, time });

describe("nextRepeatStarts", () => {
  it("points each note at the next strike of its own pitch", () => {
    const notes = [note(60, 0), note(64, 0.5), note(60, 1), note(60, 2)];
    expect(nextRepeatStarts(notes)).toEqual([1, Infinity, 2, Infinity]);
  });

  it("ignores other pitches in between", () => {
    // The bar for the low C is only ever crowded by another low C; everything else is
    // drawn in a different column.
    const notes = [note(48, 0), note(50, 0.1), note(52, 0.2), note(48, 0.3)];
    expect(nextRepeatStarts(notes)[0]).toBe(0.3);
  });

  it("gives a note with no repeat an onset infinitely far away", () => {
    // Infinity, not null, so the renderer can map it through the same time-to-pixel
    // conversion as any real onset and get "off the top of the screen".
    expect(nextRepeatStarts([note(60, 0)])).toEqual([Infinity]);
  });

  it("handles an empty song", () => {
    expect(nextRepeatStarts([])).toEqual([]);
  });
});

describe("noteBarTop", () => {
  // Notes fall head-down: y=200 is the onset, y=100 the end, and a repeat's head is
  // higher still.
  it("leaves a bar alone when the pitch never comes back", () => {
    expect(noteBarTop(100, 200, -Infinity, 14, 5)).toBe(100);
  });

  it("leaves a bar alone when the file already writes a gap", () => {
    expect(noteBarTop(100, 200, 60, 14, 5)).toBe(100); // 40px of daylight already
  });

  it("trims the tail when a repeat follows legato", () => {
    // Written end-to-end: the two bars would touch and read as one held note.
    expect(noteBarTop(100, 200, 100, 14, 5)).toBe(114);
  });

  it("never trims a bar shorter than the minimum", () => {
    // Fast repeated notes: the gap gives way rather than the note vanishing.
    expect(noteBarTop(190, 200, 190, 14, 5)).toBe(195);
  });

  it("never stretches a bar that is already shorter than the minimum", () => {
    expect(noteBarTop(197, 200, 197, 14, 5)).toBe(197);
  });
});
