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
    const canvas = document.querySelector("#stage");
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

// Nothing to play yet, and the transport says so rather than answering clicks with
// silence. Checked before the demo loads, which is the only moment it is true.
check(
  "Play and Restart are disabled until a song is loaded",
  (await page.isDisabled("#play")) && (await page.isDisabled("#restart")),
);

// The Demo button fetches samples/twinkle-twinkle.mid relative to the page, which
// is the check that the custom scheme is fetchable — under file:// it is not.
await page.click("#demo");
await page.waitForFunction(() => /notes$/.test(document.querySelector("#song-meta")?.textContent ?? ""), null, {
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

// The progress strip: hidden on the empty screen, and once a song is up it has to show a
// real length rather than the 0:00 it starts life as.
check("the timeline appears with the song", await page.isVisible("#progress"));
const total = await page.textContent("#time-total");
check(
  "the timeline knows the song's length",
  /^\d+:[0-5]\d$/.test(total ?? "") && total !== "0:00",
  `total is "${total}"`,
);

// That it also *moves*. Wait mode is holding the clock on the first chord, which is the
// point of wait mode, so this is checked with it off — and then put back, so the rest of
// the run sees the app as it was.
await page.uncheck("#wait");
await page.click("#play");
await page.waitForTimeout(1400);
const elapsed = await page.textContent("#time-now");
const spoken = await page.getAttribute("#timeline", "aria-valuenow");
check("the clock advances as the song plays", elapsed !== "0:00", `${elapsed}, aria-valuenow ${spoken}`);
await page.check("#wait");
await page.click("#play");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "02-playing.png") });

check(
  "the stage is drawing, not blank",
  await page.evaluate(() => {
    const canvas = document.querySelector("#stage");
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    // More than one distinct colour means something was actually painted.
    const first = pixels.slice(0, 4).join();
    for (let i = 4; i < pixels.length; i += 4) {
      if (pixels.slice(i, i + 4).join() !== first) return true;
    }
    return false;
  }),
);

// Difficulty and hands are segmented controls rather than dropdowns, and one shared
// handler drives both of them. The clicked button becoming the chosen one is the only
// visible sign it ran at all — a broken handler would just look like a button that does
// nothing, on every one of them at once.
await page.click('#difficulty button[data-difficulty="easy"]');
const chosen = async (group, attr, value) =>
  page.getAttribute(`#${group} button[data-${attr}="${value}"]`, "aria-pressed");
check(
  "picking a difficulty moves the marker onto it",
  (await chosen("difficulty", "difficulty", "easy")) === "true"
    && (await chosen("difficulty", "difficulty", "hard")) === "false",
);
await page.click('#difficulty button[data-difficulty="hard"]'); // put it back

// Speed is a slider, so the readout beside it is what says the handler ran — and the top
// of its travel is the half worth asserting, since "up to double" is the part a stray
// `max` would quietly take away.
await page.fill("#speed", "200");
check(
  "the speed slider runs up to double",
  (await page.textContent("#speed-value")) === "200%",
  await page.textContent("#speed-value"),
);
await page.fill("#speed", "25");
check(
  "and down to a quarter",
  (await page.textContent("#speed-value")) === "25%",
  await page.textContent("#speed-value"),
);
await page.fill("#speed", "100");

await page.click('#hand button[data-hand="right"]');
check("picking a hand moves the marker onto it", (await chosen("hand", "hand", "right")) === "true");
await page.click('#hand button[data-hand="both"]');

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
// The canvas width goes in the detail because it is what explains a wrong count: 52 keys
// across a window caught mid-resize are too narrow to be told apart by sampling pixels.
const stageWidth = await page.evaluate(() => document.querySelector("#stage").width);
check(
  "Full 88 shows the whole piano",
  fullKeys === 52,
  `${fullKeys} white keys, expected 52, across ${stageWidth}px`,
);

await page.keyboard.down("a");
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "04-pressed-full88.png") });
await page.keyboard.up("a");

/**
 * Marking out a loop region: scroll the track to a moment, drop a point on it, scroll on,
 * drop the other.
 *
 * The two halves that can only be checked in a real window are the gesture — a wheel over
 * the canvas has to move the playhead rather than the page — and the markers being drawn,
 * which is the thing that makes the region something you can aim rather than guess at.
 *
 * Runs on whatever keyboard the zoom checks above left behind — the gesture and the
 * markers are the same at any width, and the restart check further down is reading that
 * setting.
 */
await page.hover("#stage");

