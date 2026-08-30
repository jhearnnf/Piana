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

/** What the shell found in the sample library folder. */
export interface InstrumentFolder {
  /** The library listed, or null if one has never been chosen. */
  folder: string | null;
  /** Instrument names in it, already sorted. Names only — the shell owns the paths. */
  names: string[];
  /** Why it could not be read, if it could not. */
  error?: string;
}

/** One recorded note: which note it is, and the file it is in. */
export interface SampleRef {
  midi: number;
  file: string;
}

/** Which notes an instrument has recordings of. */
export interface InstrumentMap {
  instrument: string;
  /** In pitch order, one file per note. */
  samples: SampleRef[];
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
  /**
   * The bytes of a listed song, without opening it, or null if it cannot be read.
   *
   * What the song list's hover preview plays. Separate from `openSongNamed` because
   * hearing a song and switching to it are different requests, and only one of them
   * should throw away the run you are in the middle of.
   */
  readSongNamed(file: string): Promise<OpenedSong | null>;

  /** File ▸ Songs… (Ctrl+L) — the shell asking the app to show its song list. */
  onShowSongs(callback: () => void): void;

  /** List the instruments in the sample library folder. */
  listInstruments(): Promise<InstrumentFolder>;
  /** Native folder picker for the sample library. Resolves to the new listing. */
  chooseInstrumentFolder(): Promise<InstrumentFolder>;
  /** Which notes an instrument has recordings of, or null if it cannot be read. */
  instrumentMap(name: string): Promise<InstrumentMap | null>;
  /** One sample's bytes, or null. An unreadable file is a gap, not a failure. */
  readSample(name: string, file: string): Promise<ArrayBuffer | null>;
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
