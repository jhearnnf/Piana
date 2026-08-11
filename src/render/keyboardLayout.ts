/**
 * Pure geometry for a piano keyboard.
 *
 * Given a visible MIDI range and a pixel width, this computes the rectangle for every key.
 * It's used both to draw the keyboard and to position falling notes, so the two can never
 * drift out of alignment. No canvas or DOM here — it's fully unit-tested.
 */

/** Pitch classes of white keys within an octave (C D E F G A B). */
const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

/** A black key's width relative to a white key. */
export const BLACK_KEY_WIDTH_RATIO = 0.62;
/** A black key's height relative to the keyboard height. */
export const BLACK_KEY_HEIGHT_RATIO = 0.62;

export interface KeyRect {
  midi: number;
  /** Left edge in pixels. */
  x: number;
  /** Width in pixels. */
  width: number;
  isBlack: boolean;
}

export function isBlackKey(midi: number): boolean {
  return !WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

/** Count white keys in the half-open MIDI range [low, highExclusive). */
export function countWhiteKeys(low: number, highExclusive: number): number {
  let count = 0;
  for (let m = low; m < highExclusive; m++) {
    if (!isBlackKey(m)) count++;
  }
  return count;
}

/**
 * Compute key rectangles for the inclusive MIDI range [lowMidi, highMidi] laid out across
 * `totalWidth` pixels. White keys tile the width evenly; black keys are centred on the
 * boundary between their neighbouring white keys and sit on top.
 */
export function computeKeyboard(
  lowMidi: number,
  highMidi: number,
  totalWidth: number,
): KeyRect[] {
  const whiteCount = countWhiteKeys(lowMidi, highMidi + 1);
  if (whiteCount === 0) return [];

  const whiteWidth = totalWidth / whiteCount;
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO;

  const keys: KeyRect[] = [];
  for (let m = lowMidi; m <= highMidi; m++) {
    const whitesBelow = countWhiteKeys(lowMidi, m);
    if (isBlackKey(m)) {
      // Centre on the boundary between the white key to the left and the next one.
      keys.push({
        midi: m,
        x: whitesBelow * whiteWidth - blackWidth / 2,
        width: blackWidth,
        isBlack: true,
      });
    } else {
      keys.push({ midi: m, x: whitesBelow * whiteWidth, width: whiteWidth, isBlack: false });
    }
  }
  return keys;
}

/** Nearest white key at or below `midi`. */
export function whiteKeyAtOrBelow(midi: number): number {
  let m = midi;
  while (isBlackKey(m)) m--;
  return m;
}

/** Nearest white key at or above `midi`. */
export function whiteKeyAtOrAbove(midi: number): number {
  let m = midi;
  while (isBlackKey(m)) m++;
  return m;
}
