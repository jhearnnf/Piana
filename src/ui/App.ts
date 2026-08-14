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
import { elapsedInRange, formatTime, progressFraction } from "./progress.ts";
import { showResults } from "./resultsScreen.ts";
import { showScores } from "./scoresScreen.ts";
import { showTracks } from "./tracksScreen.ts";
import { desktop } from "../desktop.ts";
import {
  loadMidiDevice,
  loadMuted,
  loadVolume,
  loadWaitMode,
  loadZoom,
  saveMidiDevice,
  saveMuted,
  saveVolume,
  saveWaitMode,
  saveZoom,
} from "./preferences.ts";

/** Strip the extension off a file name to get a song title. */
const songTitle = (fileName: string): string => fileName.replace(/\.midi?$/i, "");

const MIDI_LABELS: Record<MidiStatus, string> = {
  unsupported: "🎹 MIDI: not supported (use Chrome/Edge)",
  unavailable: "🎹 MIDI: blocked",
  "no-device": "🎹 MIDI: no device",
  "device-missing": "🎹 MIDI: chosen device not connected",
  connected: "🎹 MIDI: connected",
};

/** Menu value for "don't single out a device" — the empty string an `<option>` gives back. */
const ALL_DEVICES = "";

const TEMPLATE = `
  <header class="piana-header">
    🎹 Piana
    <span class="tag">piano trainer</span>
  </header>
  <div class="piana-controls">
    <label class="file-btn">Load MIDI…<input id="file" type="file" accept=".mid,.midi" /></label>
    <button id="demo">Load demo</button>
    <button id="play">▶ Play</button>
    <button id="restart">⟲ Restart</button>
    <label>Difficulty
      <select id="difficulty">
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard" selected>Hard</option>
      </select>
    </label>
    <span class="seg" id="hand">
      <button data-hand="left">Left</button>
      <button data-hand="both" class="active">Both</button>
      <button data-hand="right">Right</button>
    </span>
    <label>Section
      <select id="section"><option value="full">Full song</option></select>
    </label>
    <label><input type="checkbox" id="loop" /> Loop</label>
    <label><input type="checkbox" id="wait" checked /> Wait mode</label>
    <button id="tracks" type="button" title="Which hand plays each track" disabled>🎼 Tracks</button>
    <button id="scores" type="button" title="Best scores">🏆 Scores</button>
    <span class="volume">
      <button id="mute" type="button" class="icon-btn" aria-pressed="false" aria-label="Mute" title="Mute">🔊</button>
      <input id="volume" type="range" min="0" max="100" step="1" value="75" aria-label="Volume" title="Volume" />
    </span>
    <label>Speed
      <select id="speed">
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1" selected>1×</option>
      </select>
    </label>
    <label>Keys
      <select id="zoom">
        <option value="auto" selected>Auto</option>
        <option value="1">1 octave</option>
        <option value="2">2 octaves</option>
        <option value="3">3 octaves</option>
        <option value="4">4 octaves</option>
        <option value="full">Full 88</option>
      </select>
    </label>
    <span id="song-name" class="song-name">No song loaded</span>
    <label id="midi-device-row" hidden>Input
      <select id="midi-device" title="Which MIDI device to listen to">
        <option value="">All devices</option>
      </select>
    </label>
    <span id="midi-status" class="midi-status">🎹 MIDI: …</span>
  </div>
  <div class="piana-progress" id="progress" hidden>
    <span class="time" id="time-now">0:00</span>
    <div class="progress-track" id="progress-track" role="progressbar"
         aria-label="Song progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
    <span class="time" id="time-total">0:00</span>
    <span class="progress-scope" id="progress-scope"></span>
  </div>
  <div class="piana-stage"><canvas id="stage"></canvas></div>
`;

/**
 * Top-level app controller. Owns the shared game objects (renderer, conductor, audio,
 * session) and the user-facing state (song, difficulty, hand, wait, section), and wires the
 * controls to them. Keeping this in one place means `main.ts` is just a bootstrap and each
 * feature toggle flows through a single `rebuild`.
 */
export class App {
  private readonly renderer: PianoRenderer;
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
  private wasPlaying = false;
  /** The stretch of song the current run covers — the section, or all of it. */
  private runRange: TimeRange | null = null;
  /** Last strings written to the progress readout, so the frame loop can skip no-op writes. */
  private shownTime = "";
  private shownPercent = -1;

