import {
  attackTime,
  damperTime,
  inharmonicity,
  midiToFreq,
  partialAmplitude,
  partialCount,
  partialDecay,
  partialFrequency,
  velocityGain,
  volumeToGain,
} from "./piano.ts";

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
  /**
   * The same, for a note the mute button does not silence.
   *
   * Mute answers "don't play the song at me". A preview is you asking to hear something,
   * now, and the only useful answer to that is the sound — a silent preview would just
   * look like a broken one. Volume still applies: that knob is about how loud the app is
   * allowed to be, which is a different question.
   */
  previewNote(midi: number, velocity: number, durationSec: number): void;
  /** Sustained press (used to echo the player's own key presses). */
  noteOn(midi: number, velocity: number): void;
  noteOff(midi: number): void;
  /** Silence the song the app is playing, without changing what it is doing. */
  setMuted(muted: boolean): void;
  /** Output level, 0 (silent) to 1 (full). */
  setVolume(level: number): void;
}

/** One sounding note: its partials, and the damper that will stop them. */
interface Voice {
  midi: number;
  /** The damper. Every part of the note runs through here, so releasing this stops it. */
  gain: GainNode;
  oscillators: OscillatorNode[];
  startedAt: number;
  released: boolean;
}

/** Above this many notes at once, the oldest is taken to make room. */
const MAX_VOICES = 24;

/** Nothing above this fraction of the sample rate is worth generating. */
const NYQUIST_MARGIN = 0.45;

/**
 * An additive piano, built out of Web Audio primitives.
 *
 * Every note is synthesised from the string model in `piano.ts`: a stack of slightly
 * stretched partials, each with its own decay, plus a short filtered noise burst for the
 * hammer. That is a lot more machinery than one oscillator per note, but a single waveform
 * cannot decay unevenly across its own harmonics, and that uneven decay is most of what a
 * piano *is*. The whole thing goes through a small generated room and a compressor, which
 * is what stops a ten-note chord from sounding like ten separate beeps.
 *
 * Nothing is downloaded — the app stays usable offline, and there is no first-note delay
 * waiting on a sample pack.
 */
export class PianoAudioPlayer implements AudioPlayer {
  private ctx: AudioContext | null = null;

  /**
   * Where every voice meets, and everything downstream is the room and the output chain.
   *
   * Two ways in, because the mute button is upstream of this rather than after it: an
   * ordinary note goes through `muteGain` to get here and a preview connects straight to
   * it. The room has to be on the far side of the mute — a tap taken before it would go
   * on echoing notes that had just been silenced.
   */
  private mix: GainNode | null = null;
  /** The mute button's own gain. Ordinary voices connect here. */
  private muteGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;
  /** Reused by every hammer strike — allocating a noise buffer per note is not free. */
  private noise: AudioBuffer | null = null;

  private readonly voices: Voice[] = [];
  /** Notes currently held down, so `noteOff` knows which voice to damp. */
  private readonly held = new Map<number, Voice>();

  private muted = false;
  private volume = 1;

