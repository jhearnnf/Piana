import type { Zoom } from "../render/visibleRange.ts";

/**
 * Settings that outlive a session.
 *
 * The keyboard zoom, the mute switch and wait mode, and not the rest. Difficulty, hand and
 * section are choices about *this* song, but "show me all 88 keys", "don't make noise" and
 * "hold until I play the note" are statements about how you like to use the app, and
 * re-making them on every launch is the whole annoyance.
 */

const ZOOM_KEY = "piana:zoom";
const MUTED_KEY = "piana:muted";
const WAIT_KEY = "piana:wait";

/**
 * Read back a stored zoom, or null if there isn't a usable one.
 *
 * Deliberately permissive about which octave counts it accepts — the caller checks the
 * value against the options actually in the dropdown, so this only has to rule out things
 * that aren't zoom settings at all.
 */
export function parseZoom(raw: string | null): Zoom | null {
  if (raw === "auto" || raw === "full") return raw;
  if (raw === null || raw.trim() === "") return null;
  const octaves = Number(raw);
  return Number.isInteger(octaves) && octaves > 0 ? octaves : null;
}

export function loadZoom(): Zoom | null {
  try {
    return parseZoom(localStorage.getItem(ZOOM_KEY));
  } catch {
    return null; // storage unavailable — fall back to the default
  }
}

export function saveZoom(zoom: Zoom): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(zoom));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Was the app muted last time?
 *
 * Anything other than a stored "true" means unmuted. Coming back to an app that is
 * silent for no visible reason is worse than one that makes a noise you can switch off,
 * so a corrupt value resolves towards sound rather than away from it.
 */
export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, String(muted));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

/**
 * Should the song hold at each note until it is played?
 *
 * On unless it was explicitly switched off. This is a learning tool, and waiting is how you
 * learn a piece you cannot yet play — the alternative is a song that runs away from you on
 * the first bar. Anything unreadable in storage therefore resolves *towards* waiting.
 */
export function parseWaitMode(raw: string | null): boolean {
  return raw !== "false";
}

export function loadWaitMode(): boolean {
  try {
    return parseWaitMode(localStorage.getItem(WAIT_KEY));
  } catch {
    return true;
  }
}

export function saveWaitMode(wait: boolean): void {
  try {
    localStorage.setItem(WAIT_KEY, String(wait));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
