/**
 * The arithmetic behind scrolling the track.
 *
 * The stage is a picture of time: a fixed number of seconds of music spread over the
 * height of the fall area. So a scroll is measured in pixels of that picture and turned
 * into seconds at the very scale the notes are drawn at — move the track a centimetre and
 * the music moves a centimetre. Pure, so the feel can be tested without a mouse.
 */

/** `WheelEvent.deltaMode` values. The spec gives them as numbers, not as names. */
export const WHEEL_PIXEL = 0;
export const WHEEL_LINE = 1;
export const WHEEL_PAGE = 2;

/**
 * Pixels one line of a `deltaMode: line` wheel stands for.
 *
 * Firefox reports lines rather than pixels, and only the page can say what a line is
 * worth. 16 is the browsers' own default line height, which is what the number is for.
 */
const LINE_PIXELS = 16;

/** A wheel event's delta in pixels, whatever unit the browser chose to report it in. */
export function wheelPixels(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (deltaMode === WHEEL_PAGE) return deltaY * pageHeight;
  if (deltaMode === WHEEL_LINE) return deltaY * LINE_PIXELS;
  return deltaY;
}

/**
 * A moment held inside the song.
 *
 * Scrolling past the last bar should stop at the last bar rather than carry on into empty
 * time you then have to scroll back out of, and a click on the very edge of the timeline
 * should land on the end of the piece rather than just after it.
 */
export function clampToSong(seconds: number, durationSec: number): number {
  return Math.min(Math.max(0, durationSec), Math.max(0, seconds));
}
