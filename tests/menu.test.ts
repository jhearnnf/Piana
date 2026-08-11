import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type Item = {
  label?: string;
  role?: string;
  type?: string;
  accelerator?: string;
  click?: () => void;
  submenu?: Item[];
};

const { menuTemplate } = require("../electron/menu.cjs") as {
  menuTemplate: (options: {
    mac: boolean;
    name: string;
    onOpen: () => void;
    onAbout: () => void;
  }) => Item[];
};

const noop = () => {};
const build = (mac: boolean) => menuTemplate({ mac, name: "Piana", onOpen: noop, onAbout: noop });

const titles = (menu: Item[]) => menu.map((m) => m.label);
const find = (menu: Item[], label: string) => menu.find((m) => m.label === label);

/** Every item in a menu, including the ones nested in submenus. */
function flatten(menu: Item[]): Item[] {
  return menu.flatMap((item) => [item, ...(item.submenu ? flatten(item.submenu) : [])]);
}

const roles = (menu: Item[]) => flatten(menu).map((i) => i.role).filter(Boolean);

/**
 * These run on whatever platform the suite runs on, which is the point: the
 * macOS menu is the half that cannot be seen from a Windows machine, and it is
 * also the half the system depends on for Cmd+Q and the clipboard.
 */
describe("menuTemplate", () => {
  it("puts the app menu first on macOS, labelled with the app name", () => {
    const mac = build(true);
    expect(titles(mac)).toEqual(["Piana", "Edit", "File", "View", "Window"]);
  });

  it("has no app, Edit or Window menu on Windows", () => {
    expect(titles(build(false))).toEqual(["&File", "&View", "&Help"]);
  });

  it("uses & mnemonics only where they mean something", () => {
    // On macOS the ampersand is not a mnemonic marker and would simply be drawn.
    expect(titles(build(true)).some((t) => t?.includes("&"))).toBe(false);
    expect(titles(build(false)).filter((t) => t?.startsWith("&"))).toHaveLength(3);
  });

  it("offers Quit exactly once on each platform", () => {
    expect(roles(build(true)).filter((r) => r === "quit")).toHaveLength(1);
    expect(roles(build(false)).filter((r) => r === "quit")).toHaveLength(1);
  });

  it("moves Quit into the app menu on macOS, so Cmd+Q has one owner", () => {
    const mac = build(true);
    expect(find(mac, "Piana")?.submenu?.map((i) => i.role)).toContain("quit");
    expect(find(mac, "File")?.submenu?.map((i) => i.role)).not.toContain("quit");
  });

  it("gives macOS the clipboard roles the system routes through the menu", () => {
    const edit = find(build(true), "Edit")?.submenu?.map((i) => i.role);
    expect(edit).toEqual(expect.arrayContaining(["cut", "copy", "paste", "selectAll"]));
  });

  it("gives macOS a Close item, which is where Cmd+W comes from", () => {
    expect(find(build(true), "Window")?.submenu?.map((i) => i.role)).toContain("close");
  });

  it("opens a MIDI file from File on both, on the platform's own key", () => {
    for (const mac of [true, false]) {
      const file = find(build(mac), mac ? "File" : "&File");
      const open = file?.submenu?.[0];
      expect(open?.label).toBe("Open MIDI…");
      // CmdOrCtrl, not two entries: Electron resolves it per platform.
      expect(open?.accelerator).toBe("CmdOrCtrl+O");
      expect(typeof open?.click).toBe("function");
    }
  });

  it("reaches About from somewhere on both, and only once", () => {
    for (const mac of [true, false]) {
      const about = flatten(build(mac)).filter((i) => i.label === "About Piana");
      expect(about).toHaveLength(1);
      expect(typeof about[0]?.click).toBe("function");
    }
  });

  it("keeps About in the app menu on macOS and under Help on Windows", () => {
    expect(find(build(true), "Piana")?.submenu?.[0]?.label).toBe("About Piana");
    expect(find(build(false), "&Help")?.submenu?.[0]?.label).toBe("About Piana");
  });
});
