/**
 * Launches the desktop app and checks it actually came up.
 *
 *   npm run smoke
 *
 * The failure this exists for is the blank window: a custom scheme serving the
 * wrong content type, a preload that threw, a build that was never made. None
 * of those fail the unit tests, none of them print anything, and all of them
 * look identical from the outside — an empty dark rectangle.
 *
 * Screenshots land in `dist-smoke/` so there is something to look at when a
 * check fails.
 *
 * It drives a throwaway settings folder rather than the real one, so it can run
 * with Piana already open and cannot leave your own app muted (see USER_DATA).
 */

import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const SHOTS = path.join(ROOT, "dist-smoke");

/**
 * A settings folder of its own, thrown away and remade on every run.
 *
 * These checks are not read-only: proving that mute and the keyboard zoom survive a restart
 * means *setting* them, and against the real folder that is someone's app coming back
 * silent the next morning with no idea why. Pointing Electron somewhere else is the whole
 * fix — window state, prefs.json and localStorage all live under this one path.
 *
 * It also decouples the run from the single-instance lock, which is taken per settings
 * folder: the app can be open on the desktop while this drives its own copy.
 *
 * Fresh each time so "sound is on by default" is a real check of the default rather than
 * of whatever the last run happened to leave behind.
 */
const USER_DATA = path.join(SHOTS, "userdata");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

if (!fs.existsSync(path.join(ROOT, "dist", "index.html"))) {
  console.error("No build in dist/ — run `npm run build` first.");
  process.exit(1);
}
fs.mkdirSync(SHOTS, { recursive: true });
fs.rmSync(USER_DATA, { recursive: true, force: true });

/**
 * Launch the app against the throwaway settings folder.
 *
 * `--user-data-dir` is Chromium's own switch and Electron honours it, so nothing in the app
 * has to know it is being tested. Extra arguments go after it — a `.mid` path, in the one
 * check that opens a song from the command line.
 */
async function launch(extra = []) {
  const args = [ROOT, `--user-data-dir=${USER_DATA}`, ...extra];
  try {
    return await electron.launch({ args, cwd: ROOT });
  } catch (err) {
    // Exit rather than throw: Playwright attaches its whole websocket log to the error,
    // and the one line that actually helps would scroll off the top of it.
    console.error(
      `\nCould not launch the app.\n\n(${err.message.split("\n")[0]})`,
    );
    process.exit(1);
  }
}

const app = await launch();
const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");

// Where the settings actually landed, asked of the app rather than assumed, so this is a
// check on the override as much as a path to read: if `--user-data-dir` were ever ignored,
// the prefs assertion at the end would be reading the real folder and this would say so.
const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
const prefsPath = path.join(userData, "prefs.json");
check(
  "the run is isolated from the real settings folder",
  path.resolve(userData) === path.resolve(USER_DATA),
  userData,
);

// The renderer builds its whole UI in a constructor, so the canvas existing is
// the same as the app having started.
await page.waitForSelector("#stage", { timeout: 15000 });

check("window opens on the app's own scheme", page.url().startsWith("piana://app/"), page.url());
check("preload bridge is exposed", await page.evaluate(() => typeof window.piana?.pickSong === "function"));
check(
  "native picker replaced the file input",
  await page.evaluate(() => Boolean(document.querySelector("#open")) && !document.querySelector(".file-btn")),
);

// Granted in main.cjs. Without that this reads "blocked", which is exactly the
// symptom of the permission handler not being wired up. There is no MIDI
// hardware on a build machine, so "no device" is the pass.
//
// requestMIDIAccess is async, so wait for the label to stop being its placeholder —
// otherwise the check passes on "MIDI: …" and would keep passing if access never
// resolved at all.
await page
  .waitForFunction(() => !(document.querySelector("#midi-status")?.textContent ?? "…").includes("…"), null, {
    timeout: 10000,
  })
  .catch(() => {});
const midi = await page.textContent("#midi-status");
check(
  "Web MIDI is permitted",
  Boolean(midi) && !midi.includes("…") && !/blocked|not supported/i.test(midi),
  midi ?? "",
);

