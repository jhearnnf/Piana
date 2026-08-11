import type { InputSource, NoteInputHandler } from "./InputSource.ts";

/** High-level status of the real-keyboard connection, for showing in the UI. */
export type MidiStatus = "unsupported" | "unavailable" | "no-device" | "connected";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;

/**
 * Real USB MIDI keyboard input via the Web MIDI API (Chrome / Edge).
 *
 * Implements the same {@link InputSource} contract as the fallback sources, so gameplay
 * doesn't care which is in use. Listens to every connected input and re-attaches when
 * devices are plugged in or out.
 */
export class MidiInput implements InputSource {
  private handler: NoteInputHandler | null = null;
  private access: MIDIAccess | null = null;

  /** Called whenever the connection status changes. */
  onStatus?: (status: MidiStatus, deviceName?: string) => void;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  connect(handler: NoteInputHandler): void {
    this.handler = handler;
    void this.requestAccess();
  }

  disconnect(): void {
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.removeEventListener("midimessage", this.onMessage as EventListener);
      }
      this.access.removeEventListener("statechange", this.onStateChange as EventListener);
    }
    this.access = null;
    this.handler = null;
  }

  private async requestAccess(): Promise<void> {
    if (!MidiInput.isSupported()) {
      this.onStatus?.("unsupported");
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.onStatus?.("unavailable"); // permission denied or no MIDI stack
      return;
    }
    this.access.addEventListener("statechange", this.onStateChange as EventListener);
    this.attachInputs();
  }

  private attachInputs(): void {
    if (!this.access) return;
    let deviceName: string | undefined;
    for (const input of this.access.inputs.values()) {
      input.removeEventListener("midimessage", this.onMessage as EventListener);
      input.addEventListener("midimessage", this.onMessage as EventListener);
      deviceName ??= input.name ?? undefined;
    }
    this.onStatus?.(deviceName ? "connected" : "no-device", deviceName);
  }

  private onStateChange = (): void => this.attachInputs();

  private onMessage = (event: MIDIMessageEvent): void => {
    const data = event.data;
    if (!data || data.length < 3 || !this.handler) return;
    const command = data[0]! & 0xf0;
    const note = data[1]!;
    const velocity = data[2]!;

    if (command === NOTE_ON && velocity > 0) {
      this.handler.noteOn(note, velocity / 127);
    } else if (command === NOTE_OFF || (command === NOTE_ON && velocity === 0)) {
      this.handler.noteOff(note);
    }
  };
}
