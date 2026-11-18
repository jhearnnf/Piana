import type { Attempt } from "../game/practiceLog.ts";
import {
  rollingAverage,
  summarizeProgress,
  TREND_WINDOW,
  type ProgressSetup,
} from "../game/progress.ts";
import { starString } from "./resultsScreen.ts";
import { DIFFICULTY_LABELS, HAND_LABELS, escapeHtml, formatTime } from "./format.ts";

/**
 * How a saved loop has been going: one chart of accuracy and one of time per lap.
 *
 * Two charts rather than one with two scales, because a percentage and a number of seconds
 * share nothing but the x axis, and a chart with a second y axis invites reading the place
 * where two lines cross as meaning something. Each lap is a faint dot; the line through them
 * is the average of the last few, since a single fluffed chord moves one lap a long way and
 * the question is which way the whole thing is heading.
 *
 * Pure presentation: the caller hands over the laps, already split by setup.
 */

export interface ProgressCallbacks {
  onClose: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_HEIGHT = 168;
const PAD = { top: 12, right: 14, bottom: 24, left: 42 };

function setupName(setup: ProgressSetup): string {
  return `${DIFFICULTY_LABELS[setup.difficulty]} · ${HAND_LABELS[setup.hand]}`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** A lap time short enough to need its tenths reads as "8.4s"; longer ones as a clock. */
function lapTime(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)}s` : formatTime(seconds);
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A change between the two ends of the trend, as an arrow, a word and a colour.
 *
 * Better is green whichever way the number moved — accuracy going up and lap time going
 * down are the same news — and the word says so, so the colour is never the only thing
 * carrying it.
 */
function deltaHtml(change: number, betterWhenHigher: boolean, text: string): string {
  if (Math.abs(change) < 1e-9) return `<span class="progress-delta">no change</span>`;
  const better = betterWhenHigher ? change > 0 : change < 0;
  const arrow = change > 0 ? "▲" : "▼";
  return `<span class="progress-delta ${better ? "better" : "worse"}">${arrow} ${text}</span>`;
}

function tilesHtml(laps: readonly Attempt[]): string {
  const s = summarizeProgress(laps)!;
  const enough = s.laps >= 2;
  const accChange = s.recentAccuracy - s.firstAccuracy;
  const timeChange = s.recentSeconds - s.firstSeconds;

  const accDelta = enough
    ? deltaHtml(accChange, true, `${Math.abs(Math.round(accChange * 100))} pts since you started`)
    : "";
  const timeDelta = enough
    ? deltaHtml(
        timeChange,
        false,
        `${lapTime(Math.abs(timeChange))} ${timeChange < 0 ? "faster" : "slower"}`,
      )
    : "";

  return `
    <div class="progress-tiles">
      <div class="progress-tile">
        <span class="progress-tile-label">Laps</span>
        <span class="progress-tile-value">${s.laps}</span>
        <span class="progress-tile-note">over ${s.days} ${s.days === 1 ? "day" : "days"}</span>
      </div>
      <div class="progress-tile">
        <span class="progress-tile-label">Time practised</span>
        <span class="progress-tile-value">${formatTime(s.seconds)}</span>
        <span class="progress-tile-note">fastest lap ${lapTime(s.fastestSeconds)}</span>
      </div>
      <div class="progress-tile">
        <span class="progress-tile-label">Accuracy lately</span>
        <span class="progress-tile-value">${percent(s.recentAccuracy)}</span>
        ${accDelta || `<span class="progress-tile-note">best ${percent(s.bestAccuracy)}</span>`}
      </div>
      <div class="progress-tile">
        <span class="progress-tile-label">Lap time lately</span>
        <span class="progress-tile-value">${lapTime(s.recentSeconds)}</span>
        ${timeDelta || `<span class="progress-tile-note">per lap</span>`}
      </div>
    </div>`;
}

function tableHtml(laps: readonly Attempt[]): string {
  const rows = laps
    .map((lap, i) => ({ lap, n: i + 1 }))
    .reverse()
    .map(
      ({ lap, n }) => `
        <tr>
          <td>${n}</td>
          <td>${escapeHtml(when(lap.at))}</td>
          <td>${percent(lap.result.accuracy)}</td>
          <td>${lapTime(lap.seconds)}</td>
          <td>${lap.result.score}</td>
          <td class="progress-stars">${starString(lap.result.stars)}</td>
        </tr>`,
    )
    .join("");
  return `
    <details class="progress-table">
      <summary>Every lap</summary>
      <table>
        <thead><tr><th>Lap</th><th>When</th><th>Accuracy</th><th>Time</th><th>Score</th><th>Stars</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
}

