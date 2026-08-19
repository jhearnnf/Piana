import type { BestEntry, SongScores } from "../game/highScores.ts";
import { starString } from "./resultsScreen.ts";
import { dateLabel, escapeHtml, setupLabel } from "./format.ts";

export interface ScoresCallbacks {
  /** Wipe every stored score. The screen closes itself afterwards. */
  onClear: () => void;
  onClose: () => void;
}

function rowHtml(entry: BestEntry): string {
  const { ctx, result } = entry;

  return `
    <li class="score-row">
      <span class="score-stars">${starString(result.stars)}</span>
      <span class="score-points">${result.score}</span>
      <span class="score-setup">${escapeHtml(setupLabel(ctx))}</span>
      <span class="score-accuracy">${Math.round(result.accuracy * 100)}%</span>
      <span class="score-date">${escapeHtml(dateLabel(entry.savedAt))}</span>
    </li>`;
}

function songHtml(song: SongScores, currentSong: string | null): string {
  const current = song.songName === currentSong ? " current" : "";
  return `
    <section class="score-song${current}">
      <h3>${escapeHtml(song.songName)}<span class="score-top">Best ${song.topScore}</span></h3>
      <ul>${song.entries.map(rowHtml).join("")}</ul>
    </section>`;
}

/**
 * Show every best score, grouped by song. Returns a disposer that removes it.
 *
 * Pure presentation: the caller supplies the already-grouped scores and does the clearing,
 * so this never touches storage.
 */
export function showScores(
  songs: readonly SongScores[],
  currentSong: string | null,
  callbacks: ScoresCallbacks,
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "results-overlay scores-overlay";

  const body = songs.length
    ? songs.map((song) => songHtml(song, currentSong)).join("")
    : `<p class="scores-empty">No scores yet. Finish a run — without Loop on — and your best
        for each song, difficulty, hand and section is recorded here.</p>`;

  overlay.innerHTML = `
    <div class="results-card scores-card">
      <h2 class="scores-title">🏆 Scores</h2>
      <div class="scores-body">${body}</div>
      <div class="results-actions">
        <button class="primary" id="scores-close">Close</button>
        ${songs.length ? `<button id="scores-clear">Clear all</button>` : ""}
      </div>
    </div>
  `;

  const dispose = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  // Escape closes it: this is a screen you glance at, and reaching for the mouse to
  // dismiss something you only opened to read is the annoying part.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    dispose();
    callbacks.onClose();
  };

  overlay.querySelector<HTMLButtonElement>("#scores-close")!.addEventListener("click", () => {
    dispose();
    callbacks.onClose();
  });

  // Two-step, in place: there is no undo behind this, and a stray click on a button
  // sitting next to "Close" would take every score with it.
  const clear = overlay.querySelector<HTMLButtonElement>("#scores-clear");
  clear?.addEventListener("click", () => {
    if (clear.dataset.armed !== "true") {
      clear.dataset.armed = "true";
      clear.textContent = "Delete all scores?";
      clear.classList.add("danger");
      return;
    }
    dispose();
    callbacks.onClear();
  });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return dispose;
}
