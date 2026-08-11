import type { Difficulty, HandSelection, Song } from "../core/types.ts";
import { parseMidi } from "../midi/parseMidi.ts";
import { PianoRenderer } from "../render/PianoRenderer.ts";
import { visibleRange, type Zoom } from "../render/visibleRange.ts";
import { ComputerKeyboardInput } from "../input/ComputerKeyboardInput.ts";
import { PointerInput } from "../input/PointerInput.ts";
import { MidiInput, type MidiStatus } from "../input/MidiInput.ts";
import type { NoteInputHandler } from "../input/InputSource.ts";
import { Conductor } from "../game/Conductor.ts";
import { ToneAudioPlayer } from "../audio/Player.ts";
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
import { showResults } from "./resultsScreen.ts";
import { showScores } from "./scoresScreen.ts";
import { showTracks } from "./tracksScreen.ts";
import { desktop } from "../desktop.ts";
import {
  loadMuted,
  loadWaitMode,
  loadZoom,
  saveMuted,
  saveWaitMode,
  saveZoom,
} from "./preferences.ts";

/** Strip the extension off a file name to get a song title. */
const songTitle = (fileName: string): string => fileName.replace(/\.midi?$/i, "");

const MIDI_LABELS: Record<MidiStatus, string> = {
  unsupported: "🎹 MIDI: not supported (use Chrome/Edge)",
  unavailable: "🎹 MIDI: blocked",
  "no-device": "🎹 MIDI: no device",
  connected: "🎹 MIDI: connected",
};

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
    <button id="mute" type="button" class="icon-btn" aria-pressed="false" aria-label="Mute" title="Mute">🔊</button>
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
    <span id="midi-status" class="midi-status">🎹 MIDI: …</span>
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
  private readonly audio = new ToneAudioPlayer();
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
      zoom: root.querySelector("#zoom")!,
      songName: root.querySelector("#song-name")!,
      midiStatus: root.querySelector("#midi-status")!,
    };

    this.restoreZoom();
    // The opening keyboard should already be the one that was chosen last time, rather
    // than the renderer's own default until the first song lands.
    this.applyVisibleRange();
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
    midi.onStatus = (status, name) => {
      const el = this.el.midiStatus!;
      el.textContent = name && status === "connected" ? `🎹 ${name}` : MIDI_LABELS[status];
      el.classList.toggle("ok", status === "connected");
    };
    midi.connect(handler);
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

    if (this.wasPlaying !== this.conductor.isPlaying()) this.updatePlayButton();
    this.wasPlaying = this.conductor.isPlaying();

    requestAnimationFrame(this.frame);
  };
}
