import type { Note } from "../core/types.ts";
import type { AudioPlayer } from "../audio/Player.ts";

/** Which notes the app plays for the user (the non-practised hand, or everything). */
export type NotePredicate = (note: Note) => boolean;

/**
 * Fires audio for notes as the playhead crosses their start time.
 *
 * It walks the sorted note list with a moving index (cheap per frame) and handles seeks /
 * loop wraps by re-binary-searching when time moves backwards. The set of notes it plays
 * is controlled by a predicate, so hand-selection can hand it "everything except the hand
 * the player is practising". Logic is testable with a mock AudioPlayer.
 */
export class AutoPlayer {
  private notes: Note[] = [];
  private index = 0;
  private lastTime = 0;
  private predicate: NotePredicate = () => true;
  /** Wall-seconds per song-second (1 / rate), so slowed playback holds notes longer. */
  private timeScale = 1;

  constructor(private readonly player: AudioPlayer) {}

  setSong(notes: Note[]): void {
    this.notes = notes; // already sorted by time
    this.seekTo(0);
  }

  setPredicate(predicate: NotePredicate): void {
    this.predicate = predicate;
  }

  setRate(rate: number): void {
    this.timeScale = 1 / Math.max(0.1, rate);
  }

  /** Reposition without playing (call on seek / loop start). */
  seekTo(time: number): void {
    this.index = this.firstIndexAtOrAfter(time);
    this.lastTime = time;
  }

  /** Advance to `now`, firing any notes whose start fell in (lastTime, now]. */
  update(now: number): void {
    if (now + 1e-6 < this.lastTime) {
      this.seekTo(now); // time jumped backwards (loop/seek)
      return;
    }
    while (this.index < this.notes.length && this.notes[this.index]!.time <= now) {
      const note = this.notes[this.index]!;
      if (this.predicate(note)) {
        this.player.triggerNote(note.midi, note.velocity, note.duration * this.timeScale);
      }
      this.index++;
    }
    this.lastTime = now;
  }

  /** First index whose note starts at or after `time` (binary search). */
  private firstIndexAtOrAfter(time: number): number {
    let lo = 0;
    let hi = this.notes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.notes[mid]!.time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
