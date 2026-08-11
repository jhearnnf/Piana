import type { Note } from "../core/types.ts";
import { chooseSplitPoint } from "./handSplit.ts";

/**
 * Working out which hand plays which note, from the notes alone.
 *
 * The cheap way to split a single stream of notes is to draw a line at middle C: below it is
 * the left hand, above it the right. That is wrong the moment the music moves — a left-hand
 * melody in the treble, a right-hand line that dips under it, an accompaniment that walks up
 * an octave — and it is wrong for every note of a piece that happens to sit entirely on one
 * side of the line.
 *
 * So instead of a fixed boundary this tracks where each hand *is*. Notes are grouped into
 * chords by onset; for each chord we consider every way of cutting it between the hands (the
 * k lowest notes to the left, the rest to the right) and score each cut by what it would cost
 * a real pianist:
 *
 *  - **reach** — a hand cannot span more than about a tenth at once, and even inside that a
 *    stretch is mildly uncomfortable. The mild part matters: without it the model will cram
 *    two voices into one hand and leave the other hand idle, because idle is free;
 *  - **fingers** — nor play more than five notes at once;
 *  - **travel** — the hand has to get there from where it just was, *and it has however long
 *    since it last played to do it in*. Distance alone would charge a slow walking bass the
 *    same as a fast run, which is why the cost is divided by the time available. This is what
 *    lets the split follow the music up and down the keyboard;
 *  - **crossing** — hands may cross when crossing is genuinely the cheaper reading, but not
 *    gratuitously, so a small penalty applies while the left hand sits above the right;
 *  - **the other hand** — taking a note the other hand was nearer to, swallowing a whole
 *    chord while the other hand has nothing to do, and passing a single line back and forth
 *    all cost something. Each of these is what a purely physical model gets wrong: they are
 *    all easy to play and all look wrong on the stage.
 *
 * Choosing each chord's cut greedily would let one bad guess wreck the passage after it, so
 * the cuts are searched with a small beam: several running interpretations are kept alive and
 * the cheapest complete one wins. Everything is deterministic and unit-tested; the only
 * output is `note.hand`.
 */

export interface AutoSplitOptions {
  /** Notes starting within this many seconds are one chord, cut as a unit. */
  chordSec: number;
  /** Widest reach a hand is assumed to have, in semitones (a tenth). */
  maxSpan: number;
  /** Reach a hand takes in its stride, in semitones. Beyond this it is a stretch. */
  comfortSpan: number;
  /** Cost per semitone of stretch between `comfortSpan` and `maxSpan`. */
  stretchWeight: number;
  /**
   * Cost per semitone of a chord that one hand swallows whole while the other has nothing
   * to play. Two notes sounding at once and two hands free is two hands' work.
   */
  idleWeight: number;
  /**
   * Cost of taking over a line the other hand was closer to. Tapers to nothing an octave
   * away, where "the same line" stops meaning anything.
   */
  voiceWeight: number;
  /**
   * Cost of passing a single line from one hand to the other. Without it, a melody with no
   * accompaniment is cheapest played by parking one hand on each half of it.
   */
  alternationWeight: number;
  /** Most notes one hand can strike at once. */
  maxNotesPerHand: number;
  /** Cost per semitone of moving a hand, when it has `moveRefSec` to do it in. */
  moveWeight: number;
  /** The gap, in seconds, at which `moveWeight` is charged in full. */
  moveRefSec: number;
  /** Shortest gap the travel cost will divide by — the floor on "no time at all". */
  moveMinSec: number;
  /** Cost per semitone of reach beyond `maxSpan`. Deliberately steep — it is impossible. */
  spanPenalty: number;
  /** Cost per extra note beyond `maxNotesPerHand`. Also impossible, also steep. */
  crowdPenalty: number;
  /** Cost per semitone that the left hand sits above the right. */
  crossPenalty: number;
  /** How many running interpretations to keep alive. */
  beamWidth: number;
}

