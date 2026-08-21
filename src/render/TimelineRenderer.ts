import type { Song } from "../core/types.ts";
import type { TimeRange } from "../game/practice.ts";
import type { LoopMarks } from "../song/loopRegion.ts";
import { miniMapNotes, timeToX, xToTime, type MiniNote } from "./miniMap.ts";
import { STAGE_THEME, withAlpha } from "./PianoRenderer.ts";

/**
 * The whole song, drawn small, under the stage.
 *
 * The stage answers "what do I play next" and nothing else — it can only ever show the
 * next three seconds. This answers the questions you ask in between: how long is this,
 * where am I in it, where is the passage that keeps going wrong, and how far is it from
 * here. It is also how you get there: a click on the map is a jump to that moment.
 *
 * The notes are expensive to lay out and never change while a song is loaded, so they are
 * drawn once onto a layer of their own and stamped down each frame. Only the things that
 * move — the playhead, the region, the wash behind what you have played — are redrawn.
 */

/** The song's height on screen is the user's to set; these are the ends of the leash. */
export const MIN_TIMELINE_HEIGHT = 24;
export const MAX_TIMELINE_HEIGHT = 240;
export const DEFAULT_TIMELINE_HEIGHT = 56;

/** Colours particular to the map. Everything else comes from the stage's own theme. */
const BACKGROUND = "#101219";
/** The part of the song that is not being practised, dimmed rather than hidden. */
const OUTSIDE_VEIL = "rgba(16, 18, 25, 0.72)";
/** A wash over what has already gone by, so progress reads at a glance. */
const PLAYED_WASH = 0.13;
/** The line that says where you are. */
const PLAYHEAD_WIDTH = 2;

export interface TimelineState {
  nowSec: number;
  /** The stretch being practised, or null for the whole song. */
  region: TimeRange | null;
  /** The loop points as they stand; either may be down without the other. */
  marks: LoopMarks;
}

export class TimelineRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private song: Song | null = null;

  /** The notes, drawn once at device resolution and stamped down each frame. */
  private layer: HTMLCanvasElement | null = null;
  private layerStale = true;

  private cssWidth = 0;
  private cssHeight = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  setSong(song: Song | null): void {
    this.song = song;
    this.layerStale = true;
  }

  /** Total length of the song on the map, for the caller's own reckoning. */
  get durationSec(): number {
    return this.song?.durationSec ?? 0;
  }

  /** Re-read the canvas's CSS size and rebuild the backing store at device resolution. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === this.cssWidth && rect.height === this.cssHeight) return;

    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.layerStale = true;
  }

  /** The moment a point across the map stands for, for clicking and dragging to it. */
  timeAtX(x: number): number {
    return xToTime(x, this.durationSec, this.cssWidth);
  }

  render(state: TimelineState): void {
    const { ctx } = this;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;

    this.drawNotes();
    this.drawRegion(state.region);
    this.drawPlayed(state.nowSec, state.region);
    this.drawMarks(state.marks);
    this.drawPlayhead(state.nowSec);
  }

  private drawNotes(): void {
    if (this.layerStale) this.buildLayer();
    if (this.layer) this.ctx.drawImage(this.layer, 0, 0, this.cssWidth, this.cssHeight);
  }

  /**
   * Lay the song out once, onto a canvas of its own.
   *
   * A long piece is thousands of rectangles, and re-laying them sixty times a second to
   * draw a playhead that moves two pixels would be the most expensive thing the app does.
   */
  private buildLayer(): void {
    this.layerStale = false;
    this.layer = null;
    if (!this.song || this.cssWidth <= 0 || this.cssHeight <= 0) return;

    const size = { width: this.cssWidth, height: this.cssHeight };
    const notes = miniMapNotes(this.song.notes, this.song.durationSec, size);
    if (notes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Batched by hand rather than set per note: a fill colour assigned three thousand
    // times is most of the cost of drawing three thousand very small rectangles.
    this.fillHand(ctx, notes, "left", STAGE_THEME.leftHand);
    this.fillHand(ctx, notes, "right", STAGE_THEME.rightHand);
    this.layer = layer;
  }

  private fillHand(
    ctx: CanvasRenderingContext2D,
    notes: readonly MiniNote[],
    hand: MiniNote["hand"],
    colour: string,
  ): void {
    ctx.fillStyle = colour;
    for (const note of notes) {
      if (note.hand === hand) ctx.fillRect(note.x, note.y, note.w, note.h);
    }
  }

  /** Dim the song outside the stretch being practised, so the region reads as the lit part. */
  private drawRegion(region: TimeRange | null): void {
    if (!region) return;
    const { ctx } = this;
    const from = this.x(region.start);
    const to = this.x(region.end);

    ctx.fillStyle = OUTSIDE_VEIL;
    ctx.fillRect(0, 0, from, this.cssHeight);
    ctx.fillRect(to, 0, this.cssWidth - to, this.cssHeight);
  }

  /** A wash over what has gone by, bounded by the run so it measures the right thing. */
  private drawPlayed(nowSec: number, region: TimeRange | null): void {
    const from = this.x(region?.start ?? 0);
    const to = Math.max(from, this.x(nowSec));
    if (to <= from) return;
    this.ctx.fillStyle = withAlpha(STAGE_THEME.hitLine, PLAYED_WASH);
    this.ctx.fillRect(from, 0, to - from, this.cssHeight);
  }

  /** The loop points, in the same green they wear on the stage. */
  private drawMarks(marks: LoopMarks): void {
    const { ctx } = this;
    ctx.fillStyle = STAGE_THEME.loopMark;
    for (const time of [marks.start, marks.end]) {
      if (time === null) continue;
      // Held inside the map at both ends: a point on the very last beat would otherwise
      // draw its line half outside the canvas and look like it had been cut off.
      const x = Math.min(this.cssWidth - 2, Math.max(0, this.x(time)));
      ctx.fillRect(x, 0, 2, this.cssHeight);
    }
  }

  private drawPlayhead(nowSec: number): void {
    const { ctx } = this;
    const x = Math.min(this.cssWidth - PLAYHEAD_WIDTH, Math.max(0, this.x(nowSec)));
    ctx.fillStyle = STAGE_THEME.hitLine;
    ctx.fillRect(x, 0, PLAYHEAD_WIDTH, this.cssHeight);
  }

  private x(timeSec: number): number {
    return timeToX(timeSec, this.durationSec, this.cssWidth);
  }
}
