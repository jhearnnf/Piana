import type { Song } from "../core/types.ts";
import type { TimeRange } from "../game/practice.ts";
import type { LoopMarks } from "../song/loopRegion.ts";
import type { SavedLoop } from "../song/savedLoops.ts";
import { bandAt, laneHeight, loopBands, type LoopBand } from "./loopLane.ts";
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

/**
 * The colour of a kept loop.
 *
 * Its own hue, shared with nothing: the marks are green, the playhead and the right hand
 * are blue, the left hand orange. A saved loop is a fourth kind of thing on the map and
 * borrowing any of those colours would make it read as one of them.
 */
const SAVED_LOOP = "#c08bff";
/** A loop that is merely kept, as against the one being practised. */
const SAVED_LOOP_IDLE = 0.42;
/** The band under the pointer, brought up short of the fully-lit active one. */
const SAVED_LOOP_HOVER = 0.75;
/** The wash that shows, down over the notes, which bars a hovered band covers. */
const HOVER_SPAN_WASH = 0.16;
/** The hairline between the lane and the song, so the strip reads as its own row. */
const LANE_RULE = "rgba(255, 255, 255, 0.07)";

export interface TimelineState {
  nowSec: number;
  /** The stretch being practised, or null for the whole song. */
  region: TimeRange | null;
  /** The loop points as they stand; either may be down without the other. */
  marks: LoopMarks;
  /** The loop under the pointer, whose span is lit down over the notes. */
  hoverLoopId?: string | null;
  /** The kept loop being practised, drawn fully lit. */
  activeLoopId?: string | null;
}

export class TimelineRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private song: Song | null = null;
  private loops: readonly SavedLoop[] = [];

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

  /**
   * The loops kept for this song, drawn as a lane across the top.
   *
   * The lane takes its height out of the canvas, so the notes have to be re-laid whenever
   * the set of loops changes — saving the first one on a song shortens the map.
   */
  setLoops(loops: readonly SavedLoop[]): void {
    this.loops = loops;
    this.layerStale = true;
  }

  /** How much of the canvas the lane of saved loops is taking, in CSS pixels. */
  get laneHeight(): number {
    return laneHeight(this.loops);
  }

  /** The saved loop under a point on the canvas, for hovering and clicking one. */
  loopAt(x: number, y: number): LoopBand | null {
    return bandAt(this.bands(), x, y);
  }

  private bands(): LoopBand[] {
    return loopBands(this.loops, this.durationSec, this.cssWidth);
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

    const lane = this.laneHeight;
    this.drawNotes(lane);
    this.drawRegion(state.region, lane);
    this.drawPlayed(state.nowSec, state.region, lane);
    this.drawHoverSpan(state.hoverLoopId ?? null, lane);
    this.drawLane(lane, state.hoverLoopId ?? null, state.activeLoopId ?? null);
    this.drawMarks(state.marks);
    this.drawPlayhead(state.nowSec);
  }

  /** The map proper: everything under the lane of saved loops. */
  private mapHeight(lane: number): number {
    return Math.max(0, this.cssHeight - lane);
  }

  private drawNotes(lane: number): void {
    if (this.layerStale) this.buildLayer(lane);
    if (this.layer) this.ctx.drawImage(this.layer, 0, lane, this.cssWidth, this.mapHeight(lane));
  }

  /**
   * Lay the song out once, onto a canvas of its own.
   *
   * A long piece is thousands of rectangles, and re-laying them sixty times a second to
   * draw a playhead that moves two pixels would be the most expensive thing the app does.
   */
  private buildLayer(lane: number): void {
    this.layerStale = false;
    this.layer = null;
    const height = this.mapHeight(lane);
    if (!this.song || this.cssWidth <= 0 || height <= 0) return;

    const size = { width: this.cssWidth, height };
    const notes = miniMapNotes(this.song.notes, this.song.durationSec, size);
    if (notes.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const layer = document.createElement("canvas");
    layer.width = this.canvas.width;
    layer.height = Math.max(1, Math.round(height * dpr));
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
  private drawRegion(region: TimeRange | null, lane: number): void {
    if (!region) return;
    const { ctx } = this;
    const from = this.x(region.start);
    const to = this.x(region.end);
    const height = this.mapHeight(lane);

    // The veil stops at the lane. Dimming the saved loops along with the music would hide
    // the very strip you reach for to change which stretch is lit.
    ctx.fillStyle = OUTSIDE_VEIL;
    ctx.fillRect(0, lane, from, height);
    ctx.fillRect(to, lane, this.cssWidth - to, height);
  }

  /** A wash over what has gone by, bounded by the run so it measures the right thing. */
  private drawPlayed(nowSec: number, region: TimeRange | null, lane: number): void {
    const from = this.x(region?.start ?? 0);
    const to = Math.max(from, this.x(nowSec));
    if (to <= from) return;
    this.ctx.fillStyle = withAlpha(STAGE_THEME.hitLine, PLAYED_WASH);
    this.ctx.fillRect(from, lane, to - from, this.mapHeight(lane));
  }

  /**
   * Light the bars a hovered loop covers, down over the music itself.
   *
   * The band alone says where the loop is on a strip six pixels tall; this says which
   * notes it holds. Pointing at a saved loop and seeing the passage light up in the map is
   * the whole answer to "which one was that?" before you commit to it with a click.
   */
  private drawHoverSpan(hoverLoopId: string | null, lane: number): void {
    const loop = this.loops.find((l) => l.id === hoverLoopId);
    if (!loop) return;

    const { ctx } = this;
    const from = this.x(loop.start);
    const to = this.x(loop.end);
    const height = this.mapHeight(lane);
    ctx.fillStyle = withAlpha(SAVED_LOOP, HOVER_SPAN_WASH);
    ctx.fillRect(from, lane, Math.max(1, to - from), height);

    // Edges, so the span reads as bounded rather than as a smudge over the middle of the
    // song — the two moments it starts and stops are what you are trying to see.
    ctx.fillStyle = withAlpha(SAVED_LOOP, SAVED_LOOP_HOVER);
    ctx.fillRect(from, lane, 1, height);
    ctx.fillRect(Math.max(from, to - 1), lane, 1, height);
  }

  /**
   * The lane of kept loops across the top.
   *
   * The one being practised is fully lit and the rest are held back, so the strip answers
   * "what have I saved" and "which am I on" in one look. The band under the pointer comes
   * up between the two, because a highlight that matched the active one would say you had
   * already chosen it.
   */
  private drawLane(lane: number, hoverLoopId: string | null, activeLoopId: string | null): void {
    if (lane <= 0) return;
    const { ctx } = this;

    for (const band of this.bands()) {
      const alpha =
        band.id === activeLoopId ? 1
        : band.id === hoverLoopId ? SAVED_LOOP_HOVER
        : SAVED_LOOP_IDLE;
      ctx.fillStyle = withAlpha(SAVED_LOOP, alpha);
      // Inset by half a pixel each side so two loops that meet end to end read as two
      // bands rather than as one long one.
      ctx.fillRect(band.x + 0.5, band.y, Math.max(1, band.w - 1), band.h);
    }

    ctx.fillStyle = LANE_RULE;
    ctx.fillRect(0, lane - 1, this.cssWidth, 1);
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
