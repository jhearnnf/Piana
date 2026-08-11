import type { Zoom } from "../render/visibleRange.ts";

/**
 * Settings that outlive a session.
 *
 * The keyboard zoom, the volume and mute switch, wait mode, and which MIDI device to
 * listen to — and not the rest. Difficulty, hand and section are choices about *this* song,
 * but "show me all 88 keys", "this loud", "don't make noise", "hold until I play the note"
 * and "the piano, not the fader box" are statements about how you like to use the app, and
 * re-making them on every launch is the whole annoyance.
 */

const ZOOM_KEY = "piana:zoom";
const MUTED_KEY = "piana:muted";
const VOLUME_KEY = "piana:volume";
const WAIT_KEY = "piana:wait";
const MIDI_DEVICE_KEY = "piana:midi-device";

/** Where the slider sits before anyone has moved it: loud enough to hear, short of full. */
export const DEFAULT_VOLUME = 0.75;

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
 * How loud was it last time, as 0..1?
 *
 * An unreadable value resolves to the default rather than to silence — same reasoning as
 * the mute switch, and the reason an empty string is rejected before `Number` gets to it
 * and helpfully turns it into zero. Out-of-range numbers are clamped rather than thrown
 * away, since a stored 1.2 is plainly a request for "loud".
 */
export function parseVolume(raw: string | null): number {
  if (raw === null || raw.trim() === "") return DEFAULT_VOLUME;
  const level = Number(raw);
  if (!Number.isFinite(level)) return DEFAULT_VOLUME;
  return Math.min(1, Math.max(0, level));
}

export function loadVolume(): number {
  try {
    return parseVolume(localStorage.getItem(VOLUME_KEY));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function saveVolume(level: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(level));
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

/**
 * Which MIDI device to listen to, by name, or null for all of them.
 *
 * Null is the honest reading of an empty or missing value: nobody has chosen a device yet,
 * so every device counts. Stored as the device's name — see `chooseInputs` for why not the
 * Web MIDI id — and only whitespace-trimmed on the way back, since a keyboard is free to
 * call itself anything at all and this has no list of valid names to check it against.
 */
export function parseMidiDevice(raw: string | null): string | null {
  return raw === null || raw.trim() === "" ? null : raw.trim();
}

export function loadMidiDevice(): string | null {
  try {
    return parseMidiDevice(localStorage.getItem(MIDI_DEVICE_KEY));
  } catch {
    return null; // storage unavailable — listen to everything
  }
}

export function saveMidiDevice(name: string | null): void {
  try {
    localStorage.setItem(MIDI_DEVICE_KEY, name ?? "");
  } catch {
    /* storage unavailable — non-fatal */
  }
}
