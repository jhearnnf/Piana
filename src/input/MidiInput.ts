import type { InputSource, NoteInputHandler } from "./InputSource.ts";
import { chooseInputs, connectionStatus, deviceNames, type MidiState } from "./midiDevices.ts";
import { decodeMidiMessage } from "./midiMessage.ts";

/**
 * Real USB MIDI keyboard input via the Web MIDI API (Chrome / Edge).
 *
 * Implements the same {@link InputSource} contract as the fallback sources, so gameplay
 * doesn't care which is in use. Listens to every connected input by default — most people
 * have one keyboard and should not have to choose it — and re-attaches when devices are
 * plugged in or out. {@link selectDevice} narrows that to a single keyboard, which is what
 * you want when a control surface or a DAW port is on the bus alongside the piano.
 */
export class MidiInput implements InputSource {
  private handler: NoteInputHandler | null = null;
  private access: MIDIAccess | null = null;
  private selected: string | null = null;

  /** Called whenever the devices or the connection status change. */
  onStatus?: (state: MidiState) => void;

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  }

  connect(handler: NoteInputHandler): void {
    this.handler = handler;
    void this.requestAccess();
  }

  /**
   * Listen to just this device by name, or to every device when null.
   *
   * Safe to call before {@link connect}: the choice is remembered and applied as soon as
   * access lands, so a restored preference doesn't need to wait for the first status.
   */
  selectDevice(name: string | null): void {
    this.selected = name;
    this.attachInputs();
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
      this.report("unsupported", []);
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      this.report("unavailable", []); // permission denied or no MIDI stack
      return;
    }
    this.access.addEventListener("statechange", this.onStateChange as EventListener);
    this.attachInputs();
  }

  private attachInputs(): void {
    if (!this.access) return;
    const inputs = [...this.access.inputs.values()];
    // Cleared across the board first: a device dropped from the selection has to stop
    // being heard, and re-adding the same listener to a kept one is a no-op.
    for (const input of inputs) {
      input.removeEventListener("midimessage", this.onMessage as EventListener);
    }
    const listening = chooseInputs(inputs, this.selected);
    for (const input of listening) {
      input.addEventListener("midimessage", this.onMessage as EventListener);
    }
    this.report(connectionStatus(inputs.length, listening.length, this.selected), deviceNames(inputs));
  }

  private report(status: MidiState["status"], devices: string[]): void {
    this.onStatus?.({ status, devices, selected: this.selected });
  }

  private onStateChange = (): void => this.attachInputs();

  private onMessage = (event: MIDIMessageEvent): void => {
    if (!event.data || !this.handler) return;
    const action = decodeMidiMessage(event.data);
    if (action === null) return;

    if (action.kind === "noteOn") this.handler.noteOn(action.midi, action.velocity);
    else if (action.kind === "noteOff") this.handler.noteOff(action.midi);
    else this.handler.sustain(action.down);
  };
}
