import { describe, it, expect } from "vitest";
import { chooseInputs, connectionStatus, deviceName, deviceNames } from "../src/input/midiDevices.ts";

const piano = { name: "Digital Piano" };
const faders = { name: "nanoKONTROL2 SLIDER/KNOB" };

describe("deviceName", () => {
  it("uses the name the device reports", () => {
    expect(deviceName(piano)).toBe("Digital Piano");
  });

  it("still has something to show for a device that reports no name", () => {
    expect(deviceName({ name: null })).toBe("Unknown device");
    expect(deviceName({})).toBe("Unknown device");
    expect(deviceName({ name: "   " })).toBe("Unknown device");
  });
});

describe("chooseInputs", () => {
  it("listens to everything when no device has been chosen", () => {
    expect(chooseInputs([faders, piano], null)).toEqual([faders, piano]);
  });

  it("listens to only the chosen device", () => {
    expect(chooseInputs([faders, piano], "Digital Piano")).toEqual([piano]);
  });

  it("listens to nothing when the chosen device is unplugged", () => {
    expect(chooseInputs([faders], "Digital Piano")).toEqual([]);
  });

  it("listens to every device sharing the chosen name", () => {
    const second = { name: "Digital Piano" };
    expect(chooseInputs([piano, faders, second], "Digital Piano")).toEqual([piano, second]);
  });
});

describe("deviceNames", () => {
  it("lists the devices in plug-in order", () => {
    expect(deviceNames([faders, piano])).toEqual(["nanoKONTROL2 SLIDER/KNOB", "Digital Piano"]);
  });

  it("offers a repeated name once", () => {
    expect(deviceNames([piano, { name: "Digital Piano" }])).toEqual(["Digital Piano"]);
  });
});

describe("connectionStatus", () => {
  it("is connected while something is being listened to", () => {
    expect(connectionStatus(2, 2, null)).toBe("connected");
    expect(connectionStatus(2, 1, "Digital Piano")).toBe("connected");
  });

  it("reports nothing plugged in", () => {
    expect(connectionStatus(0, 0, null)).toBe("no-device");
    expect(connectionStatus(0, 0, "Digital Piano")).toBe("no-device");
  });

  it("distinguishes a chosen device that is away from an empty bus", () => {
    // The difference matters: there is a keyboard connected, it is just not the one asked
    // for, and "no device" would send you looking for a cable that is already plugged in.
    expect(connectionStatus(1, 0, "Digital Piano")).toBe("device-missing");
  });
});
