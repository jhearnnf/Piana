'use strict';

/**
 * The menu bar's shape, as a template Electron can build.
 *
 * macOS gets a different one, and not for looks. The system routes Cmd+Q,
 * Cmd+W and the clipboard through the menu there, so an app whose menu lacks
 * them cannot be quit or closed from the keyboard and cannot paste into its own
 * fields — hence the app, Edit and Window menus, which Windows has no use for.
 * About moves into the app menu because that is where a Mac user looks for it,
 * which leaves Help with nothing in it, so Help is dropped there too.
 *
 * The `&` mnemonics go the other way: they are how Windows and Linux mark the
 * Alt-key letter, and macOS has no such thing and would draw the ampersand.
 *
 * Pure, and separate from main.cjs, for the reason serve.cjs and prefs.cjs are:
 * it makes the half of this that only runs on the other platform something the
 * tests can check from here.
 */

/**
 * @param {object} options
 * @param {boolean} options.mac    build the macOS shape
 * @param {string} options.name    the app name, which labels the macOS app menu
 * @param {() => void} options.onOpen   File ▸ Open MIDI…
 * @param {() => void} options.onAbout  About Piana, wherever it ended up
 */
function menuTemplate({ mac, name, onOpen, onAbout }) {
  const about = { label: 'About Piana', click: onAbout };

  const appMenu = {
    // Spelled out rather than `role: 'appMenu'`, which ignores any submenu
    // given to it and so would leave the stock About in place of ours. The
    // first menu is the app menu on macOS whatever it is labelled.
    label: name,
    submenu: [
      about,
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };

  const editMenu = {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ],
  };

  const windowMenu = {
    label: 'Window',
    submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
  };

  return [
    ...(mac ? [appMenu, editMenu] : []),
    {
      label: mac ? 'File' : '&File',
      submenu: [
        { label: 'Open MIDI…', accelerator: 'CmdOrCtrl+O', click: onOpen },
        // Quit lives in the app menu on macOS, and putting it in both would
        // give Cmd+Q two owners.
        ...(mac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: mac ? 'View' : '&View',
      submenu: [
        { role: 'reload' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    ...(mac ? [windowMenu] : [{ label: '&Help', submenu: [about] }]),
  ];
}

module.exports = { menuTemplate };
