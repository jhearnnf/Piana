import { Midi } from "@tonejs/midi";
import type { Note, Song, TempoEvent, TimeSignature, TrackInfo } from "../core/types.ts";
import { computeDuration, pitchRange, sortNotes } from "../core/songUtils.ts";
import { assignHandsByTracks } from "../song/handSplit.ts";

/**
 * Parse a raw `.mid` file into our normalized {@link Song}.
 *
 * This is the single adapter between the @tonejs/midi library and the rest of Piana —
 * nothing else imports @tonejs/midi. That keeps the source of a song swappable: an online
 * search result or an audio->MIDI converter can produce a `Song` the same way later.
 */
export function parseMidi(data: ArrayBuffer | Uint8Array, name?: string): Song {
  const midi = new Midi(data);

  const tempoMap = readTempoMap(midi);
  const timeSignature = readTimeSignature(midi);

  // Build one note group per track so hand-splitting can use track structure. Empty tracks
  // are dropped here, which is why the index a note carries is its index among the tracks
  // that *play* — the only ones the user is ever shown.
  const playing = midi.tracks.filter((track) => track.notes.length > 0);
  const groups: Note[][] = playing.map((track, index) =>
    track.notes.map(
      (n): Note => ({
        midi: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
        hand: "right", // provisional; set by assignHandsByTracks below
        track: index,
      }),
    ),
  );

  assignHandsByTracks(groups);

  const notes = sortNotes(groups.flat());

  return {
    name: name ?? midi.name ?? "Untitled",
    notes,
    tracks: groups.map((group, index) => trackInfo(playing[index]!, group, index)),
    tempoMap,
    timeSignature,
    durationSec: computeDuration(notes),
  };
}

/** Describe one track for the hand-assignment UI. */
function trackInfo(track: Midi["tracks"][number], notes: Note[], index: number): TrackInfo {
  // Plenty of files name neither the track nor the instrument, and a row labelled with an
  // empty string looks like a bug rather than a silent file.
  const name = track.name?.trim() || track.instrument?.name?.trim() || `Track ${index + 1}`;
  return {
    index,
    name,
    noteCount: notes.length,
    range: pitchRange(notes) ?? [60, 60],
  };
}

function readTempoMap(midi: Midi): TempoEvent[] {
  const tempos = midi.header.tempos;
  if (tempos.length === 0) return [{ time: 0, bpm: 120 }];
  return tempos
    .map((t): TempoEvent => ({ time: t.time ?? 0, bpm: t.bpm }))
    .sort((a, b) => a.time - b.time);
}

function readTimeSignature(midi: Midi): TimeSignature {
  const first = midi.header.timeSignatures[0];
  const sig = first?.timeSignature;
  return { numerator: sig?.[0] ?? 4, denominator: sig?.[1] ?? 4 };
}
