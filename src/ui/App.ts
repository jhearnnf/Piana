import type { Difficulty, HandSelection, Song } from "../core/types.ts";
import { parseMidi } from "../midi/parseMidi.ts";
import { PianoRenderer } from "../render/PianoRenderer.ts";
import { visibleRange, type Zoom } from "../render/visibleRange.ts";
import { ComputerKeyboardInput } from "../input/ComputerKeyboardInput.ts";
import { PointerInput } from "../input/PointerInput.ts";
import { MidiInput } from "../input/MidiInput.ts";
import type { MidiState, MidiStatus } from "../input/midiDevices.ts";
import type { NoteInputHandler } from "../input/InputSource.ts";
import { Conductor } from "../game/Conductor.ts";
import { PianoAudioPlayer } from "../audio/Player.ts";
import { AutoPlayer } from "../game/AutoPlayer.ts";
import { GameSession } from "../game/GameSession.ts";
import type { TimeRange } from "../game/practice.ts";
import {
  clearBests,
  getBest,
  groupBySong,
  listBests,
  saveIfBest,
  type ScoreContext,
} from "../game/highScores.ts";
import { applyDifficulty } from "../song/difficulty.ts";
import { applyHandModes, defaultHandModes, type HandMode } from "../song/handModes.ts";
import { detectSections, fullSongSection, type Section } from "../song/sections.ts";
import {
  loopSectionId,
  markedRegion,
  marksOf,
  moveMark,
  placeMark,
  NO_MARKS,
  type LoopMarks,
} from "../song/loopRegion.ts";
import {
  addLoop,
  defaultLoopName,
  loadLoops,
  loopById,
  loopMatching,
  MAX_LOOP_NAME,
  rangeOf,
  removeLoop,
  renameLoop,
  saveLoops,
  type SavedLoop,
} from "../song/savedLoops.ts";
import { ScrubInput } from "../input/ScrubInput.ts";
import { clampToSong } from "../input/scrub.ts";
import { MarkerDrag } from "../input/MarkerDrag.ts";
import { TimelineInput } from "../input/TimelineInput.ts";
import {
  DEFAULT_TIMELINE_HEIGHT,
  MAX_TIMELINE_HEIGHT,
  MIN_TIMELINE_HEIGHT,
  TimelineRenderer,
} from "../render/TimelineRenderer.ts";
import { escapeHtml, formatTime, sectionLabel } from "./format.ts";
import { showResults } from "./resultsScreen.ts";
import { showScores } from "./scoresScreen.ts";
import { showTracks } from "./tracksScreen.ts";
import { showLibrary, type LibraryView } from "./libraryScreen.ts";
import { buildLibrary, songTitle } from "../song/library.ts";
import { desktop, type PianaDesktop, type SongFolder } from "../desktop.ts";
import {
  loadMidiDevice,
  loadMuted,
  loadVolume,
  loadWaitMode,
  loadZoom,
  loadTimelineHeight,
  saveMidiDevice,
  saveMuted,
  saveTimelineHeight,
  saveVolume,
  saveWaitMode,
  saveZoom,
} from "./preferences.ts";

const MIDI_LABELS: Record<MidiStatus, string> = {
  unsupported: "🎹 MIDI: not supported (use Chrome/Edge)",
  unavailable: "🎹 MIDI: blocked",
  "no-device": "🎹 MIDI: no device",
  "device-missing": "🎹 MIDI: chosen device not connected",
  connected: "🎹 MIDI: connected",
};

/** Menu value for "don't single out a device" — the empty string an `<option>` gives back. */
const ALL_DEVICES = "";

/** Menu value for the region marked by hand, which joins the section list once it exists. */
const MARKED_SECTION = "marked";

/** How far an arrow key moves the playhead along the timeline, in seconds. Shift goes further. */
const KEY_SEEK_STEP = 2;
const KEY_SEEK_COARSE = 15;

/** The `<input>` types that letters actually go into, as against sliders and tick boxes. */
const TEXT_ENTRY = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

/**
 * Is this element one that letters go into?
 *
 * Two boxes on the app take typing — the one that names a loop and the one that searches
 * the song list — and every keyboard shortcut has to keep out of both, since `[` and the
 * space bar are perfectly good characters to put in a name. Asked of the element rather
 * than of those two boxes, because the next box will want the same answer.
 *
 * Deliberately narrow: a slider, a tick box and a dropdown are all things the focus can
 * land on and none of them is a place you are writing, so a shortcut pressed over one of
 * them is a shortcut, not a keystroke.
 */
function isTyping(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && TEXT_ENTRY.has(element.type);
}

/** A name of the user's, in the quotes a tooltip says it in. */
function quoted(name: string): string {
  return `“${name}”`;
}

/**
 * The chrome above the stage, in three strips, ordered by how often you touch them.
 *
 *  1. The bar — Play, and the things you reach for between songs. Play is the only
 *     accent-filled control on the screen, because it is the one you press most and
 *     everything else can afford to be quieter than it.
 *  2. The settings — how *this* run is set up: hands, difficulty, section, wait, speed.
 *     One row of same-height controls under small labels, with the two you set once and
 *     forget (the keyboard size and which device to listen to) pushed to the far end.
 *  3. The timeline, sitting directly on the stage: the whole song drawn small, so the
 *     shape of the piece and where you are in it are one picture. Click it to go there.
 *     Its head carries the clock and the two loop points — the only controls on the screen
 *     about a moment in the song rather than about the run as a whole — plus the button
 *     that keeps the marked stretch under a name. Along the top of the map itself runs the
 *     lane of loops already kept for this song: point at one to see what it is called and
 *     which bars it holds, click it to practise it. Its foot is a grip for how much room
 *     the map gets.
 *
 * There is no title band. It was fifty pixels saying the name of an app you already
 * opened, taken off the runway the notes fall down.
 */
