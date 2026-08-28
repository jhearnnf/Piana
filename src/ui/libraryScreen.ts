import { filterLibrary, isPlayed, playedCount, type LibrarySong } from "../song/library.ts";
import { starString } from "./resultsScreen.ts";
import { dateLabel, escapeHtml, shortSetupLabel } from "./format.ts";

/**
 * The song list: everything in your MIDI folder, one click from playing.
 *
 * The point is not to save a dialog — it is that a file dialog can only tell you a file
 * name, and the question you actually have in front of a folder of MIDI is "which of these
 * have I played, and how did I do?". So each row carries its best run: stars, points, the
 * setup that earned them, and when. Ones you have never finished say so plainly.
 *
 * The row you are pointing at also plays itself, fast, so "which one is this?" has an
 * answer that does not involve opening three files in turn.
 *
 * Presentation only. The caller supplies the already-joined list, does the opening, and
 * makes the sound, so this touches neither storage nor the shell.
 */

/**
 * How long a row has to be the one you are pointing at before it starts playing.
 *
 * A beat, deliberately. Long enough that running the pointer down the list to reach
 * something does not set off every song on the way, and that a song starting reads as an
 * answer to where you stopped rather than a noise the list made; short enough that you
 * are not left waiting on it.
 */
export const PREVIEW_DELAY_MS = 500;

/** What the screen is showing: the folder, and the songs in it. */
export interface LibraryView {
  /** The folder being listed, or null if one has never been chosen. */
  folder: string | null;
  songs: LibrarySong[];
  /** Why the folder could not be read, if it could not. */
  error?: string;
}

export interface LibraryCallbacks {
  /** Play this file. The screen closes itself first. */
  onOpen: (file: string) => void;
  /** Pick a different folder. Resolves to what the new one contains. */
  onChooseFolder: () => Promise<LibraryView>;
  /**
   * Play a quick, sped-up taste of this song, or stop the one playing when given null.
   * Resolving is how the screen knows the sound has stopped, so a row that has finished
   * playing does not go on claiming to be playing.
   */
  onPreview: (file: string | null) => Promise<void> | void;
  onClose: () => void;
}

function historyHtml(song: LibrarySong): string {
  // An unplayed row leaves the score columns empty rather than filling them with zeroes:
  // "0 points, no stars" is what a bad run looks like, not what an unplayed song is.
  const best = song.best;
  if (!best) return `<span class="library-unplayed">Not played yet</span>`;

  // Only the best run is shown, with a count of the others: a song practised left hand,
  // right hand and both would otherwise take three lines and push the list off the screen.
  const more = song.runs > 1 ? ` <span class="library-runs">+${song.runs - 1} more</span>` : "";
  return `
      <span class="library-stars">${starString(best.result.stars)}</span>
      <span class="library-points">${best.result.score}</span>
      <span class="library-setup">${escapeHtml(shortSetupLabel(best.ctx))}${more}</span>
      <span class="library-date">${escapeHtml(dateLabel(song.lastPlayed))}</span>`;
}

function rowHtml(song: LibrarySong, current: boolean, index: number): string {
  const classes = ["library-row", current ? "current" : "", isPlayed(song) ? "played" : ""];
  return `
    <li class="${classes.filter(Boolean).join(" ")}" role="option" id="library-row-${index}"
        data-index="${index}" data-file="${escapeHtml(song.file)}" aria-selected="false">
      <span class="library-title">${escapeHtml(song.title)}</span>
      ${historyHtml(song)}
    </li>`;
}

function bodyHtml(
  view: LibraryView,
  shown: readonly LibrarySong[],
  current: string | null,
): string {
  if (view.folder === null) {
    return `<p class="scores-empty">No song folder yet. Choose the folder you keep your MIDI
      files in and they will all be listed here — with whatever you have scored on each.</p>`;
  }
  if (view.error) {
    return `<p class="scores-empty">Could not read that folder — it may have been moved or
      renamed, or be on a drive that is not plugged in.
      <br><span class="library-error">${escapeHtml(view.error)}</span></p>`;
  }
  if (view.songs.length === 0) {
    return `<p class="scores-empty">No <code>.mid</code> files in that folder.</p>`;
  }
  if (shown.length === 0) {
    return `<p class="scores-empty">Nothing matches that.</p>`;
  }
  return `<ul class="library-list" role="listbox" aria-label="Songs">${shown
    .map((song, i) => rowHtml(song, song.title === current, i))
    .join("")}</ul>`;
}

/** The "12 songs · 5 played" line, or "" when there is nothing to count. */
export function countLabel(view: LibraryView, shown: number): string {
  if (view.folder === null || view.error || view.songs.length === 0) return "";
  const total = view.songs.length;
  const played = playedCount(view.songs);
  const scope = shown === total ? `${total} song${total === 1 ? "" : "s"}` : `${shown} of ${total}`;
  return `${scope} · ${played} played`;
}

/**
 * Show the song list. Returns a disposer that removes it.
 *
 * Built to be driven from the keyboard, because that is what makes it quicker than the
 * file dialog it replaces: the search box has the focus on open, typing narrows the list,
 * the arrows move the highlight, and Enter plays it. The mouse works too.
 */
