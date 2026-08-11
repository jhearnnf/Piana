/**
 * Pure geometry for the falling note bars.
 *
 * The hard case is the same note played twice in a row. Most MIDI files write those
 * legato — the second onset lands on, or within milliseconds of, the first note's end —
 * so drawn honestly the two bars touch and read as one long note. By the time the join
 * reaches the hit line it is off the bottom of the screen, and the player has no way to
 * see that they were meant to lift and strike again.
 *
 * The fix is to hold a fixed pixel gap open below every repeat, taken out of the tail of
 * the note before it. Pixels rather than seconds: the gap has to stay equally readable
 * whether the look-ahead is 2 seconds or 6, and the tail is the end of a note already
 * struck, so shortening it costs the player nothing.
 *
 * No canvas or DOM here — it's fully unit-tested.
 */

/** Just the fields these helpers need, so tests can build notes inline. */
interface Onset {
  midi: number;
  time: number;
}

/**
 * For each note, the start time of the next note at the same pitch — `Infinity` if that
 * pitch never comes back.
 *
 * `notes` must be sorted ascending by time, as `Song.notes` always is. Computed once per
 * song rather than searched per frame; every falling note needs its answer 60 times a
 * second.
 *
 * `Infinity` rather than `null` so the caller can map it through the same time-to-pixel
 * conversion as any other onset: it lands infinitely far up the screen, which is exactly
 * how a note with no repeat should behave.
 */
export function nextRepeatStarts(notes: readonly Onset[]): number[] {
  const starts = new Array<number>(notes.length);
  const nextByMidi = new Map<number, number>();
  for (let i = notes.length - 1; i >= 0; i--) {
    const note = notes[i]!;
    starts[i] = nextByMidi.get(note.midi) ?? Infinity;
    nextByMidi.set(note.midi, note.time);
  }
  return starts;
}

/**
 * The y a note's bar should stop at, given where the next strike of the same pitch is.
 *
 * Notes fall head-down: `yBottom` is the onset and `yTop` its end, higher up the screen.
 * `nextRepeatY` is where the next strike of this pitch has its head (`-Infinity` when
 * there is none, which falls out of {@link nextRepeatStarts} for free).
 *
 * A bar is only ever shortened, never stretched, and never past `minHeightPx` — a
 * run of fast repeated notes ends up with small gaps rather than with bars that have
 * been trimmed out of existence.
 */
export function noteBarTop(
  yTop: number,
  yBottom: number,
  nextRepeatY: number,
  gapPx: number,
  minHeightPx: number,
): number {
  const clearOfNext = nextRepeatY + gapPx;
  if (clearOfNext <= yTop) return yTop; // the file already leaves room
  return Math.max(yTop, Math.min(clearOfNext, yBottom - minHeightPx));
}
