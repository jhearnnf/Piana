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

/** What the shell found in the remembered song folder. */
export interface SongFolder {
  /** The folder listed, or null if one has never been chosen. */
  folder: string | null;
  /** MIDI file names in it, already sorted. Names only — the shell owns the paths. */
  files: string[];
  /** Why it could not be read, if it could not. */
  error?: string;
}

export interface PianaDesktop {
  /** Open the native file picker. The result arrives through `onOpenSong`. */
  pickSong(): Promise<void>;
  onOpenSong(callback: (song: OpenedSong) => void): void;

  /** List the `.mid` files in the song folder. */
  listSongs(): Promise<SongFolder>;
  /** Native folder picker for the song folder. Resolves to the new listing. */
  chooseSongFolder(): Promise<SongFolder>;
  /**
   * Open a listed song by file name. It arrives through `onOpenSong` like any other,
   * so there is one path into the app however a song was chosen.
   */
  openSongNamed(file: string): Promise<boolean>;
  /** File ▸ Songs… (Ctrl+L) — the shell asking the app to show its song list. */
  onShowSongs(callback: () => void): void;
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