const TEMPLATE = `
  <div class="piana-bar">
    <div class="bar-transport">
      <button id="play" class="play-btn" type="button" disabled
              title="Play or pause (space)">▶ Play</button>
      <button id="restart" class="icon-btn" type="button"
              title="Start this run again" aria-label="Restart" disabled>⟲</button>
    </div>

    <div class="bar-song">
      <span id="song-name" class="song-name">No song loaded</span>
      <span id="song-meta" class="song-meta">Open a MIDI file to start</span>
    </div>

    <div class="bar-actions">
      <button id="library" type="button" class="strong"
              title="Songs in your MIDI folder (Ctrl+L)" hidden>📂 Songs</button>
      <label class="file-btn">📄 Open…<input id="file" type="file" accept=".mid,.midi" /></label>
      <button id="demo" type="button" title="Load the built-in demo song">🎵 Demo</button>
      <button id="tracks" type="button" title="Which hand plays each track" disabled>🎼 Tracks</button>
      <button id="scores" type="button" title="Best scores">🏆 Scores</button>
    </div>

    <div class="bar-output">
      <button id="mute" type="button" class="icon-btn" aria-pressed="false"
              aria-label="Mute" title="Mute">🔊</button>
      <input id="volume" type="range" min="0" max="100" step="1" value="75"
             aria-label="Volume" title="Volume" />
      <span id="midi-status" class="midi-status">🎹 MIDI: …</span>
    </div>
  </div>

  <div class="piana-settings">
    <div class="setting">
      <span class="setting-label" id="hand-label">Hands</span>
      <span class="seg" id="hand" role="group" aria-labelledby="hand-label">
        <button type="button" data-hand="left" aria-pressed="false">Left</button>
        <button type="button" data-hand="both" class="active" aria-pressed="true">Both</button>
        <button type="button" data-hand="right" aria-pressed="false">Right</button>
      </span>
    </div>

    <div class="setting">
      <span class="setting-label" id="difficulty-label">Difficulty</span>
      <span class="seg" id="difficulty" role="group" aria-labelledby="difficulty-label">
        <button type="button" data-difficulty="easy" aria-pressed="false">Easy</button>
        <button type="button" data-difficulty="medium" aria-pressed="false">Medium</button>
        <button type="button" data-difficulty="hard" class="active" aria-pressed="true">Hard</button>
      </span>
    </div>

    <label class="setting">
      <span class="setting-label">Section</span>
      <select id="section"><option value="full">Full song</option></select>
    </label>

    <div class="toggles">
      <label class="chip"><input type="checkbox" id="wait" checked /> Wait mode</label>
    </div>

    <label class="setting">
      <span class="setting-label">Speed</span>
      <input id="speed" class="speed-slider" type="range" min="25" max="200" step="5" value="100"
             aria-label="Speed" title="Playback speed" />
      <output id="speed-value" class="speed-value" for="speed">100%</output>
    </label>

    <div class="setting-rare">
    <label class="setting">
      <span class="setting-label">Keys</span>
      <select id="zoom">
        <option value="auto" selected>Auto</option>
        <option value="1">1 octave</option>
        <option value="2">2 octaves</option>
        <option value="3">3 octaves</option>
        <option value="4">4 octaves</option>
        <option value="full">Full 88</option>
      </select>
    </label>

    <label class="setting" id="midi-device-row" hidden>
      <span class="setting-label">Input</span>
      <select id="midi-device" title="Which MIDI device to listen to">
        <option value="">All devices</option>
      </select>
    </label>
    </div>
  </div>

  <div class="piana-timeline" id="progress" hidden>
    <div class="timeline-head">
      <span class="time" id="time-now">0:00</span>
      <span class="progress-scope" id="progress-scope"></span>
      <span class="loop-marks" role="group" aria-label="Loop">
        <label class="loop-toggle"
               title="Repeat the marked stretch over and over instead of playing it once">
          <input type="checkbox" id="loop" />
          <span class="loop-toggle-icon" aria-hidden="true">↻</span>
          <span>Loop</span>
        </label>
        <button id="mark-start" type="button" class="mark-btn" disabled
                title="Start the loop at the hit line ( [ )">⟦ Set start</button>
        <button id="mark-end" type="button" class="mark-btn" disabled
                title="End the loop at the top of the stage ( ] )">Set end ⟧</button>
        <button id="mark-clear" type="button" class="mark-btn clear" disabled
                title="Back to the whole song ( \\ )" aria-label="Clear the loop region">✕</button>
        <span class="mark-sep" aria-hidden="true"></span>
        <button id="loop-save" type="button" class="mark-btn" disabled
                title="Keep this stretch under a name">✚ Save loop</button>
        <button id="loop-delete" type="button" class="mark-btn clear" hidden
                title="Forget this saved loop">Forget</button>
      </span>
      <form id="loop-name-form" class="loop-name-form" hidden>
        <input id="loop-name" class="loop-name-input" type="text" maxlength="40"
               autocomplete="off" spellcheck="false"
               placeholder="Name this loop" aria-label="Loop name" />
        <button type="submit" class="mark-btn set">Keep</button>
        <button id="loop-name-cancel" type="button" class="mark-btn clear"
                aria-label="Cancel">✕</button>
      </form>
      <span class="time" id="time-total">0:00</span>
    </div>
    <div class="timeline-body">
      <canvas id="timeline" tabindex="0" role="slider" aria-label="Song position"
              aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"
              title="Click or drag to move through the song"></canvas>
      <div class="loop-tip" id="loop-tip" hidden></div>
    </div>
    <div class="timeline-grip" id="timeline-grip"
         title="Drag to make the song map taller or shorter"></div>
  </div>
  <div class="piana-stage">
    <canvas id="stage" title="Scroll — or drag with the middle button — to move through the song"></canvas>
    <div class="stage-loop" id="stage-loop" hidden></div>
  </div>
`;

/**
 * Top-level app controller. Owns the shared game objects (renderer, conductor, audio,
 * session) and the user-facing state (song, difficulty, hand, wait, section), and wires the
 * controls to them. Keeping this in one place means `main.ts` is just a bootstrap and each
 * feature toggle flows through a single `rebuild`.
 */
export class App {
  private readonly renderer: PianoRenderer;
  private readonly timeline: TimelineRenderer;
  private readonly conductor = new Conductor();
  private readonly audio = new PianoAudioPlayer();
  private readonly autoPlayer = new AutoPlayer(this.audio);
  private readonly session: GameSession;

  private readonly pressed = new Set<number>();
  private readonly el: Record<string, HTMLElement>;

  private baseSong: Song | null = null;
  private sections: Section[] = [];
  /** Which hand plays each track, indexed to match `baseSong.tracks`. Reset per song. */
  private handModes: HandMode[] = [];
  private hand: HandSelection = "both";
  private difficulty: Difficulty = "hard";
  /** On by default; see `loadWaitMode`. Kept in step with the checkbox in the constructor. */
  private waitMode = true;
  private loop = false;
  private zoom: Zoom = "auto";
  private muted = false;
  private range: TimeRange | null = null;
  private sectionId = "full";
  /**
   * The two loop points as they stand, which is not the same as {@link range}: a start
   * dropped on its own is a marker on the stage and nothing more until its partner lands.
   */
  private marks: LoopMarks = NO_MARKS;
  /**
   * The loops kept for the song that is open, newest song wins.
   *
   * Held here rather than read from storage each frame: they are drawn on every one of
   * them, and the list is small enough that a copy is cheaper than a parse.
   */
  private savedLoops: SavedLoop[] = [];
  /**
   * Which kept loop is being practised, or null.
   *
   * None of them when a song opens, and none of them the moment a marker is dragged off
   * one: the region is then a stretch of song that merely started life as a saved loop,
   * and calling it by that name would mean the label in the corner of the stage was
   * describing bars nobody is playing.
   */
  private activeLoopId: string | null = null;
  /** The kept loop under the pointer, lit on the map while it is there. */
  private hoverLoopId: string | null = null;
  /** Whether the name box is open, and whether it is naming a new loop or an old one. */
  private naming: "new" | "rename" | null = null;
  /**
   * True while a marker is being dragged.
   *
   * The stage stops wrapping the loop for as long as it is, so the point can be aimed
   * against the music that is really either side of it rather than against a ribbon of
   * repeats that would slide about under the hand moving it.
   */
  private tuningMark = false;
  /** Whether a seek that is under way interrupted playback, and so should give it back. */
  private resumeAfterSeek = false;
  private timelineHeight = DEFAULT_TIMELINE_HEIGHT;
  private wasPlaying = false;
  /** Last clock written to the readout, so the frame loop can skip no-op writes. */
  private shownTime = "";

