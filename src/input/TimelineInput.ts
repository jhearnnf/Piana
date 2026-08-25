/** The left mouse button, as `PointerEvent.button` numbers it. */
const PRIMARY_BUTTON = 0;

export interface TimelineHandlers {
  /** Go to the moment at this x pixel across the map. Fired on the click and on each drag. */
  onSeek: (x: number) => void;
  /** A drag has begun — the moment to stop the clock so it does not fight the hand. */
  onGrab: () => void;
  /** The hand has let go, so play may pick up again if it was playing when grabbed. */
  onRelease: () => void;
  /**
   * A press landed at this point. Return true to claim it, leaving the map alone.
   *
   * How the lane of saved loops sits on the same canvas as the scrubber: a press on a band
   * is a choice of passage, not a jump to the moment the band happens to start at.
   */
  onPick: (x: number, y: number) => boolean;
  /** The pointer is here and nothing is being dragged — for lighting up what is under it. */
  onHover: (x: number, y: number) => void;
  /** The pointer has left the map, so whatever was lit up should go out. */
  onLeave: () => void;
}

/**
 * Clicking and dragging the song map to move through the piece.
 *
 * The map already shows where everything is; this is what makes it worth looking at, since
 * seeing that the hard passage is two thirds of the way in is only half an answer if
 * getting there still means scrolling for it.
 *
 * A click is a drag that never moved, so both are one gesture: the clock stops on the way
 * down, follows the pointer, and picks up again — if it was running — on the way up. That
 * is what a scrubber does everywhere else, and it is the reason dragging along the map
 * does not sound like a piano falling down the stairs.
 */
export class TimelineInput {
  private dragging = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly handlers: TimelineHandlers,
  ) {}

  connect(): void {
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    this.canvas.addEventListener("pointerleave", this.onOut);
  }

  disconnect(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("pointerleave", this.onOut);
    this.dragging = false;
  }

  private xAt(e: PointerEvent): number {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  private yAt(e: PointerEvent): number {
    return e.clientY - this.canvas.getBoundingClientRect().top;
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== PRIMARY_BUTTON) return;
    e.preventDefault();
    // Offered to the lane first. A band is a small target sitting on top of a large one,
    // so the specific thing under the pointer gets the press before the general one.
    if (this.handlers.onPick(this.xAt(e), this.yAt(e))) return;
    this.dragging = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.handlers.onGrab();
    this.handlers.onSeek(this.xAt(e));
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) this.handlers.onSeek(this.xAt(e));
    else this.handlers.onHover(this.xAt(e), this.yAt(e));
  };

  private onUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.handlers.onRelease();
  };

  private onOut = (): void => {
    this.handlers.onLeave();
  };
}