export const DEFAULT_AUTO_SPLIT: AutoSplitOptions = {
  chordSec: 0.05,
  maxSpan: 14,
  comfortSpan: 7,
  stretchWeight: 1,
  idleWeight: 0.6,
  voiceWeight: 4,
  alternationWeight: 3,
  maxNotesPerHand: 5,
  moveWeight: 1,
  moveRefSec: 0.25,
  moveMinSec: 0.08,
  spanPenalty: 12,
  crowdPenalty: 20,
  crossPenalty: 2,
  beamWidth: 8,
};

/**
 * Where each hand is, and when it was last needed.
 *
 * `at` is a MIDI pitch and fractional — it's the centre of the hand, not a key. `since` is
 * the time it last played, which is what turns distance into effort.
 */
interface HandState {
  at: number;
  since: number;
}

/** Which hands a chord needed. Only single-handed chords can form a passed-along line. */
type Used = "left" | "right" | "both";

interface HandPositions {
  left: HandState;
  right: HandState;
  /** Which hands the previous chord used, or null at the start of the piece. */
  lastUsed: Used | null;
}

/** One surviving interpretation: its cost, where it left the hands, and how it got there. */
interface Candidate {
  cost: number;
  hands: HandPositions;
  /** Back-pointer chain of cuts, newest first. Cheaper than copying an array per branch. */
  trail: Trail | null;
}

interface Trail {
  /** How many of the chord's notes (lowest first) went to the left hand. */
  cut: number;
  prev: Trail | null;
}

/**
 * Assign `note.hand` for every note, in place.
 *
 * Notes are treated as one instrument played by one person: pass in only the notes you want
 * split together.
 */
export function autoSplitHands(
  notes: readonly Note[],
  options: Partial<AutoSplitOptions> = {},
): void {
  const opts = { ...DEFAULT_AUTO_SPLIT, ...options };
  if (notes.length === 0) return;

  const chords = groupChordsByOnset(notes, opts.chordSec);
  let beam: Candidate[] = [{ cost: 0, hands: startingPositions(chords), trail: null }];

  for (const chord of chords) {
    const next: Candidate[] = [];
    for (const candidate of beam) {
      for (let cut = 0; cut <= chord.length; cut++) {
        const step = cutCost(chord, cut, candidate.hands, opts);
        next.push({
          cost: candidate.cost + step.cost,
          hands: step.hands,
          trail: { cut, prev: candidate.trail },
        });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, opts.beamWidth);
  }

  applyCuts(chords, beam[0]!.trail);
}

/** Group notes into chords by start time; each chord is sorted low to high. */
function groupChordsByOnset(notes: readonly Note[], chordSec: number): Note[][] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const chords: Note[][] = [];
  let current: Note[] = [];
  let anchor = -Infinity;

  for (const note of sorted) {
    if (note.time - anchor > chordSec) {
      current = [];
      chords.push(current);
      anchor = note.time;
    }
    current.push(note);
  }
  for (const chord of chords) chord.sort((a, b) => a.midi - b.midi);
  return chords;
}

/**
 * Where to assume the hands start.
 *
 * The first chord has no history to move from, so the hands begin at the centre of the music
 * on either side of {@link chooseSplitPoint}'s boundary, having last played a second before
 * the piece — near enough to matter, far enough that reaching the opening chord is not
 * treated as a leap. That boundary only ever decides the opening; from the second chord on,
 * the music itself does.
 */
