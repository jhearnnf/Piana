'use strict';

/**
 * The whole bridge. Everything else the app does — MIDI input, audio, canvas,
 * high scores — is plain web API that works the same in a tab, so the desktop
 * build only has to add the two things a tab has no way to do: put up a native
 * file picker, and be handed a `.mid` by the operating system.
 *
 * `window.piana` is deliberately absent in the browser build, and the renderer
 * treats it as optional. One codebase, two ways to run it.
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
});
