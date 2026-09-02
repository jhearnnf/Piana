import type { Difficulty, HandSelection, Note, Song } from "../core/types.ts";
import type { Conductor } from "./Conductor.ts";
import type { AutoPlayer } from "./AutoPlayer.ts";
import { ScoringSession, type HitResult, type ScoreResult } from "./Scoring.ts";
import {
  advanceGate,
  findGate,
  firstGroupAtOrAfter,
  groupChords,
  splitPractice,
  type NoteGroup,
  type TimeRange,
} from "./practice.ts";

export interface SessionConfig {
  song: Song;
  hand: HandSelection;
  difficulty: Difficulty;
  /** Section to practise, or null for the whole song. */
  range: TimeRange | null;
  /** Wait for the correct note before advancing (Synthesia "melody practice"). */
  waitMode: boolean;
  /** Loop the range continuously for practice instead of ending with a score. */
  loop: boolean;
}

export type SessionState = "idle" | "running" | "finished";

/**
 * Longest gap between frames the lap clock will believe, in seconds.
 *
 * Comfortably longer than the worst frame a loaded machine produces and far shorter than
 * the smallest interruption worth noticing. See {@link GameSession.tickLapClock}.
 */
const MAX_FRAME_SEC = 1;

/**
 * Orchestrates a play-through: it decides which notes the player owns vs the app plays,
 * drives the {@link Conductor}, feeds the {@link ScoringSession}, and implements wait-mode
 * gating. It holds no rendering or device code — the render loop calls `update` each frame
 * and forwards key presses to `handleHit`.
 */
export class GameSession {
  private config: SessionConfig | null = null;
  private required: Note[] = [];
  private scoring: ScoringSession | null = null;

  // Wait-mode gating over chord groups.
  private groups: NoteGroup[] = [];
  private gateIndex = 0;
  /** Which pitches of each pending gate have been played, keyed by gate index. */
  private readonly gateSatisfied = new Map<number, Set<number>>();

  private rangeStart = 0;
  private rangeEnd = 0;
  private state: SessionState = "idle";
  /**
   * Where the clock was at the previous `update`, so the end of the range can be judged by
   * arriving at it rather than by sitting past it. See {@link reachedEnd}.
   */
  private lastUpdateSec = 0;

  /** Wall-clock seconds spent playing the lap under way. See {@link tickLapClock}. */
  private lapSeconds = 0;
  /** Wall clock at the previous `update`, or NaN when the lap clock needs re-anchoring. */
  private lastWallMs = NaN;
  /**
   * Whether the lap under way began at the top of the range.
   *
   * Only a lap played from its start is an attempt at the passage. Scroll into the middle
   * of a looping run and what comes round is half of one, and filing that alongside the
   * whole thing would put a dip in the record for having looked at something.
   */
  private lapFromStart = false;

  /** Fired once when a scored run reaches the end of its range. */
  onFinish?: (result: ScoreResult, seconds: number) => void;

  /**
   * Fired when a lap of a looping run comes round, with that lap's own score and how long
   * it took.
   *
   * A loop is where the practice happens and it never finishes, so without this the only
   * runs the app could ever record are the ones played end to end — which is to say, none
   * of the ones you spend an evening on. Laps nobody played are not reported: a loop left
   * running while you listen, or while you are out of the room, is not an attempt at
   * anything and would drag a report's line down for hours at a time.
   */
  onLap?: (result: ScoreResult, seconds: number) => void;

  constructor(
    private readonly conductor: Conductor,
    private readonly autoPlayer: AutoPlayer,
  ) {
    this.conductor.onLoop = () => this.startLap();
  }

  getState(): SessionState {
    return this.state;
  }

  configure(config: SessionConfig): void {
    this.config = config;
    const { song, hand, range } = config;
    const split = splitPractice(song.notes, hand, range);
    this.required = split.required;
    this.groups = groupChords(split.required);

    // The app sounds only the auto (non-practised) notes; the player supplies the rest.
    const autoSet = new Set(split.auto);
    this.autoPlayer.setSong(song.notes);
    this.autoPlayer.setPredicate((n) => autoSet.has(n));

    this.rangeStart = range?.start ?? 0;
    this.rangeEnd = range?.end ?? song.durationSec;
    this.conductor.duration = song.durationSec;
    // Looping practice wraps within the range; a scored run plays it once.
    this.conductor.setLoop(config.loop ? { start: this.rangeStart, end: this.rangeEnd } : null);
    this.reset();
  }

  /**
   * Rewind to the start of the range and clear the score, ready to play again.
   *
   * The lap being abandoned goes unrecorded. Starting over is what you do when a lap went
   * wrong, and a record that counted the half you walked away from would be counting the
   * decision to try again as a failure.
   */
  reset(): void {
    this.conductor.pause();
    this.conductor.seek(this.rangeStart);
    this.aimAt(this.rangeStart);
    this.scoring = new ScoringSession(this.required);
    this.startClock(true);
    this.state = "idle";
  }

  /**
   * Move the run to `seconds`, taking everything that follows the clock along with it.
   *
   * This is what scrolling the track calls. The gate has to move too: left where it was,
   * wait mode would spend every frame hauling the clock back to a chord you have just
   * scrolled past, and the music would refuse to move at all.
   *
   * The score is left alone. Scrolling is how you go and look at a passage, not a second
   * attempt at the one you were playing — and a run you have scrolled through is finished
   * from the results screen either way.
   */
  seek(seconds: number): void {
    this.conductor.seek(seconds);
    this.aimAt(this.conductor.time);
    this.lapFromStart = false; // what comes round now is part of a lap, not one
  }

