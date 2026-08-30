'use strict';

/**
 * A folder of audio files, read as an instrument.
 *
 * Piana's own piano is synthesised (src/audio/piano.ts) so that the app has a sound with
 * nothing installed and nothing downloaded. This is the other option: play the recordings
 * of a real instrument that are already sitting on this machine.
 *
 * The deliberate decision here is to key off *file names* rather than off any one vendor's
 * project format. Sample libraries mostly disagree about everything except this: one file
 * per note, with the note in the name. S.K.Y. Keys writes `060-one.flac`; a great many
 * others write `C4.wav`. Both are just "here is note 60", and a reader that understands
 * that understands most of the libraries anyone actually has — with no parser for a
 * proprietary instrument file, and nothing to update when the next one appears.
 *
 * What is *not* attempted: velocity layers, round-robins, release samples, loop points,
 * key ranges. Those live in the formats this ignores. See `sampleCutoff` in sampleMap.ts
 * for how the missing dynamics are made up on the playback side instead.
 *
 * Pure, for the reason library.cjs and prefs.cjs are: the caller does the reading, so the
 * decisions are testable without an Electron process or a 4 GB sample library.
 */

const path = require('path');

/** What Chromium will decode. The renderer hands these straight to `decodeAudioData`. */
const AUDIO_FILE = /\.(flac|wav|ogg|mp3|m4a|aac|opus)$/i;

/** A path separator, either platform's. See `resolveChild`. */
const SEPARATOR = /[\\/]/;

function isSampleFile(name) {
  return typeof name === 'string' && AUDIO_FILE.test(name);
}

/** Semitones above C for each note letter. */
const LETTER = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * A spelled note — `C4`, `A#3`, `Bb-1` — as a MIDI number, or null.
 *
 * Middle C is 60, which is the convention MIDI itself is defined in. Some libraries call
 * that C3 instead, and there is no way to tell from a file name which one is meant; being
 * an octave out is at least an octave out *consistently*, which is audible immediately and
 * therefore fixable, rather than subtly wrong.
 *
 * `b` is read as a flat only when a letter came before it, so `Bb3` is B-flat and `B3` is
 * still B — the two are one character apart and mean notes a semitone apart.
 */
function noteNameToMidi(text) {
  const match = /^([A-Ga-g])([#bs]?)(-?\d{1,2})$/.exec(text);
  if (!match) return null;

  const accidental = match[2] === '#' || match[2] === 's' ? 1 : match[2] === 'b' ? -1 : 0;
  const midi = (Number(match[3]) + 1) * 12 + LETTER[match[1].toLowerCase()] + accidental;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/**
 * The MIDI note a sample file is for, or null if its name does not say.
 *
 * Two conventions, tried in the order that cannot be confused for the other. A leading
 * number is unambiguous, so it wins outright. Failing that the name is split on the usual
 * separators and its ends are checked for a spelled note — the ends, because that is where
 * a pitch goes, and checking every word would let a library called `Piano E` claim to be
 * a single note.
 */
function sampleNote(name) {
  if (!isSampleFile(name)) return null;
  const stem = name.slice(0, name.length - path.extname(name).length);

  // `060-one.flac`, `036.wav` — S.K.Y. Keys and most other numbered sets.
  const numbered = /^(\d{1,3})(?:[-_. ]|$)/.exec(stem);
  if (numbered) {
    const midi = Number(numbered[1]);
    return midi >= 0 && midi <= 127 ? midi : null;
  }

  // `C4.wav`, `piano-A#3.flac`, `Db2 soft.wav`.
  const words = stem.split(/[-_. ]+/).filter(Boolean);
  for (const word of [words[words.length - 1], words[0]]) {
    if (word === undefined) continue;
    const midi = noteNameToMidi(word);
    if (midi !== null) return midi;
  }
  return null;
}

/** Names, in a stable order that does not split a mixed-case folder into two alphabets. */
function byName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The samples among `names`, as `{ midi, file }` in pitch order.
 *
 * One file per note. A library that ships velocity layers or round-robins has several
 * files claiming the same note, and this keeps the first by name rather than trying to
 * choose between them — the alternative is a heuristic about which layer is "the" one,
 * which would be wrong quietly. See the module comment: layers are out of scope, and
 * taking one of them consistently is what that costs.
 */
function buildSampleMap(names) {
  const byNote = new Map();
  for (const name of [...names].sort(byName)) {
    const midi = sampleNote(name);
    if (midi === null || byNote.has(midi)) continue;
    byNote.set(midi, name);
  }
  return [...byNote.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([midi, file]) => ({ midi, file }));
}

/**
 * Which of `entries` are instruments worth listing.
 *
 * A sample library's root is a folder of folders, and not all of them are instruments —
 * S.K.Y. Keys keeps its settings in one, and every library has some equivalent. Leading
 * dots, dashes and underscores are the usual way of saying "not one of the presets", and
 * are treated as such rather than shown as a playable sound that turns out to be empty.
 */
function listInstrumentNames(entries) {
  return entries
    .filter((entry) => entry.directory && !/^[-._]/.test(entry.name))
    .map((entry) => entry.name)
    .sort(byName);
}

/**
 * One step down from `base`, or null if `segment` is not a plain name.
 *
 * The renderer asks for sounds by name, so this is where a name becomes a filesystem read
 * and therefore where it is checked. Same rule as `resolveInFolder` in library.cjs: a
 * separator, a dot segment, a NUL or a drive letter is refused rather than normalised,
 * because there is no legitimate way for one to come back from a listing made here.
 *
 * Both separators are rejected by hand rather than left to `basename`, which only knows
 * the running platform's one — a backslash is an ordinary character in a POSIX file name,
 * and this should give the same answer wherever it runs.
 */
function resolveChild(base, segment) {
  if (typeof segment !== 'string' || segment === '' || segment.includes('\0')) return null;
  if (SEPARATOR.test(segment) || path.basename(segment) !== segment) return null;

  const target = path.resolve(base, segment);
  return path.dirname(target) === base ? target : null;
}

/** The folder an instrument's samples are in, or null. */
function resolveInstrument(root, instrument) {
  return resolveChild(path.resolve(root), instrument);
}

/** One sample's path inside the library, or null. Two names, each checked in turn. */
function resolveSample(root, instrument, file) {
  if (!isSampleFile(file)) return null;
  const folder = resolveInstrument(root, instrument);
  return folder === null ? null : resolveChild(folder, file);
}

module.exports = {
  isSampleFile,
  noteNameToMidi,
  sampleNote,
  buildSampleMap,
  listInstrumentNames,
  resolveInstrument,
  resolveSample,
};
