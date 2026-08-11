/** High-level status of the real-keyboard connection, for showing in the UI. */
export type MidiStatus = "unsupported" | "unavailable" | "no-device" | "device-missing" | "connected";

/** Everything the UI needs to draw the MIDI controls after any change to the devices. */
export interface MidiState {
  status: MidiStatus;
  /** Every connected input, in the order the browser lists them. */
  devices: string[];
  /** The device being listened to, or null for all of them. */
  selected: string | null;
}

/** The name to show for an input, and the identity a saved choice is matched against. */
export const deviceName = (input: { name?: string | null }): string => input.name?.trim() || "Unknown device";

/**
 * The inputs to actually listen to: the chosen device, or all of them when none is chosen.
 *
 * Matched by name rather than by the Web MIDI `id`, which is a per-browser hash that can
 * change between sessions — a saved choice keyed on it would quietly stop matching the
 * keyboard it was made for. The name is also the string the user picked off the menu, so
 * a stored value stays readable and can be shown back to them when the device is away.
 */
export function chooseInputs<T extends { name?: string | null }>(
  inputs: readonly T[],
  selected: string | null,
): T[] {
  if (selected === null) return [...inputs];
  return inputs.filter((input) => deviceName(input) === selected);
}

/**
 * The names to offer on the menu — in plug-in order, without repeats.
 *
 * Two identical keyboards therefore appear once and are selected together. Telling them
 * apart would mean falling back to the unstable `id`, and the pair is much rarer than the
 * case this whole feature is for: one keyboard plus a control surface.
 */
export function deviceNames(inputs: readonly { name?: string | null }[]): string[] {
  return [...new Set(inputs.map(deviceName))];
}

/**
 * What to say about the connection, given how many devices are plugged in and how many of
 * them are being listened to.
 *
 * A chosen device that isn't plugged in is its own answer: "no device" would be a lie with
 * a keyboard sitting connected on the desk, and "connected" would be a lie about hearing it.
 */
export function connectionStatus(connected: number, listening: number, selected: string | null): MidiStatus {
  if (listening > 0) return "connected";
  if (selected !== null && connected > 0) return "device-missing";
  return "no-device";
}
