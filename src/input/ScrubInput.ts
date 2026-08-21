import { wheelPixels } from "./scrub.ts";

/** The middle mouse button, as `PointerEvent.button` numbers it. */
const MIDDLE_BUTTON = 1;

/**
 * Scrolling through a loaded song on the stage, to find where a loop should begin and end.
 *
 * Two gestures, each following its own device's convention rather than one raw direction:
 *
 *   *the wheel moves you up and down the track.* The music not yet played is above the hit
 *   line, so rolling the wheel up — away from you — goes forward through the song, the way
 *   scrolling up a page goes towards its top.
 *
 *   *the middle button grabs the track.* Notes fall downwards as time passes, so dragging
 *   downwards is playing forwards: the same movement that pulls a roll of piano paper past
 *   the reader.
 *
 * The two disagree about which way is "forward" for the same reason a map disagrees with
 * its own scrollbar, and for the same reason nobody notices — one moves the view, the
 * other moves the thing being viewed.
 *
 * It only ever reports a distance in seconds; what to do with it, and whether there is a
 * song to do it to, belongs to the app.
 */
export class ScrubInput {
  private dragging = false;
  private lastY = 0;

  /**
   * @param onScrub  called with how far to move, in seconds, positive for forwards.
   * @param secondsPerPixel  the scale the notes are currently drawn at.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onScrub: (deltaSec: number) => void,
    private readonly secondsPerPixel: () => number,
  ) {}

  connect(): void {
    // Not passive: a wheel over the stage scrolls the song, and must not also scroll
    // whatever the app happens to be sitting in.
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    // Chrome answers a middle click with its own scroll-anywhere cursor, which swallows
    // every pointer event that follows it. Only the mouse events can call it off.
    this.canvas.addEventListener("mousedown", this.blockMiddle);
    this.canvas.addEventListener("auxclick", this.blockMiddle);
  }

  disconnect(): void {
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("mousedown", this.blockMiddle);
    this.canvas.removeEventListener("auxclick", this.blockMiddle);
    this.endDrag();
  }

  private blockMiddle = (e: MouseEvent): void => {
    if (e.button === MIDDLE_BUTTON) e.preventDefault();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const pixels = wheelPixels(e.deltaY, e.deltaMode, this.canvas.clientHeight);
    // Later in the song is further up the screen, so a wheel rolled up — a negative
    // delta — goes forwards.
    this.onScrub(-pixels * this.secondsPerPixel());
  };

  private onDown = (e: PointerEvent): void => {
    if (e.button !== MIDDLE_BUTTON) return;
    e.preventDefault();
    this.dragging = true;
    this.lastY = e.clientY;
    // Captured, so a drag that runs off the stage — or off the window — keeps scrolling
    // and, more importantly, still hears the button being let go.
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add("scrubbing");
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dy = e.clientY - this.lastY;
    this.lastY = e.clientY;
    this.onScrub(dy * this.secondsPerPixel());
  };

  private onUp = (): void => {
    this.endDrag();
  };

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.classList.remove("scrubbing");
  }
}
