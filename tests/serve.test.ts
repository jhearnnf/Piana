import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import path from "node:path";

// The desktop shell is CommonJS so Electron's main process can load it directly.
const require = createRequire(import.meta.url);
const { resolveAsset } = require("../electron/serve.cjs") as {
  resolveAsset: (url: string, root: string) => string | null;
};

const ROOT = path.resolve("/srv/dist");
const at = (...parts: string[]) => path.join(ROOT, ...parts);

describe("resolveAsset", () => {
  it("maps a path onto a file inside the build", () => {
    expect(resolveAsset("piana://app/assets/index.js", ROOT)).toBe(at("assets", "index.js"));
  });

  it("serves index.html for the bare origin", () => {
    expect(resolveAsset("piana://app/", ROOT)).toBe(at("index.html"));
  });

  it("decodes escapes, so a song with a space in its name is found", () => {
    expect(resolveAsset("piana://app/samples/my%20song.mid", ROOT)).toBe(at("samples", "my song.mid"));
  });

  it("ignores the query and hash the app drives itself with", () => {
    expect(resolveAsset("piana://app/index.html?x=1#play", ROOT)).toBe(at("index.html"));
  });

  // `piana:` is a standard scheme, so the URL parser removes dot segments
  // before the path ever gets here — encoded ones (`%2e%2e`) included. Pinned
  // down because it is the reason the guard below looks like it has nothing to
  // do: `..` is already gone, and what is left is the Windows separator.
  it("lets the URL parser flatten .. , escaped or not", () => {
    expect(resolveAsset("piana://app/../secrets.txt", ROOT)).toBe(at("secrets.txt"));
    expect(resolveAsset("piana://app/assets/../../secrets.txt", ROOT)).toBe(at("secrets.txt"));
    expect(resolveAsset("piana://app/%2e%2e/secrets.txt", ROOT)).toBe(at("secrets.txt"));
  });

  it("refuses a backslash climb, which the parser leaves intact", () => {
    // Not a path separator to the URL parser, very much one to Windows.
    expect(resolveAsset("piana://app/..%5c..%5csecrets.txt", ROOT)).toBeNull();
    expect(resolveAsset("piana://app/..%5cdist-ssr%5cindex.html", ROOT)).toBeNull();
  });

  it("refuses a request that resolves to the build folder itself", () => {
    expect(resolveAsset("piana://app/..%5cdist", ROOT)).toBeNull();
  });

  it("refuses a NUL, which would truncate the path at the syscall", () => {
    expect(resolveAsset("piana://app/index.html%00.png", ROOT)).toBeNull();
  });

  it("refuses a malformed escape rather than throwing", () => {
    expect(resolveAsset("piana://app/%zz", ROOT)).toBeNull();
  });
});