  /**
   * Muting cuts the output rather than skipping the notes.
   *
   * Dropping the calls instead would leave a note that was already sounding to ring on,
   * and leave the engine holding a key the app thinks it released — so unmuting could come
   * back to a stuck note. Cutting the output stops the sound now and keeps every voice's
   * bookkeeping straight, mute or not.
   *
   * What it cuts is the song: previews join the chain past this point, since asking to
   * hear a song is not something to answer with silence.
   */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.muteGain && this.ctx) {
      // Ramped rather than switched: a gain that jumps mid-waveform is a click.
      this.muteGain.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.01);
    }
  }

  setVolume(level: number): void {
    this.volume = level;
    if (this.volumeGain && this.ctx) {
      this.volumeGain.gain.setTargetAtTime(volumeToGain(level), this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Build the audio graph, on the first user gesture and not before.
   *
   * The context is created here rather than in the constructor so the app does not open one
   * that the browser will only suspend again — and so mute and volume, which are restored
   * from storage before any of this exists, are simply applied once it does.
   */
  async ensureStarted(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    if (typeof AudioContext === "undefined") return; // no audio here (tests, odd hosts)

    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = makeNoise(ctx);

    // Output chain, from the speakers backwards: volume, then a compressor that catches
    // the peaks of a big chord so the master can sit high enough for a single quiet note
    // to still be heard.
    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = volumeToGain(this.volume);
    this.volumeGain.connect(ctx.destination);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 14;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.25;
    compressor.connect(this.volumeGain);

    // A small room. Dry notes are the giveaway of a synthesised piano — a real one is
    // always heard in a space, and a little of one costs nothing here.
    this.mix = ctx.createGain();
    this.mix.connect(compressor);

    const predelay = ctx.createDelay(0.1);
    predelay.delayTime.value = 0.014;
    const reverb = ctx.createConvolver();
    reverb.buffer = makeRoom(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    this.mix.connect(predelay);
    predelay.connect(reverb);
    reverb.connect(wet);
    wet.connect(compressor);

    // The mute, in front of the mix rather than behind it, so a preview can step around
    // it by connecting to the mix directly.
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = this.muted ? 0 : 1;
    this.muteGain.connect(this.mix);

    if (ctx.state === "suspended") await ctx.resume();
  }

  triggerNote(midi: number, velocity: number, durationSec: number): void {
    this.strike(midi, velocity, durationSec, this.muteGain);
  }

  previewNote(midi: number, velocity: number, durationSec: number): void {
    this.strike(midi, velocity, durationSec, this.mix);
  }

  noteOn(midi: number, velocity: number): void {
    const voice = this.startVoice(midi, velocity, this.muteGain);
    if (voice) this.held.set(midi, voice);
  }

  /** A note of a fixed length, into whichever end of the chain the caller belongs at. */
  private strike(
    midi: number,
    velocity: number,
    durationSec: number,
    destination: GainNode | null,
  ): void {
    const voice = this.startVoice(midi, velocity, destination);
    if (!voice) return;
    // Auto-played notes are not held, so nothing else will ever damp them.
    this.release(voice, voice.startedAt + Math.max(0.05, durationSec));
  }

  noteOff(midi: number): void {
    const voice = this.held.get(midi);
    if (!voice || !this.ctx) return;
    this.held.delete(midi);
    this.release(voice, this.ctx.currentTime);
  }

  /**
   * Strike one string: a stack of decaying partials plus the hammer's own noise.
   *
   * The partials are level-normalised against their own sum. They all start in phase, so
   * without that a bright note would peak at several times the level of a mellow one for
   * the same velocity, and the compressor would spend its life undoing it.
   */
  private startVoice(midi: number, velocity: number, destination: GainNode | null): Voice | null {
    const ctx = this.ctx;
    if (!ctx || !destination) return null;

    // Re-striking a key that is still sounding damps the old string first, the way the
    // hammer's own damper does; otherwise a repeated note stacks voice on voice.
    const sounding = this.held.get(midi);
    if (sounding) {
      this.held.delete(midi);
      this.release(sounding, ctx.currentTime, 0.02);
    }
    if (this.voices.length >= MAX_VOICES) this.stealOldest();

    const t0 = ctx.currentTime;
    const attack = attackTime(midi);
    const level = velocityGain(velocity);
    const fundamental = midiToFreq(midi);
    const b = inharmonicity(midi);
    const ceiling = ctx.sampleRate * NYQUIST_MARGIN;

    const partials: { freq: number; amp: number; tau: number; detune: number }[] = [];
    let sum = 0;
    for (let n = 1; n <= partialCount(midi); n++) {
      const freq = partialFrequency(fundamental, n, b);
      if (freq > ceiling) break;
      const amp = partialAmplitude(n, velocity);
      if (amp < 0.002) continue;
      const tau = partialDecay(midi, n);

      // Most keys have two or three strings, tuned very slightly apart. The slow beating
      // between them is a good part of why a piano sounds alive rather than electronic;
      // it matters most in the low partials, so only those pay for the extra oscillator.
      if (n <= 3) {
        partials.push({ freq, amp: amp / 2, tau, detune: -1.6 });
        partials.push({ freq, amp: amp / 2, tau, detune: 1.6 });
      } else {
        partials.push({ freq, amp, tau, detune: 0 });
      }
      sum += amp;
    }
    if (partials.length === 0) return null;

    const gain = ctx.createGain();
    gain.gain.value = 1;
    gain.connect(destination);

    const oscillators: OscillatorNode[] = [];
    let longest = 0;
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = partial.freq;
      osc.detune.value = partial.detune;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime((level * partial.amp) / sum, t0 + attack);
      env.gain.setTargetAtTime(0, t0 + attack, partial.tau);

      osc.connect(env);
      env.connect(gain);
      osc.start(t0);
      oscillators.push(osc);
      longest = Math.max(longest, partial.tau);
    }

    this.strikeNoise(ctx, gain, t0, midi, level * velocity);

    const voice: Voice = { midi, gain, oscillators, startedAt: t0, released: false };
    // A backstop only: every voice is damped by a key release or by its own duration long
    // before this. It exists so a dropped note-off cannot leave oscillators running for
    // the life of the app.
    this.stopAt(voice, t0 + Math.min(30, longest * 6 + 1));
    this.voices.push(voice);
    return voice;
  }

  /**
   * The knock of felt on wire: a very short band of noise around the note.
   *
   * Tiny, and the first thing you miss without it. The partials alone give a tone that
   * fades in from nowhere; this is the moment of contact that says the note was struck
   * rather than switched on.
   */
  private strikeNoise(
    ctx: AudioContext,
    destination: GainNode,
    t0: number,
    midi: number,
    level: number,
  ): void {
    if (!this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.loopEnd = this.noise.duration;

    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = Math.min(6000, Math.max(180, midiToFreq(midi) * 4));
    band.Q.value = 0.9;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(level * 0.6, t0 + 0.001);
    env.gain.setTargetAtTime(0, t0 + 0.001, 0.012);

    source.connect(band);
    band.connect(env);
    env.connect(destination);
    // Started at an offset so repeated notes are not all the identical click.
    source.start(t0, Math.random() * (this.noise.duration - 0.1));
    source.stop(t0 + 0.2);
  }

  /** Drop the damper on a voice at `when`, and schedule its teardown. */
  private release(voice: Voice, when: number, tau = damperTime(voice.midi)): void {
    if (voice.released) return;
    voice.released = true;

    const param = voice.gain.gain;
    param.cancelScheduledValues(when);
    param.setValueAtTime(param.value, when);
    param.setTargetAtTime(0, when, tau);
    this.stopAt(voice, when + tau * 6 + 0.05);
  }

  /** Stop and unhook a voice at `when`, replacing any later stop already scheduled. */
  private stopAt(voice: Voice, when: number): void {
    for (const osc of voice.oscillators) {
      try {
        osc.stop(when);
      } catch {
        /* already stopped — nothing to bring forward */
      }
    }
    // Every oscillator in the voice stops together, so one of them ending is the note being
    // over and the nodes being safe to release. (A voice is never built without partials,
    // so the check is for the compiler rather than for a case that happens.)
    const first = voice.oscillators[0];
    if (!first) return;
    first.onended = () => {
      voice.gain.disconnect();
      const index = this.voices.indexOf(voice);
      if (index !== -1) this.voices.splice(index, 1);
    };
  }

  /**
   * Make room for a new note by damping the oldest sounding one.
   *
   * The oldest is also the quietest by then — it has been decaying the longest — so this is
   * the note least likely to be missed. Held keys are fair game: a stuck sustain that has
   * been ringing for half a minute should not cost the player the note they are playing now.
   */
  private stealOldest(): void {
    if (!this.ctx) return;
    let oldest: Voice | null = null;
    for (const voice of this.voices) {
      if (voice.released) continue;
      if (!oldest || voice.startedAt < oldest.startedAt) oldest = voice;
    }
    if (!oldest) return;
    // Only if this *is* the held one: the same pitch can be sounding twice, once under a
    // finger and once from the auto-played part, and stealing the latter must not leave
    // the key with no voice to release when it comes up.
    if (this.held.get(oldest.midi) === oldest) this.held.delete(oldest.midi);
    this.release(oldest, this.ctx.currentTime, 0.03);
  }
}

/** A second of white noise, shared by every hammer strike. */
function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * An impulse response for the room, generated rather than loaded.
 *
 * Decaying noise is the standard cheap reverb tail, but raw noise makes it hiss; the
 * one-pole filter rolls the top off so the tail is warm and sits behind the notes instead
 * of on top of them. The two channels are independent, which is what makes it wide.
 */
function makeRoom(ctx: AudioContext): AudioBuffer {
  const seconds = 1.8;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smoothed = 0;
    for (let i = 0; i < length; i++) {
      smoothed += 0.32 * (Math.random() * 2 - 1 - smoothed);
      data[i] = smoothed * (1 - i / length) ** 2.6;
    }
  }
  return buffer;
}
