import type { Difficulty, HandSelection } from "../core/types.ts";
import type { ScoreContext } from "../game/highScores.ts";
import { parseLoopSectionId } from "../song/loopRegion.ts";

/**
 * The small pieces of text every screen needs to say the same way.
 *
 * A run is described as "Hard · Both hands · Full song" on the results screen, the scores
 * screen and the song list alike, and a song's name arrives from a file name in all three.
 * Naming the same thing two ways in two places is how a UI starts to feel like two UIs.
 */

/**
 * Seconds as `m:ss`, growing to `h:mm:ss` only once there is an hour to show.
 *
 * Rounded down so a clock never reads as finished while notes are still coming.
 */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}

/** Escape text for interpolation into HTML. Song and track names come from files. */
export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!,
  );
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export const HAND_LABELS: Record<HandSelection, string> = {
  left: "Left hand",
  both: "Both hands",
  right: "Right hand",
};

/**
 * Human name for a stored section id.
 *
 * Sections are detected fresh from the MIDI each time it is loaded and are only ever
 * numbered, so the id is enough to name one without keeping the song around — which is
 * what lets the scores screen open with no song loaded at all. A hand-picked loop region
 * carries its own times for the same reason: it belongs to no list the app could look it
 * up in, so it says what it is.
 */
export function sectionLabel(id: string): string {
  if (id === "full") return "Full song";
  const loop = parseLoopSectionId(id);
  if (loop) return `Loop ${formatTime(loop.start)}–${formatTime(loop.end)}`;
  const index = Number(id);
  return Number.isInteger(index) ? `Section ${index + 1}` : id;
}

/** The whole setup a score belongs to, as one line. */
export function setupLabel(ctx: ScoreContext): string {
  return [DIFFICULTY_LABELS[ctx.difficulty], HAND_LABELS[ctx.hand], sectionLabel(ctx.sectionId)]
    .join(" · ");
}

/**
 * The same, with the section left off unless it is one.
 *
 * For the song list, where every row spends its width on a different song rather than on
 * a different setup of the same one: "Full song" is what almost every row would say, and a
 * column that reads the same all the way down is a column that has stopped saying anything.
 * The scores screen keeps the long form — there, the section is the thing telling the rows
 * apart.
 */
export function shortSetupLabel(ctx: ScoreContext): string {
  const parts = [DIFFICULTY_LABELS[ctx.difficulty], HAND_LABELS[ctx.hand]];
  if (ctx.sectionId !== "full") parts.push(sectionLabel(ctx.sectionId));
  return parts.join(" · ");
}

/** The day a score was set, or "" for entries saved before that was recorded. */
export function dateLabel(savedAt: number | null): string {
  if (savedAt === null) return "";
  return new Date(savedAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