  constructor(root: HTMLElement) {
    root.innerHTML = TEMPLATE;
    const canvas = root.querySelector<HTMLCanvasElement>("#stage")!;
    this.renderer = new PianoRenderer(canvas);
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
      tracks: root.querySelector("#tracks")!,
      scores: root.querySelector("#scores")!,
      speed: root.querySelector("#speed")!,
      mute: root.querySelector("#mute")!,
      volume: root.querySelector("#volume")!,
      zoom: root.querySelector("#zoom")!,
      songName: root.querySelector("#song-name")!,
      midiDevice: root.querySelector("#midi-device")!,
      midiDeviceRow: root.querySelector("#midi-device-row")!,
      midiStatus: root.querySelector("#midi-status")!,
      progress: root.querySelector("#progress")!,
      progressTrack: root.querySelector("#progress-track")!,
      progressFill: root.querySelector("#progress-fill")!,
      progressScope: root.querySelector("#progress-scope")!,
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
    this.wireInputs(canvas);
    this.wireControls();
    this.wireDropTarget(root);
    this.wireDesktop(root);

    new ResizeObserver(() => this.renderer.resize()).observe(canvas.parentElement!);
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

    (this.el.difficulty as HTMLSelectElement).addEventListener("change", (e) => {
      this.difficulty = (e.target as HTMLSelectElement).value as Difficulty;
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
      this.loop = (e.target as HTMLInputElement).checked;
      this.rebuild();
    });
    (this.el.section as HTMLSelectElement).addEventListener("change", (e) => {
      this.selectSection((e.target as HTMLSelectElement).value);
      this.rebuild();
    });
    this.el.hand!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-hand]");
      if (!btn) return;
      this.hand = btn.dataset.hand as HandSelection;
      for (const b of this.el.hand!.querySelectorAll("button")) b.classList.toggle("active", b === btn);
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
    (this.el.speed as HTMLSelectElement).addEventListener("change", (e) => {
      const rate = Number((e.target as HTMLSelectElement).value);
      this.conductor.rate = rate;
      this.autoPlayer.setRate(rate);
    });
    (this.el.zoom as HTMLSelectElement).addEventListener("change", (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.zoom = value === "auto" || value === "full" ? value : Number(value);
      saveZoom(this.zoom);
      this.applyVisibleRange();
    });
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
   */
  private wireDesktop(root: HTMLElement): void {
    const shell = desktop();
    if (!shell) return;

    shell.onOpenSong(({ name, data }) => this.loadSong(data, name));

    const picker = root.querySelector<HTMLElement>(".file-btn");
    if (!picker) return;

    const button = document.createElement("button");
    button.id = "open";
    button.textContent = "Load MIDI…";
    button.addEventListener("click", () => void shell.pickSong());
    picker.replaceWith(button);
  }

  private loadSong(buffer: ArrayBuffer, name: string): void {
    try {
      this.baseSong = parseMidi(buffer, name);
      this.handModes = defaultHandModes(this.baseSong);
      (this.el.tracks as HTMLButtonElement).disabled = this.baseSong.tracks.length === 0;
      this.sections = detectSections(this.baseSong);
      this.populateSections();
      this.selectSection("full");
      this.rebuild();
      void this.startPlaying();
    } catch (err) {
      this.el.songName!.textContent = "Could not read that MIDI file";
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

  /** Rebuild the section dropdown from the detected sections. */
  private populateSections(): void {
    const select = this.el.section as HTMLSelectElement;
    const options = [`<option value="full">Full song</option>`];
    for (const s of this.sections) {
      options.push(`<option value="${s.id}">${s.name}</option>`);
    }
    select.innerHTML = options.join("");
    select.value = "full";
  }

  /** Set the active practice range from a section id ("full" = whole song). */
  private selectSection(id: string): void {
    this.sectionId = id;
    if (id === "full" || !this.baseSong) {
      this.range = null;
      return;
    }
    const section = this.sections.find((s) => s.id === id) ?? fullSongSection(this.baseSong);
    this.range = { start: section.start, end: section.end };
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
    this.applyVisibleRange();
    this.session.configure({
      song,
      hand: this.hand,
      difficulty: this.difficulty,
      range: this.range,
      waitMode: this.waitMode,
      loop: this.loop,
    });
    this.el.songName!.textContent = `${song.name} — ${song.notes.length} notes`;
    this.updatePlayButton();
    this.setRunRange(song);
  }

  /**
   * Point the progress bar at whatever the run now covers.
   *
   * Mirrors the range the session was just configured with, so the bar measures the same
   * stretch that is actually being played: pick a section and it re-scales to that section
   * rather than leaving you to find eight bars inside a bar for the whole piece.
   */
  private setRunRange(song: Song): void {
    this.runRange = this.range ?? { start: 0, end: song.durationSec };
    this.el.progress!.hidden = false;

    const section = this.sections.find((s) => s.id === this.sectionId);
    this.el.progressScope!.textContent = section ? section.name : "";
    this.el.timeTotal!.textContent = formatTime(this.runRange.end - this.runRange.start);
    this.shownTime = ""; // the elapsed side is re-read next frame against the new range
    this.shownPercent = -1;
  }

  /**
   * Draw the current position into the bar and the readout.
   *
   * Called every frame, so both halves are written only when they would actually change:
   * the text about once a second, the bar at whole percents. Wait mode holds the clock at
   * a gate, which is the point — a bar that crept on while you were stuck on a chord would
   * be reporting the wrong thing.
   */
  private updateProgress(nowSec: number): void {
    const range = this.runRange;
    if (!range) return;

    const percent = Math.round(progressFraction(nowSec, range) * 100);
    if (percent !== this.shownPercent) {
      this.shownPercent = percent;
      (this.el.progressFill as HTMLElement).style.width = `${percent}%`;
      this.el.progressTrack!.setAttribute("aria-valuenow", String(percent));
    }

    const elapsed = formatTime(elapsedInRange(nowSec, range));
    if (elapsed !== this.shownTime) {
      this.shownTime = elapsed;
      this.el.timeNow!.textContent = elapsed;
    }
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
    this.renderer.render({ nowSec: now, pressed: this.pressed });
    this.updateProgress(now);

    if (this.wasPlaying !== this.conductor.isPlaying()) this.updatePlayButton();
    this.wasPlaying = this.conductor.isPlaying();

    requestAnimationFrame(this.frame);
  };
}
