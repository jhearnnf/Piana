import { describe, it, expect, beforeEach } from "vitest";
import type { Note } from "../src/core/types.ts";
import type { AudioPlayer } from "../src/audio/Player.ts";
import { AutoPlayer } from "../src/game/AutoPlayer.ts";

function note(midi: number, time: number, hand: Note["hand"] = "right"): Note {
  return { midi, time, duration: 0.5, velocity: 0.8, hand };
}

class MockPlayer implements AudioPlayer {
  fired: number[] = [];
  muted = false;
  async ensureStarted() {}
  triggerNote(midi: number) {
    this.fired.push(midi);
  }
  noteOn() {}
  noteOff() {}
  setMuted(muted: boolean) {
    this.muted = muted;
  }
}

describe("AutoPlayer", () => {
  let player: MockPlayer;
  let auto: AutoPlayer;
  const notes = [note(60, 0), note(62, 1), note(64, 2), note(65, 3)];

  beforeEach(() => {
    player = new MockPlayer();
    auto = new AutoPlayer(player);
    auto.setSong(notes);
  });

  it("fires notes as the playhead crosses their start time", () => {
    auto.update(0.5); // crosses note at 0
    expect(player.fired).toEqual([60]);
    auto.update(2.0); // crosses notes at 1 and 2
    expect(player.fired).toEqual([60, 62, 64]);
  });

  it("does not fire the same note twice", () => {
    auto.update(1.0);
    auto.update(1.0);
    expect(player.fired).toEqual([60, 62]);
  });

  it("re-syncs on a backward seek without replaying passed notes", () => {
    auto.update(3.5); // all fired
    expect(player.fired).toHaveLength(4);
    auto.update(1.5); // seek back: should not immediately refire
    expect(player.fired).toHaveLength(4);
    auto.update(2.5); // crossing note at 2 again
    expect(player.fired).toEqual([60, 62, 64, 65, 64]);
  });

  it("respects the predicate (e.g. only the left hand)", () => {
    const mixed = [note(60, 0, "right"), note(48, 0.5, "left"), note(62, 1, "right")];
    auto.setSong(mixed);
    auto.setPredicate((n) => n.hand === "left");
    auto.update(2);
    expect(player.fired).toEqual([48]);
  });
});
