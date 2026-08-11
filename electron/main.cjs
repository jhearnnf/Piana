'use strict';

/**
 * Piana's desktop shell.
 *
 * The app itself is unchanged web code — the Vite build in `dist/` — and this
 * process only does the things a browser tab cannot: remember the window,
 * serve the build over a scheme that allows `fetch` and counts as secure
 * (see serve.cjs), grant Web MIDI, and open `.mid` files from the OS.
 *
 * Deliberately no packaging step. `npm run app` builds and launches straight
 * out of the source tree, and tools/install-shortcut.ps1 (Windows) or
 * tools/make-app.sh (macOS) puts a launcher pointing at the same tree, so edits
 * show up on the next launch.
 */

const {
  app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, session, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { parseState, restoreState, MIN_SIZE } = require('./window-state.cjs');
const { resolveAsset } = require('./serve.cjs');
const { parsePrefs, startFolder } = require('./prefs.cjs');
const { menuTemplate } = require('./menu.cjs');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// macOS differs in enough small ways below — the menu, the icon, what closing
// the last window means — to be worth naming once.
const MAC = process.platform === 'darwin';

// Where the renderer lives. The dev server is opt-in through the environment
// so `npm run app:dev` gets hot reload while the normal launch stays offline.
const DEV_URL = process.env.PIANA_DEV_URL || null;
const APP_ORIGIN = 'piana://app';
const START_URL = DEV_URL || `${APP_ORIGIN}/index.html`;

let win = null;

// A `.mid` handed to us by the OS before the window could show it.
let pendingSong = null;

// ------------------------------------------------------------------- scheme

// Must happen before `ready`, which is why it sits at module top level rather
// than in the startup path below.
protocol.registerSchemesAsPrivileged([{
  scheme: 'piana',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
};

/**
 * Serve the build.
 *
 * Content types are set from the extension rather than left to sniffing: a
 * module script served as anything but a JavaScript type is refused outright,
 * and the symptom is a blank window with one line in a console nobody has
 * open. Cheap to be explicit.
 */
function serveApp() {
  protocol.handle('piana', async (request) => {
    const file = resolveAsset(request.url, DIST);
    if (!file) return new Response('Not found', { status: 404 });

    try {
      const data = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// -------------------------------------------------------------- window state

// userData rather than the source tree: this is per-machine preference, not
// something to carry around in the repo.
function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    return parseState(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return null; // first run
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;

  // getNormalBounds() is the un-maximized geometry, so a window closed while
  // maximized still remembers the size to restore down to.
  const { x, y, width, height } = win.getNormalBounds();
  const state = { x, y, width, height, maximized: win.isMaximized(), fullScreen: win.isFullScreen() };

  try {
    fs.writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`);
  } catch { /* not worth interrupting a close over */ }
}

// Dragging or resizing fires continuously; only the resting position matters.
let saveTimer = null;
function saveStateSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

// ------------------------------------------------------------------- prefs

// Alongside window-state.json, and for the same reason: this is an answer about this
// machine — where this person keeps their MIDI files — not something to carry in the repo.
function prefsFile() {
  return path.join(app.getPath('userData'), 'prefs.json');
}

function loadPrefs() {
  try {
    return parsePrefs(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return null; // first run
  }
}

function savePrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), `${JSON.stringify(prefs, null, 2)}\n`);
  } catch { /* a forgotten folder is not worth interrupting anything over */ }
}

/**
 * Note where a song came from, so the next Open dialog starts there.
 *
 * Called for every song opened by path — the picker, the File menu, "open with Piana",
 * the command line — rather than only in the picker, because they all say the same thing
 * about where the music is kept.
 */
function rememberSongFolder(file) {
  const folder = path.dirname(path.resolve(file));
  const prefs = loadPrefs() ?? {};
  if (prefs.songFolder === folder) return; // nothing changed, don't churn the file
  savePrefs({ ...prefs, songFolder: folder });
}

// ------------------------------------------------------------------- songs

const MIDI_FILTER = [{ name: 'MIDI files', extensions: ['mid', 'midi'] }];

function looksLikeMidi(p) {
  return typeof p === 'string' && /\.midi?$/i.test(p);
}

/**
 * Read a `.mid` into the shape the renderer's loader already takes.
 *
 * The bytes are copied out of the Buffer's pool into a standalone ArrayBuffer:
 * `fs.readFileSync` hands back a view into a shared allocation, and sending
 * that across the bridge would either carry unrelated bytes or arrive with a
 * `byteOffset` the renderer would have to know about.
 */
function readSong(file) {
  const buf = fs.readFileSync(file);
  return {
    name: path.basename(file).replace(/\.midi?$/i, ''),
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
}

/** Show a song, or hold onto it until there is a window ready to show it in. */
function openSong(file) {
  let song;
  try {
    song = readSong(file);
  } catch (err) {
    dialog.showErrorBox('Could not open that file', `${file}\n\n${err.message}`);
    return;
  }

  rememberSongFolder(file);

  if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
    win.webContents.send('song:open', song);
    if (win.isMinimized()) win.restore();
    win.focus();
    return;
  }

  pendingSong = song;

  // There may be no window to park it in front of: on macOS the app stays
  // running with its windows closed, and a .mid dropped on the Dock icon then
  // arrives with nothing on screen. Making one here is what turns that into a
  // launch. Before `ready` — which is where `open-file` usually fires — there
  // is nothing to make it with, and startup will create it a moment later.
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) createWindow();
}

async function pickSong() {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open a MIDI file',
    filters: MIDI_FILTER,
    properties: ['openFile'],
    // Where the last song came from, or Music before there has been a last song.
    defaultPath: startFolder(loadPrefs(), (p) => fs.existsSync(p), app.getPath('music')),
  });
  if (res.canceled || !res.filePaths.length) return;
  openSong(res.filePaths[0]);
}

/**
 * A `.mid` path in a command line, if there is one.
 *
 * Both launch paths put junk in argv — Electron's own switches, and the app
 * directory that the Desktop shortcut passes — so this matches on the
 * extension rather than trusting a position.
 */
function songArg(argv) {
  return argv.slice(1).find(looksLikeMidi) || null;
}

// -------------------------------------------------------------------- menu

function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'About Piana',
    message: `Piana ${app.getVersion()}`,
    detail: 'A minimal Synthesia-style piano trainer.\n\n'
      + 'Load your own .mid file, play along on a USB MIDI keyboard, '
      + 'and get scored on accuracy and timing.\n\n'
      + `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
    buttons: ['OK'],
  });
}

function buildMenu() {
  return Menu.buildFromTemplate(menuTemplate({
    mac: MAC,
    name: app.name,
    onOpen: () => void pickSong(),
    onAbout: showAbout,
  }));
}

// ------------------------------------------------------------------ window

function createWindow() {
  const state = restoreState(loadState(), screen.getAllDisplays().map((d) => d.workArea));

  win = new BrowserWindow({
    ...state.bounds,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: 'Piana',
    // Matches --bg in src/style.css, so a slow first paint is the app's own
    // dark background rather than a white flash.
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    show: false,
    // macOS has no per-window icon — it draws the Dock tile from the .app
    // bundle instead, and cannot read an .ico anyway. See the dock icon set at
    // startup, and tools/make-app.sh for the bundle.
    ...(MAC ? {} : { icon: path.join(ROOT, 'assets', 'icon.ico') }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // The game loop runs on requestAnimationFrame and the auto-player
      // schedules audio from it. Throttled in the background, an unfocused
      // window would stop playing the accompaniment mid-song.
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  win.loadURL(START_URL);

  win.once('ready-to-show', () => {
    if (state.fullScreen) win.setFullScreen(true);
    else if (state.maximized) win.maximize();
    win.show();
  });

  // A song from the command line has nowhere to go until the renderer has
  // wired its listener up.
  win.webContents.on('did-finish-load', () => {
    if (!pendingSong) return;
    win.webContents.send('song:open', pendingSong);
    pendingSong = null;
  });

  // Nothing in the app navigates or opens windows, so both are refusals. A
  // link that does appear later (a docs link, say) belongs in the real
  // browser, not in a chrome-less window with a preload attached.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Compared against the origin rather than the start URL, so a dev-server
  // reload landing on `/` instead of the bare host is not mistaken for an
  // escape attempt.
  const origin = DEV_URL ? new URL(DEV_URL).origin : APP_ORIGIN;
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) event.preventDefault();
  });

  for (const event of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    win.on(event, saveStateSoon);
  }

  // 'close' still has a live window to measure; 'closed' does not.
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveState();
  });

  win.on('closed', () => { win = null; });
}

/**
 * Web MIDI, and nothing else.
 *
 * Electron denies these by default, and a denied `requestMIDIAccess` is
 * exactly what the app reports as "MIDI: blocked" — the state the browser
 * build shows when you run it somewhere without permission. Everything other
 * than MIDI is refused: a piano trainer has no business asking for a camera.
 */
function grantMidi(session) {
  const allowed = (permission) => permission === 'midi' || permission === 'midiSysex';

  session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed(permission)));
  session.setPermissionCheckHandler((_contents, permission) => allowed(permission));
}

// ------------------------------------------------------------------ startup

// Without this Windows groups the taskbar button under Electron and shows
// Electron's icon there instead of ours. The shortcuts tools/install-shortcut.ps1
// writes carry the same id — the taskbar only ties a running window to a
// shortcut when both agree.
app.setAppUserModelId('com.jamespiana.piana');

// macOS shows the app name in the menu bar and in the Cmd+Q item, and takes it
// from package.json otherwise — a lower-case "piana". Set only there, because
// the name is also what the userData folder is called: renaming it on Windows
// would orphan the prefs.json already sitting in %APPDATA%\piana.
if (MAC) app.setName('Piana');

// One window, one set of high scores, one MIDI device grab. A second launch —
// including "open with Piana" on a .mid — hands its file to the window that
// is already up.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const file = songArg(argv);
    if (file) openSong(file);
    else if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
    } else if (app.isReady()) {
      // No window to raise, which on macOS is an ordinary state. Launching
      // again is a request to see the app, so give it one.
      createWindow();
    }
  });

  app.whenReady().then(() => {
    if (!DEV_URL && !fs.existsSync(path.join(DIST, 'index.html'))) {
      dialog.showErrorBox(
        'Piana is not built yet',
        `No build found in ${DIST}.\n\nRun "npm run build" (or "npm run app", which builds first).`,
      );
      app.quit();
      return;
    }

    grantMidi(session.defaultSession);
    if (!DEV_URL) serveApp();

    // The window's `icon:` is ignored on macOS and the .ico beside it is not a
    // format the Dock reads, so the tile is set from a png here — otherwise a
    // run straight from `npm run app`, with no .app bundle around it, shows
    // Electron's own icon. `npm run icon` rasterises the pngs rather than them
    // being committed, so a clone that has not run it just keeps that icon.
    if (MAC && app.dock) {
      const tile = path.join(ROOT, 'assets', 'icon-256.png');
      try {
        if (fs.existsSync(tile)) app.dock.setIcon(tile);
      } catch { /* cosmetic, never worth failing a launch over */ }
    }

    // The window first, then the song: `openSong` opens a window when there is
    // none (see below), and asking for the song first would get two.
    // `isLoading()` is still true here, so this only parks it for
    // `did-finish-load` to deliver — and reports an unreadable file rather than
    // throwing out of startup.
    createWindow();

    const file = songArg(process.argv);
    if (file) openSong(file);
  });

  // Closing the last window quits — except on macOS, where an app with no
  // windows open is a normal state and quitting instead of leaving the Dock
  // icon lit is the thing that looks broken. 'activate' below is what brings
  // the window back, and only ever runs there.
  app.on('window-all-closed', () => { if (!MAC) app.quit(); });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // macOS hands files over this way rather than through argv.
  app.on('open-file', (event, file) => {
    event.preventDefault();
    openSong(file);
  });
}

// ------------------------------------------------------------------ bridge

ipcMain.handle('song:pick', () => pickSong());
