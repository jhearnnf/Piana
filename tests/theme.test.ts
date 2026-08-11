import { describe, it, expect } from "vitest";
import { shade, withAlpha } from "../src/render/PianoRenderer.ts";

describe("withAlpha", () => {
  it("turns a theme colour into an rgba() string", () => {
    expect(withAlpha("#ffc247", 0.55)).toBe("rgba(255, 194, 71, 0.55)");
  });

  it("keeps a fully transparent stop on the same colour", () => {
    // Both ends of the press glow come from one theme entry, so they cannot drift apart.
    expect(withAlpha("#ffc247", 0)).toBe("rgba(255, 194, 71, 0)");
  });

  it("does not lose a leading zero byte", () => {
    expect(withAlpha("#00ff80", 1)).toBe("rgba(0, 255, 128, 1)");
  });
});

describe("shade", () => {
  it("darkens a colour towards black", () => {
    expect(shade("#ffffff", 0.5)).toBe("#808080");
    expect(shade("#ffc247", 1)).toBe("#ffc247");
    expect(shade("#ffc247", 0)).toBe("#000000");
  });

  it("stays a valid six-digit colour when a channel shrinks past one digit", () => {
    // A black-key note is a shaded hand colour, so a dropped digit here would silently
    // repaint every sharp in the wrong colour.
    expect(shade("#100510", 0.5)).toBe("#080308");
  });
});
