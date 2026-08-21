import { describe, it, expect } from "vitest";
import { Conductor } from "../src/game/Conductor.ts";

describe("Conductor", () => {
  it("stays at 0 while paused", () => {
    const c = new Conductor();
    expect(c.tick(1000)).toBe(0);
    expect(c.tick(2000)).toBe(0);
  });

  it("advances by wall-clock delta when playing", () => {
    const c = new Conductor();
    c.play();
    c.tick(1000); // anchor
    expect(c.tick(2000)).toBeCloseTo(1, 5); // +1000ms = +1s
    expect(c.tick(2500)).toBeCloseTo(1.5, 5);
  });

  it("scales time by the rate", () => {
    const c = new Conductor();
    c.rate = 0.5;
    c.play();
    c.tick(1000);
    expect(c.tick(2000)).toBeCloseTo(0.5, 5); // half speed
  });

  it("does not jump after resuming from pause", () => {
    const c = new Conductor();
    c.play();
    c.tick(1000);
    c.tick(2000); // time = 1
    c.pause();
    c.tick(10000); // long gap while paused
    c.play();
    expect(c.tick(11000)).toBeCloseTo(1, 5); // no accrued jump
  });

  it("pauses at the end of the song", () => {
    const c = new Conductor();
    c.duration = 2;
    c.play();
    c.tick(0);
    c.tick(5000); // would be 5s
    expect(c.time).toBe(2);
    expect(c.isPlaying()).toBe(false);
  });

  it("wraps within a loop range", () => {
    const c = new Conductor();
    c.setLoop({ start: 1, end: 3 }); // length 2, seeks to 1
    expect(c.time).toBe(1);
    c.play();
    c.tick(0);
    c.tick(2500); // +2.5s -> 3.5 -> wraps to 1 + 0.5
    expect(c.time).toBeCloseTo(1.5, 5);
  });

  it("says so each time it comes round", () => {
    const c = new Conductor();
    let laps = 0;
    c.onLoop = () => laps++;
    c.setLoop({ start: 0, end: 1 });
    c.play();
    c.tick(0);
    c.tick(1500); // one wrap
    expect(laps).toBe(1);
    c.tick(3000); // and another
    expect(laps).toBe(2);
  });

  it("has already moved the clock by the time it says so", () => {
    const c = new Conductor();
    let atLap = -1;
    c.onLoop = () => (atLap = c.time);
    c.setLoop({ start: 2, end: 4 });
    c.play();
    c.tick(0);
    c.tick(2500); // 2 -> 4.5, wraps to 2.5
    expect(atLap).toBeCloseTo(2.5, 5);
  });

  it("does not announce a lap that never happened", () => {
    const c = new Conductor();
    let laps = 0;
    c.onLoop = () => laps++;
    c.duration = 2;
    c.play();
    c.tick(0);
    c.tick(5000); // runs to the end of a song with no loop set
    expect(laps).toBe(0);
  });

  it("stop returns to loop start when looping", () => {
    const c = new Conductor();
    c.setLoop({ start: 4, end: 8 });
    c.seek(6);
    c.stop();
    expect(c.time).toBe(4);
  });
});