function startingPositions(chords: readonly Note[][]): HandPositions {
  const notes = chords.flat();
  const split = chooseSplitPoint(notes);
  const below = notes.filter((n) => n.midi < split).map((n) => n.midi);
  const above = notes.filter((n) => n.midi >= split).map((n) => n.midi);
  const since = (chords[0]?.[0]?.time ?? 0) - 1;
  return {
    left: { at: median(below) ?? split - 7, since },
    right: { at: median(above) ?? split + 7, since },
    lastUsed: null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** What it costs to give the lowest `cut` notes of `chord` to the left hand. */
function cutCost(
  chord: readonly Note[],
  cut: number,
  hands: HandPositions,
  opts: AutoSplitOptions,
): { cost: number; hands: HandPositions } {
  const sides = [
    { hand: "left" as const, notes: chord.slice(0, cut) },
    { hand: "right" as const, notes: chord.slice(cut) },
  ];

  const time = chord[0]!.time;
  let cost = 0;
  const next: HandPositions = { ...hands };

  for (const side of sides) {
    if (side.notes.length === 0) continue; // an idle hand stays where it was, for free

    const low = side.notes[0]!.midi;
    const high = side.notes[side.notes.length - 1]!.midi;

    const span = high - low;
    if (span > opts.comfortSpan) cost += (span - opts.comfortSpan) * opts.stretchWeight;
    if (span > opts.maxSpan) cost += (span - opts.maxSpan) * opts.spanPenalty;
    if (side.notes.length > opts.maxNotesPerHand) {
      cost += (side.notes.length - opts.maxNotesPerHand) * opts.crowdPenalty;
    }

    // Effort, not distance: a hand with a full beat to get somewhere is barely working,
    // and the same jump inside a run is the hard thing.
    const hand = hands[side.hand];
    const other = hands[side.hand === "left" ? "right" : "left"];
    const centre = (low + high) / 2;
    const available = Math.max(time - hand.since, opts.moveMinSec);
    cost += (Math.abs(centre - hand.at) * opts.moveWeight * opts.moveRefSec) / available;

    // Discounting travel by time is what stops a slow walking bass looking expensive — but
    // it also makes every hand cheap enough to reach anything, and a melody tossed
    // back and forth between the hands costs almost nothing while looking, on the stage,
    // like the colours are flickering. So taking a note the other hand was nearer to is
    // charged separately, and by pitch alone: that is what "this is the same line" means.
    const toHand = Math.abs(centre - hand.at);
    const toOther = Math.abs(centre - other.at);
    if (toHand > toOther) cost += opts.voiceWeight * Math.max(0, 1 - toOther / 12);

    next[side.hand] = { at: centre, since: time };
  }

  const used: Used = cut === 0 ? "right" : cut === chord.length ? "left" : "both";
  next.lastUsed = used;

  if (used !== "both") {
    // One hand taking a whole chord while the other stands by. Legitimate — a right-hand
    // triad over a resting left hand is ordinary piano writing — but not free, or the model
    // would quietly hand every accompaniment to whichever hand happened to be nearest and
    // leave the other one out of the piece.
    const span = chord[chord.length - 1]!.midi - chord[0]!.midi;
    if (chord.length > 1) cost += span * opts.idleWeight;

    // A line played by one hand at a time and handed back and forth. Each hand is near its
    // own notes, so nothing above notices; what gives it away is the handover itself.
    if (hands.lastUsed !== null && hands.lastUsed !== "both" && hands.lastUsed !== used) {
      cost += opts.alternationWeight;
    }
  }

  // Crossed hands are playable and composers do write them, but they are the unusual
  // reading, so they have to be worth it rather than merely possible.
  if (next.left.at > next.right.at) cost += (next.left.at - next.right.at) * opts.crossPenalty;

  return { cost, hands: next };
}

/** Walk the winning back-pointer chain and write the hands onto the notes. */
function applyCuts(chords: readonly Note[][], trail: Trail | null): void {
  let node = trail;
  for (let i = chords.length - 1; i >= 0; i--) {
    const chord = chords[i]!;
    const cut = node?.cut ?? 0;
    node = node?.prev ?? null;
    for (let j = 0; j < chord.length; j++) {
      (chord[j] as Note).hand = j < cut ? "left" : "right";
    }
  }
}
