import * as Tone from "tone";

/**
 * Sound output, behind a small interface so it can be swapped (a sampled piano, a
 * different synth, or silence for tests) without touching game logic.
 *
 * `ensureStarted` must be called from a user gesture — browsers block audio until then.
 */
export interface AudioPlayer {
  ensureStarted(): Promise<void>;
  /** Play a note for a fixed duration (used for auto-played parts). */
  triggerNote(midi: number, velocity: number, durationSec: number): void;
  /** Sustained press (used to echo the player's own key presses). */
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  /** Silence everything the app plays, without changing what it is doing. */
  setMuted(muted: boolean): void;
}

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A soft polyphonic synth voice. Offline-friendly (no samples to download). */
export class ToneAudioPlayer implements AudioPlayer {
  private synth: Tone.PolySynth;
  /** Everything the app plays passes through here, which is what mute switches off. */
  private output: Tone.Volume;
  private started = false;

  constructor() {
    this.output = new Tone.Volume(-8).toDestination();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.8 },
    }).connect(this.output);
  }

  /**
   * Muting cuts the output rather than skipping the notes.
   *
   * Dropping the calls instead would leave a note that was already sounding to ring on,
   * and leave the synth holding a key the app thinks it released — so unmuting could come
   * back to a stuck note. Cutting the output stops the sound now and keeps every voice's
   * bookkeeping straight, mute or not.
   */
  setMuted(muted: boolean): void {
    this.output.mute = muted;
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.started = true;
  }

  triggerNote(midi: number, velocity: number, durationSec: number): void {
    if (!this.started) return;
    this.synth.triggerAttackRelease(midiToFreq(midi), durationSec, undefined, velocity);
  }

  noteOn(midi: number, velocity: number): void {
    if (!this.started) return;
    this.synth.triggerAttack(midiToFreq(midi), undefined, velocity);
  }

  noteOff(midi: number): void {
    if (!this.started) return;
    this.synth.triggerRelease(midiToFreq(midi));
  }
}
