import type { Note, Song } from "../core/types.ts";
import { noteEnd } from "../core/songUtils.ts";

/**
 * Splitting a song into practiceable sections.
 *
 * We cut at natural rests — points where nothing is sounding for at least `gapSec` — so a
 * section lines up with a musical phrase rather than an arbitrary time. Very short
 * fragments are merged into their neighbour, and any section longer than `maxLenSec` is
 * divided evenly so no chunk is overwhelming. Pure and unit-tested.
 */
export interface Section {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface SectionOptions {
  /** A silence this long (seconds) starts a new section. */
  gapSec: number;
  /** Sections longer than this are split into equal pieces. */
  maxLenSec: number;
  /** Sections shorter than this are merged into a neighbour. */
  minLenSec: number;
}

export const DEFAULT_SECTION_OPTIONS: SectionOptions = {
  gapSec: 0.6,
  maxLenSec: 20,
  minLenSec: 2,
};

/** A single section spanning the whole song. */
export function fullSongSection(song: Song): Section {
  return { id: "full", name: "Full song", start: 0, end: song.durationSec };
}

export function detectSections(song: Song, options: Partial<SectionOptions> = {}): Section[] {
  const opts = { ...DEFAULT_SECTION_OPTIONS, ...options };
  const notes = [...song.notes].sort((a, b) => a.time - b.time);
  if (notes.length === 0) return [fullSongSection(song)];

  const cuts = findGapCuts(notes, opts.gapSec);
  const end = notes.reduce((m, n) => Math.max(m, noteEnd(n)), 0);

  let ranges = buildRanges(cuts, end);
  ranges = mergeShort(ranges, opts.minLenSec);
  ranges = ranges.flatMap((r) => splitLong(r, opts.maxLenSec));

  return ranges.map((r, i) => ({ id: String(i), name: `Section ${i + 1}`, start: r.start, end: r.end }));
}

interface Range {
  start: number;
  end: number;
}

/** Start times where a rest of at least `gapSec` precedes the next note. */
function findGapCuts(notes: Note[], gapSec: number): number[] {
  const cuts = [notes[0]!.time];
  let runningEnd = noteEnd(notes[0]!);
  for (let i = 1; i < notes.length; i++) {
    const note = notes[i]!;
    if (note.time - runningEnd >= gapSec) cuts.push(note.time);
    runningEnd = Math.max(runningEnd, noteEnd(note));
  }
  return cuts;
}

/** Turn cut points into contiguous [start, end) ranges. */
function buildRanges(cuts: number[], end: number): Range[] {
  const ranges: Range[] = [];
  for (let i = 0; i < cuts.length; i++) {
    ranges.push({ start: cuts[i]!, end: i + 1 < cuts.length ? cuts[i + 1]! : end });
  }
  return ranges;
}

/** Merge any range shorter than `minLen` into a neighbour. */
function mergeShort(ranges: Range[], minLen: number): Range[] {
  if (ranges.length <= 1) return ranges;
  const out: Range[] = [];
  for (const range of ranges) {
    const prev = out[out.length - 1];
    if (prev && range.end - range.start < minLen) {
      prev.end = range.end; // absorb into the previous section
    } else {
      out.push({ ...range });
    }
  }
  // If the very first section ended up too short, fold it forward.
  if (out.length > 1 && out[0]!.end - out[0]!.start < minLen) {
    out[1]!.start = out[0]!.start;
    out.shift();
  }
  return out;
}

/** Divide a range into equal pieces no longer than `maxLen`. */
function splitLong(range: Range, maxLen: number): Range[] {
  const length = range.end - range.start;
  if (length <= maxLen) return [range];
  const pieces = Math.ceil(length / maxLen);
  const step = length / pieces;
  const out: Range[] = [];
  for (let i = 0; i < pieces; i++) {
    out.push({ start: range.start + i * step, end: range.start + (i + 1) * step });
  }
  return out;
}
