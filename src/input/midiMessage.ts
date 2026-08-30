/**
 * What a MIDI message from the keyboard means.
 *
 * Split out from `MidiInput` so the decoding is arguable without a MIDI device on the
 * bus — the same split as `piano.ts` from `Player.ts`. It is a small amount of bit
 * twiddling with a large number of ways to be quietly wrong, and the symptom of each is a
 * keyboard that half works.
 *
 * Only the messages a piano trainer has an answer for. Everything else — pitch bend,
 * aftertouch, program change, clock, the modulation wheel — is a message from an
 * instrument this app is not, and is better ignored than guessed at.
 */

/** The status nibble, once the channel has been masked off. */
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

/** The pedal, in the numbering every keyboard agrees on. */
const SUSTAIN_CONTROLLER = 64;

/**
 * Where a continuous pedal counts as down.
 *
 * The MIDI spec's own answer, and worth stating because a sustain pedal is not the switch
 * it feels like: a half-damper pedal sweeps the whole 0–127 range as it travels, and even a
 * plain switch pedal sends 0 or 127 rather than anything cleverer. Piana's dampers are on
 * or off, so this is where the sweep is read as a decision.
 */
const PEDAL_DOWN_FROM = 64;

export type MidiAction =
  | { kind: "noteOn"; midi: number; velocity: number }
  | { kind: "noteOff"; midi: number }
  | { kind: "sustain"; down: boolean };

/**
 * Decode one message, or null if it is not one of ours.
 *
 * Note-on at zero velocity is a note-off, and has to be: it is how a great many keyboards
 * release a key, because it lets them send a run of notes under one status byte. Reading
 * it as a note-on instead is the classic way to end up with every key you play stuck down.
 */
export function decodeMidiMessage(data: Readonly<Uint8Array> | readonly number[]): MidiAction | null {
  if (data.length < 3) return null;

  const command = data[0]! & 0xf0;
  const first = data[1]!;
  const second = data[2]!;

  if (command === NOTE_ON && second > 0) {
    return { kind: "noteOn", midi: first, velocity: second / 127 };
  }
  if (command === NOTE_OFF || (command === NOTE_ON && second === 0)) {
    return { kind: "noteOff", midi: first };
  }
  if (command === CONTROL_CHANGE && first === SUSTAIN_CONTROLLER) {
    return { kind: "sustain", down: second >= PEDAL_DOWN_FROM };
  }
  return null;
}