/**
 * How many white keys are on screen, counted off the canvas.
 *
 * A row sampled just above the bottom edge crosses every white key and the dark border
 * between each pair, so counting the light runs counts the keys. Below the black keys and
 * below the octave labels, so nothing else is in the way.
 */
const countWhiteKeys = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const y = canvas.height - 2;
    const row = canvas.getContext("2d").getImageData(0, y, canvas.width, 1).data;

    let keys = 0;
    let inKey = false;
    for (let x = 0; x < canvas.width; x++) {
      const light = (row[x * 4] + row[x * 4 + 1] + row[x * 4 + 2]) / 3 > 160;
      if (light && !inKey) keys++;
      inKey = light;
    }
    return keys;
  });

/** Change a select and give the next frame time to redraw the canvas. */
const setZoom = async (value) => {
  await page.selectOption("#zoom", value);
  await page.waitForTimeout(300);
};

// The settings folder is new, so these really are the defaults rather than the last run's
// leftovers — no need to set them first.
check("sound is on by default", (await page.getAttribute("#mute", "aria-pressed")) === "false");
check("the keyboard zoom starts on Auto", (await page.inputValue("#zoom")) === "auto");

const startingVolume = await page.inputValue("#volume");
check(
  "the volume starts part-way up rather than at either end",
  Number(startingVolume) > 0 && Number(startingVolume) < 100,
  `#volume is "${startingVolume}"`,
);
// Set through the DOM rather than dragged: a range input is a fiddly mouse target, and
// what is under test is the handler and what it stores, not the browser's own slider.
await page.evaluate(() => {
  const slider = document.querySelector("#volume");
  slider.value = "40";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
});

await page.click("#mute");
check(
  "the mute button reports being muted",
  (await page.getAttribute("#mute", "aria-pressed")) === "true"
    && (await page.textContent("#mute")) === "🔇"
    && (await page.getAttribute("#mute", "aria-label")) === "Unmute",
  `${await page.textContent("#mute")} / ${await page.getAttribute("#mute", "aria-label")}`,
);
await page.screenshot({ path: path.join(SHOTS, "01-empty.png") });

// The Keys setting has to apply to the empty keyboard too, rather than sitting on the
// renderer's default three octaves until a song arrives to unblock it.
await setZoom("full");
const emptyFullKeys = await countWhiteKeys();
check(
  "Full 88 applies before a song is loaded",
  emptyFullKeys === 52,
  `${emptyFullKeys} white keys, expected 52`,
);
await page.screenshot({ path: path.join(SHOTS, "02-empty-full88.png") });

// "Load demo" fetches samples/twinkle-twinkle.mid relative to the page, which
// is the check that the custom scheme is fetchable — under file:// it is not.
await page.click("#demo");
await page.waitForFunction(() => /notes$/.test(document.querySelector("#song-name")?.textContent ?? ""), null, {
  timeout: 10000,
});
const loaded = await page.textContent("#song-name");
check("demo song loads over the custom scheme", /Twinkle/.test(loaded ?? ""), loaded ?? "");

// Loading a song starts it — no second click. The Play button flipping to Pause is the
// visible half of that, and is what breaks if the auto-start throws before it gets there.
await page.waitForTimeout(600);
const playLabel = await page.textContent("#play");
check("a loaded song starts playing by itself", /Pause/.test(playLabel ?? ""), playLabel ?? "");
check("wait mode is on by default", await page.isChecked("#wait"));
await page.screenshot({ path: path.join(SHOTS, "02-playing.png") });

check(
  "the stage is drawing, not blank",
  await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    // More than one distinct colour means something was actually painted.
    const first = pixels.slice(0, 4).join();
    for (let i = 4; i < pixels.length; i += 4) {
      if (pixels.slice(i, i + 4).join() !== first) return true;
    }
    return false;
  }),
);

// "Auto" trims the keyboard to the octaves the song actually uses, which is why the
// full piano is not there by default.
await setZoom("auto");
const autoKeys = await countWhiteKeys();
check("Auto shows only the song's octaves", autoKeys > 0 && autoKeys < 40, `${autoKeys} white keys`);

// A held key: pressing 'a' plays C4. Held down, not tapped, so the highlight is on
// screen when the shot is taken.
await page.keyboard.down("a");
await page.keyboard.down("d");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "03-pressed-auto.png") });
await page.keyboard.up("a");
await page.keyboard.up("d");