const playhead = async () => page.textContent("#time-now");
const before = await playhead();
await page.mouse.wheel(0, -800); // up the track is further into the song
await page.waitForTimeout(300);
const after = await playhead();
check("scrolling the stage moves through the song", after !== before, `${before} -> ${after}`);
check("scrolling stops the run rather than fighting it", /Resume|Play/.test((await page.textContent("#play")) ?? ""));

// The other gesture: grab the track with the middle button and pull. Chrome answers a
// middle click with its own scroll-anywhere cursor, which eats every event after it, so
// this is really a check that the app got in first and called it off.
const stage = await page.locator("#stage").boundingBox();
const midX = stage.x + stage.width / 2;
const midY = stage.y + stage.height / 2;
const beforeDrag = await playhead();
await page.mouse.move(midX, midY);
await page.mouse.down({ button: "middle" });
for (let step = 1; step <= 5; step++) await page.mouse.move(midX, midY - step * 30);
await page.mouse.up({ button: "middle" });
await page.waitForTimeout(300);
const afterDrag = await playhead();
check(
  "dragging the track with the middle button moves it too",
  afterDrag !== beforeDrag,
  `${beforeDrag} -> ${afterDrag} (dragged up, so backwards)`,
);

await page.keyboard.press("[");
await page.waitForTimeout(150);
const startText = await page.textContent("#mark-start");
check(
  "[ drops the loop start where the track is sitting",
  /^⟦ Start \d+:[0-5]\d$/.test(startText?.trim() ?? ""),
  `#mark-start reads "${startText}"`,
);
check("one point on its own is not yet a region", (await page.inputValue("#section")) === "full");

await page.mouse.wheel(0, -600); // on through the song to find the other end
await page.waitForTimeout(300);
await page.keyboard.press("]");
await page.waitForTimeout(300);

const endText = await page.textContent("#mark-end");
check(
  "] closes the region",
  /^End \d+:[0-5]\d ⟧$/.test(endText?.trim() ?? ""),
  `#mark-end reads "${endText}"`,
);
check("marking a region out by hand turns Loop on", await page.isChecked("#loop"));
check(
  "the region joins the section menu as the chosen one",
  (await page.inputValue("#section")) === "marked",
  await page.inputValue("#section"),
);
const scope = await page.textContent("#progress-scope");
check("the progress strip names the region", /^Loop \d+:[0-5]\d/.test(scope ?? ""), scope ?? "");
const regionStart = (await page.textContent("#mark-start")).replace(/\D*Start\s*/, "");
check(
  "the run restarts at the top of the region",
  (await playhead()) === regionStart,
  `clock reads ${await playhead()}, region starts ${regionStart}`,
);

// The markers themselves, counted off the canvas: the green they are drawn in appears
// nowhere else on the stage, so any of it is the marks being drawn.
const markPixels = await page.evaluate(() => {
  const canvas = document.querySelector("#stage");
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let green = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    // #6bd490, allowing for the anti-aliasing along a dashed line.
    if (Math.abs(pixels[i] - 0x6b) < 12 && Math.abs(pixels[i + 1] - 0xd4) < 12 && Math.abs(pixels[i + 2] - 0x90) < 12) {
      green++;
    }
  }
  return green;
});
check("the loop markers are drawn on the stage", markPixels > 200, `${markPixels} marker pixels`);

// Backed off the loop start, so the shot catches the marker up the stage with the music
// outside the region veiled below it — which is the whole of what the region looks like.
await page.mouse.wheel(0, 220);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, "07-loop-region.png") });

/** The seconds a marker button is showing, or NaN if it has not been placed. */
const markSeconds = async (id) => {
  const text = (await page.textContent(id)) ?? "";
  const clock = /(\d+):([0-5]\d)/.exec(text);
  return clock ? Number(clock[1]) * 60 + Number(clock[2]) : Number.NaN;
};

/**
 * Fine-tuning a point by dragging it on the stage.
 *
 * Restarted first so the loop start is sitting exactly on the hit line, which is where the
 * run begins — that gives the drag a known place to take hold of the line.
 */
await page.click("#restart");
await page.waitForTimeout(300);
const beforeDrag2 = await markSeconds("#mark-start");
const stageBox = await page.locator("#stage").boundingBox();
// The keyboard takes the bottom of the stage; the hit line is the top of it.
const hitLine = stageBox.y + stageBox.height * (1 - 0.24);
await page.mouse.move(stageBox.x + stageBox.width / 2, hitLine);
await page.mouse.down();
for (let step = 1; step <= 5; step++) {
  await page.mouse.move(stageBox.x + stageBox.width / 2, hitLine - step * 24);
}
await page.mouse.up();
await page.waitForTimeout(300);
const afterDrag2 = await markSeconds("#mark-start");
check(
  "a loop point can be dragged along the stage to fine-tune it",
  Number.isFinite(afterDrag2) && afterDrag2 > beforeDrag2,
  `loop start moved ${beforeDrag2}s -> ${afterDrag2}s by dragging it up the stage`,
);

