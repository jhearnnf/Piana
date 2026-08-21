import type { Song } from "../core/types.ts";
import type { TimeRange } from "../game/practice.ts";
import { loopOffsets, type LoopMarks } from "../song/loopRegion.ts";
import { BLACK_KEY_HEIGHT_RATIO, computeKeyboard, type KeyRect } from "./keyboardLayout.ts";
import { nextRepeatStarts, noteBarTop } from "./noteBars.ts";

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
  /** The loop markers, and the tabs naming them. */
  loopMark: string;
  /** Ink of a marker's tab, read against `loopMark`. */
  loopMarkInk: string;
  /** Veil drawn over the music outside the marked region. */
  loopVeil: string;
}

/**
 * The stage's colours, shared with the timeline below it.
 *
 * Exported so the map of the whole song is drawn in the same left and right hands, and
 * marks its loop points in the same green, as the notes falling above it. Two surfaces
 * describing one song should not be able to disagree about what colour that song is.
 */
export const STAGE_THEME: RendererTheme = {
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
  loopMark: "#6bd490",
  loopMarkInk: "#0b2417",
  loopVeil: "rgba(8, 9, 13, 0.62)",
};

/**
 * How much of the hand colour a note keeps when it belongs to a black key.
 *
 * The falling note is the first thing you read — knowing a beat early that the next one
 * is a sharp is what stops the hand landing on the white key beside it. Darkening it is
 * the same cue the keyboard itself gives, moved to where you are already looking.
 *
 * Dark enough here that a sharp reads as *outlined* rather than *filled*: shade alone was
 * a difference you had to look for, and at a glance a dimmed bar reads as "further away"
 * rather than "black key". Solid versus hollow is a difference in form, which survives
 * peripheral vision, small keys and a bright room.
 */
const BLACK_NOTE_SHADE = 0.3;

/** Width of a sharp's outline, as a share of the bar's width and in pixels. */
const BLACK_NOTE_EDGE_RATIO = 0.2;
const BLACK_NOTE_EDGE_MIN = 2;
const BLACK_NOTE_EDGE_MAX = 3.5;

/**
 * How far the strike cap is lightened from the hand colour (0 = hand colour, 1 = white).
 *
 * Both hands and both key colours use the same lightening, so the cap always reads as the
 * same thing — "this is a new press" — rather than as a fifth note colour to learn.
 */
const STRIKE_CAP_TINT = 0.55;

/** Height of the strike cap, in pixels and as a share of the bar it sits on. */
const STRIKE_CAP_HEIGHT = 6;
const STRIKE_CAP_RATIO = 0.4;

/**
 * The gap held open below a repeat of the same note, in pixels.
 *
 * Taken out of the tail of the note before it (see `noteBars.ts`). Large enough to be
 * unmistakable at arm's length — a hair's-width gap is worse than none, because it looks
 * like an artefact rather than a release.
 */
const REPEAT_GAP = 14;

/** Shortest a bar may be drawn, so trimming a tail can never erase the note. */
const MIN_NOTE_HEIGHT = 5;

/** How far either side of a loop marker counts as grabbing it, in pixels. */
const MARK_GRAB_PX = 8;

/** How long a note is kept on screen after it has been struck, in seconds. */
const TAIL_SEC = 0.5;

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

