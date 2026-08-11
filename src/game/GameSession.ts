import type { Difficulty, HandSelection, Note, Song } from "../core/types.ts";
import type { Conductor } from "./Conductor.ts";
import type { AutoPlayer } from "./AutoPlayer.ts";
import { ScoringSession, type HitResult, type ScoreResult } from "./Scoring.ts";
import { groupChords, splitPractice, type NoteGroup, type TimeRange } from "./practice.ts";

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
  private readonly gateSatisfied = new Set<number>();

  private rangeStart = 0;
  private rangeEnd = 0;
  private state: SessionState = "idle";

  /** Fired once when a scored run reaches the end of its range. */
  onFinish?: (result: ScoreResult) => void;

  constructor(
    private readonly conductor: Conductor,
    private readonly autoPlayer: AutoPlayer,
  ) {}

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

  /** Rewind to the start of the range and clear the score, ready to play again. */
  reset(): void {
    this.conductor.pause();
    this.conductor.seek(this.rangeStart);
    this.autoPlayer.seekTo(this.rangeStart);
    this.gateIndex = 0;
    this.gateSatisfied.clear();
    this.scoring = new ScoringSession(this.required);
    this.state = "idle";
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
    const group = this.groups[this.gateIndex];
    if (group && group.midis.includes(midi) && !this.gateSatisfied.has(midi)) {
      this.gateSatisfied.add(midi);
      // Judge at the ideal time: wait-mode rewards correctness, not reaction speed.
      const result = this.scoring!.registerHit(midi, group.time);
      if (this.gateSatisfied.size >= group.midis.length) {
        this.gateIndex++;
        this.gateSatisfied.clear();
      }
      return result;
    }
    // A note that isn't part of the current chord counts as wrong.
    return this.scoring!.registerHit(midi, this.conductor.time);
  }

  /** Advance the session to `nowSec`. Call once per frame after the Conductor ticks. */
  update(nowSec: number): void {
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
    if (!this.config?.loop && this.conductor.time >= this.rangeEnd) this.finish();
  }

  private finish(): void {
    if (this.state === "finished") return;
    this.conductor.pause();
    this.scoring?.finalize();
    this.state = "finished";
    if (this.scoring && this.config) this.onFinish?.(this.scoring.result(this.config.difficulty));
  }
}
