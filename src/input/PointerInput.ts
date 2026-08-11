import type { InputSource, NoteInputHandler } from "./InputSource.ts";
import type { PianoRenderer } from "../render/PianoRenderer.ts";

/**
 * Mouse / touch input on the on-screen piano. Uses the renderer's hit-testing so the keys
 * you click line up exactly with what's drawn.
 */
export class PointerInput implements InputSource {
  private handler: NoteInputHandler | null = null;
  private activeMidi: number | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: PianoRenderer,
  ) {}

  connect(handler: NoteInputHandler): void {
    this.handler = handler;
    this.canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointerup", this.onUp);
  }

  disconnect(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointerup", this.onUp);
    this.handler = null;
    this.activeMidi = null;
  }

  private onDown = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const midi = this.renderer.keyAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (midi === null) return;
    this.activeMidi = midi;
    this.handler?.noteOn(midi, 0.8);
  };

  private onUp = (): void => {
    if (this.activeMidi === null) return;
    this.handler?.noteOff(this.activeMidi);
    this.activeMidi = null;
  };
}
