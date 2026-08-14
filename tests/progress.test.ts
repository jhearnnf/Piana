import { describe, it, expect } from "vitest";
import { elapsedInRange, formatTime, progressFraction } from "../src/ui/progress.ts";

describe("progressFraction", () => {
  const song = { start: 0, end: 120 };

  it("is 0 at the start and 1 at the end", () => {
    expect(progressFraction(0, song)).toBe(0);
    expect(progressFraction(120, song)).toBe(1);
  });

  it("measures the way through", () => {
    expect(progressFraction(30, song)).toBe(0.25);
  });

  // Practising bars 9-16 should fill the bar over those bars, not show a sliver of the
  // whole piece that barely moves.
  it("measures a section against the section", () => {
    expect(progressFraction(45, { start: 40, end: 60 })).toBe(0.25);
  });

  it("clamps outside the range", () => {
    // The conductor can sit on the duration itself, and wait mode holds at a gate.
    expect(progressFraction(500, song)).toBe(1);
    expect(progressFraction(10, { start: 40, end: 60 })).toBe(0);
  });

  it("treats an empty range as not started rather than dividing by zero", () => {
    expect(progressFraction(5, { start: 5, end: 5 })).toBe(0);
    expect(progressFraction(5, { start: 9, end: 2 })).toBe(0);
  });
});

describe("elapsedInRange", () => {
  it("counts from the start of a section, not of the song", () => {
    expect(elapsedInRange(45, { start: 40, end: 60 })).toBe(5);
  });

  it("never runs past the length it is counting into", () => {
    expect(elapsedInRange(999, { start: 40, end: 60 })).toBe(20);
  });
});

describe("formatTime", () => {
  it("writes minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9)).toBe("0:09");
    expect(formatTime(95)).toBe("1:35");
  });

  it("rounds down, so it cannot read as finished while notes are still coming", () => {
    expect(formatTime(59.9)).toBe("0:59");
  });

  it("grows an hours field only when there is one", () => {
    expect(formatTime(3599)).toBe("59:59");
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("survives the values a broken clock would hand it", () => {
    expect(formatTime(-5)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
  });
});
