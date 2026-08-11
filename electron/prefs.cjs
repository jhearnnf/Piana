'use strict';

/**
 * Preferences the shell keeps, as opposed to the ones the app keeps.
 *
 * Only one so far: the folder the Open dialog should start in. It has to live out here
 * because it is about a native dialog and a filesystem path — the renderer never sees
 * either, and `localStorage` (where the app's own settings go) is the wrong place for
 * something the sandbox side has no business knowing.
 *
 * Pure, so it can be tested without an Electron process: the caller does the reading and
 * writing and passes in what it found.
 */

/** Reads the prefs file. Junk on disk is the same as no file at all. */
function parsePrefs(text) {
  try {
    const prefs = JSON.parse(text);
    return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : null;
  } catch {
    return null;
  }
}

/** The stored song folder, or null if there isn't a usable one. */
function songFolder(prefs) {
  const folder = prefs && prefs.songFolder;
  return typeof folder === 'string' && folder !== '' ? folder : null;
}

/**
 * Which folder the Open dialog should start in.
 *
 * Existence is checked rather than assumed: a remembered folder on a USB stick or a
 * network share is gone as often as not, and Windows answers a `defaultPath` that does not
 * resolve by falling back to whatever it feels like — which is the behaviour being fixed.
 *
 * Returns undefined when there is nothing sensible to suggest, which is how Electron is
 * told to just use the system default.
 *
 * @param {object|null} prefs    what was loaded from disk
 * @param {(p: string) => boolean} exists
 * @param {string} [fallback]    where to start before anything has ever been opened
 */
function startFolder(prefs, exists, fallback) {
  const remembered = songFolder(prefs);
  if (remembered && exists(remembered)) return remembered;
  if (fallback && exists(fallback)) return fallback;
  return undefined;
}

module.exports = { parsePrefs, songFolder, startFolder };
