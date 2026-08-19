import type { BestEntry, SongScores } from "../game/highScores.ts";

/**
 * The song folder as the app sees it: the files that are in it, married up with what you
 * have already scored on each one.
 *
 * The join is by title — the file name without its extension — because that is the name
 * `loadSong` gives a song and therefore the name its high scores are filed under. Nothing
 * here reads storage or the disk; the caller supplies both halves, which is what lets the
 * whole model be checked from tests without a folder or a browser.
 */

/** Strip the extension off a file name to get a song title. */
export const songTitle = (fileName: string): string => fileName.replace(/\.midi?$/i, "");

/** One row of the song list: a file on disk, plus its history. */
export interface LibrarySong {
  /** The file name as it sits in the folder, e.g. `Clair de Lune.mid`. */
  file: string;
  /** What the song is called — the file name without its extension. */
  title: string;
  /** The best run across every difficulty, hand and section, or null if never finished. */
  best: BestEntry | null;
  /** Points for that run; 0 when unplayed. */
  topScore: number;
  /** How many different setups have a stored best — "played three ways". */
  runs: number;
  /** When the most recent best was set, or null if unplayed (or set before dates were kept). */
  lastPlayed: number | null;
}

/** True if this song has ever been finished. */
export function isPlayed(song: LibrarySong): boolean {
  return song.best !== null;
}

/**
 * Build the list: one row per file, in the order the files arrive.
 *
 * The shell already sorts the folder, and a list that re-ordered itself as your scores
 * changed would move songs out from under the click that was about to open them.
 *
 * Scores for songs that are *not* in the folder are dropped rather than shown. This is a
 * list of what you can open right now; a piece you played from a since-deleted download
 * still has its score on the Scores screen, which is the screen about history.
 */
export function buildLibrary(
  files: readonly string[],
  scores: readonly SongScores[],
): LibrarySong[] {
  const byTitle = new Map(scores.map((song) => [song.songName, song]));

  return files.map((file) => {
    const title = songTitle(file);
    const played = byTitle.get(title);
    // `entries` is already best-first, so the head is the run to show.
    const best = played?.entries[0] ?? null;
    const dates = (played?.entries ?? [])
      .map((entry) => entry.savedAt)
      .filter((at): at is number => at !== null);

    return {
      file,
      title,
      best,
      topScore: played?.topScore ?? 0,
      runs: played?.entries.length ?? 0,
      lastPlayed: dates.length ? Math.max(...dates) : null,
    };
  });
}

/**
 * Narrow the list to what matches `query`.
 *
 * Matched loosely on purpose — case-insensitively, on any part of the name, and on each
 * word of the query separately, so "moon beet" finds "Beethoven - Moonlight Sonata"
 * without you having to remember which order the file put them in. An empty query
 * matches everything.
 */
export function filterLibrary(
  songs: readonly LibrarySong[],
  query: string,
): LibrarySong[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...songs];
  return songs.filter((song) => {
    const title = song.title.toLowerCase();
    return terms.every((term) => title.includes(term));
  });
}

/** How many of these have been played, for the "12 songs · 5 played" line. */
export function playedCount(songs: readonly LibrarySong[]): number {
  return songs.reduce((total, song) => total + (isPlayed(song) ? 1 : 0), 0);
}
