import { describe, it, expect } from "vitest";
import { shade, tint, withAlpha } from "../src/render/PianoRenderer.ts";

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

describe("tint", () => {
  it("mixes a colour towards white", () => {
    expect(tint("#000000", 0.5)).toBe("#808080");
    expect(tint("#5ac8fa", 0)).toBe("#5ac8fa");
    expect(tint("#5ac8fa", 1)).toBe("#ffffff");
  });

  it("keeps the hue of the hand it came from", () => {
    // The strike cap is a lightened hand colour, not a shared white: which hand plays the
    // note has to stay readable at the one place the eye is actually looking.
    const cap = tint("#ff9f6b", 0.55);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(cap.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g!);
    expect(g!).toBeGreaterThan(b!);
  });
});