await page.click("#mark-clear");
await page.waitForTimeout(200);

/**
 * Where the end point lands when it is dropped without scrolling first.
 *
 * The start goes on the hit line and the end on the top edge of the stage, so the two of
 * them dropped one after the other enclose exactly the music on screen — a look-ahead's
 * worth of it.
 */
await page.keyboard.press("[");
await page.keyboard.press("]");
await page.waitForTimeout(300);
const enclosed = (await markSeconds("#mark-end")) - (await markSeconds("#mark-start"));
check(
  "the end point lands at the top of the stage, not on the hit line",
  enclosed >= 2 && enclosed <= 4,
  `${enclosed}s enclosed, which is the stage's own look-ahead`,
);
await page.screenshot({ path: path.join(SHOTS, "08-loop-wrapped.png") });

/**
 * The loop drawn as a loop: with the end of the region halfway down the stage, the music
 * above it is the region's own opening bars, shifted up by a lap.
 *
 * Checked by counting note-bright pixels in the top of the stage — the wrapped notes are
 * lit, and with Loop off the same strip is behind the veil over everything past the end
 * point, which is far darker than any note.
 */
const litAbove = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("#stage");
    const height = Math.floor(canvas.height * 0.3);
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, height).data;
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if ((r > 200 && g > 120 && b < 140) || (r < 140 && g > 150 && b > 200)) lit++;
    }
    return lit;
  });

// Halfway through the region, so its end sits in the middle of the stage.
const songSeconds = await markSeconds("#time-total");
const midRegion = ((await markSeconds("#mark-start")) + (await markSeconds("#mark-end"))) / 2;
const mapAt = async (seconds) => {
  const box = await page.locator("#timeline").boundingBox();
  await page.mouse.click(box.x + (box.width * seconds) / songSeconds, box.y + box.height / 2);
  await page.waitForTimeout(300);
};
await mapAt(midRegion);
const wrapped = await litAbove();

await page.uncheck("#loop");
await mapAt(midRegion);
const notWrapped = await litAbove();
check(
  "looping shows the start of the loop above its end point",
  wrapped > notWrapped * 2 && wrapped > 200,
  `${wrapped} lit pixels above the end point while looping, ${notWrapped} with Loop off`,
);
await page.check("#loop");
await mapAt(midRegion);
await page.screenshot({ path: path.join(SHOTS, "09-loop-seam.png") });

await page.click("#mark-clear");
await page.waitForTimeout(200);
check(
  "clearing the region goes back to the whole song",
  (await page.inputValue("#section")) === "full"
    && (await page.textContent("#progress-scope")) === ""
    && (await page.isDisabled("#mark-clear")),
);

/**
 * The song map: the whole piece drawn small, clickable, and as tall as you want it.
 *
 * Three things can only be checked in a real window — that the notes are actually drawn on
 * it, that a click on a point of it lands on the moment that point stands for, and that
 * dragging its foot resizes it and the size outlives the app.
 */
const mapBox = await page.locator("#timeline").boundingBox();
const mapInk = await page.evaluate(() => {
  const canvas = document.querySelector("#timeline");
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  let notes = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    // The two hand colours, #ff9f6b and #5ac8fa, appear nowhere else on the map.
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (r > 200 && g > 120 && b < 140) notes++;
    else if (r < 140 && g > 150 && b > 200) notes++;
  }
  return notes;
});
check("the song's notes are drawn on the map", mapInk > 100, `${mapInk} note pixels`);

// Three quarters of the way along a 23-second song is around 0:17. Checked as a range,
// since the exact second depends on the window width the map is drawn across.
await page.mouse.click(mapBox.x + mapBox.width * 0.75, mapBox.y + mapBox.height / 2);
await page.waitForTimeout(300);
const jumped = await page.textContent("#time-now");
const jumpedSec = Number(jumped.split(":")[0]) * 60 + Number(jumped.split(":")[1]);
check(
  "clicking the map jumps to that moment in the song",
  jumpedSec >= 15 && jumpedSec <= 19,
  `clicked three quarters along a ${await page.textContent("#time-total")} song, landed on ${jumped}`,
);

