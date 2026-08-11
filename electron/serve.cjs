'use strict';

/**
 * Maps a `piana://app/...` request onto a file in the built `dist/` folder.
 *
 * Why a custom scheme at all, when `loadFile` would open the same HTML? Two
 * things the app needs stop working under `file://`:
 *
 *  - `fetch()` is refused. "Load demo" fetches `samples/twinkle-twinkle.mid`
 *    relative to the page, and Chromium gives a `file://` page an opaque
 *    origin that no fetch is allowed out of.
 *  - Web MIDI wants a secure context, and the guarantee is easier to state
 *    than to rely on — a registered scheme marked `secure` is unambiguous.
 *
 * Registering `piana:` as standard + secure + fetch-capable buys both, and the
 * app keeps ordinary absolute URLs instead of `file://` path arithmetic.
 *
 * Pure so it can be tested without an Electron process: it answers "which file,
 * if any" and the caller does the reading.
 */

const path = require('path');

/**
 * Absolute path of the file a request is asking for, or null to 404.
 *
 * The traversal guard is the point of the function. Nothing untrusted should
 * reach it in a single-page app with no remote content, but this is the one
 * place a URL turns into a filesystem read, so the check is made rather than
 * assumed away.
 *
 * It is not redundant with the URL parser. A standard scheme gets its dot
 * segments removed for free — `/../x` and `/%2e%2e/x` both arrive as `/x` —
 * but a backslash is only a separator for the *special* schemes (http, file
 * and friends), so `/..%5c..%5cx` comes through untouched and then means
 * exactly what it looks like once Windows sees it.
 *
 * @param {string} requestUrl full URL, e.g. `piana://app/assets/index.js`
 * @param {string} root       the `dist/` directory to serve out of
 */
function resolveAsset(requestUrl, root) {
  let pathname;
  try {
    ({ pathname } = new URL(requestUrl));
  } catch {
    return null;
  }

  // %20 and friends: the URL carries an encoded path, the filesystem wants the
  // real characters. A malformed escape is a bad request, not a crash.
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // A bare origin (`piana://app/`) means the entry point.
  if (decoded === '/' || decoded === '') decoded = '/index.html';

  // NUL terminates a path in the syscall layer, so a name containing one can
  // read a different file than it appears to.
  if (decoded.includes('\0')) return null;

  const base = path.resolve(root);
  const target = path.resolve(base, `.${decoded}`);

  // `startsWith(base)` alone would also accept a sibling like `dist-ssr`.
  const relative = path.relative(base, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  return target;
}

module.exports = { resolveAsset };