await setZoom("full");
const fullKeys = await countWhiteKeys();
check("Full 88 shows the whole piano", fullKeys === 52, `${fullKeys} white keys, expected 52`);

await page.keyboard.down("a");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "04-pressed-full88.png") });
await page.keyboard.up("a");

// The per-track hand controls, and the auto split behind them. The demo is a two-track
// file, so it opens trusting the tracks; switching both to Auto split makes the algorithm
// work the separation out from the notes alone, and it should reach the same answer.
await page.click("#tracks");
await page.waitForSelector(".tracks-card", { timeout: 5000 });
const trackCount = await page.locator(".track-row").count();
check("the tracks screen lists the song's tracks", trackCount === 2, `${trackCount} rows`);

const tallies = async () => page.$$eval(".track-tally", (els) => els.map((e) => e.textContent.trim()));
const beforeAuto = await tallies();
check(
  "a two-track file starts hand-separated by its tracks",
  beforeAuto.every((t) => /^all (left|right) hand$/.test(t)),
  beforeAuto.join(" / "),
);

for (let i = 0; i < trackCount; i++) {
  await page.locator(".track-mode").nth(i).selectOption("auto");
  await page.waitForTimeout(200);
}
const afterAuto = await tallies();
check(
  "the auto split finds the same separation from the notes alone",
  JSON.stringify(afterAuto) === JSON.stringify(beforeAuto),
  afterAuto.join(" / "),
);
await page.screenshot({ path: path.join(SHOTS, "05-tracks.png") });
await page.click("#tracks-close");

// The scores screen reads localStorage directly, so an exception in it is invisible
// until someone opens it. Opening and closing it is the check.
await page.click("#scores");
await page.waitForSelector(".scores-card", { timeout: 5000 });
check("the scores screen opens", await page.isVisible(".scores-card"));
check("opening the scores pauses the run", /Resume|Play/.test((await page.textContent("#play")) ?? ""));
await page.screenshot({ path: path.join(SHOTS, "06-scores.png") });
await page.click("#scores-close");
check("the scores screen closes", (await page.locator(".scores-card").count()) === 0);

await app.close();

// Relaunch: the zoom, the volume and the mute switch are all meant to outlive the session,
// which also proves localStorage works under the custom scheme.
const second = await launch();
const reopened = await second.firstWindow();
await reopened.waitForSelector("#stage", { timeout: 15000 });

const remembered = await reopened.inputValue("#zoom");
check("the keyboard zoom survives a restart", remembered === "full", `#zoom is "${remembered}"`);

const stillMuted = await reopened.getAttribute("#mute", "aria-pressed");
check("mute survives a restart", stillMuted === "true", `aria-pressed="${stillMuted}"`);

const rememberedVolume = await reopened.inputValue("#volume");
check("the volume survives a restart", rememberedVolume === "40", `#volume is "${rememberedVolume}"`);

await second.close();

// Opening a .mid by path — "open with Piana", the command line, the picker — should load
// it and note which folder it came from, so the next Open dialog starts there.
const sample = path.join(ROOT, "public", "samples", "twinkle-twinkle.mid");
const third = await launch([sample]);
const fromArgv = await third.firstWindow();
await fromArgv.waitForSelector("#stage", { timeout: 15000 });
await fromArgv.waitForFunction(
  () => /notes$/.test(document.querySelector("#song-name")?.textContent ?? ""),
  null,
  { timeout: 10000 },
);
const argvSong = await fromArgv.textContent("#song-name");
check("a .mid on the command line opens", /twinkle/i.test(argvSong ?? ""), argvSong ?? "");
await third.close();

const prefs = fs.existsSync(prefsPath) ? JSON.parse(fs.readFileSync(prefsPath, "utf8")) : {};
check(
  "the song's folder is remembered for the next Open dialog",
  prefs.songFolder === path.dirname(sample),
  `songFolder = ${prefs.songFolder ?? "(unset)"}`,
);

// The settings folder is left where it is, not deleted: when a check fails it is often the
// first thing worth looking at, and the next run clears it anyway.

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
