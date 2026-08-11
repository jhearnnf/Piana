import type { Song } from "../core/types.ts";
import { BLACK_KEY_HEIGHT_RATIO, computeKeyboard, type KeyRect } from "./keyboardLayout.ts";

export interface RendererTheme {
  background: string;
  /** Body of a white key (its front edge, where it is brightest). */
  whiteKey: string;
  /** Back of a white key, in the shade of the black keys. */
  whiteKeyBack: string;
  /** Body of a black key. */
  blackKey: string;
  /** Top face of a black key — the light catching its back edge. */
  blackKeyTop: string;
  /** Front lip of a black key, the face that points at you. */
  blackKeyFoot: string;
  /** Outline of a black key, light enough to read against the stage behind it. */
  blackKeyEdge: string;
  /** Shadow a black key casts onto the white keys underneath. */
  keyShadow: string;
  keyBorder: string;
  hitLine: string;
  label: string;
  leftHand: string;
  rightHand: string;
  /** Fill for a key being held down. Also the colour of the light above it. */
  pressed: string;
  /** Outline of a held key, dark enough to read against `pressed`. */
  pressedEdge: string;
}

const DEFAULT_THEME: RendererTheme = {
  background: "#14161c",
  whiteKey: "#fbfcff",
  whiteKeyBack: "#d9dde8",
  blackKey: "#0f1116",
  blackKeyTop: "#454d61",
  blackKeyFoot: "#2b3140",
  blackKeyEdge: "#5b6479",
  keyShadow: "rgba(0, 0, 0, 0.6)",
  keyBorder: "#0c0d12",
  hitLine: "#5ac8fa",
  label: "#9aa0b0",
  leftHand: "#ff9f6b",
  rightHand: "#5ac8fa",
  pressed: "#ffc247",
  pressedEdge: "#8a5300",
};

/**
 * How much of the hand colour a note keeps when it belongs to a black key.
 *
 * The falling note is the first thing you read — knowing a beat early that the next one
 * is a sharp is what stops the hand landing on the white key beside it. Darkening it is
 * the same cue the keyboard itself gives, moved to where you are already looking.
 */
const BLACK_NOTE_SHADE = 0.62;

/** How far the light above a held key reaches, in pixels and as a share of the fall area. */
const GLOW_MAX_HEIGHT = 130;
const GLOW_HEIGHT_RATIO = 0.4;

/**
 * How far past the key's edges the light has fanned out by the top of the beam, as a
 * multiple of key width. It starts exactly key-wide at the bottom.
 */
const GLOW_SPREAD = 0.5;

/**
 * A `#rrggbb` theme colour as an `rgba()` string.
 *
 * Lets the glow be built from the same `pressed` colour as the key fill, rather than
 * keeping a second, hand-matched translucent copy in the theme that could drift from it.
 */