export function showLibrary(
  view: LibraryView,
  currentSong: string | null,
  callbacks: LibraryCallbacks,
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "results-overlay library-overlay";

  overlay.innerHTML = `
    <div class="results-card library-card">
      <h2 class="scores-title">📂 Songs</h2>
      <div class="library-folder">
        <span class="library-path" id="library-path"></span>
        <button id="library-choose">Change folder…</button>
      </div>
      <div class="library-search">
        <input id="library-query" type="search" placeholder="Search songs…"
               aria-label="Search songs" autocomplete="off" spellcheck="false" />
        <span class="library-count" id="library-count"></span>
      </div>
      <div class="scores-body" id="library-body"></div>
      <div class="results-actions">
        <button class="primary" id="library-close">Close</button>
      </div>
    </div>
  `;

  const body = overlay.querySelector<HTMLElement>("#library-body")!;
  const query = overlay.querySelector<HTMLInputElement>("#library-query")!;
  const count = overlay.querySelector<HTMLElement>("#library-count")!;
  const path = overlay.querySelector<HTMLElement>("#library-path")!;

  let current = view;
  let shown: LibrarySong[] = [];
  let active = 0;
  /** The song queued or sounding, so a pointer wobbling inside a row doesn't restart it. */
  let previewing: string | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  /** Silence the preview and take the mark off whichever row was wearing it. */
  const stopPreview = (): void => {
    clearTimeout(previewTimer);
    previewTimer = undefined;
    if (previewing === null) return;
    previewing = null;
    for (const row of body.querySelectorAll<HTMLElement>(".previewing")) {
      row.classList.remove("previewing");
    }
    void callbacks.onPreview(null);
  };

  /** Line the highlighted song up to play, once the pointer has settled on it. */
  const queuePreview = (): void => {
    const song = shown[active];
    if (song && song.file === previewing) return; // already the one you are hearing
    stopPreview();
    if (!song) return;

    previewing = song.file;
    const row = body.querySelector<HTMLElement>(`.library-row[data-index="${active}"]`);
    previewTimer = setTimeout(() => {
      row?.classList.add("previewing");
      // The mark comes off when the sound stops rather than after a guessed number of
      // seconds, so it is always telling the truth about what you can hear.
      void Promise.resolve(callbacks.onPreview(song.file)).then(() => {
        row?.classList.remove("previewing");
      });
    }, PREVIEW_DELAY_MS);
  };

  /**
   * Move the highlight, keeping it on the list and in view.
   *
   * `preview` is off for the highlight the list puts up on its own, and on for every move
   * you make: opening the screen is not asking to hear the first song in the folder, but
   * arrowing onto a row or pointing at one is.
   */
  const highlight = (index: number, preview = false): void => {
    active = shown.length === 0 ? 0 : Math.min(Math.max(index, 0), shown.length - 1);
    for (const row of body.querySelectorAll<HTMLElement>(".library-row")) {
      const on = Number(row.dataset.index) === active;
      row.classList.toggle("active", on);
      row.setAttribute("aria-selected", String(on));
      if (!on) continue;
      row.scrollIntoView({ block: "nearest" });
      query.setAttribute("aria-activedescendant", row.id);
    }
    if (preview) queuePreview();
  };

  const render = (): void => {
    // The rows the preview was attached to are about to be replaced.
    stopPreview();
    shown = filterLibrary(current.songs, query.value);
    body.innerHTML = bodyHtml(current, shown, currentSong);
    count.textContent = countLabel(current, shown.length);
    path.textContent = current.folder ?? "No folder chosen";
    path.title = current.folder ?? "";
    // Nothing to search through is worse than no search box — it just looks broken.
    query.hidden = current.folder === null || current.songs.length === 0;
    highlight(0);
  };

  const dispose = (): void => {
    stopPreview();
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };

  const open = (file: string): void => {
    dispose();
    callbacks.onOpen(file);
  };

  const close = (): void => {
    dispose();
    callbacks.onClose();
  };

  // Captured on the document, unlike the other screens' plain listeners, because the
  // search box has the focus: Escape would otherwise only clear the box, and the arrows
  // would only move the caret.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      highlight(active + (e.key === "ArrowDown" ? 1 : -1), true);
    } else if (e.key === "Enter") {
      const song = shown[active];
      if (!song) return;
      e.preventDefault();
      open(song.file);
    }
  };

  query.addEventListener("input", render);

  // Delegated, so re-rendering the list on every keystroke doesn't leak a listener a row.
  body.addEventListener("click", (e) => {
    const file = (e.target as HTMLElement).closest<HTMLElement>(".library-row")?.dataset.file;
    if (file) open(file);
  });
  body.addEventListener("mousemove", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".library-row");
    if (row) highlight(Number(row.dataset.index), true);
  });

  overlay.querySelector<HTMLButtonElement>("#library-choose")!.addEventListener("click", () => {
    void callbacks.onChooseFolder().then((next) => {
      current = next;
      query.value = "";
      render();
      query.focus();
    });
  });
  overlay.querySelector<HTMLButtonElement>("#library-close")!.addEventListener("click", close);

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  render();
  query.focus();

  return dispose;
}
