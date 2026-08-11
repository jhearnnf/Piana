/**
 * The transport clock that drives playback.
 *
 * It converts wall-clock milliseconds into song time, honouring play/pause, a speed rate,
 * and an optional loop range (used for section practice). All timing lives here so the
 * render loop, audio, and scoring share one source of truth. The clock math takes an
 * explicit `nowMs` so it can be unit-tested without a real clock.
 */
export interface LoopRange {
  start: number;
  end: number;
}

export class Conductor {
  private timeSec = 0;
  private rateValue = 1;
  private playing = false;
  private lastTickMs = NaN;
  private loop: LoopRange | null = null;

  /** Total song length in seconds; playback pauses on reaching it (when not looping). */
  duration = 0;

  get time(): number {
    return this.timeSec;
  }

  get rate(): number {
    return this.rateValue;
  }

  set rate(value: number) {
    this.rateValue = Math.max(0.1, value);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getLoop(): LoopRange | null {
    return this.loop;
  }

  play(): void {
    this.playing = true;
    this.lastTickMs = NaN; // re-anchor on the next tick so no time jump accrues
  }

  pause(): void {
    this.playing = false;
  }

  stop(): void {
    this.playing = false;
    this.seek(this.loop ? this.loop.start : 0);
  }

  seek(seconds: number): void {
    this.timeSec = Math.max(0, seconds);
    this.lastTickMs = NaN;
  }

  /** Set a loop range to practise, or null to clear it. Seeks to the loop start. */
  setLoop(range: LoopRange | null): void {
    this.loop = range;
    if (range) this.seek(range.start);
  }

  /** Advance the clock to wall-clock `nowMs` and return the current song time. */
  tick(nowMs: number): number {
    if (!this.playing) {
      this.lastTickMs = nowMs;
      return this.timeSec;
    }
    if (Number.isNaN(this.lastTickMs)) this.lastTickMs = nowMs;
    const delta = ((nowMs - this.lastTickMs) / 1000) * this.rateValue;
    this.lastTickMs = nowMs;
    this.setTime(this.timeSec + delta);
    return this.timeSec;
  }

  private setTime(t: number): void {
    if (this.loop) {
      const len = this.loop.end - this.loop.start;
      if (len > 0 && t >= this.loop.end) {
        // Wrap with carry so we don't drift on each loop.
        t = this.loop.start + ((t - this.loop.start) % len);
      }
    } else if (this.duration > 0 && t >= this.duration) {
      t = this.duration;
      this.playing = false;
    }
    this.timeSec = Math.max(0, t);
  }
}
