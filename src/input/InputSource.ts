/**
 * A single, source-agnostic note-input contract.
 *
 * The real USB MIDI keyboard, the computer-keyboard fallback, and mouse/touch on the
 * on-screen piano all implement `InputSource` and emit the same events. Everything
 * downstream (highlighting, scoring) listens to one handler and never cares where a note
 * came from.
 */
export interface NoteInputHandler {
  /** A key was pressed. `velocity` is 0-1. */
  noteOn(midi: number, velocity: number): void;
  /** A key was released. */
  noteOff(midi: number): void;
  /**
   * The sustain pedal went down, or came up.
   *
   * Part of playing rather than a setting, which is why it lives here beside the notes:
   * the pedal is the third thing your body does to a piano, and a source that has one
   * reports it the same way it reports a key. Sources without one simply never call it.
   */
  sustain(down: boolean): void;
}

export interface InputSource {
  connect(handler: NoteInputHandler): void;
  disconnect(): void;
}
