import type { Song } from "../core/types.ts";
import { handTally, type HandMode } from "../song/handModes.ts";
import { noteLabel } from "../render/PianoRenderer.ts";
import { escapeHtml } from "./format.ts";

export interface TracksCallbacks {
  /** A track's mode changed. The caller re-splits and re-renders, then this screen refreshes. */
  onChange: (trackIndex: number, mode: HandMode) => void;
  onClose: () => void;
}

const MODE_LABELS: Record<HandMode, string> = {
  auto: "Auto split",
  left: "Left hand",
  right: "Right hand",
};

/**
 * How the split came out for one track, as a sentence rather than two numbers.
 *
 * This is the only feedback that the auto split did something sensible — the colours on the
 * stage say it too, but only for the handful of notes currently on screen.
 */
function tallyLabel(left: number, right: number): string {
  if (left === 0 && right === 0) return "no notes";
  if (right === 0) return "all left hand";
  if (left === 0) return "all right hand";
  const total = left + right;
  return `${Math.round((left / total) * 100)}% left · ${Math.round((right / total) * 100)}% right`;
}

function rowHtml(song: Song, modes: readonly HandMode[], index: number): string {
  const track = song.tracks[index]!;
  const mode = modes[index] ?? "auto";
  const { left, right } = handTally(song, index);
  const options = (Object.keys(MODE_LABELS) as HandMode[])
    .map((m) => `<option value="${m}"${m === mode ? " selected" : ""}>${MODE_LABELS[m]}</option>`)
    .join("");

  return `
    <li class="track-row">
      <span class="track-name">${escapeHtml(track.name)}</span>
      <span class="track-detail">
        ${track.noteCount} notes · ${noteLabel(track.range[0])}–${noteLabel(track.range[1])}
      </span>
      <span class="track-tally ${left && right ? "split" : ""}" data-track="${index}">
        ${tallyLabel(left, right)}
      </span>
      <select class="track-mode" data-track="${index}" aria-label="Hand for ${escapeHtml(track.name)}">
        ${options}
      </select>
    </li>`;
}

/**
 * Show the per-track hand controls. Returns a disposer that removes the screen.
 *
 * Every row's tally is refreshed after any change, because changing one track's mode changes
 * how the *other* auto tracks come out — they are all split as one pool. Only the tallies are
 * rewritten, not the rows: replacing the dropdown you are using takes the focus out from
 * under you mid-keystroke.
 */
export function showTracks(
  song: Song,
  getModes: () => readonly HandMode[],
  callbacks: TracksCallbacks,
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "results-overlay tracks-overlay";

  const refreshTallies = (): void => {
    for (const el of body.querySelectorAll<HTMLElement>(".track-tally")) {
      const { left, right } = handTally(song, Number(el.dataset.track));
      el.textContent = tallyLabel(left, right);
      el.classList.toggle("split", Boolean(left && right));
    }
  };

  overlay.innerHTML = `
    <div class="results-card tracks-card">
      <h2 class="scores-title">🎼 Tracks</h2>
      <p class="tracks-intro">
        Choose which hand plays each track. <strong>Auto split</strong> works it out from the
        notes — following each hand around the keyboard rather than cutting at a fixed pitch —
        and colours them <span class="swatch left">left</span> and
        <span class="swatch right">right</span>.
      </p>
      <div class="scores-body" id="tracks-body"></div>
      <div class="results-actions">
        <button class="primary" id="tracks-close">Close</button>
      </div>
    </div>
  `;

  const body = overlay.querySelector<HTMLElement>("#tracks-body")!;
  const modes = getModes();
  body.innerHTML = song.tracks.length
    ? `<ul class="track-list">${song.tracks.map((_, i) => rowHtml(song, modes, i)).join("")}</ul>`
    : `<p class="scores-empty">This song has no tracks to split.</p>`;

  const dispose = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    dispose();
    callbacks.onClose();
  };

  // Delegated: one listener for the list rather than one per row.
  body.addEventListener("change", (e) => {
    const select = (e.target as HTMLElement).closest<HTMLSelectElement>(".track-mode");
    if (!select) return;
    callbacks.onChange(Number(select.dataset.track), select.value as HandMode);
    refreshTallies();
  });

  overlay.querySelector<HTMLButtonElement>("#tracks-close")!.addEventListener("click", () => {
    dispose();
    callbacks.onClose();
  });

  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return dispose;
}