  constructor(root: HTMLElement) {
    root.innerHTML = TEMPLATE;
    const canvas = root.querySelector<HTMLCanvasElement>("#stage")!;
    const timelineCanvas = root.querySelector<HTMLCanvasElement>("#timeline")!;
    this.renderer = new PianoRenderer(canvas);
    this.timeline = new TimelineRenderer(timelineCanvas);
    this.session = new GameSession(this.conductor, this.autoPlayer);
    this.session.onFinish = (result) => this.handleFinish(result);

    this.el = {
      file: root.querySelector("#file")!,
      demo: root.querySelector("#demo")!,
      play: root.querySelector("#play")!,
      restart: root.querySelector("#restart")!,
      difficulty: root.querySelector("#difficulty")!,
      hand: root.querySelector("#hand")!,
      section: root.querySelector("#section")!,
      loop: root.querySelector("#loop")!,
      wait: root.querySelector("#wait")!,
      library: root.querySelector("#library")!,
      tracks: root.querySelector("#tracks")!,
      scores: root.querySelector("#scores")!,
      speed: root.querySelector("#speed")!,
      speedValue: root.querySelector("#speed-value")!,
      mute: root.querySelector("#mute")!,
      volume: root.querySelector("#volume")!,
      zoom: root.querySelector("#zoom")!,
      songName: root.querySelector("#song-name")!,
      songMeta: root.querySelector("#song-meta")!,
      midiDevice: root.querySelector("#midi-device")!,
      midiDeviceRow: root.querySelector("#midi-device-row")!,
      midiStatus: root.querySelector("#midi-status")!,
      progress: root.querySelector("#progress")!,
      progressScope: root.querySelector("#progress-scope")!,
      timeline: root.querySelector("#timeline")!,
      timelineGrip: root.querySelector("#timeline-grip")!,
      markStart: root.querySelector("#mark-start")!,
      markEnd: root.querySelector("#mark-end")!,
      markClear: root.querySelector("#mark-clear")!,
      loopSave: root.querySelector("#loop-save")!,
      loopDelete: root.querySelector("#loop-delete")!,
      loopMarks: root.querySelector(".loop-marks")!,
      loopNameForm: root.querySelector("#loop-name-form")!,
      loopName: root.querySelector("#loop-name")!,
      loopNameCancel: root.querySelector("#loop-name-cancel")!,
      loopTip: root.querySelector("#loop-tip")!,
      stageLoop: root.querySelector("#stage-loop")!,
      timeNow: root.querySelector("#time-now")!,
      timeTotal: root.querySelector("#time-total")!,
    };

    this.restoreZoom();
    // The opening keyboard should already be the one that was chosen last time, rather
    // than the renderer's own default until the first song lands.
    this.applyVisibleRange();
    this.setVolume(loadVolume());
    this.setMuted(loadMuted());
    this.setWaitMode(loadWaitMode());
    this.setTimelineHeight(loadTimelineHeight());
    this.wireInputs(canvas);
    this.wireTimeline(timelineCanvas);
    this.wireControls();
    this.wireDropTarget(root);
    this.wireDesktop(root);

    new ResizeObserver(() => this.renderer.resize()).observe(canvas.parentElement!);
    new ResizeObserver(() => this.timeline.resize()).observe(timelineCanvas.parentElement!);
    requestAnimationFrame(this.frame);
  }

  private wireInputs(canvas: HTMLCanvasElement): void {
    const handler: NoteInputHandler = {
      noteOn: (midi, velocity) => {
        this.pressed.add(midi);
        // Playing a key is itself the gesture the browser wants before it will allow
        // sound, so the piano works on its own — no song loaded, nothing pressed first.
        void this.audio.ensureStarted();
        this.audio.noteOn(midi, velocity); // echo the player's own presses
        this.session.handleHit(midi);
      },
      noteOff: (midi) => {
        this.pressed.delete(midi);
        this.audio.noteOff(midi);
      },
    };
    new ComputerKeyboardInput().connect(handler);
    new PointerInput(canvas, this.renderer).connect(handler);
    new ScrubInput(
      canvas,
      (deltaSec) => this.scrub(deltaSec),
      () => this.renderer.secondsPerPixel(),
    ).connect();
    new MarkerDrag(canvas, this.renderer, {
      marks: () => this.marks,
      nowSec: () => this.conductor.time,
      onGrab: () => (this.tuningMark = true),
      onMove: (which, time) => this.moveLoopMark(which, time),
      onSettle: () => {
        this.tuningMark = false;
        this.settleLoopMarks();
      },
    }).connect();

    const midi = new MidiInput();
    midi.onStatus = (state) => this.showMidiState(state);
    midi.selectDevice(loadMidiDevice()); // before connect: applied as soon as access lands
    midi.connect(handler);

    (this.el.midiDevice as HTMLSelectElement).addEventListener("change", (e) => {
      const name = (e.target as HTMLSelectElement).value || null;
      saveMidiDevice(name);
      midi.selectDevice(name);
    });
  }

  /**
   * Show which devices are on the bus, which one is being heard, and the connection state.
   *
   * The status pill deliberately says only "connected" now that the device menu is next to
   * it. It used to show the name of whichever input the browser happened to enumerate
   * first, which on a bus with a control surface on it meant the app announced a box of
   * faders as your piano.
   */
  private showMidiState({ status, devices, selected }: MidiState): void {
    const pill = this.el.midiStatus!;
    pill.textContent = MIDI_LABELS[status];
    pill.classList.toggle("ok", status === "connected");

    // Hidden only where there is no MIDI to speak of. It stays up for a single device,
    // and for none: the question it answers first is "what does the app think is plugged
    // in?", and a menu that appears only once you already have two keyboards can't answer
    // it at the moment you are wondering.
    this.el.midiDeviceRow!.hidden = status === "unsupported" || status === "unavailable";

    // A chosen device that isn't plugged in stays on the menu, marked. Dropping it would
    // silently reset the app to listening to everything — the very thing that was chosen
    // against — and the reset would only show up as a fader box playing your notes.
    const names = selected !== null && !devices.includes(selected) ? [...devices, selected] : devices;
    // Built as elements rather than as markup, unlike the section menu: a device names
    // itself, and a name with a quote or an angle bracket in it would otherwise be
    // pasted straight into the page's HTML.
    const select = this.el.midiDevice as HTMLSelectElement;
    const label = (name: string) =>
      name === selected && status === "device-missing" ? `${name} (not connected)` : name;
    select.replaceChildren(
      new Option("All devices", ALL_DEVICES),
      ...names.map((name) => new Option(label(name), name)),
    );
    select.value = selected ?? ALL_DEVICES;
  }

  private wireControls(): void {
    (this.el.file as HTMLInputElement).addEventListener("change", async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.loadSong(await file.arrayBuffer(), songTitle(file.name));
    });
    this.el.demo!.addEventListener("click", async () => {
      const res = await fetch("samples/twinkle-twinkle.mid");
      this.loadSong(await res.arrayBuffer(), "Twinkle Twinkle Little Star");
    });

    this.el.play!.addEventListener("click", () => void this.onPlayToggle());
    this.el.restart!.addEventListener("click", () => {
      this.session.reset();
      this.updatePlayButton();
    });

