'use strict';

/**
 * The whole bridge. Everything else the app does — MIDI input, audio, canvas,
 * high scores — is plain web API that works the same in a tab, so the desktop
 * build only has to add the two things a tab has no way to do: put up a native
 * file picker, and be handed a `.mid` by the operating system.
 *
 * `window.piana` is deliberately absent in the browser build, and the renderer
 * treats it as optional. One codebase, two ways to run it.
 *
 * The song list is the same two things again rather than a third: reading a folder is
 * filesystem work, and the list it produces is how the OS hands over a `.mid` without a
 * file dialog in the way.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piana', {
  /** Native "Open MIDI…" picker. Any chosen file arrives via `onOpenSong`. */
  pickSong: () => ipcRenderer.invoke('song:pick'),

  /**
   * A song opened from the menu, the picker, or the command line.
   * Payload is `{ name, data }` with `data` an ArrayBuffer of the raw file.
   */
  onOpenSong: (cb) => ipcRenderer.on('song:open', (_event, song) => cb(song)),

  /** The `.mid` files in the remembered song folder: `{ folder, files, error? }`. */
  listSongs: () => ipcRenderer.invoke('songs:list'),

  /** Native folder picker for the song folder. Resolves to the new listing. */
  chooseSongFolder: () => ipcRenderer.invoke('songs:folder'),

  /** Open a listed song by file name. It arrives via `onOpenSong` like any other. */
  openSongNamed: (name) => ipcRenderer.invoke('songs:open', name),

  /** File ▸ Songs… (Ctrl+L) — the shell asking the app to show its song list. */
  onShowSongs: (cb) => ipcRenderer.on('songs:show', () => cb()),
});
