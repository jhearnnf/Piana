import type { Note } from "../core/types.ts";
import type { AudioPlayer } from "../audio/Player.ts";
import { AutoPlayer } from "./AutoPlayer.ts";

/**
 * A few seconds of a song, played fast — what you hear while pointing at a row of the
 * song list.
 *
 * The question a folder of MIDI files leaves you with is "which one is this?", and a file
 * name only sometimes answers it. Playing the piece properly would answer it in about
 * thirty seconds, which is thirty seconds longer than anyone will hold a pointer still
 * for, so this runs the notes through at a few times speed instead: the opening of the
 * piece, at a speed where the tune is still a tune.
 *
 * Deliberately not a scrub or a montage of clips. A tune you half-remember is recognised
 * by its shape over a few bars, and cutting between bits of it destroys exactly that.
 *
 * The mute button does not silence this. It is there so the app will stop playing at you;
 * pointing at a song to hear it is the opposite request, and answering it with silence
 * would just look broken.
 */

/** How long a preview is allowed to run for, in real seconds. */
export const PREVIEW_SECONDS = 8;

/**
 * Bounds on how fast a preview plays.
 *
 * The floor is there because a preview that ran at ordinary speed would just be the song,
 * and you would be waiting on it rather than skimming. The ceiling is the more important
 * one: past about three times speed a melody stops being a melody and turns into a trill,
 * and a preview nobody can recognise is worse than no preview at all. A long piece
 * therefore gets its opening rather than the whole of itself, which is the same bargain
 * the first eight bars have always been.
 */
export const MIN_PREVIEW_RATE = 1.5;
export const MAX_PREVIEW_RATE = 3;

/**
 * Struck softer than the real thing.
 *
 * This is something you are being shown, not something you are playing, and at speed the
 * notes pile up densely enough that full velocity is harsh.
 */
const PREVIEW_VELOCITY = 0.75;

/** Which part of a song to play, and how fast. */
export interface PreviewPlan {
  /** Song time to start from, in seconds. */
  from: number;
  /** Song time to stop at — never more than `PREVIEW_SECONDS` of real time later. */
  until: number;
  /** Song seconds per real second. */
  rate: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Work out what to play for these notes, or null if there is nothing to play.
 *
 * Starts at the first note rather than at zero: a file that opens with two bars of rest
 * would otherwise spend a quarter of its preview in silence, and a hover that stays quiet
 * reads as broken. The rate is then whatever would fit the rest of the piece into the
 * time available — clamped, so a short song is not raced through for no reason and a long
 * one is not made unrecognisable trying to fit.
 */
export function previewPlan(notes: readonly Note[]): PreviewPlan | null {
  const first = notes[0];
  const last = notes[notes.length - 1];
  if (!first || !last) return null;

  const from = first.time;
  const span = Math.max(0, last.time - from);
  const rate = clamp(span / PREVIEW_SECONDS, MIN_PREVIEW_RATE, MAX_PREVIEW_RATE);
  return { from, until: Math.min(last.time, from + PREVIEW_SECONDS * rate), rate };
}

/**
 * Plays previews, one at a time.
 *
 * The note firing is `AutoPlayer`'s, the same as the accompaniment during a run — it
 * already knows how to walk a sorted note list against a clock and how to shorten notes
 * to match a rate. What is added here is the clock itself, because a preview is not part
 * of a run and must not touch the conductor, the playhead, or anything on screen.
 */
export class SongPreview {
  private readonly auto: AutoPlayer;
  private frame: number | null = null;
  /** Resolves the promise the current preview handed out, so callers know it ended. */
  private finish: (() => void) | null = null;

  constructor(audio: AudioPlayer) {
    // The player is wrapped rather than handed over, for the two things that make a
    // preview not the song: it comes out quieter, and it goes in past the mute button —
    // "don't play the song at me" is not an answer to "what is this one?". Only
    // `triggerNote` is ever reached: nothing holds a key down here.
    this.auto = new AutoPlayer({
      ensureStarted: () => audio.ensureStarted(),
      triggerNote: (midi, velocity, duration) =>
        audio.previewNote(midi, velocity * PREVIEW_VELOCITY, duration),
      previewNote: () => {},
      noteOn: () => {},
      noteOff: () => {},
      setMuted: () => {},
      setVolume: () => {},
    });
  }

  /** True while a preview is sounding. */
  isPlaying(): boolean {
    return this.frame !== null;
  }

  /**
   * Play a taste of `notes`, stopping whatever was playing.
   *
   * Resolves when the preview ends — whether it ran out or was stopped — so the list can
   * take the "now playing" mark off a row at the moment the sound actually stops.
   */
  play(notes: readonly Note[]): Promise<void> {
    this.stop();
    const plan = previewPlan(notes);
    if (!plan) return Promise.resolve();

    this.auto.setRate(plan.rate);
    this.auto.setSong([...notes]);
    this.auto.seekTo(plan.from);

    const startedAt = performance.now();
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      const step = (): void => {
        const time = plan.from + ((performance.now() - startedAt) / 1000) * plan.rate;
        this.auto.update(Math.min(time, plan.until));
        // The last note still has to sound, so the run ends after the update that
        // reaches `until`, not before it.
        if (time >= plan.until) this.stop();
        else this.frame = requestAnimationFrame(step);
      };
      this.frame = requestAnimationFrame(step);
    });
  }

  /**
   * Stop the preview.
   *
   * Notes already struck are left to ring out on their own. They are short at this speed
   * and decaying already, and cutting them dead is heard as a click — a worse full stop
   * than simply not playing the next one.
   */
  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const finish = this.finish;
    this.finish = null;
    finish?.();
  }
}
