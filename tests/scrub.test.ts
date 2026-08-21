import { describe, it, expect } from "vitest";
import { clampToSong, wheelPixels, WHEEL_LINE, WHEEL_PAGE, WHEEL_PIXEL } from "../src/input/scrub.ts";

describe("wheelPixels", () => {
  it("passes pixels straight through", () => {
    expect(wheelPixels(120, WHEEL_PIXEL, 600)).toBe(120);
  });

  it("turns lines into pixels", () => {
    expect(wheelPixels(3, WHEEL_LINE, 600)).toBe(48);
  });

  it("turns pages into the height of the page", () => {
    expect(wheelPixels(2, WHEEL_PAGE, 600)).toBe(1200);
  });

  it("keeps the sign, whatever the unit", () => {
    expect(wheelPixels(-3, WHEEL_LINE, 600)).toBeLessThan(0);
  });
});

describe("clampToSong", () => {
  it("leaves a moment inside the song alone", () => {
    expect(clampToSong(12.5, 60)).toBe(12.5);
  });

  it("stops at the start of the song", () => {
    expect(clampToSong(-29, 60)).toBe(0);
  });

  it("stops at the end of the song", () => {
    expect(clampToSong(89, 60)).toBe(60);
  });

  it("has nowhere to go in an empty song", () => {
    expect(clampToSong(5, 0)).toBe(0);
  });
});
