import type { TimeRange } from "../game/practice.ts";
import { MIN_LOOP_SEC } from "./loopRegion.ts";

/**
 * The loops you keep.
 *
 * A region marked out by hand answers "practise these eight bars"; it stops answering it
 * the moment you mark out a different eight. Every piece has three or four places that
 * need the work, and re-finding each of them by scrolling and dropping two points is the
 * tax you pay for coming back to the song tomorrow — which is exactly when you should be
 * playing rather than aiming markers.
 *
 * So a region can be given a name and kept. Saved loops belong to the song, are drawn
 * across the top of its map, and are picked up with one click. None of them is engaged
 * when a song opens: the piece starts whole, and choosing a passage stays a thing you do
 * on purpose.
 *
 * The rules here are pure and the storage is a thin skin over them, so what happens to a
 * name, an id or a set of times is unit-tested rather than clicked at.
 */
export interface SavedLoop {
  id: string;
  name: string;
  start: number;
  end: number;
}

/**
 * Longest a name may be.
 *
 * Names are read off a tooltip the width of a loop and printed in the corner of the stage,
 * so this is about where the label stops being readable rather than about storage. Long
 * enough for "Left hand run into the bridge", short enough that it cannot become a
 * paragraph pinned over the notes.
 */
export const MAX_LOOP_NAME = 40;

const PREFIX = "piana:loops:";

/** How far apart two regions' ends may be and still count as the same loop, in seconds. */
const SAME_LOOP_TOLERANCE = 0.01;

/**
 * Tidy a name typed into the box.
 *
 * Trimmed and collapsed because a name is a label rather than a document: leading spaces
 * and a run of twenty in the middle are invisible in the box and wrong everywhere the name
 * is drawn. An empty result is the caller's cue to fall back on a default rather than to
 * save something with no name at all.
 */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_LOOP_NAME);
}

/**
 * A name for a loop nobody has named: "Loop 1", then the first number not already taken.
 *
 * Reusing a freed number rather than always counting upwards, so a song you have saved and
 * deleted your way around all afternoon does not offer you "Loop 27" over three loops.
 */
export function defaultLoopName(loops: readonly SavedLoop[]): string {
  const taken = new Set(loops.map((loop) => loop.name));
  for (let n = 1; ; n++) {
    const name = `Loop ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** An id no loop in the list is using. Internal, so it only has to be unique. */
export function nextLoopId(loops: readonly SavedLoop[]): string {
  const highest = loops.reduce((max, loop) => Math.max(max, Number(loop.id) || 0), 0);
  return String(highest + 1);
}

/** Loops in the order they are played, which is the order they are drawn and listed in. */
export function sortLoops(loops: readonly SavedLoop[]): SavedLoop[] {
  return [...loops].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The range a loop stands for, for handing to the parts of the app that speak in ranges. */
export function rangeOf(loop: SavedLoop): TimeRange {
  return { start: loop.start, end: loop.end };
}

export function loopById(loops: readonly SavedLoop[], id: string | null): SavedLoop | null {
  return loops.find((loop) => loop.id === id) ?? null;
}

/**
 * The saved loop a region *is*, if it is one.
 *
 * How the app knows whether the two markers on screen are still sitting on something you
 * named. Compared with a tolerance rather than exactly, because a marker dragged back to
 * where it was lands on a pixel rather than on a number — and a loop that stopped being
 * itself over a thousandth of a second would be a loop you could never quite get back to.
 */
export function loopMatching(
  loops: readonly SavedLoop[],
  range: TimeRange | null,
  tolerance = SAME_LOOP_TOLERANCE,
): SavedLoop | null {
  if (!range) return null;
  return (
    loops.find(
      (loop) =>
        Math.abs(loop.start - range.start) <= tolerance &&
        Math.abs(loop.end - range.end) <= tolerance,
    ) ?? null
  );
}

/** Keep `range` under `name`. Returns the new list, and the loop that was added. */
export function addLoop(
  loops: readonly SavedLoop[],
  name: string,
  range: TimeRange,
): { loops: SavedLoop[]; loop: SavedLoop } {
  const loop: SavedLoop = {
    id: nextLoopId(loops),
    name: cleanName(name) || defaultLoopName(loops),
    start: range.start,
    end: range.end,
  };
  return { loops: sortLoops([...loops, loop]), loop };
}

export function removeLoop(loops: readonly SavedLoop[], id: string): SavedLoop[] {
  return loops.filter((loop) => loop.id !== id);
}

/** Give a loop a different name, leaving an empty one as it was. */
export function renameLoop(loops: readonly SavedLoop[], id: string, name: string): SavedLoop[] {
  const clean = cleanName(name);
  if (!clean) return [...loops];
  return loops.map((loop) => (loop.id === id ? { ...loop, name: clean } : loop));
}

/**
 * Read a stored list back, keeping only what is actually a loop.
 *
 * Storage is shared with the scores and the preferences and is the user's to edit, so
 * every field is checked and anything that fails is dropped rather than drawn as a band of
 * width NaN across the map. A region shorter than the shortest loop that can be marked is
 * dropped for the same reason it cannot be marked in the first place.
 */
export function parseLoops(raw: string | null): SavedLoop[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const loops: SavedLoop[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const loop = item as Partial<SavedLoop> | null;
    if (!loop || typeof loop.name !== "string") continue;
    const { start, end } = loop;
    if (typeof start !== "number" || typeof end !== "number") continue;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end - start < MIN_LOOP_SEC) continue;

    // Ids collide only in a file somebody has edited, and two loops sharing one would make
    // the second unselectable — so the list gives the newcomer a fresh id rather than
    // dropping a region that is otherwise perfectly good.
    const id = typeof loop.id === "string" && loop.id !== "" && !seen.has(loop.id)
      ? loop.id
      : nextLoopId(loops);
    seen.add(id);
    loops.push({ id, name: cleanName(loop.name) || defaultLoopName(loops), start, end });
  }
  return sortLoops(loops);
}

/** Where one song's loops live. Keyed by name, as the scores are. */
export function loopsKey(songName: string): string {
  return PREFIX + encodeURIComponent(songName);
}

export function loadLoops(songName: string): SavedLoop[] {
  try {
    return parseLoops(localStorage.getItem(loopsKey(songName)));
  } catch {
    return []; // storage unavailable — the song simply has no loops this session
  }
}

export function saveLoops(songName: string, loops: readonly SavedLoop[]): void {
  try {
    if (loops.length === 0) localStorage.removeItem(loopsKey(songName));
    else localStorage.setItem(loopsKey(songName), JSON.stringify(loops));
  } catch {
    /* storage unavailable — non-fatal */
  }
}
