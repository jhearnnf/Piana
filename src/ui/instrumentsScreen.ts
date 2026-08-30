import {
  filterInstruments,
  mostPlayed,
  playTimeLabel,
  type InstrumentUse,
} from "../audio/instrumentUse.ts";
import { escapeHtml } from "./format.ts";

/**
 * The sound picker: what a note is played through, and how much of each.
 *
 * A sample library ships two hundred-odd presets and you use about five of them. So the
 * shortlist comes first — the sounds you have really spent time playing, most first — and
 * the full alphabetical list is underneath it for the times you are actually looking for
 * something new. Search narrows both.
 *
 * More than one can be on at once, each with its own level, because that is the thing a
 * library gives you that a single instrument cannot: a piano with a little of a pad under
 * it is a sound neither of them is on its own.
 *
 * Presentation only. The caller supplies the list, owns the loading and makes the sound,
 * so this touches neither storage nor the shell — and every change is reported as it
 * happens rather than on close, so the blend can be set by ear against a song that is
 * still playing behind the screen.
 */

/** How many sounds may play at once. */
export const MAX_LAYERS = 4;

/** How many of your most-played to shortlist before the full list starts. */
const SHORTLIST = 6;

/** One instrument in the stack: its name and its share of the sound. */
export interface ChosenInstrument {
  name: string;
  level: number;
}

/** What the screen is showing. */
export interface InstrumentsView {
  /** The sample library being listed, or null if one has never been chosen. */
  folder: string | null;
  names: string[];
  /** Why the folder could not be read, if it could not. */
  error?: string;
  chosen: ChosenInstrument[];
  uses: InstrumentUse[];
  /** How far each instrument still loading has got, by name — e.g. `"24 / 45"`. */
  loading: Record<string, string>;
}

export interface InstrumentsCallbacks {
  /** Turn an instrument on or off. The caller loads or frees it. */
  onToggle: (name: string, chosen: boolean) => void;
  /** A level moved, 0..1. Fires while dragging, so it can be heard as it is set. */
  onLevel: (name: string, level: number) => void;
  /** Pick a different sample library. Resolves to what the new one holds. */
  onChooseFolder: () => Promise<InstrumentsView>;
  onClose: () => void;
}

/** The screen, once it is up: pushed new state, and taken down. */
export interface InstrumentsScreen {
  /** New loading progress, or a stack changed from elsewhere. */
  update: (view: InstrumentsView) => void;
  dispose: () => void;
}

function rowHtml(
  name: string,
  chosen: ChosenInstrument | undefined,
  use: InstrumentUse | undefined,
  full: boolean,
): string {
  const on = chosen !== undefined;
  const level = Math.round((chosen?.level ?? 1) * 100);
  // Disabled rather than hidden once the stack is full: a checkbox that has quietly
  // stopped working is a bug, and one that says why is a limit.
  const locked = !on && full;

  return `
    <li class="instrument-row ${on ? "on" : ""}" data-name="${escapeHtml(name)}">
      <label class="instrument-pick">
        <input type="checkbox" data-name="${escapeHtml(name)}"
               ${on ? "checked" : ""} ${locked ? "disabled" : ""}
               ${locked ? `title="Turn one of the ${MAX_LAYERS} off first"` : ""} />
        <span class="instrument-name">${escapeHtml(name)}</span>
      </label>
      <span class="instrument-played">${use ? playTimeLabel(use.seconds) : ""}</span>
      <span class="instrument-loading" data-loading="${escapeHtml(name)}"></span>
      <span class="instrument-level" ${on ? "" : "hidden"}>
        <input type="range" min="0" max="100" step="1" value="${level}"
               data-name="${escapeHtml(name)}"
               aria-label="How much ${escapeHtml(name)}" title="How much ${escapeHtml(name)}" />
        <output class="instrument-percent">${level}%</output>
      </span>
    </li>`;
}

function listHtml(
  names: readonly string[],
  view: InstrumentsView,
  byName: Map<string, ChosenInstrument>,
  uses: Map<string, InstrumentUse>,
): string {
  const full = view.chosen.length >= MAX_LAYERS;
  return names.map((name) => rowHtml(name, byName.get(name), uses.get(name), full)).join("");
}

function bodyHtml(view: InstrumentsView, shown: readonly string[]): string {
  if (view.folder === null) {
    return `<p class="scores-empty">No sample library yet. Choose the folder your instruments
      live in — the one with a sub-folder per sound — and they will all be listed here.
      Until then, and any time nothing is ticked, Piana plays its own synthesised piano.</p>`;
  }
  if (view.error) {
    return `<p class="scores-empty">Could not read that folder — it may have been moved or
      renamed, or be on a drive that is not plugged in.
      <br><span class="library-error">${escapeHtml(view.error)}</span></p>`;
  }
  if (view.names.length === 0) {
    return `<p class="scores-empty">No instruments in that folder. Piana expects one
      sub-folder per sound, each holding audio files named by note — <code>060-one.flac</code>
      or <code>C4.wav</code>.</p>`;
  }
  if (shown.length === 0) return `<p class="scores-empty">Nothing matches that.</p>`;

  const byName = new Map(view.chosen.map((c) => [c.name, c]));
  const uses = new Map(view.uses.map((u) => [u.name, u]));
  const short = mostPlayed(shown, view.uses, SHORTLIST);
  const rest = shown.filter((name) => !short.includes(name));

  const sections: string[] = [];
  if (short.length > 0) {
    sections.push(`
      <h3 class="instrument-heading">Most played</h3>
      <ul class="instrument-list">${listHtml(short, view, byName, uses)}</ul>`);
  }
  if (rest.length > 0) {
    sections.push(`
      <h3 class="instrument-heading">${short.length > 0 ? "Everything else" : "All sounds"}</h3>
      <ul class="instrument-list">${listHtml(rest, view, byName, uses)}</ul>`);
  }
  return sections.join("");
}

