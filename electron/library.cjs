'use strict';

/**
 * The song folder, as a list.
 *
 * The shell already remembers where your MIDI files live (prefs.cjs, so the Open dialog
 * starts there). This turns that same folder into something the app can show you: the
 * `.mid` files in it, by name, so a song is one click away instead of one file dialog.
 *
 * Only the folder itself is listed, not what is under it. A recursive walk of a music
 * folder is a good way to make the app hang on a network share, and "the folder I keep my
 * MIDI files in" is a flat idea in the first place.
 *
 * Pure, for the reason serve.cjs and prefs.cjs are: the caller does the reading, so the
 * decisions — which files count, what order they come in, and which names are safe to
 * turn back into a path — are testable without an Electron process.
 */

const path = require('path');

/** Is this a MIDI file name? The same test the drop target and the file filter use. */
function isMidiFile(name) {
  return typeof name === 'string' && /\.midi?$/i.test(name);
}

/**
 * The MIDI files among `names`, in the order they should be shown.
 *
 * Sorted numerically-aware and case-insensitively, so "Prelude 2" comes before
 * "Prelude 10" and a folder of mixed capitalisation doesn't split into two alphabets.
 */
function listMidiNames(names) {
  return names
    .filter(isMidiFile)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Turn a file name from the list back into a path inside `folder`, or null.
 *
 * The renderer asks to open a song by name, so this is where a name becomes a filesystem
 * read and therefore where it gets checked. It is a name, not a path: anything with a
 * separator, a dot segment, a NUL or a drive letter in it is refused rather than
 * normalised, because there is no legitimate way for one of those to come back from a
 * list this module produced.
 *
 * Both separators are rejected by hand rather than left to `basename`, which only knows
 * the running platform's one — a backslash is an ordinary character in a POSIX file name,
 * and this should give the same answer wherever it runs.
 */
function resolveInFolder(folder, name) {
  if (!isMidiFile(name) || name.includes('\0')) return null;
  if (/[\\/]/.test(name) || path.basename(name) !== name) return null; // a path, not a name

  const base = path.resolve(folder);
  const target = path.resolve(base, name);
  return path.dirname(target) === base ? target : null;
}

module.exports = { isMidiFile, listMidiNames, resolveInFolder };
