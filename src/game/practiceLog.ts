import type { Difficulty, HandSelection } from "../core/types.ts";
import type { ScoreResult } from "./Scoring.ts";

/**
 * The record of the laps you have played.
 *
 * A best score answers "how well can you play this?" and nothing else. It is a single
 * number that only ever moves upwards, and the thing you actually want to see after a
 * fortnight on the same eight bars — that they took you four minutes on Monday and ninety
 * seconds today, at sixty per cent then and ninety now — is exactly what keeping only the
 * best throws away. So every lap of a loop, and every scored run, is written down here as
 * it happens: its own accuracy, its own score, and the time it took.
 *
 * Attempts are kept per song and carry the setup they were played under, so a report can
 * draw one line per loop and per song without a second index to keep in step.
 *
 * The rules are pure and storage is a thin skin over them, in the way the scores and the
 * saved loops are.
 */

/** One lap of a loop, or one scored run, as it was played. */
export interface Attempt {
  /** Epoch ms the lap ended. */
  at: number;
  /**
   * Wall-clock seconds spent on it.
   *
   * Timed rather than taken from the range's length, because the two are not the same
   * number: wait mode holds the music at a chord until you find it, so how long a lap took
   * is precisely the measure of how well you know it. Time paused is not counted.
   */
  seconds: number;
  /** What was practised: "full", a detected section's id, or a `loop:start-end` region. */
  sectionId: string;
  /**
   * How the stretch was named on screen at the time, or "" for the whole song.
   *
   * A snapshot rather than a reference: a loop that has since been renamed or forgotten
   * still has to read as something in a report of the evening you spent on it.
   */
  label: string;
  difficulty: Difficulty;
  hand: HandSelection;
  result: ScoreResult;
}

/**
 * How many attempts one song keeps.
 *
 * Laps are short and a good practice session makes a lot of them, so this is a ceiling on
 * a file the user never sees rather than a judgement about how much history is
 * interesting. Oldest out first: a trend is read from its recent end, and the alternative —
 * refusing new laps once the list is full — would quietly stop recording the very sessions
 * a report is for.
 */
export const MAX_ATTEMPTS = 400;

const PREFIX = "piana:log:";

/** Add `attempt` to a song's log, dropping the oldest once it is full. */
export function recordAttempt(log: readonly Attempt[], attempt: Attempt): Attempt[] {
  const next = [...log, attempt];
  return next.length <= MAX_ATTEMPTS ? next : next.slice(next.length - MAX_ATTEMPTS);
}

/** Everything one setup has to show for itself, across every attempt at it. */
export interface AttemptSummary {
  sectionId: string;
  /** The name the stretch went by most recently. */
  label: string;
  difficulty: Difficulty;
  hand: HandSelection;
  attempts: number;
  /** Total wall-clock seconds spent on it. */
  seconds: number;
  bestScore: number;
  /** The earliest attempt kept, and the latest — the two ends of the trend. */
  first: Attempt;
  last: Attempt;
}

/**
 * The identity a report groups attempts under.
 *
 * The same four things a best score is filed by. Grouping on the section alone would
 * average your left hand at half speed together with both hands at full, and draw a line
 * that wanders for reasons that have nothing to do with how you are getting on.
 */
function setupKey(attempt: Attempt): string {
  return [attempt.sectionId, attempt.difficulty, attempt.hand].map(encodeURIComponent).join("|");
}

/**
 * Gather a song's attempts into one row per setup, most recently practised first.
 *
 * That order because a report is opened on the way out of a session, and the loop you just
 * put twenty minutes into is the one you want to see at the top of it.
 *
 * Pure, and the only thing between the log and a chart, so what a row claims is unit-tested
 * rather than eyeballed on a page.
 */
export function summarize(log: readonly Attempt[]): AttemptSummary[] {
  const bySetup = new Map<string, Attempt[]>();
  for (const attempt of log) {
    const key = setupKey(attempt);
    const list = bySetup.get(key);
    if (list) list.push(attempt);
    else bySetup.set(key, [attempt]);
  }

  const rows: AttemptSummary[] = [];
  for (const attempts of bySetup.values()) {
    // Sorted rather than trusted: the log is written in order, but an edited or merged
    // file need not be, and every field below reads as if the ends are the ends.
    const inOrder = [...attempts].sort((a, b) => a.at - b.at);
    const first = inOrder[0]!;
    const last = inOrder[inOrder.length - 1]!;
    rows.push({
      sectionId: last.sectionId,
      label: last.label,
      difficulty: last.difficulty,
      hand: last.hand,
      attempts: inOrder.length,
      seconds: inOrder.reduce((total, a) => total + a.seconds, 0),
      bestScore: inOrder.reduce((max, a) => Math.max(max, a.result.score), 0),
      first,
      last,
    });
  }
  return rows.sort((a, b) => b.last.at - a.last.at);
}

const DIFFICULTIES = new Set<string>(["easy", "medium", "hard"]);
const HANDS = new Set<string>(["left", "both", "right"]);

/**
 * Read a stored log back, keeping only the attempts that are entirely well-formed.
 *
 * Junk is dropped rather than repaired, as everywhere else that reads this storage: an
 * attempt is one point on a line, and a point built from half-read numbers is worse than a
 * gap in it. The result is put back in time order so the summary above has the ends it
 * expects even from a file somebody has stitched together by hand.
 */
export function parseLog(raw: string | null): Attempt[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const log: Attempt[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { at, seconds, sectionId, label, difficulty, hand, result } =
      entry as Record<string, unknown>;
    if (!isFinitePositive(at) || !isFinitePositive(seconds)) continue;
    if (typeof sectionId !== "string" || sectionId === "") continue;
    if (typeof label !== "string") continue;
    if (typeof difficulty !== "string" || !DIFFICULTIES.has(difficulty)) continue;
    if (typeof hand !== "string" || !HANDS.has(hand)) continue;
    if (!isResult(result)) continue;

    log.push({
      at,
      seconds,
      sectionId,
      label,
      difficulty: difficulty as Difficulty,
      hand: hand as HandSelection,
      result,
    });
  }
  return log.sort((a, b) => a.at - b.at);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const RESULT_FIELDS = [
  "totalNotes",
  "perfect",
  "good",
  "missed",
  "wrong",
  "maxCombo",
  "accuracy",
  "avgTimingMs",
  "score",
  "stars",
] as const;

function isResult(value: unknown): value is ScoreResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return RESULT_FIELDS.every((field) => {
    const n = record[field];
    return typeof n === "number" && Number.isFinite(n);
  });
}

/** Where one song's attempts live. Keyed by name, as its scores and loops are. */
export function logKey(songName: string): string {
  return PREFIX + encodeURIComponent(songName);
}

/** Read a storage key back into the song it belongs to, or null if it isn't one of ours. */
export function parseLogKey(key: string): string | null {
  if (!key.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(key.slice(PREFIX.length)) || null;
  } catch {
    return null; // malformed percent-encoding
  }
}

export function loadLog(songName: string): Attempt[] {
  try {
    return parseLog(localStorage.getItem(logKey(songName)));
  } catch {
    return []; // storage unavailable — this session simply goes unrecorded
  }
}

export function saveLog(songName: string, log: readonly Attempt[]): void {
  try {
    if (log.length === 0) localStorage.removeItem(logKey(songName));
    else localStorage.setItem(logKey(songName), JSON.stringify(log));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
