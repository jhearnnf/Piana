import type { ScoreResult } from "../game/Scoring.ts";

export interface ResultsCallbacks {
  onReplay: () => void;
  onClose: () => void;
}

export interface ResultsInfo {
  result: ScoreResult;
  isNewBest: boolean;
  best: ScoreResult | null;
}

/** Build a star string like "★★☆". */
export function starString(stars: number): string {
  return "★".repeat(stars) + "☆".repeat(3 - stars);
}

function statRow(label: string, value: string): string {
  return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

/**
 * Show the end-of-run results overlay. Returns a disposer that removes it.
 * Pure presentation — the caller supplies the score and the button actions.
 */
export function showResults(info: ResultsInfo, callbacks: ResultsCallbacks): () => void {
  const { result, isNewBest, best } = info;
  const overlay = document.createElement("div");
  overlay.className = "results-overlay";

  const accuracyPct = Math.round(result.accuracy * 100);
  const bestLine = isNewBest
    ? `<div class="best-badge">🎉 New best!</div>`
    : best
      ? `<div class="best-line">Best: ${best.score}</div>`
      : "";

  overlay.innerHTML = `
    <div class="results-card">
      <div class="results-stars">${starString(result.stars)}</div>
      <div class="results-score">${result.score}</div>
      ${bestLine}
      <div class="results-stats">
        ${statRow("Accuracy", `${accuracyPct}%`)}
        ${statRow("Perfect", String(result.perfect))}
        ${statRow("Good", String(result.good))}
        ${statRow("Missed", String(result.missed))}
        ${statRow("Wrong notes", String(result.wrong))}
        ${statRow("Max combo", String(result.maxCombo))}
        ${statRow("Avg timing", `${Math.round(result.avgTimingMs)} ms`)}
      </div>
      <div class="results-actions">
        <button class="primary" id="results-replay">Play again</button>
        <button id="results-close">Close</button>
      </div>
    </div>
  `;

  const dispose = (): void => overlay.remove();
  overlay.querySelector<HTMLButtonElement>("#results-replay")!.addEventListener("click", () => {
    dispose();
    callbacks.onReplay();
  });
  overlay.querySelector<HTMLButtonElement>("#results-close")!.addEventListener("click", () => {
    dispose();
    callbacks.onClose();
  });

  document.body.appendChild(overlay);
  return dispose;
}
