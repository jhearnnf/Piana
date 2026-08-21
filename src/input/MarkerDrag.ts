import type { PianoRenderer } from "../render/PianoRenderer.ts";
import type { LoopMarks } from "../song/loopRegion.ts";

/** The left mouse button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

export interface MarkerDragHandlers {
  /** The marks as they stand, asked for fresh: they change under this while it drags. */
  marks: () => LoopMarks;
  /** Current song time, which is what the stage's picture is drawn against. */
  nowSec: () => number;
  /** A point has been taken hold of. */
  onGrab: () => void;
  /** Move a point to `time`. Fired continuously while dragging. */
  onMove: (which: "start" | "end", time: number) => void;
  /** The drag is over — the moment to apply the region and start practising it. */
  onSettle: () => void;
}

/**
 * Taking hold of a loop point on the stage and sliding it.
 *
 * Dropping a point at the playhead is how you place it roughly; this is how you get it
 * right. The line is already drawn across the music it cuts, so moving it by hand is the
 * one gesture where you can see the note you are about to include or leave out at the
 * moment you decide — no number to nudge, no second window to check it in.
 *
 * The region is not re-applied until the button comes up. Applying it on every pixel of
 * the drag would restart the run underneath the hand doing the dragging, sixty times a
 * second.
 */
export class MarkerDrag {
  private held: "start" | "end" | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: PianoRenderer,
    private readonly handlers: MarkerDragHandlers,
  ) {}

  connect(): void {
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
  }

  disconnect(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.release();
  }

  /** Where a pointer event falls on the canvas, in the pixels the renderer draws in. */
  private pointAt(e: PointerEvent): number {
    return e.clientY - this.canvas.getBoundingClientRect().top;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== PRIMARY_BUTTON) return;
    const which = this.renderer.markAtY(this.pointAt(e), this.handlers.marks(), this.handlers.nowSec());
    if (!which) return;

    // Claimed before the on-screen piano can read it as a key press. It cannot — the
    // markers are above the keyboard — but a drag that wandered down onto the keys would
    // otherwise play every note it crossed.
    e.preventDefault();
    e.stopPropagation();
    this.held = which;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add("dragging-mark");
    this.handlers.onGrab();
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.held) {
      // Nothing held: the cursor's job is to say that the line under it can be taken hold
      // of at all, which is the only clue a two-pixel line gets to advertise itself.
      const over = this.renderer.markAtY(this.pointAt(e), this.handlers.marks(), this.handlers.nowSec());
      this.canvas.classList.toggle("over-mark", over !== null);
      return;
    }
    this.handlers.onMove(this.held, this.renderer.timeAtY(this.pointAt(e), this.handlers.nowSec()));
  };

  private onUp = (): void => {
    if (!this.held) return;
    this.release();
    this.handlers.onSettle();
  };

  private release(): void {
    this.held = null;
    this.canvas.classList.remove("dragging-mark");
  }
}