/** The "3 of 224 · 2 playing" line under the search box. */
export function countLabel(view: InstrumentsView, shown: number): string {
  if (view.folder === null || view.error || view.names.length === 0) return "";
  const total = view.names.length;
  const scope = shown === total ? `${total} sounds` : `${shown} of ${total}`;
  return view.chosen.length === 0 ? scope : `${scope} · ${view.chosen.length} playing`;
}

/**
 * Show the sound picker.
 *
 * Nothing is rebuilt while you are using it. Ticking a box, moving a level and loading
 * progress arriving all patch the rows in place, because re-rendering the list would take
 * the search box's focus, drop the slider out from under the pointer mid-drag, and scroll
 * the row you were aiming at away. Only a new folder or a new search rebuilds.
 */
export function showInstruments(
  initial: InstrumentsView,
  callbacks: InstrumentsCallbacks,
): InstrumentsScreen {
  const overlay = document.createElement("div");
  overlay.className = "results-overlay library-overlay";

  overlay.innerHTML = `
    <div class="results-card library-card">
      <h2 class="scores-title">🎧 Sounds</h2>
      <div class="library-folder">
        <span class="library-path" id="instruments-path"></span>
        <button id="instruments-choose">Change folder…</button>
      </div>
      <div class="library-search">
        <input id="instruments-query" type="search" placeholder="Search sounds…"
               aria-label="Search sounds" autocomplete="off" spellcheck="false" />
        <span class="library-count" id="instruments-count"></span>
      </div>
      <div class="scores-body" id="instruments-body"></div>
      <div class="results-actions">
        <button class="primary" id="instruments-close">Close</button>
      </div>
    </div>
  `;

  const body = overlay.querySelector<HTMLElement>("#instruments-body")!;
  const query = overlay.querySelector<HTMLInputElement>("#instruments-query")!;
  const count = overlay.querySelector<HTMLElement>("#instruments-count")!;
  const path = overlay.querySelector<HTMLElement>("#instruments-path")!;

  let current = initial;
  let shown: string[] = [];

  const render = (): void => {
    shown = filterInstruments(current.names, query.value);
    body.innerHTML = bodyHtml(current, shown);
    count.textContent = countLabel(current, shown.length);
    path.textContent = current.folder ?? "No folder chosen";
    path.title = current.folder ?? "";
    query.hidden = current.folder === null || current.names.length === 0;
    paint();
  };

  /**
   * Bring the rows into line with `current` without rebuilding them.
   *
   * A slider being dragged is left alone — its value is already what the caller was told,
   * and writing it back mid-drag makes it fight the pointer.
   */
  const paint = (): void => {
    const byName = new Map(current.chosen.map((c) => [c.name, c]));
    const full = current.chosen.length >= MAX_LAYERS;

    for (const row of body.querySelectorAll<HTMLElement>(".instrument-row")) {
      const name = row.dataset.name ?? "";
      const chosen = byName.get(name);
      const on = chosen !== undefined;

      row.classList.toggle("on", on);
      const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      box.checked = on;
      box.disabled = !on && full;
      box.title = box.disabled ? `Turn one of the ${MAX_LAYERS} off first` : "";

      const level = row.querySelector<HTMLElement>(".instrument-level")!;
      level.hidden = !on;
      const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
      if (on && document.activeElement !== slider) {
        slider.value = String(Math.round(chosen.level * 100));
        row.querySelector<HTMLElement>(".instrument-percent")!.textContent = `${slider.value}%`;
      }

      row.querySelector<HTMLElement>(".instrument-loading")!.textContent =
        current.loading[name] ?? "";
    }
    count.textContent = countLabel(current, shown.length);
  };

  const dispose = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };

  const close = (): void => {
    dispose();
    callbacks.onClose();
  };

  // Captured on the document, like the song list's, because the search box has the focus:
  // Escape would otherwise only clear the box.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  };

  query.addEventListener("input", render);

  // Delegated, so re-rendering on a keystroke does not leak a listener a row.
  body.addEventListener("change", (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"]');
    if (!box) return;
    callbacks.onToggle(box.dataset.name ?? "", box.checked);
  });

  // `input` rather than `change`: a level is aimed by ear, and one that only landed when
  // the pointer came up would have to be set by guessing and letting go to find out.
  body.addEventListener("input", (e) => {
    const slider = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="range"]');
    if (!slider) return;
    const row = slider.closest<HTMLElement>(".instrument-row");
    row?.querySelector<HTMLElement>(".instrument-percent")!
      .replaceChildren(`${slider.value}%`);
    callbacks.onLevel(slider.dataset.name ?? "", Number(slider.value) / 100);
  });

  overlay.querySelector<HTMLButtonElement>("#instruments-choose")!.addEventListener("click", () => {
    void callbacks.onChooseFolder().then((next) => {
      current = next;
      query.value = "";
      render();
      query.focus();
    });
  });
  overlay.querySelector<HTMLButtonElement>("#instruments-close")!.addEventListener("click", close);

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  render();
  query.focus();

  return {
    update: (view) => {
      const rebuild = view.names !== current.names || view.folder !== current.folder;
      current = view;
      if (rebuild) render();
      else paint();
    },
    dispose,
  };
}