    this.wireSegment(this.el.difficulty!, "difficulty", (value) => {
      this.difficulty = value as Difficulty;
      this.rebuild();
    });
    (this.el.wait as HTMLInputElement).addEventListener("change", (e) => {
      this.waitMode = (e.target as HTMLInputElement).checked;
      saveWaitMode(this.waitMode);
      this.rebuild();
    });
    this.el.scores!.addEventListener("click", () => this.openScores());
    this.el.tracks!.addEventListener("click", () => this.openTracks());
    (this.el.loop as HTMLInputElement).addEventListener("change", (e) => {
      this.setLoop((e.target as HTMLInputElement).checked);
      this.rebuild();
    });
    (this.el.section as HTMLSelectElement).addEventListener("change", (e) => {
      this.selectSection((e.target as HTMLSelectElement).value);
      this.rebuild();
    });
    this.el.markStart!.addEventListener("click", () => this.placeLoopMark("start"));
    this.el.markEnd!.addEventListener("click", () => this.placeLoopMark("end"));
    this.el.markClear!.addEventListener("click", () => this.clearLoopMarks());
    this.wireSavedLoops();
    this.wireLoopKeys();
    this.wireSpaceBar();
    this.wireSegment(this.el.hand!, "hand", (value) => {
      this.hand = value as HandSelection;
      this.rebuild();
    });
    this.el.mute!.addEventListener("click", () => {
      this.setMuted(!this.muted);
      saveMuted(this.muted);
    });
    (this.el.volume as HTMLInputElement).addEventListener("input", (e) => {
      const level = Number((e.target as HTMLInputElement).value) / 100;
      this.setVolume(level);
      saveVolume(level);
      // Reaching for the volume is a request to hear something. A slider pushed up while
      // muted that changed nothing audible would just look broken, so it unmutes.
      if (this.muted && level > 0) {
        this.setMuted(false);
        saveMuted(false);
      }
    });
    (this.el.speed as HTMLInputElement).addEventListener("input", (e) => {
      this.setRate(Number((e.target as HTMLInputElement).value) / 100);
    });
    (this.el.zoom as HTMLSelectElement).addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.zoom = value === "auto" || value === "full" ? value : Number(value);
      saveZoom(this.zoom);
      this.applyVisibleRange();
    });
  }

  /**
   * The song map: click it to go there, and drag its bottom edge to give it more room.
   *
   * Seeking runs through the same {@link seekTo} as the wheel over the stage, so there is
   * one answer in the app to "put the run here" no matter which surface asked for it.
   */
  private wireTimeline(canvas: HTMLCanvasElement): void {
    new TimelineInput(canvas, {
      onPick: (x, y) => this.pickSavedLoop(x, y),
      onHover: (x, y) => this.hoverSavedLoop(x, y),
      onLeave: () => this.hoverSavedLoop(null, null),
      onGrab: () => {
        this.resumeAfterSeek = this.conductor.isPlaying();
        this.conductor.pause();
      },
      onSeek: (x) => this.seekTo(this.timeline.timeAtX(x)),
      onRelease: () => {
        // Handed back only if it was playing when it was taken: a click on the map while
        // paused is a look at a passage, and should not start the song.
        if (this.resumeAfterSeek) this.conductor.play();
        this.resumeAfterSeek = false;
        this.updatePlayButton();
      },
    }).connect();

    // The map is a slider, so it answers the keys a slider answers. It has to be reachable
    // by keyboard at all for the click-to-jump to have any equivalent without a mouse.
    canvas.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? KEY_SEEK_COARSE : KEY_SEEK_STEP;
      const to =
        e.key === "ArrowRight" ? this.conductor.time + step
        : e.key === "ArrowLeft" ? this.conductor.time - step
        : e.key === "Home" ? 0
        : e.key === "End" ? this.timeline.durationSec
        : null;
      if (to === null) return;
      e.preventDefault();
      this.seekTo(to);
    });

    this.wireTimelineGrip();
  }

  /**
   * Drag the foot of the timeline to change how much song is on screen.
   *
   * How tall the map wants to be is a question about the piece and the screen it is on,
   * not one the app can answer once for everybody: a two-line study needs a sliver, and
   * picking a passage out of a five-minute piece wants every pixel it can get.
   */
  private wireTimelineGrip(): void {
    const grip = this.el.timelineGrip!;
    let fromY = 0;
    let fromHeight = 0;

    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fromY = e.clientY;
      fromHeight = this.timelineHeight;
      grip.setPointerCapture(e.pointerId);
      grip.classList.add("dragging");
    });
    grip.addEventListener("pointermove", (e) => {
      if (grip.hasPointerCapture(e.pointerId)) this.setTimelineHeight(fromHeight + (e.clientY - fromY));
    });
    const letGo = (e: PointerEvent) => {
      if (!grip.hasPointerCapture(e.pointerId)) return;
      grip.releasePointerCapture(e.pointerId);
      grip.classList.remove("dragging");
      saveTimelineHeight(this.timelineHeight); // stored once, not on every pixel of the drag
    };
    grip.addEventListener("pointerup", letGo);
    grip.addEventListener("pointercancel", letGo);
  }

  /** Set the height of the song map, within what the map can usefully be drawn at. */
  private setTimelineHeight(height: number): void {
    this.timelineHeight = Math.min(MAX_TIMELINE_HEIGHT, Math.max(MIN_TIMELINE_HEIGHT, Math.round(height)));
    this.applyTimelineSize();
  }

  /**
   * Give the canvas the map's height plus the lane's.
   *
   * The lane of saved loops is drawn on the same canvas but is not part of the map, so it
   * is added to the height rather than taken out of it. Otherwise keeping your first loop
   * on a song would silently shrink the picture of the song — the map would be paying for
   * a strip about the map.
   */
  private applyTimelineSize(): void {
    const height = this.timelineHeight + this.timeline.laneHeight;
    (this.el.timeline as HTMLElement).style.height = `${height}px`;
    this.timeline.resize();
  }

  /**
   * The space bar: play and pause, and nothing else, ever.
   *
   * A browser gives the space bar to whatever has the focus — it presses the button, ticks
   * the tick box, opens the dropdown, scrolls the page. On a page of settings that is
   * fine. Here it is not: the bar is the transport control, and the thing you reach for it
   * to do is *stop the music*. Having it re-tick Loop instead, because Loop is what you
   * last clicked, is the kind of small betrayal that makes you stop trusting the key.
   *
   * So it is taken at the window, in the capture phase, before the focused control can see
   * it: pressed, released and repeated, whatever is under the focus ring. Nothing else in
   * the app is allowed to answer it.
   *
   * Two things are left alone. A box you are typing in gets its space, because a space is
   * a character. And with a screen up over the stage the bar does nothing at all — the run
   * behind it is paused on purpose, and the bar has nothing to say about a song you cannot
   * see — but it is still swallowed there, so it cannot press the button under the focus.
   */
  private wireSpaceBar(): void {
    const onSpace = (e: KeyboardEvent): void => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return; // a combination, not the bar
      if (isTyping(document.activeElement)) return;

      // Claimed on both the press and the release. A button is activated by the *release*
      // of the space bar, so stopping the press alone would leave the second half of the
      // keystroke loose in an app that has just decided the bar means something else.
      e.preventDefault();
      e.stopPropagation();

      if (e.type !== "keydown" || e.repeat) return; // held down is one pause, not sixty
      if (document.querySelector(".results-overlay")) return;
      void this.onPlayToggle();
    };
    window.addEventListener("keydown", onSpace, true);
    window.addEventListener("keyup", onSpace, true);

    // Enter, on a tick box, does what the space bar no longer can.
    //
    // Buttons and links answer Enter as well as the bar, so taking the bar away costs them
    // nothing. A checkbox answers only the bar — so Wait mode and Loop would have become
    // unreachable without a mouse, which is too high a price for a transport key.
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey) return;
      const box = document.activeElement;
      if (!(box instanceof HTMLInputElement) || box.type !== "checkbox") return;
      e.preventDefault();
      box.click();
    });
  }

  /**
   * Keys for the loop points: `[` opens the region, `]` closes it, `\` throws it away.
   *
   * The brackets because that is what every editor with an in-point and an out-point has
   * used for thirty years, and because the letters are all piano — a shortcut on `s` would
   * be a shortcut that plays a D.
   */
  private wireLoopKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (document.querySelector(".results-overlay")) return; // a screen is up over the stage

      // Skipped only where a bracket is a character somebody is typing, which on this
      // screen is the one box that names a loop. Everywhere else it is deliberately *not*
      // skipped: the settings are checkboxes, sliders and menus, none of which have any
      // use for a bracket, and a shortcut that quietly stopped working because you last
      // touched the section dropdown is a shortcut nobody trusts twice.
      if (isTyping(document.activeElement)) return;

      if (e.key === "[") this.placeLoopMark("start");
      else if (e.key === "]") this.placeLoopMark("end");
      else if (e.key === "\\") this.clearLoopMarks();
      else return;
      e.preventDefault();
    });
  }

  /**
   * Scroll the track by `deltaSec`.
   *
   * Playing stops the moment you take hold of the music. A clock still running underneath
   * a track being scrolled would fight the scroll for the playhead and would sound notes
   * at whatever speed your hand happened to move — and you are scrolling precisely because
   * you want to look at a passage rather than hear it go by.
   */
  private scrub(deltaSec: number): void {
    if (this.conductor.isPlaying()) this.conductor.pause();
    this.seekTo(this.conductor.time + deltaSec);
  }

  /**
   * Put the run at `seconds`. Every way of moving through the song ends up here — the
   * wheel, the middle-button drag, a click on the map, the arrow keys.
   */
  private seekTo(seconds: number): void {
    const song = this.practiceSong();
    if (!song) return;
    this.session.seek(clampToSong(seconds, song.durationSec));
    this.updatePlayButton();
  }

  /**
   * Drop a loop marker.
   *
   * The start goes on the hit line, where the music you can hear is. The end goes on the
   * top edge of the stage, because that is where a passage *finishes*: the notes between
   * the two are exactly the ones on screen, so a region no longer than the look-ahead is
   * framed whole at the moment you close it, and scrolling until the last note you want
   * is about to come into view is the same gesture as marking it.
   *
   * A region completed this way turns Loop on, because marking one out by hand is not
   * something anybody does for a single play-through.
   */
  private placeLoopMark(which: "start" | "end"): void {
    const song = this.practiceSong();
    if (!song) return;
    const now = this.conductor.time;
    const at = which === "end" ? this.renderer.timeAtTop(now) : now;
    this.marks = placeMark(this.marks, which, clampToSong(at, song.durationSec));
    this.activeLoopId = null; // settling works out whether the new pair is a saved loop

    if (markedRegion(this.marks)) this.settleLoopMarks();
    // Only one point down: the other is still somewhere further through the song. There
    // is nothing to practise yet, so whatever range was being practised is given up — but
    // the track stays exactly where your hand left it, because you are in the middle of
    // looking for the second point and being thrown back to the start would end the search.
    else this.dropRange(now);
  }

  /**
   * Slide a marker that is being dragged.
   *
   * Shown immediately and applied to nothing: the region is only handed to the session
   * when the button comes up. Re-configuring the run on every pixel would restart it sixty
   * times a second underneath the hand doing the dragging.
   */
  private moveLoopMark(which: "start" | "end", time: number): void {
    const song = this.practiceSong();
    if (!song) return;
    this.marks = moveMark(this.marks, which, clampToSong(time, song.durationSec));
    this.showLoopMarks();
  }

  /** Make the region the markers now describe the stretch that is practised. */
  private settleLoopMarks(): void {
    const region = markedRegion(this.marks);
    if (!region) {
      this.showLoopMarks();
      return;
    }
    this.range = region;
    this.sectionId = loopSectionId(region);
    // Re-read rather than remembered: a marker dragged off a saved loop's edge has left
    // that loop, and one dragged back onto it has returned to it. Both are the same
    // question — do these two times still describe something you named? — asked afresh.
    this.activeLoopId = loopMatching(this.savedLoops, region)?.id ?? null;
    this.setLoop(true);
    this.rebuild(); // which starts the run at the top of the region — where you want to be
  }

  /** Throw the marked region away and go back to practising the whole song. */
  private clearLoopMarks(): void {
    if (!this.baseSong) return;
    this.marks = NO_MARKS;
    this.activeLoopId = null;
    this.dropRange(this.conductor.time);
  }

  /** Practise the whole song again, leaving the track where it is sitting. */
  private dropRange(at: number): void {
    this.activeLoopId = null;
    if (this.range) {
      this.range = null;
      this.sectionId = "full";
      this.rebuild();
      this.session.seek(at);
      return; // the rebuild has already put the chrome in step with all of this
    }
    this.showLoopMarks();
    this.showSavedLoops();
  }

  /** Set loop mode and put the checkbox in step with it. */
  private setLoop(loop: boolean): void {
    this.loop = loop;
    (this.el.loop as HTMLInputElement).checked = loop;
  }

  /**
   * Put the state of the two markers on their buttons.
   *
   * A placed point shows its own time, so the pair of them read as the region itself and
   * not as two buttons that may or may not have been pressed — and so a marker scrolled
   * off the top of the stage is still somewhere you can see.
   */
  private showLoopMarks(): void {
    const ready = this.baseSong !== null;
    // A placed point keeps its word as well as gaining its time — "Start 0:04" rather than
    // "0:04" — so the pair still says what it is from across the room, and the button you
    // are looking for is found by reading rather than by remembering which side it is on.
    const label = (
      button: HTMLElement,
      time: number | null,
      unset: string,
      set: (value: string) => string,
    ) => {
      button.textContent = time === null ? unset : set(formatTime(time));
      button.classList.toggle("set", time !== null);
      (button as HTMLButtonElement).disabled = !ready;
    };
    label(this.el.markStart!, this.marks.start, "⟦ Set start", (t) => `⟦ Start ${t}`);
    label(this.el.markEnd!, this.marks.end, "Set end ⟧", (t) => `End ${t} ⟧`);
    (this.el.markClear as HTMLButtonElement).disabled =
      !ready || (this.marks.start === null && this.marks.end === null);
  }

  /**
   * The controls that keep a loop: the name box, and the two buttons either side of it.
   *
   * Saving is deliberately a second gesture rather than something marking a region does
   * for you. Most regions are marked to be played twice and thrown away, and a song that
   * quietly accumulated a saved loop every time you pressed `]` would end up with a lane
   * you had to clear out before you could read it.
   */
  private wireSavedLoops(): void {
    this.el.loopSave!.addEventListener("click", () => this.beginNaming());
    this.el.loopDelete!.addEventListener("click", () => this.forgetActiveLoop());
    (this.el.loopNameForm as HTMLFormElement).addEventListener("submit", (e) => {
      e.preventDefault();
      this.commitName();
    });
    this.el.loopNameCancel!.addEventListener("click", () => this.endNaming());
    this.el.loopName!.addEventListener("keydown", (e) => {
      // Escape backs out of naming, and is caught here so it never reaches anything else
      // on the page that might be listening for it.
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      this.endNaming();
    });
  }

  /**
   * Open the name box for the marked region — or for the loop it already is.
   *
   * A new loop arrives with "Loop 3" already in the box and selected, so keeping one is
   * Save-then-Enter for anybody who does not want to think of a name, and Save-type-Enter
   * for anybody who does.
   */
  private beginNaming(): void {
    const region = markedRegion(this.marks);
    if (!region) return;

    const active = loopById(this.savedLoops, this.activeLoopId);
    this.naming = active ? "rename" : "new";
    const input = this.el.loopName as HTMLInputElement;
    input.value = active ? active.name : defaultLoopName(this.savedLoops);
    input.maxLength = MAX_LOOP_NAME;
    this.el.loopMarks!.hidden = true;
    this.el.loopNameForm!.hidden = false;
    input.focus();
    input.select();
  }

  /** Put the name box away and give the row of buttons back. */
  private endNaming(): void {
    if (this.naming === null) return;
    this.naming = null;
    this.el.loopNameForm!.hidden = true;
    this.el.loopMarks!.hidden = false;
    // Focus goes back to the button that opened the box; left on a hidden input it would
    // land on the page body, and the bracket keys would start firing again mid-word.
    this.el.loopSave!.focus();
    this.showSavedLoops();
  }

  /** Keep the marked region under the typed name, or rename the loop it already is. */
  private commitName(): void {
    const region = markedRegion(this.marks);
    const name = (this.el.loopName as HTMLInputElement).value;

    if (region && this.naming === "rename" && this.activeLoopId !== null) {
      this.savedLoops = renameLoop(this.savedLoops, this.activeLoopId, name);
    } else if (region) {
      const { loops, loop } = addLoop(this.savedLoops, name, region);
      this.savedLoops = loops;
      this.activeLoopId = loop.id; // what you just saved is what you are practising
    }
    this.storeLoops();
    this.endNaming();
    this.applySavedLoops();
  }

  /**
   * Forget the saved loop being practised.
   *
   * The markers stay where they are and the run carries on over the same bars: what has
   * been thrown away is the name and the band on the lane, not the passage. Deleting a
   * bookmark should not also close the book at that page.
   */
  private forgetActiveLoop(): void {
    const loop = loopById(this.savedLoops, this.activeLoopId);
    if (!loop) return;
    this.savedLoops = removeLoop(this.savedLoops, loop.id);
    this.activeLoopId = null;
    if (this.hoverLoopId === loop.id) this.hoverSavedLoop(null, null);
    this.storeLoops();
    this.applySavedLoops();
  }

  /** Write this song's loops back to storage. Called after every change to the list. */
  private storeLoops(): void {
    if (this.baseSong) saveLoops(this.baseSong.name, this.savedLoops);
  }

  /**
   * Hand the current list of loops to the map and put the chrome in step with it.
   *
   * The canvas is resized here because the lane's height depends on how many loops
   * overlap — saving one that sits under another makes the strip a row taller.
   */
  private applySavedLoops(): void {
    this.timeline.setLoops(this.savedLoops);
    this.applyTimelineSize();
    this.showSavedLoops();
    this.populateSections(); // the marked option is named after the loop when it is one
  }

  /**
   * Say what can be done with loops right now, and which one is being played.
   *
   * The name sits over the top-left of the stage rather than in the timeline's head. It is
   * the answer to "what am I practising?", and that question is asked while looking at the
   * notes — a caption three strips up, among the buttons, is a caption nobody reads.
   */
  private showSavedLoops(): void {
    const region = markedRegion(this.marks);
    const active = loopById(this.savedLoops, this.activeLoopId);

    const save = this.el.loopSave as HTMLButtonElement;
    save.disabled = region === null;
    save.textContent = active ? "✎ Rename" : "✚ Save loop";
    save.title = active
      ? `Give ${quoted(active.name)} a different name`
      : "Keep this stretch under a name";

    const forget = this.el.loopDelete as HTMLButtonElement;
    forget.hidden = active === null;
    forget.title = active ? `Forget ${quoted(active.name)}` : "";

    this.showStageLoop(active);
  }

  /**
   * Write the loop's name over the top-left of the stage.
   *
   * Rewritten only when the loop itself changes, and the fade is restarted by hand when it
   * does. Every other call would otherwise replace the same two spans with themselves
   * several times a run — and switching from one loop straight to another would swap the
   * word silently, which is exactly the moment the caption most needs to be noticed.
   */
  private showStageLoop(active: SavedLoop | null): void {
    const label = this.el.stageLoop!;
    const shown = label.dataset.loop ?? "";
    const now = active ? `${active.id}:${active.name}` : "";
    label.hidden = active === null;
    if (shown === now) return;

    label.dataset.loop = now;
    label.innerHTML = active
      ? `<span class="stage-loop-name">${escapeHtml(active.name)}</span>` +
        `<span class="stage-loop-time">${formatTime(active.start)}–${formatTime(active.end)}</span>`
      : "";
    // Taken off and put back on, with a read of the layout in between to force it: an
    // animation that is already running does not start again just because its element's
    // contents changed.
    label.style.animation = "none";
    void label.offsetWidth;
    label.style.animation = "";
  }

  /**
   * A press on the lane of saved loops: start playing that stretch.
   *
   * Returns whether the press was claimed, so a press anywhere else on the map still
   * scrubs. Pressing the loop already being played switches it off and gives the whole
   * song back — the same target turning the same thing on and off, which is what lets
   * the lane be used without a second control for putting a loop away.
   */
  private pickSavedLoop(x: number, y: number): boolean {
    const band = this.timeline.loopAt(x, y);
    const loop = band && loopById(this.savedLoops, band.id);
    if (!loop) return false;

    if (this.activeLoopId === loop.id) this.clearLoopMarks();
    else {
      this.marks = marksOf(rangeOf(loop));
      this.settleLoopMarks(); // which starts the run at the top of it
    }
    return true;
  }

  /**
   * Light up the loop under the pointer and say what it is called.
   *
   * The band alone is a violet bar six pixels tall — enough to say *something is saved
   * here*, and nothing like enough to choose between three of them. Hovering names it and
   * lights the bars it holds down over the map, so which passage a loop is can be read
   * before committing to it with a click.
   */
  private hoverSavedLoop(x: number | null, y: number | null): void {
    const band = x === null || y === null ? null : this.timeline.loopAt(x, y);
    this.hoverLoopId = band?.id ?? null;

    const tip = this.el.loopTip!;
    tip.hidden = band === null;
    if (!band) return;

    const loop = loopById(this.savedLoops, band.id);
    tip.innerHTML =
      `<span class="loop-tip-name">${escapeHtml(band.name)}</span>` +
      (loop
        ? `<span class="loop-tip-time">${formatTime(loop.start)}–${formatTime(loop.end)}</span>`
        : "");
    // Centred on the band and pinned just under it, so the label points at the bar it
    // belongs to rather than at wherever the pointer happens to be along it.
    const canvas = this.el.timeline as HTMLCanvasElement;
    tip.style.left = `${canvas.offsetLeft + band.x + band.w / 2}px`;
    tip.style.top = `${canvas.offsetTop + band.y + band.h + 5}px`;
  }

  /**
   * Wire a segmented control: click a button, it becomes the chosen one.
   *
   * Hands and difficulty are both "pick one of three", and a row of buttons showing all
   * three answers at once beats a dropdown that shows one and hides the rest behind a
   * click — these are settings you change while looking at the stage, not ones you go
   * hunting for. `key` is the data attribute the buttons carry their value in.
   */
  private wireSegment(group: HTMLElement, key: string, onPick: (value: string) => void): void {
    group.addEventListener("click", (e) => {
      const picked = (e.target as HTMLElement).closest<HTMLButtonElement>(`button[data-${key}]`);
      if (!picked || picked.classList.contains("active")) return;
      for (const button of group.querySelectorAll("button")) {
        const on = button === picked;
        button.classList.toggle("active", on);
        button.setAttribute("aria-pressed", String(on));
      }
      onPick(picked.dataset[key]!);
    });
  }

  /**
   * Set playback speed, as a multiple of the song's written tempo, and show it as a
   * percentage beside the slider.
   *
   * A slider rather than a row of fixed steps because the useful speed is the one just
   * inside what your hands can manage, and that lands between whatever three numbers a
   * segmented control would have offered. It runs past 1× as well as under it: once a
   * piece is learned, pushing it above tempo is how you find the bars that are still
   * only *nearly* learned. Both the clock and the accompaniment have to hear about it —
   * notes that fell at double speed over a piano still playing at one would be a
   * different song.
   */
  private setRate(rate: number): void {
    this.conductor.rate = rate;
    this.autoPlayer.setRate(rate);
    (this.el.speed as HTMLInputElement).value = String(Math.round(rate * 100));
    this.el.speedValue!.textContent = `${Math.round(rate * 100)}%`;
  }

  /**
   * Silence everything the app plays — the accompaniment and the echo of your own
   * presses alike — and say so on the button.
   *
   * A real MIDI keyboard usually makes its own sound, so the echo is the half people want
   * gone; but "mute" that left the other hand playing would be a strange thing to call
   * mute, so it is all of it. The notes still fall and scoring is untouched.
   */
  private setMuted(muted: boolean): void {
    this.muted = muted;
    this.audio.setMuted(muted);

    // Icon-only, because the control row is full and this is one of the few glyphs
    // everyone already reads. The label says what the button will *do*, which is the
    // convention for a toggle; `aria-pressed` and the red styling carry the state.
    const button = this.el.mute!;
    button.textContent = muted ? "🔇" : "🔊";
    button.title = muted ? "Unmute" : "Mute";
    button.setAttribute("aria-label", muted ? "Unmute" : "Mute");
    button.setAttribute("aria-pressed", String(muted));
    button.classList.toggle("muted", muted);
  }

  /** Set the output level (0..1) and put the slider in step with it. */
  private setVolume(level: number): void {
    this.audio.setVolume(level);
    (this.el.volume as HTMLInputElement).value = String(Math.round(level * 100));
  }

  /** Set wait mode and put the checkbox in step with it. */
  private setWaitMode(wait: boolean): void {
    this.waitMode = wait;
    (this.el.wait as HTMLInputElement).checked = wait;
  }

  /**
   * Show the best score for every song, difficulty, hand and section played on this
   * machine.
   *
   * Playback pauses while the list is up — the alternative is reading your old scores
   * while the current run quietly racks up misses behind the overlay.
   */
  private openScores(): void {
    if (this.conductor.isPlaying()) {
      this.conductor.pause();
      this.updatePlayButton();
    }
    showScores(groupBySong(listBests()), this.baseSong?.name ?? null, {
      onClear: () => clearBests(),
      onClose: () => {},
    });
  }

  /**
   * Choose which hand plays each track of the loaded song.
   *
   * Same pause-while-open as the scores: re-splitting the hands rebuilds the session
   * underneath you anyway, so there is nothing to come back to mid-run.
   */
  private openTracks(): void {
    const song = this.baseSong;
    if (!song) return;
    if (this.conductor.isPlaying()) {
      this.conductor.pause();
      this.updatePlayButton();
    }
    showTracks(song, () => this.handModes, {
      onChange: (index, mode) => {
        this.handModes[index] = mode;
        this.rebuild();
      },
      onClose: () => {},
    });
  }

  /**
   * Put the dropdown back to whatever was chosen last time.
   *
   * The stored value is checked against the options actually on the menu rather than
   * against a second list of valid zooms kept here — one that could quietly stop matching
   * the markup, leaving a saved setting that silently does nothing.
   */
  private restoreZoom(): void {
    const stored = loadZoom();
    if (stored === null) return;

    const select = this.el.zoom as HTMLSelectElement;
    if (![...select.options].some((option) => option.value === String(stored))) return;

    select.value = String(stored);
    this.zoom = stored;
  }

  /**
   * Drop a `.mid` anywhere on the app to load it.
   *
   * Bound to the window rather than the app root because a file dropped on any
   * uncovered part of the page makes the browser navigate to it — in a desktop
   * window that means the app is simply gone, replaced by a MIDI download.
   */
  private wireDropTarget(root: HTMLElement): void {
    const dragging = (on: boolean) => root.classList.toggle("dragging", on);

    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragging(true);
    });
    // Fires for every child element the pointer crosses, so only the one that
    // actually left the window counts.
    window.addEventListener("dragleave", (e) => {
      if (!e.relatedTarget) dragging(false);
    });
    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragging(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.midi?$/i.test(f.name));
      if (file) this.loadSong(await file.arrayBuffer(), songTitle(file.name));
    });
  }

  /**
   * Desktop-only wiring. No-op in the browser build.
   *
   * The hidden `<input type="file">` is swapped for the shell's native picker:
   * it remembers the last folder used and is the same dialog the File menu and
   * Ctrl+O open, so all three routes behave identically.
   *
   * The Songs button appears here too rather than in the template, because the list it
   * opens is a list of a folder — and a browser tab has no folder to list. A button that
   * was always there and only worked in one of the two builds would be the worse half of
   * "one codebase, two ways to run it".
   */
  private wireDesktop(root: HTMLElement): void {
    const shell = desktop();
    if (!shell) return;

    shell.onOpenSong(({ name, data }) => this.loadSong(data, name));

    this.el.library!.hidden = false;
    this.el.library!.addEventListener("click", () => void this.openLibrary(shell));
    shell.onShowSongs(() => void this.openLibrary(shell)); // File ▸ Songs… (Ctrl+L)

    const picker = root.querySelector<HTMLElement>(".file-btn");
    if (!picker) return;

    const button = document.createElement("button");
    button.id = "open";
    button.textContent = "📄 Open…";
    button.addEventListener("click", () => void shell.pickSong());
    picker.replaceWith(button);
  }

  /**
   * Show what is in the song folder, with what you have scored on each.
   *
   * The folder is read fresh every time it is opened — files land in a music folder from
   * outside the app — and the scores are read fresh with it, so a run you finished a
   * moment ago is already on the row when you come back to pick the next song.
   *
   * Same pause-while-open as the other screens: a run left going behind the overlay just
   * quietly racks up misses.
   */
  private async openLibrary(shell: PianaDesktop): Promise<void> {
    if (this.conductor.isPlaying()) {
      this.conductor.pause();
      this.updatePlayButton();
    }
    const view = (folder: SongFolder): LibraryView => ({
      folder: folder.folder,
      songs: buildLibrary(folder.files, groupBySong(listBests())),
      ...(folder.error === undefined ? {} : { error: folder.error }),
    });

    showLibrary(view(await shell.listSongs()), this.baseSong?.name ?? null, {
      // The song comes back through `onOpenSong` like every other route into the app,
      // which is what starts it playing — nothing to do here but ask.
      onOpen: (file) => void shell.openSongNamed(file),
      onChooseFolder: async () => view(await shell.chooseSongFolder()),
      onClose: () => {},
    });
  }

  private loadSong(buffer: ArrayBuffer, name: string): void {
    try {
      this.baseSong = parseMidi(buffer, name);
      this.handModes = defaultHandModes(this.baseSong);
      (this.el.tracks as HTMLButtonElement).disabled = this.baseSong.tracks.length === 0;
      this.sections = detectSections(this.baseSong);
      // Every kept loop starts the song switched off. The lane says what is there; which
      // of them you want today is a choice, and a song that opened straight into last
      // night's eight bars would be answering it for you.
      this.savedLoops = loadLoops(this.baseSong.name);
      this.hoverLoopId = null;
      this.endNaming();
      this.selectSection("full"); // a new song arrives whole, with no points marked on it
      this.applySavedLoops();
      this.rebuild();
      void this.startPlaying();
    } catch (err) {
      this.el.songName!.textContent = "Could not read that MIDI file";
      this.el.songMeta!.textContent = "";
      console.error(err);
    }
  }

  /**
   * Start the run. Used by the Play button and by loading a song.
   *
   * A song you just opened starts playing on its own: opening it *was* the request to
   * play it, and with wait mode on the notes come to a stop at the first one and hold
   * there, so nothing runs away before you have your hands on the keys.
   *
   * The audio context needs a user gesture to start, which loading a file is — but if the
   * browser disagrees, the run still begins silently rather than not at all.
   */
  private async startPlaying(): Promise<void> {
    try {
      await this.audio.ensureStarted();
    } catch (err) {
      console.warn("Audio could not start yet — press a key or Play to enable sound.", err);
    }
    this.session.start();
    this.updatePlayButton();
  }

  /**
   * Rebuild the section dropdown: the detected sections, and the region you marked out
   * yourself if there is one.
   *
   * The marked region joins the menu rather than living in a control of its own, because
   * it answers exactly the same question a section does — *which stretch of this song am
   * I practising?* — and two places to answer one question is how a settings row stops
   * being readable. It appears only once both markers are down, so the menu never offers
   * a choice that would do nothing.
   */
  private populateSections(): void {
    const select = this.el.section as HTMLSelectElement;
    const options = [`<option value="full">Full song</option>`];
    for (const s of this.sections) {
      options.push(`<option value="${s.id}">${s.name}</option>`);
    }
    const marked = markedRegion(this.marks);
    if (marked && this.sectionId !== "full" && !this.sections.some((s) => s.id === this.sectionId)) {
      // Named after the loop when the region is one you kept: the menu and the lane are
      // two views of one choice, and a row reading "0:41–0:58" beside a band reading
      // "Bridge" would not look like the same stretch of song.
      const saved = loopById(this.savedLoops, this.activeLoopId);
      const label = saved
        ? escapeHtml(saved.name)
        : `${formatTime(marked.start)}–${formatTime(marked.end)}`;
      options.push(`<option value="${MARKED_SECTION}">⟦ ${label} ⟧</option>`);
    }
    select.innerHTML = options.join("");
    select.value = this.sections.some((s) => s.id === this.sectionId)
      ? this.sectionId
      : marked && this.sectionId !== "full"
        ? MARKED_SECTION
        : "full";
  }

  /**
   * Set the active practice range from a section id ("full" = whole song).
   *
   * Choosing a section drops the two loop markers on its edges. A detected section is a
   * guess at where a phrase begins and ends, and a good one, but it is still a guess — so
   * it arrives as something you can see on the stage and nudge with `[` and `]`, rather
   * than as a range with no handles on it.
   */
  private selectSection(id: string): void {
    if (id === MARKED_SECTION) return; // already the active range; the menu is just showing it
    this.sectionId = id;
    if (id === "full" || !this.baseSong) {
      this.range = null;
      this.marks = NO_MARKS;
      this.activeLoopId = null;
      return;
    }
    const section = this.sections.find((s) => s.id === id) ?? fullSongSection(this.baseSong);
    this.range = { start: section.start, end: section.end };
    this.marks = marksOf(this.range);
    // A detected section that happens to be exactly a loop you kept is that loop, and
    // should be named as one — the two are the same stretch of music either way.
    this.activeLoopId = loopMatching(this.savedLoops, this.range)?.id ?? null;
  }

  /** The song actually practised: the base MIDI simplified to the chosen difficulty. */
  private practiceSong(): Song | null {
    return this.baseSong ? applyDifficulty(this.baseSong, this.difficulty) : null;
  }

  /** Re-apply all current settings to the renderer and session. Resets the run. */
  private rebuild(): void {
    // Hands are settled first, on the *whole* song: difficulty thins the texture, and an
    // auto split reading a piece with notes already missing reads it wrong. This mutates
    // `baseSong` in place, so everything downstream — including a later zoom change that
    // rebuilds the practice song on its own — sees the same assignment.
    if (this.baseSong) applyHandModes(this.baseSong, this.handModes);

    const song = this.practiceSong();
    if (!song) return;
    this.renderer.setSong(song);
    this.timeline.setSong(song);
    this.applyVisibleRange();
    this.session.configure({
      song,
      hand: this.hand,
      difficulty: this.difficulty,
      range: this.range,
      waitMode: this.waitMode,
      loop: this.loop,
    });
    this.el.songName!.textContent = song.name;
    this.el.songMeta!.textContent = `${song.notes.length} notes`;
    this.updatePlayButton();
    this.populateSections(); // the marked region may have just appeared on it, or left it
    this.showLoopMarks();
    this.showSavedLoops();
    this.showRunScope(song);
  }

  /**
   * Say what the run covers, above a map that always shows the whole song.
   *
   * The clock either side of the map reads in the song's own time now, rather than in the
   * section's: with every bar of the piece drawn between those two numbers, a pair that
   * counted a section instead would be labelling the ends of something that is not on
   * screen. Which stretch is being practised is said in words beside them, and drawn on
   * the map as the part that is lit.
   */
  private showRunScope(song: Song): void {
    this.el.progress!.hidden = false;

    // Named whenever the run is less than the whole song — a kept loop by the name you
    // gave it, a detected section by its number, a hand-picked region by the times it
    // runs between.
    const saved = loopById(this.savedLoops, this.activeLoopId);
    this.el.progressScope!.textContent =
      this.sectionId === "full" ? ""
      : saved ? saved.name
      : sectionLabel(this.sectionId);
    this.el.timeTotal!.textContent = formatTime(song.durationSec);
    this.el.timeline!.setAttribute("aria-valuemax", String(Math.round(song.durationSec)));
    this.shownTime = ""; // the clock is re-read next frame against the new song
  }

  /**
   * Write the clock.
   *
   * Called every frame, so it is written only when it would actually change — about once
   * a second. Wait mode holds the clock at a gate, which is the point: a readout that
   * crept on while you were stuck on a chord would be reporting the wrong thing.
   */
  private updateProgress(nowSec: number): void {
    const shown = formatTime(nowSec);
    if (shown === this.shownTime) return;
    this.shownTime = shown;
    this.el.timeNow!.textContent = shown;
    this.el.timeline!.setAttribute("aria-valuenow", String(Math.floor(nowSec)));
    this.el.timeline!.setAttribute("aria-valuetext", shown);
  }

  /**
   * The region the stage should wrap its music around, if any.
   *
   * Only a real region being looped: looping the whole song has no seam worth drawing, and
   * a marker being dragged suspends the wrap so the point can be aimed against the music
   * that is genuinely either side of it rather than against a ribbon of repeats.
   */
  private wrapRegion(): TimeRange | null {
    return this.loop && this.range && !this.tuningMark ? this.range : null;
  }

  /**
   * Apply the current zoom to the renderer's visible key range.
   *
   * Runs with no song loaded too. `visibleRange` has always had an answer for an empty
   * song — "Full 88" is 88 keys whether or not there is anything to play — but this used
   * to return early without one, so the empty keyboard ignored the Keys setting until a
   * song arrived to unblock it.
   */
  private applyVisibleRange(): void {
    const notes = this.practiceSong()?.notes ?? [];
    this.renderer.setVisibleRange(...visibleRange(notes, this.zoom));
  }

  private async onPlayToggle(): Promise<void> {
    if (!this.baseSong) return;
    if (this.session.getState() !== "running") {
      await this.startPlaying();
      return;
    }
    await this.audio.ensureStarted(); // needs a user gesture
    if (this.conductor.isPlaying()) this.conductor.pause();
    else this.conductor.play();
    this.updatePlayButton();
  }

  private updatePlayButton(): void {
    const running = this.session.getState() === "running";
    this.el.play!.textContent = this.conductor.isPlaying()
      ? "❚❚ Pause"
      : running
        ? "▶ Resume"
        : "▶ Play";

    // Both do nothing at all until there is a song. A button that looks live and answers a
    // click with silence is the one thing worse than a greyed-out one.
    const ready = this.baseSong !== null;
    (this.el.play as HTMLButtonElement).disabled = !ready;
    (this.el.restart as HTMLButtonElement).disabled = !ready;
  }

  private handleFinish(result: import("../game/Scoring.ts").ScoreResult): void {
    const ctx: ScoreContext = {
      songName: this.baseSong?.name ?? "Unknown",
      difficulty: this.difficulty,
      hand: this.hand,
      sectionId: this.sectionId,
    };
    const best = getBest(ctx);
    const isNewBest = saveIfBest(ctx, result);
    this.updatePlayButton();
    showResults(
      { result, isNewBest, best },
      {
        onReplay: () => this.session.start(),
        onClose: () => this.session.reset(),
      },
    );
  }

  private frame = (): void => {
    this.conductor.tick(performance.now());
    this.session.update(this.conductor.time); // may gate (wait mode) or finish
    const now = this.conductor.time;
    this.autoPlayer.update(now);
    this.renderer.render({
      nowSec: now,
      pressed: this.pressed,
      loop: this.marks,
      wrap: this.wrapRegion(),
    });
    this.timeline.render({
      nowSec: now,
      region: this.range,
      marks: this.marks,
      hoverLoopId: this.hoverLoopId,
      activeLoopId: this.activeLoopId,
    });
    this.updateProgress(now);

    if (this.wasPlaying !== this.conductor.isPlaying()) this.updatePlayButton();
    this.wasPlaying = this.conductor.isPlaying();

    requestAnimationFrame(this.frame);
  };
}
