/**
 * The desktop shell's bridge, as the renderer sees it.
 *
 * Injected by `electron/preload.cjs` and absent in the browser build, so every
 * caller has to cope with `null`. That is the point: the app stays a web app
 * that happens to run in a window, rather than one that only runs in a window.
 */

/** A `.mid` handed over by the shell — from the picker, the menu, or the OS. */
export interface OpenedSong {
  name: string;
  data: ArrayBuffer;
}

export interface PianaDesktop {
  /** Open the native file picker. The result arrives through `onOpenSong`. */
  pickSong(): Promise<void>;
  onOpenSong(callback: (song: OpenedSong) => void): void;
}

declare global {
  interface Window {
    piana?: PianaDesktop;
  }
}

/** The bridge, or null when running in an ordinary browser. */
export function desktop(): PianaDesktop | null {
  return typeof window === "undefined" ? null : (window.piana ?? null);
}