/** Round numbers for an axis from 0 up to at least `max`: steps of 1, 2 or 5 times a power of ten. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

interface ChartSpec {
  values: number[];
  /** Fixed range for the y axis, or null to fit 0..max. */
  yMax: number | null;
  tickLabel: (v: number) => string;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Draw one chart into `host` at its current width, with a crosshair and a readout of the
 * lap under the pointer.
 */
function drawChart(
  host: HTMLElement,
  laps: readonly Attempt[],
  spec: ChartSpec,
  tooltip: HTMLElement,
): void {
  host.replaceChildren();
  const width = Math.max(260, host.clientWidth);
  const height = CHART_HEIGHT;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const ticks = niceTicks(spec.yMax ?? Math.max(...spec.values));
  const yTop = spec.yMax ?? ticks[ticks.length - 1]!;
  const n = spec.values.length;
  const x = (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (Math.min(v, yTop) / yTop) * plotH;

  const svg = el("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "progress-svg" });

  for (const t of ticks) {
    svg.append(el("line", { x1: PAD.left, x2: width - PAD.right, y1: y(t), y2: y(t), class: "progress-grid" }));
    const label = el("text", { x: PAD.left - 8, y: y(t) + 4, class: "progress-axis", "text-anchor": "end" });
    label.textContent = spec.tickLabel(t);
    svg.append(label);
  }

  // A handful of lap numbers along the bottom: the first, the last, and evenly between.
  const xTickCount = Math.min(n, Math.max(2, Math.floor(plotW / 70)));
  const xTicks = new Set<number>();
  for (let k = 0; k < xTickCount; k++) {
    xTicks.add(xTickCount === 1 ? 0 : Math.round((k / (xTickCount - 1)) * (n - 1)));
  }
  for (const i of xTicks) {
    const label = el("text", { x: x(i), y: height - 6, class: "progress-axis", "text-anchor": "middle" });
    label.textContent = n === 1 ? "Lap 1" : String(i + 1);
    svg.append(label);
  }

  for (let i = 0; i < n; i++) {
    svg.append(el("circle", { cx: x(i), cy: y(spec.values[i]!), r: 3, class: "progress-dot" }));
  }

  const trend = rollingAverage(spec.values);
  if (n > 1) {
    const d = trend.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    svg.append(el("path", { d, class: "progress-line" }));
  }

  const cross = el("line", { y1: PAD.top, y2: PAD.top + plotH, class: "progress-cross", visibility: "hidden" });
  const focus = el("circle", { r: 5, class: "progress-focus", visibility: "hidden" });
  svg.append(cross, focus);

  // The hit area is the whole plot, not the dots: a three-pixel dot is a target you aim
  // at, and the nearest lap to the pointer is the one being asked about.
  const hit = el("rect", { x: PAD.left - 6, y: 0, width: plotW + 12, height, fill: "transparent" });
  svg.append(hit);

  const show = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - PAD.left) / plotW) * (n - 1))));
    const lap = laps[i]!;
    for (const [node, attr] of [[cross, "x1"], [cross, "x2"], [focus, "cx"]] as const) {
      node.setAttribute(attr, String(x(i)));
    }
    focus.setAttribute("cy", String(y(spec.values[i]!)));
    cross.setAttribute("visibility", "visible");
    focus.setAttribute("visibility", "visible");

    tooltip.innerHTML = `
      <span class="progress-tip-head">Lap ${i + 1} · ${escapeHtml(when(lap.at))}</span>
      <span>Accuracy <b>${percent(lap.result.accuracy)}</b></span>
      <span>Time <b>${lapTime(lap.seconds)}</b></span>
      <span>Score <b>${lap.result.score}</b> <span class="progress-stars">${starString(lap.result.stars)}</span></span>
      ${n > 1 ? `<span class="progress-tip-avg">Average of last ${Math.min(i + 1, TREND_WINDOW)}: ${spec.tickLabel(trend[i]!)}</span>` : ""}`;
    tooltip.hidden = false;
    const hostBox = host.getBoundingClientRect();
    const left = box.left - hostBox.left + x(i);
    tooltip.style.left = `${Math.max(80, Math.min(hostBox.width - 80, left))}px`;
    tooltip.style.top = `${host.offsetTop - 6}px`;
  };
  const hide = () => {
    cross.setAttribute("visibility", "hidden");
    focus.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };
  hit.addEventListener("pointermove", (e) => show(e.clientX));
  hit.addEventListener("pointerleave", hide);

  host.append(svg);
}