export function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A `#rrggbb` colour scaled towards black by `factor` (1 = unchanged, 0 = black). */
export function shade(hex: string, factor: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (value: number): number => Math.round(Math.max(0, Math.min(255, value * factor)));
  const parts = [channel((n >> 16) & 255), channel((n >> 8) & 255), channel(n & 255)];
  return `#${parts.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Human label for a MIDI note, e.g. 60 -> "C4". */
export function noteLabel(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]!;
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export interface RenderState {
  /** Current playback time in seconds. */
  nowSec: number;
  /** MIDI numbers currently held down by the player (for key highlight). */
  pressed: ReadonlySet<number>;
}

/**
 * Canvas renderer for the keyboard and the falling notes above it.
 *
 * Rendering-only: it never mutates the song and holds no game logic. The Conductor drives
 * it by calling `render` each frame with the current time. Key/note x-positions come from
 * the shared {@link computeKeyboard} geometry so keys and falling notes always line up.
 */
export class PianoRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly theme: RendererTheme;
  /** Note fill per hand, darkened for black keys. Derived from the theme once. */
  private readonly noteFill: Record<"left" | "right", { white: string; black: string }>;

  private song: Song | null = null;
  private lowMidi = 48; // C3
  private highMidi = 83; // B5
  private lookAheadSec = 3;

  /** How much vertical space the keyboard takes (fraction of canvas height). */
  private keyboardHeightRatio = 0.24;

  private cssWidth = 0;
  private cssHeight = 0;
  private keyRects: KeyRect[] = [];
  private keyByMidi = new Map<number, KeyRect>();

  constructor(private readonly canvas: HTMLCanvasElement, theme: Partial<RendererTheme> = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.noteFill = {
      left: { white: this.theme.leftHand, black: shade(this.theme.leftHand, BLACK_NOTE_SHADE) },
      right: { white: this.theme.rightHand, black: shade(this.theme.rightHand, BLACK_NOTE_SHADE) },
    };
    this.resize();
  }

  setSong(song: Song | null): void {
    this.song = song;
  }

  setVisibleRange(lowMidi: number, highMidi: number): void {
    this.lowMidi = Math.min(lowMidi, highMidi);
    this.highMidi = Math.max(lowMidi, highMidi);
    this.layoutKeys();
  }

  setLookAhead(seconds: number): void {
    this.lookAheadSec = Math.max(0.5, seconds);
  }

  getVisibleRange(): [number, number] {
    return [this.lowMidi, this.highMidi];
  }

  /** Re-read the canvas's CSS size and rebuild the backing store at device resolution. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layoutKeys();
  }

  private get keyboardTop(): number {
    return this.cssHeight * (1 - this.keyboardHeightRatio);
  }

  private layoutKeys(): void {
    this.keyRects = computeKeyboard(this.lowMidi, this.highMidi, this.cssWidth);
    this.keyByMidi = new Map(this.keyRects.map((k) => [k.midi, k]));
  }

  /** Map a time (seconds) to a y pixel: hit line at the keyboard top, older = lower. */
  private timeToY(timeSec: number, nowSec: number): number {
    const fallHeight = this.keyboardTop;
    return fallHeight * (1 - (timeSec - nowSec) / this.lookAheadSec);
  }

  render(state: RenderState): void {
    const { ctx } = this;
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

    if (this.song) this.drawFallingNotes(this.song, state.nowSec);
    this.drawHitLine();
    // Over the hit line, under the keys: the light reads as coming up off the
    // key rather than as another thing lying on the stage.
    this.drawPressGlow(state.pressed);
    this.drawKeyboard(state.pressed);
  }

  /**
   * A shaft of light rising off every held key.
   *
   * The fill colour alone is easy to miss: a held key is a small shape at the bottom edge
   * of the screen, and your eyes are on the falling notes higher up. The glow puts the
   * feedback where you are already looking, and it is visible on a black key — where a
   * bright fill has hardly any area to show itself in — as much as on a white one.
   */
  private drawPressGlow(pressed: ReadonlySet<number>): void {
    if (pressed.size === 0) return;

    const { ctx } = this;
    const top = this.keyboardTop;
    const height = Math.min(GLOW_MAX_HEIGHT, top * GLOW_HEIGHT_RATIO);
    if (height <= 0) return;

    const gradient = ctx.createLinearGradient(0, top - height, 0, top);
    gradient.addColorStop(0, withAlpha(this.theme.pressed, 0));
    gradient.addColorStop(1, withAlpha(this.theme.pressed, 0.55));

    ctx.save();
    // Additive, so two neighbouring keys brighten where they overlap instead of
    // the later one painting a hard edge over the earlier.
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;

    for (const midi of pressed) {
      const key = this.keyByMidi.get(midi);
      if (!key) continue; // pressed a key that is scrolled off the visible range

      // A beam rather than a column: exactly key-wide where it is brightest, fanning out
      // as it fades. A rectangle puts its hard vertical edges at full opacity right where
      // the eye is, and reads as a painted box instead of light coming off the key.
      const spread = key.width * GLOW_SPREAD;
      ctx.beginPath();
      ctx.moveTo(key.x, top);
      ctx.lineTo(key.x + key.width, top);
      ctx.lineTo(key.x + key.width + spread, top - height);
      ctx.lineTo(key.x - spread, top - height);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  private drawFallingNotes(song: Song, nowSec: number): void {
    const { ctx } = this;
    const windowStart = nowSec - 0.5; // keep notes briefly after they're struck
    const windowEnd = nowSec + this.lookAheadSec;

    for (const note of song.notes) {
      if (note.time > windowEnd || note.time + note.duration < windowStart) continue;
      const key = this.keyByMidi.get(note.midi);
      if (!key) continue; // outside the visible range (zoomed out)

      const yBottom = this.timeToY(note.time, nowSec);
      const yTop = this.timeToY(note.time + note.duration, nowSec);
      const height = Math.max(3, yBottom - yTop);

      const inset = key.width * 0.08;
      const x = key.x + inset;
      const w = key.width - inset * 2;

      const fill = this.noteFill[note.hand === "left" ? "left" : "right"];
      ctx.fillStyle = key.isBlack ? fill.black : fill.white;
      this.roundRect(x, yTop, w, height, Math.min(6, w / 2));
      ctx.fill();
      // The darkened fill alone can read as "further away" rather than "black key", so a
      // sharp also gets the outline its key has.
      if (key.isBlack) {
        ctx.strokeStyle = fill.white;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  private drawHitLine(): void {
    const { ctx } = this;
    const y = this.keyboardTop;
    ctx.strokeStyle = this.theme.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.cssWidth, y);
    ctx.stroke();
  }

  private drawKeyboard(pressed: ReadonlySet<number>): void {
    const top = this.keyboardTop;
    const fullHeight = this.cssHeight - top;

    // White keys first, black keys on top.
    this.drawWhiteKeys(pressed, top, fullHeight);
    this.drawBlackKeys(pressed, top, fullHeight * BLACK_KEY_HEIGHT_RATIO);
  }

  private drawWhiteKeys(pressed: ReadonlySet<number>, top: number, height: number): void {
    const { ctx } = this;
    // Shaded at the back, bright at the front edge — the same fall of light that makes a
    // real keyboard readable, and it darkens exactly the strip the black keys sit in.
    const face = ctx.createLinearGradient(0, top, 0, top + height);
    face.addColorStop(0, this.theme.whiteKeyBack);
    face.addColorStop(0.45, this.theme.whiteKey);

    for (const key of this.keyRects) {
      if (key.isBlack) continue;
      const down = pressed.has(key.midi);
      ctx.fillStyle = down ? this.theme.pressed : face;
      ctx.fillRect(key.x, top, key.width, height);
      // A held key is outlined in a dark amber rather than the usual near-black:
      // the border is what separates it from a held key right next to it.
      ctx.strokeStyle = down ? this.theme.pressedEdge : this.theme.keyBorder;
      ctx.lineWidth = down ? 2 : 1;
      ctx.strokeRect(key.x + 0.5, top + 0.5, key.width - 1, height - 1);
      if (key.midi % 12 === 0) this.drawKeyLabel(key, top + height);
    }
  }

  /**
   * The black keys, drawn as raised objects rather than dark rectangles.
   *
   * Flat near-black on a near-black stage left them hard to pick out at a glance — the one
   * thing you most need to see, since hitting a sharp instead of the white key beside it is
   * the commonest mistake. Three things separate them now: a lit top face and front lip so
   * the key has a shape, a rim light along the edge so it survives the dark background
   * above the keyboard, and a shadow cast down onto the white keys so it reads as sitting
   * on top of them.
   */
  private drawBlackKeys(pressed: ReadonlySet<number>, top: number, height: number): void {
    const { ctx } = this;
    const body = ctx.createLinearGradient(0, top, 0, top + height);
    body.addColorStop(0, this.theme.blackKeyTop);
    body.addColorStop(0.28, this.theme.blackKey);
    body.addColorStop(0.86, this.theme.blackKey);
    body.addColorStop(1, this.theme.blackKeyFoot);

    for (const key of this.keyRects) {
      if (!key.isBlack) continue;
      const down = pressed.has(key.midi);
      this.roundRect(key.x, top, key.width, height, 3);

      ctx.save();
      ctx.shadowColor = this.theme.keyShadow;
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = down ? this.theme.pressed : body;
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = down ? this.theme.pressedEdge : this.theme.blackKeyEdge;
      ctx.lineWidth = down ? 2 : 1;
      ctx.stroke();
    }
  }

  private drawKeyLabel(key: KeyRect, bottom: number): void {
    if (key.width < 16) return; // too narrow to read
    const { ctx } = this;
    ctx.fillStyle = this.theme.label;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(noteLabel(key.midi), key.x + key.width / 2, bottom - 4);
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /** Hit-test a canvas point to a MIDI key (black keys take priority). Used for clicks. */
  keyAtPoint(px: number, py: number): number | null {
    if (py < this.keyboardTop) return null;
    const blackBottom = this.keyboardTop + (this.cssHeight - this.keyboardTop) * BLACK_KEY_HEIGHT_RATIO;
    for (const key of this.keyRects) {
      if (key.isBlack && px >= key.x && px <= key.x + key.width && py <= blackBottom) {
        return key.midi;
      }
    }
    for (const key of this.keyRects) {
      if (!key.isBlack && px >= key.x && px <= key.x + key.width) return key.midi;
    }
    return null;
  }
}