const heightOf = () => page.evaluate(() => document.querySelector("#timeline").getBoundingClientRect().height);
const startHeight = await heightOf();
const grip = await page.locator("#timeline-grip").boundingBox();
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
await page.mouse.down();
for (let step = 1; step <= 4; step++) await page.mouse.move(grip.x + grip.width / 2, grip.y + step * 15);
await page.mouse.up();
await page.waitForTimeout(300);
const grownHeight = await heightOf();
check(
  "dragging the grip makes the map taller",
  grownHeight > startHeight + 30,
  `${startHeight}px -> ${grownHeight}px`,
);
const MAP_HEIGHT = grownHeight;
check(
  "the map is still drawn at its new height",
  await page.evaluate(() => {
    const canvas = document.querySelector("#timeline");
    return canvas.height >= canvas.getBoundingClientRect().height;
  }),
);

// A section detected from the rests arrives as two markers too. The point is that the
// app's guess at where a phrase begins is something you can then nudge with [ and ],
// rather than something you either take whole or leave.
const sectionIds = await page.$$eval("#section option", (opts) => opts.map((o) => o.value));
await page.selectOption("#section", sectionIds[1]);
await page.waitForTimeout(250);
check(
  "choosing a section puts its edges under the markers",
  (await page.locator("#mark-start.set").count()) === 1
    && (await page.locator("#mark-end.set").count()) === 1,
  `${sectionIds.length - 1} sections; markers read ${await page.textContent("#mark-start")} .. ${await page.textContent("#mark-end")}`,
);
await page.selectOption("#section", "full");
await page.waitForTimeout(200);

await page.uncheck("#loop");

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

// Read off the style rather than measured: the timeline is hidden until a song is open,
// and a hidden element measures zero however tall it has been told to be.
const rememberedHeight = await reopened.evaluate(
  () => document.querySelector("#timeline").style.height,
);
check(
  "the height of the song map survives a restart",
  Math.abs(Number.parseFloat(rememberedHeight) - MAP_HEIGHT) < 2,
  `${rememberedHeight}, was ${MAP_HEIGHT}px`,
);

await second.close();

// Opening a .mid by path — "open with Piana", the command line, the picker — should load
// it and note which folder it came from, so the next Open dialog starts there.
const sample = path.join(ROOT, "public", "samples", "twinkle-twinkle.mid");
const third = await launch([sample]);
const fromArgv = await third.firstWindow();
await fromArgv.waitForSelector("#stage", { timeout: 15000 });
await fromArgv.waitForFunction(
  () => /notes$/.test(document.querySelector("#song-meta")?.textContent ?? ""),
  null,
  { timeout: 10000 },
);
const argvSong = await fromArgv.textContent("#song-name");
check("a .mid on the command line opens", /twinkle/i.test(argvSong ?? ""), argvSong ?? "");

// The song list, which reads the folder that song came from. It has to run here rather
// than in the first launch: before anything has been opened there is no folder to list.
await fromArgv.click("#library");
await fromArgv.waitForSelector(".library-card", { timeout: 5000 });
const listed = await fromArgv.$$eval(".library-title", (els) => els.map((e) => e.textContent.trim()));
check(
  "the song list shows the MIDI files in the remembered folder",
  listed.includes("twinkle-twinkle"),
  listed.join(" / ") || "(empty)",
);
check(
  "the listed folder is the one the song came from",
  (await fromArgv.textContent("#library-path")) === path.dirname(sample),
  (await fromArgv.textContent("#library-path")) ?? "",
);
check(
  "the song list marks the song that is loaded",
  (await fromArgv.locator(".library-row.current").count()) === 1,
);
await fromArgv.screenshot({ path: path.join(SHOTS, "07-library.png") });

// Searching narrows it, and a search that matches nothing empties it rather than
// silently showing everything.
await fromArgv.fill("#library-query", "twink");
check("searching keeps a matching song", (await fromArgv.locator(".library-row").count()) === 1);
await fromArgv.fill("#library-query", "ragtime");
check("searching drops the ones that don't match", (await fromArgv.locator(".library-row").count()) === 0);
await fromArgv.fill("#library-query", "");

// Enter on the highlighted row is the whole point of the screen: it should close the
// list and load the song, without a file dialog anywhere.
await fromArgv.press("#library-query", "Enter");
await fromArgv.waitForTimeout(800);
check("the song list closes when a song is chosen", (await fromArgv.locator(".library-card").count()) === 0);
const opened = await fromArgv.textContent("#song-name");
check("Enter on a listed song loads it", /twinkle/i.test(opened ?? ""), opened ?? "");

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