/**
 * Show how the loop called `name` has been going. Returns a disposer that removes it.
 *
 * `setups` is every difficulty and hand the loop has been played under, most recent first;
 * the screen opens on the first and offers the rest as tabs.
 */
export function showProgress(
  name: string,
  range: string,
  setups: readonly ProgressSetup[],
  callbacks: ProgressCallbacks,
): () => void {
  const overlay = document.createElement("div");
  overlay.className = "results-overlay progress-overlay";

  const tabs =
    setups.length > 1
      ? `<div class="progress-setups" role="tablist">${setups
          .map(
            (s, i) =>
              `<button type="button" role="tab" data-i="${i}" aria-selected="${i === 0}">${escapeHtml(setupName(s))}</button>`,
          )
          .join("")}</div>`
      : setups.length === 1
        ? `<p class="progress-setup-one">${escapeHtml(setupName(setups[0]!))}</p>`
        : "";

  overlay.innerHTML = `
    <div class="results-card progress-card" role="dialog" aria-label="Progress on ${escapeHtml(name)}">
      <h2 class="scores-title">📈 ${escapeHtml(name)} <span class="progress-range">${escapeHtml(range)}</span></h2>
      ${tabs}
      <div class="progress-body">
        ${
          setups.length
            ? `<div class="progress-content"></div>`
            : `<p class="scores-empty">No laps of this loop yet. Turn Loop on and play it round —
                every lap you finish is written down and drawn here, so you can watch it get
                cleaner and quicker.</p>`
        }
      </div>
      <div class="results-actions">
        <button class="primary" id="progress-close">Close</button>
      </div>
    </div>
  `;

  const content = overlay.querySelector<HTMLElement>(".progress-content");
  let current = 0;

  const render = () => {
    if (!content) return;
    const laps = setups[current]!.laps;
    content.innerHTML = `
      ${tilesHtml(laps)}
      <section class="progress-chart">
        <h3>Accuracy <span>each dot a lap · line is the average of the last ${TREND_WINDOW}</span></h3>
        <div class="progress-plot" data-chart="accuracy"></div>
      </section>
      <section class="progress-chart">
        <h3>Time per lap <span>lower is quicker</span></h3>
        <div class="progress-plot" data-chart="time"></div>
      </section>
      <div class="progress-tip" hidden></div>
      ${tableHtml(laps)}`;
    const tip = content.querySelector<HTMLElement>(".progress-tip")!;
    drawChart(
      content.querySelector<HTMLElement>('[data-chart="accuracy"]')!,
      laps,
      { values: laps.map((l) => l.result.accuracy), yMax: 1, tickLabel: (v) => percent(v) },
      tip,
    );
    drawChart(
      content.querySelector<HTMLElement>('[data-chart="time"]')!,
      laps,
      { values: laps.map((l) => l.seconds), yMax: null, tickLabel: (v) => lapTime(v) },
      tip,
    );
  };

  overlay.querySelectorAll<HTMLButtonElement>(".progress-setups button").forEach((button) => {
    button.addEventListener("click", () => {
      current = Number(button.dataset.i);
      overlay
        .querySelectorAll<HTMLButtonElement>(".progress-setups button")
        .forEach((b) => b.setAttribute("aria-selected", String(b === button)));
      render();
    });
  });

  const onResize = () => render();
  const dispose = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
  };
  const close = () => {
    dispose();
    callbacks.onClose();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  overlay.querySelector<HTMLButtonElement>("#progress-close")!.addEventListener("click", close);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close();
  });

  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  document.body.appendChild(overlay);
  render(); // after it is in the page, so the charts can measure their width
  return dispose;
}
