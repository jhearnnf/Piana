/**
 * How much you have actually played each instrument.
 *
 * A sample library has hundreds of sounds in it and you use about five. An alphabetical
 * list of 224 presets is a list you have to read every time; a list with the sounds you
 * really play at the top of it is one you stop reading. So the picker is ranked by this.
 *
 * "Played" means notes were sounding — a song running or keys under your hands — and not
 * that a sound was merely selected. The difference matters because leaving something
 * chosen is free and leaving it chosen overnight is very free, and neither says anything
 * about whether you like it. What is being ranked is the time you spent listening.
 *
 * Pure, apart from the two storage calls at the bottom, so the ranking and the trimming
 * can be argued about without a browser.
 */

/** One instrument, and the time spent playing through it. */
export interface InstrumentUse {
  name: string;
  /** Seconds of notes actually sounding. */
  seconds: number;
  /** When it was last played, ms since the epoch. */
  lastUsed: number;
}

const STORAGE_KEY = "piana:instrument-use";

/**
 * How many instruments to remember.
 *
 * Well past the number anyone has opinions about, and far short of the two hundred-odd a
 * library ships with — the point is a list you recognise, and everything below this is a
 * sound you tried once. Trimmed by time played rather than by recency, so an evening spent
 * auditioning presets cannot push out the piano you have used for a month.
 */
export const MAX_REMEMBERED = 40;

/**
 * Add `seconds` of playing to each of `names`.
 *
 * Every instrument in a stack is credited the whole time, not a share of it: three sounds
 * layered for an hour is an hour of each, because each of them is a sound you chose to
 * listen to for an hour. Dividing it would rank a layered favourite below something used
 * on its own for a fraction of the time.
 *
 * Pure — the caller keeps the list and decides when to write it.
 */
export function recordUse(
  uses: readonly InstrumentUse[],
  names: readonly string[],
  seconds: number,
  now: number,
): InstrumentUse[] {
  if (seconds <= 0 || names.length === 0) return [...uses];

  const byName = new Map(uses.map((use) => [use.name, use]));
  for (const name of new Set(names)) {
    const existing = byName.get(name);
    byName.set(name, {
      name,
      seconds: (existing?.seconds ?? 0) + seconds,
      lastUsed: now,
    });
  }
  return trim(rank([...byName.values()]));
}

/**
 * Most played first, and the most recent of those first among equals.
 *
 * The tie-break matters more than it looks: everything you have never played is on nought
 * seconds together, and without it that whole tail would sit in whatever order the map
 * happened to be in.
 */
export function rank(uses: readonly InstrumentUse[]): InstrumentUse[] {
  return [...uses].sort((a, b) => b.seconds - a.seconds || b.lastUsed - a.lastUsed);
}

/** The top `MAX_REMEMBERED`, assuming the list is already ranked. */
function trim(ranked: readonly InstrumentUse[]): InstrumentUse[] {
  return ranked.slice(0, MAX_REMEMBERED);
}

/**
 * The instruments whose names match `query`, in the order they were given.
 *
 * Case- and accent-insensitive substring matching, and nothing cleverer. A sample library
 * names its presets in twos — "Ghost Flute", "Bliss Flute", "Fields Flute" — so typing
 * "flute" and getting all of them is the whole search anyone needs here.
 */
export function filterInstruments(names: readonly string[], query: string): string[] {
  const needle = query.trim();
  if (needle === "") return [...names];
  return names.filter(
    (name) => name.localeCompare(needle, undefined, { sensitivity: "base" }) === 0
      || fold(name).includes(fold(needle)),
  );
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * The instruments you have actually played, most-played first.
 *
 * Filtered against the library as it stands, because a remembered name whose folder has
 * been renamed or deleted is a row that cannot be chosen — and one that would sit at the
 * top of the list being useless, since that is precisely where the ones you played most
 * end up. Instruments never played are not here at all: this is the shortlist, and its
 * value is in what it leaves out.
 */
export function mostPlayed(
  names: readonly string[],
  uses: readonly InstrumentUse[],
  limit: number,
): string[] {
  const available = new Set(names);
  return rank(uses)
    .filter((use) => use.seconds > 0 && available.has(use.name))
    .slice(0, limit)
    .map((use) => use.name);
}

/**
 * Seconds as the coarsest thing that is still true.
 *
 * "1h 48m", not "1:48:31". This is a number you glance at to see which of two sounds you
 * have lived in more, and a running seconds count would imply a precision that is not
 * being claimed — the clock only advances while notes are sounding, so it is an
 * approximation from the start.
 */
export function playTimeLabel(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  if (total < 60) return `${total}s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Read back what was stored, keeping only entries that are entirely well-formed.
 *
 * Junk is dropped rather than repaired. This is a convenience list — the worst that a lost
 * entry costs is an instrument sitting lower in the picker than it has earned, and that is
 * a much better failure than a ranking built on half-read numbers.
 */
export function parseUses(raw: string | null): InstrumentUse[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const uses: InstrumentUse[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const { name, seconds, lastUsed } = entry as Record<string, unknown>;
      if (typeof name !== "string" || name === "") continue;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) continue;
      if (typeof lastUsed !== "number" || !Number.isFinite(lastUsed)) continue;
      uses.push({ name, seconds, lastUsed });
    }
    return rank(uses);
  } catch {
    return [];
  }
}

export function loadUses(): InstrumentUse[] {
  try {
    return parseUses(localStorage.getItem(STORAGE_KEY));
  } catch {
    return []; // storage unavailable — an unranked picker still works
  }
}

export function saveUses(uses: readonly InstrumentUse[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uses));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