  /**
   * Begin a fresh lap of a looping run.
   *
   * A loop is the same passage played again, so everything judging it starts again too:
   * the wait-mode gate goes back to the first chord of the range, the accompaniment
   * re-aims, and the score is taken from scratch rather than carrying the first lap's
   * misses round with it for ever. Without this the gate stayed parked past the last
   * chord of lap one and every lap after it played itself through, waiting for nothing.
   *
   * Aimed at the range's own start rather than at the clock, which the transport wraps a
   * fraction beyond it: a chord written exactly on the loop point is part of the lap, and
   * would otherwise be stepped over by the very carry that keeps the loop from drifting.
   */
  private startLap(): void {
    this.endLap();
    this.aimAt(this.rangeStart);
    this.scoring = new ScoringSession(this.required);
    this.startClock(true);
  }

  /**
   * Hand the lap that has just come round to whoever is keeping the record.
   *
   * Finalized first, so the notes at the end of the passage that nobody played are counted
   * as missed rather than left pending for ever — the lap is over and they are not coming.
   */
  private endLap(): void {
    if (!this.scoring || !this.config || !this.lapFromStart) return;
    this.scoring.finalize();
    const result = this.scoring.result(this.config.difficulty);
    // Judged nothing at all: the loop went by untouched, which is listening rather than
    // practising. See {@link onLap}.
    if (result.perfect + result.good + result.wrong === 0) return;
    this.onLap?.(result, this.lapSeconds);
  }

  /** Begin timing a lap, `fromStart` saying whether it is a whole one. */
  private startClock(fromStart: boolean): void {
    this.lapSeconds = 0;
    this.lastWallMs = NaN;
    this.lapFromStart = fromStart;
  }

  /**
   * Add the frame just gone to the lap's clock, if it was spent playing.
   *
   * What is being timed is how long the passage took you, so a run left paused adds
   * nothing. A frame longer than {@link MAX_FRAME_SEC} is not practice either: it is a
   * machine that went to sleep or a window that stopped being drawn, and counting it would
   * put a lap of forty minutes in the record for having closed the lid.
   */
  private tickLapClock(nowMs: number): void {
    const previous = this.lastWallMs;
    this.lastWallMs = nowMs;
    if (Number.isNaN(previous) || !this.conductor.isPlaying()) return;
    const delta = (nowMs - previous) / 1000;
    if (delta > 0 && delta <= MAX_FRAME_SEC) this.lapSeconds += delta;
  }

  /** Point the gate, the accompaniment and the end-of-run test at `seconds`. */
  private aimAt(seconds: number): void {
    this.autoPlayer.seekTo(seconds);
    this.gateIndex = firstGroupAtOrAfter(this.groups, seconds);
    this.gateSatisfied.clear();
    this.lastUpdateSec = seconds;
  }

  start(): void {
    if (!this.config) return;
    this.reset();
    this.state = "running";
    this.conductor.play();
  }

  stop(): void {
    this.conductor.pause();
    this.state = "idle";
  }

  /** Forward a player key press. Returns how it was judged, or null if not in a run. */
  handleHit(midi: number): HitResult | null {
    if (this.state !== "running" || !this.scoring) return null;
    if (this.config?.waitMode) return this.handleWaitHit(midi);
    return this.scoring.registerHit(midi, this.conductor.time);
  }

  private handleWaitHit(midi: number): HitResult {
    const index = findGate(this.groups, this.gateIndex, midi, this.gateSatisfied);
    // A note belonging to no gate within reach counts as wrong.
    if (index === null) return this.scoring!.registerHit(midi, this.conductor.time);

    let played = this.gateSatisfied.get(index);
    if (!played) this.gateSatisfied.set(index, (played = new Set()));
    played.add(midi);
    // Judge at the ideal time: wait-mode rewards correctness, not reaction speed.
    const result = this.scoring!.registerHit(midi, this.groups[index]!.time);

    this.gateIndex = advanceGate(this.groups, this.gateIndex, this.gateSatisfied);
    // Gates left behind can't be revisited; drop them so the map stays the size of the reach.
    for (const passed of this.gateSatisfied.keys()) {
      if (passed < this.gateIndex) this.gateSatisfied.delete(passed);
    }
    return result;
  }

  /**
   * Advance the session to `nowSec`. Call once per frame after the Conductor ticks.
   *
   * `nowMs` is the wall clock the lap is timed against, taken as an argument so a test can
   * drive it the way it drives the transport.
   */
  update(nowSec: number, nowMs: number = Date.now()): void {
    this.tickLapClock(nowMs);
    if (this.state !== "running") return;

    if (this.config?.waitMode) {
      const group = this.groups[this.gateIndex];
      if (group && nowSec >= group.time) {
        this.conductor.seek(group.time); // hold at the gate until the chord is played
      }
    } else {
      this.scoring?.update(nowSec);
    }

    // Looping practice never ends; a scored run finishes at the end of its range.
    if (!this.config?.loop && this.reachedEnd()) this.finish();
    this.lastUpdateSec = this.conductor.time;
  }

  /**
   * True once the clock has *arrived* at the end of the range, rather than merely sitting
   * past it.
   *
   * Scrolling the track puts the clock wherever the hand goes, and a run that ended the
   * instant you scrolled past the last bar would answer a scroll with a score card. A
   * range with nothing in it is over the moment it begins.
   */
  private reachedEnd(): boolean {
    if (this.rangeEnd <= this.rangeStart) return true;
    return this.conductor.time >= this.rangeEnd && this.lastUpdateSec < this.rangeEnd;
  }

  private finish(): void {
    if (this.state === "finished") return;
    this.conductor.pause();
    this.scoring?.finalize();
    this.state = "finished";
    if (this.scoring && this.config) {
      this.onFinish?.(this.scoring.result(this.config.difficulty), this.lapSeconds);
    }
  }
}