/** A `#rrggbb` colour mixed towards white by `amount` (0 = unchanged, 1 = white). */
export function tint(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (value: number): number =>
    Math.round(Math.max(0, Math.min(255, value + (255 - value) * amount)));
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
  /** The loop points marked so far. Either end may still be unset. */
  loop?: LoopMarks | null;
  /**
   * The region being looped, when Loop is on.
   *
   * Given, the stage shows nothing but this region's music, wrapped: its opening bars
   * fall directly above its closing ones, lap after lap, so the repeat arrives instead of
   * interrupting.
   */
  wrap?: TimeRange | null;
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
  /** Note colours per hand: bar fill, sharp outline, strike cap. Derived from the theme once. */
  private readonly noteFill: Record<
    "left" | "right",
    { white: string; black: string; edge: string; cap: string }
  >;

  private song: Song | null = null;
  /**
   * Where the next strike of each note's own pitch begins, one entry per note.
   *
   * Rebuilt with the song rather than searched per frame — see `noteBars.ts`.
   */
  private repeatStarts: number[] = [];
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
    this.theme = { ...STAGE_THEME, ...theme };
    const hand = (colour: string) => ({
      white: colour,
      black: shade(colour, BLACK_NOTE_SHADE),
      edge: colour,
      cap: tint(colour, STRIKE_CAP_TINT),
    });
    this.noteFill = { left: hand(this.theme.leftHand), right: hand(this.theme.rightHand) };
    this.resize();
  }

  setSong(song: Song | null): void {
    this.song = song;
    this.repeatStarts = song ? nextRepeatStarts(song.notes) : [];
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

    const wrap = state.wrap ?? null;
    if (this.song) this.drawFallingNotes(this.song, state.nowSec, wrap);
    if (state.loop || wrap) this.drawLoopMarks(state.loop ?? null, wrap, state.nowSec);
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

  /**
   * The falling notes, once through the song — or, while a region is looping, that region
   * over and over.
   *
   * Wrapped, the rest of the piece is not drawn at all: the notes on either side of the
   * loop are not ones you are going to play, and leaving them there behind the repeats
   * would be two songs falling down the same screen.
   */
  private drawFallingNotes(song: Song, nowSec: number, wrap: TimeRange | null): void {
    const windowStart = nowSec - TAIL_SEC;
    const windowEnd = nowSec + this.lookAheadSec;

    if (!wrap) {
      this.drawNotePass(song, nowSec, windowStart, windowEnd, 0, null);
      return;
    }
    for (const offset of loopOffsets(wrap, windowStart, windowEnd)) {
      this.drawNotePass(song, nowSec, windowStart, windowEnd, offset, wrap);
    }
  }

  /** One pass over the song, with every note shifted later by `offset` seconds. */
  private drawNotePass(
    song: Song,
    nowSec: number,
    windowStart: number,
    windowEnd: number,
    offset: number,
    wrap: TimeRange | null,
  ): void {
    for (let i = 0; i < song.notes.length; i++) {
      const note = song.notes[i]!;
      if (wrap && (note.time < wrap.start || note.time >= wrap.end)) continue;
      const time = note.time + offset;
      if (time > windowEnd || time + note.duration < windowStart) continue;
      const key = this.keyByMidi.get(note.midi);
      if (!key) continue; // outside the visible range (zoomed out)

      // The head — the edge that meets the hit line — is the note's start, so a bar falls
      // head-down and its tail is the part that has already been played.
      const yHead = this.timeToY(time, nowSec);
      const yEnd = this.timeToY(time + note.duration, nowSec);

      const repeatStart = this.repeatStarts[i] ?? Infinity;
      const yRepeat = Number.isFinite(repeatStart)
        ? this.timeToY(repeatStart + offset, nowSec)
        : -Infinity; // never repeated: infinitely far up the screen
      const yTop = noteBarTop(yEnd, yHead, yRepeat, REPEAT_GAP, MIN_NOTE_HEIGHT);
      const height = Math.max(MIN_NOTE_HEIGHT, yHead - yTop);

      const inset = key.width * 0.08;
      const x = key.x + inset;
      const w = key.width - inset * 2;

      this.drawNoteBar(x, yTop, w, height, key.isBlack, note.hand === "left" ? "left" : "right");
    }
  }

  /**
   * One falling note.
   *
   * Two things beyond the hand colour are drawn here, and both exist to answer a question
   * the bar alone cannot: *what am I about to press, and is it a new press?*
   *
   * A sharp is hollow — dark body, bright outline — where a natural is solid. Shape reads
   * faster than shade, and it holds up on the narrow bars a black key gets.
   *
   * Every bar is capped with a lighter band at its head. That is the moment of striking
   * the key, and with the gap held open below a repeat (see `noteBars.ts`) it is what
   * separates "press this again" from "keep holding it" once the join has slid off the
   * bottom of the screen.
   */
  private drawNoteBar(
    x: number,
    y: number,
    w: number,
    h: number,
    isBlack: boolean,
    hand: "left" | "right",
  ): void {
    const { ctx } = this;
    const colours = this.noteFill[hand];
    const radius = Math.min(isBlack ? 3 : 6, w / 2, h / 2);

    ctx.fillStyle = isBlack ? colours.black : colours.white;
    this.roundRect(x, y, w, h, radius);
    ctx.fill();

    const capHeight = Math.min(STRIKE_CAP_HEIGHT, h * STRIKE_CAP_RATIO);
    ctx.save();
    ctx.clip(); // to the bar just drawn, so the cap keeps its rounded corners
    ctx.fillStyle = colours.cap;
    ctx.fillRect(x, y + h - capHeight, w, capHeight);
    ctx.restore();

    if (!isBlack) return;
    // Stroked last so the outline runs unbroken across the cap, and inset by half its own
    // width so a thick line stays inside the bar instead of straddling the neighbouring key.
    const lineWidth = Math.min(
      BLACK_NOTE_EDGE_MAX,
      Math.max(BLACK_NOTE_EDGE_MIN, w * BLACK_NOTE_EDGE_RATIO),
      w / 3, // a bar zoomed down to a few pixels stays a bar, not a solid line
      h / 3,
    );
    ctx.strokeStyle = colours.edge;
    ctx.lineWidth = lineWidth;
    this.roundRect(
      x + lineWidth / 2,
      y + lineWidth / 2,
      w - lineWidth,
      h - lineWidth,
      Math.max(0, radius - lineWidth / 2),
    );
    ctx.stroke();
  }

  /**
   * The loop points, and a veil over everything outside them.
   *
   * The veil is the part that does the work. Two lines on a dark stage are two lines you
   * have to find and then work out which side of; dimming the music that will not be
   * played says the same thing in the shape you already read the stage in — what is lit
   * is what you are practising.
   */
  private drawLoopMarks(marks: LoopMarks | null, wrap: TimeRange | null, nowSec: number): void {
    if (wrap) {
      this.drawLapLines(wrap, nowSec);
      return;
    }
    if (!marks) return;

    const { ctx } = this;
    const top = this.keyboardTop;
    const { start, end } = marks;

    ctx.fillStyle = this.theme.loopVeil;
    // Earlier than the start means lower down the stage, so the start's veil hangs below
    // its line, all the way to the keys.
    if (start !== null) {
      const y = Math.max(0, this.timeToY(start, nowSec));
      if (y < top) ctx.fillRect(0, y, this.cssWidth, top - y);
    }
    if (end !== null) {
      const y = Math.min(top, this.timeToY(end, nowSec));
      if (y > 0) ctx.fillRect(0, 0, this.cssWidth, y);
    }

    if (start !== null) this.drawLoopMark(this.timeToY(start, nowSec), "LOOP START", -1);
    if (end !== null) this.drawLoopMark(this.timeToY(end, nowSec), "LOOP END", 1);
  }

  /**
   * The seams of a looping region: a line wherever one lap ends and the next begins.
   *
   * No veil here, because with the region wrapped there is nothing on the stage that is
   * not the loop. Only the two seams of the lap you are playing are named — the ones
   * further up and down the ribbon are the same two boundaries coming round again, and
   * repeating their labels would say nothing except that the loop is short.
   */
  private drawLapLines(wrap: TimeRange, nowSec: number): void {
    const windowStart = nowSec - TAIL_SEC;
    const windowEnd = nowSec + this.lookAheadSec;

    for (const offset of loopOffsets(wrap, windowStart, windowEnd)) {
      // Each lap opens on the region's start and closes on its end; drawn from the region
      // rather than from the marks so a seam and the music either side of it cannot drift
      // apart by a frame.
      const named = offset === 0;
      this.drawLoopMark(this.timeToY(wrap.start + offset, nowSec), named ? "LOOP START" : null, -1);
      this.drawLoopMark(this.timeToY(wrap.end + offset, nowSec), named ? "LOOP END" : null, 1);
    }
  }

  /**
   * One loop marker: a dashed rule across the stage with a tab naming it.
   *
   * Dashed, because a solid line the width of the stage is what the hit line is, and the
   * two say very different things. The tab sits on the side the region is on — `inside`
   * is -1 for up the screen, 1 for down — so the pair of them frame the passage rather
   * than pointing away from it. A `null` label draws the line alone, for the seams of a
   * lap other than the one being played.
   */
  private drawLoopMark(y: number, label: string | null, inside: number): void {
    const { ctx } = this;
    const top = this.keyboardTop;
    if (y < 0 || y > top) return; // scrolled off the stage

    ctx.save();
    ctx.strokeStyle = this.theme.loopMark;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.cssWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (label === null) {
      ctx.restore();
      return;
    }

    ctx.font = "700 10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(label).width + 16;
    const height = 17;
    const x = Math.max(6, this.cssWidth - width - 12);
    // Clamped onto the stage so a marker sitting at either edge still says which it is,
    // instead of hanging its own name off the top of the screen.
    const tabY = Math.min(top - height - 2, Math.max(2, inside > 0 ? y + 3 : y - height - 3));

    ctx.fillStyle = this.theme.loopMark;
    this.roundRect(x, tabY, width, height, 4);
    ctx.fill();
    ctx.fillStyle = this.theme.loopMarkInk;
    ctx.fillText(label, x + width / 2, tabY + height / 2 + 0.5);
    ctx.restore();
  }

  /**
   * The song time showing at the very top of the stage.
   *
   * Where the loop *end* is dropped. The start goes on the hit line, because that is the
   * moment a passage begins — but a passage ends at the far side of the music you can see
   * coming, and aiming its end at the top edge means a region shorter than the look-ahead
   * is framed on the screen whole, both markers visible at once.
   */
  timeAtTop(nowSec: number): number {
    return nowSec + this.lookAheadSec;
  }

  /** The song time a y pixel on the stage stands for — {@link timeToY} read backwards. */
  timeAtY(y: number, nowSec: number): number {
    const fallHeight = this.keyboardTop;
    if (!(fallHeight > 0)) return nowSec;
    return nowSec + (1 - y / fallHeight) * this.lookAheadSec;
  }

  /**
   * Which loop marker a height on the stage is grabbing, or null if neither.
   *
   * Only the height is asked for, because a marker is a line right across the stage — it
   * can be taken hold of anywhere along it. A line two pixels thick is not something
   * anyone can put a mouse on, so the reach is a fingertip's width either side, and when
   * both markers are inside that reach the nearer one wins; otherwise a region squeezed
   * shut would only ever let go of whichever end happened to be tested first.
   */
  markAtY(py: number, marks: LoopMarks, nowSec: number): "start" | "end" | null {
    if (py < 0 || py > this.keyboardTop) return null;

    let best: "start" | "end" | null = null;
    let bestDistance = MARK_GRAB_PX;
    for (const which of ["start", "end"] as const) {
      const time = marks[which];
      if (time === null) continue;
      const distance = Math.abs(this.timeToY(time, nowSec) - py);
      if (distance <= bestDistance) {
        best = which;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * How much song time one pixel of the fall area is worth.
   *
   * The scale the falling notes are drawn at, handed out so a gesture that scrolls the
   * track can move the music by exactly as far as it looks like it should.
   */
  secondsPerPixel(): number {
    return this.keyboardTop > 0 ? this.lookAheadSec / this.keyboardTop : 0;
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
