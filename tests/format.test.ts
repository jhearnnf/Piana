import { describe, it, expect } from "vitest";
import type { ScoreContext } from "../src/game/highScores.ts";
import {
  dateLabel,
  escapeHtml,
  sectionLabel,
  setupLabel,
  shortSetupLabel,
} from "../src/ui/format.ts";
import { countLabel } from "../src/ui/libraryScreen.ts";
import { buildLibrary } from "../src/song/library.ts";

const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  songName: "Song",
  difficulty: "hard",
  hand: "both",
  sectionId: "full",
  ...over,
});

describe("escapeHtml", () => {
  it("escapes the characters that would break out of an attribute or a tag", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("Rock & Roll")).toBe("Rock &amp; Roll");
    expect(escapeHtml("It's a song.mid")).toBe("It&#39;s a song.mid");
  });

  it("leaves ordinary text alone", () => {
    expect(escapeHtml("Clair de Lune")).toBe("Clair de Lune");
  });
});

describe("sectionLabel", () => {
  it("names the whole song and numbers the sections from one", () => {
    expect(sectionLabel("full")).toBe("Full song");
    expect(sectionLabel("0")).toBe("Section 1");
    expect(sectionLabel("3")).toBe("Section 4");
  });

  it("shows an unrecognised id rather than inventing a name for it", () => {
    expect(sectionLabel("chorus")).toBe("chorus");
  });
});

describe("setupLabel", () => {
  it("spells out every part of the setup", () => {
    expect(setupLabel(ctx())).toBe("Hard · Both hands · Full song");
    expect(setupLabel(ctx({ difficulty: "easy", hand: "left", sectionId: "1" }))).toBe(
      "Easy · Left hand · Section 2",
    );
  });
});

describe("shortSetupLabel", () => {
  it("leaves the section off when it is the whole song", () => {
    expect(shortSetupLabel(ctx())).toBe("Hard · Both hands");
  });

  it("keeps the section when there is one, since that is the part worth saying", () => {
    expect(shortSetupLabel(ctx({ difficulty: "medium", hand: "right", sectionId: "2" }))).toBe(
      "Medium · Right hand · Section 3",
    );
  });
});

describe("dateLabel", () => {
  it("has nothing to say about a score saved before dates were kept", () => {
    expect(dateLabel(null)).toBe("");
  });

  it("formats a real date", () => {
    expect(dateLabel(Date.UTC(2026, 7, 17, 12))).toMatch(/2026/);
  });
});

describe("countLabel", () => {
  const songs = buildLibrary(["a.mid", "b.mid", "c.mid"], []);

  it("counts the whole folder when nothing is filtered out", () => {
    expect(countLabel({ folder: "/music", songs }, 3)).toBe("3 songs · 0 played");
  });

  it("says how many of how many when a search has narrowed it", () => {
    expect(countLabel({ folder: "/music", songs }, 1)).toBe("1 of 3 · 0 played");
  });

  it("gets the singular right", () => {
    const one = buildLibrary(["a.mid"], []);
    expect(countLabel({ folder: "/music", songs: one }, 1)).toBe("1 song · 0 played");
  });

  it("has nothing to count without a folder, on an error, or on an empty one", () => {
    expect(countLabel({ folder: null, songs: [] }, 0)).toBe("");
    expect(countLabel({ folder: "/music", songs, error: "ENOENT" }, 3)).toBe("");
    expect(countLabel({ folder: "/music", songs: [] }, 0)).toBe("");
  });
});
