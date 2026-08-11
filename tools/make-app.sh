#!/bin/sh
# Wraps Electron in a Piana.app, so the Dock has something of ours to launch.
#
#   npm run mac                 # beside Electron, in node_modules
#   npm run mac -- /Applications
#
# The Dock takes an icon, and a name, from the application bundle it launched.
# It ignores the window icon Electron sets from `icon:`, and `app.dock.setIcon`
# only reaches the tile of an app that is already running — so a Dock item made
# from the stock Electron.app is an Electron atom called Electron before the
# click and, once the pin is made, forever after. The only thing that changes it
# is a bundle carrying the icon and the name itself. This is make-exe.ps1's
# problem exactly, one platform over.
#
# So: copy Electron.app, rename its executable, rewrite the Info.plist keys that
# name an app, declare .mid as something it opens, drop an .icns beside them,
# and leave a three-line pointer at this checkout in Contents/Resources/app —
# which is the first place Electron looks for an app to run, ahead of the
# default one it would otherwise show. The source here is still what runs; the
# bundle is a launcher, not a build.
#
# Nothing outside macOS is needed to do any of it: ditto, PlistBuddy, iconutil
# and codesign all ship with the OS, the same way make-exe.ps1 uses the resource
# APIs already in Windows rather than rcedit.
#
# `npm install` and Electron upgrades wipe a copy made in node_modules — run
# this again. A copy made in /Applications survives both, and keeps working
# because it points back here.

set -e

case "$(uname -s)" in
  Darwin) ;;
  *) echo "make-app.sh builds a macOS bundle - on Windows the equivalent is 'npm run exe'." >&2; exit 1 ;;
esac

root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/node_modules/electron/dist"
src="$dist/Electron.app"

target=${1:-$dist}
dest="$target/Piana.app"

[ -d "$src" ] || { echo "Electron not found at $src - run 'npm install' first." >&2; exit 1; }
[ -d "$target" ] || { echo "No such folder: $target" >&2; exit 1; }

# The bundle runs the checkout, and the checkout runs the Vite build in dist/.
# Without one the app opens only to put up an error dialog, which is a poor
# first impression for something that was just dragged to the Dock.
[ -f "$root/dist/index.html" ] || {
  echo "No build in $root/dist - run 'npm run build' first." >&2
  exit 1
}

# The pointer below is JavaScript, and quoting a path into it safely is not
# worth the guesswork. Refuse the two characters that would need it.
case "$root" in
  *\'*|*\\*) echo "This checkout's path contains a quote or a backslash: $root" >&2; exit 1 ;;
esac

# rm -rf on a path built from an argument, so make sure of what it is first.
case "$dest" in
  */Piana.app) ;;
  *) echo "Refusing to write $dest" >&2; exit 1 ;;
esac

# ------------------------------------------------------------------ the icon
#
# icns entry names are fixed, and each one has to be the size its name claims,
# so the mapping is written out rather than looped. @2x is the retina copy of
# the size below it: the Dock draws 128 on a non-retina display and reads
# icon_128x128@2x for the same slot on a retina one.

icons="$root/assets"
for size in 16 32 64 128 256 512 1024; do
  [ -f "$icons/icon-$size.png" ] || {
    echo "Missing $icons/icon-$size.png - run 'npm run icon' first." >&2; exit 1; }
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
iconset="$work/piana.iconset"
mkdir -p "$iconset"

cp "$icons/icon-16.png"   "$iconset/icon_16x16.png"
cp "$icons/icon-32.png"   "$iconset/icon_16x16@2x.png"
cp "$icons/icon-32.png"   "$iconset/icon_32x32.png"
cp "$icons/icon-64.png"   "$iconset/icon_32x32@2x.png"
cp "$icons/icon-128.png"  "$iconset/icon_128x128.png"
cp "$icons/icon-256.png"  "$iconset/icon_128x128@2x.png"
cp "$icons/icon-256.png"  "$iconset/icon_256x256.png"
cp "$icons/icon-512.png"  "$iconset/icon_256x256@2x.png"
cp "$icons/icon-512.png"  "$iconset/icon_512x512.png"
cp "$icons/icon-1024.png" "$iconset/icon_512x512@2x.png"

iconutil -c icns "$iconset" -o "$work/piana.icns"

# ---------------------------------------------------------------- the bundle

rm -rf "$dest"
# ditto rather than cp -R: it keeps the symlinks inside the frameworks as
# symlinks, and a framework whose Versions/Current has been copied into a real
# directory is a framework that no longer loads.
ditto "$src" "$dest"

mv "$dest/Contents/MacOS/Electron" "$dest/Contents/MacOS/Piana"
cp "$work/piana.icns" "$dest/Contents/Resources/piana.icns"

# Read once: it goes into the plist for Finder's Get Info, and into the pointer
# below, which is where `app.getVersion()` and so the About box read it from.
version=$(node -p "require('$root/package.json').version")

plist="$dest/Contents/Info.plist"
plb() { /usr/libexec/PlistBuddy -c "$1" "$plist" >/dev/null 2>&1; }
set_key() {
  plb "Set :$1 $2" || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$plist" >/dev/null
}

set_key CFBundleExecutable  Piana
set_key CFBundleName        Piana
set_key CFBundleDisplayName Piana
set_key CFBundleIconFile    piana
# The same id main.cjs gives Windows for the taskbar. Nothing here depends on
# it, but two apps sharing com.github.Electron is how the Dock ends up treating
# Piana and any other stock-Electron app as one thing.
set_key CFBundleIdentifier  com.jamespiana.piana
set_key CFBundleShortVersionString "$version"

# --------------------------------------------------------- opening .mid files
#
# The Windows side gets "Open with Piana" from the file association the
# installer writes; here it is a declaration in the bundle. Without it Piana
# does not appear in Finder's Open With menu, .mid files cannot be dropped on
# the Dock tile, and main.cjs's `open-file` handler never fires — the one route
# into the app that argv does not cover on macOS.
#
# Alternate rank rather than Owner: a MIDI file more often belongs to a DAW
# that is also installed, and claiming to be its default handler is not this
# app's call to make. It still appears in Open With, and still opens what is
# sent to it.
plb "Delete :CFBundleDocumentTypes" || true
/usr/libexec/PlistBuddy \
  -c "Add :CFBundleDocumentTypes array" \
  -c "Add :CFBundleDocumentTypes:0 dict" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string 'MIDI file'" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" \
  -c "Add :CFBundleDocumentTypes:0:LSHandlerRank string Alternate" \
  -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" \
  -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.midi-audio" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions array" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:0 string mid" \
  -c "Add :CFBundleDocumentTypes:0:CFBundleTypeExtensions:1 string midi" \
  "$plist" >/dev/null

# ------------------------------------------------------------- the pointer
#
# Electron looks in Contents/Resources for app.asar, then app, then falls back
# to the default app it ships. A package.json naming a main file is the whole
# interface, and that main file only has to hand over to this checkout's:
# require resolves from the node_modules beside it, and `__dirname` inside
# electron/main.cjs is this checkout's electron folder, which is what every
# path in it is relative to.
#
# The version is copied in because `app.getVersion()` reads it from here, not
# from the checkout, and it is what the About box shows.
mkdir -p "$dest/Contents/Resources/app"
cat > "$dest/Contents/Resources/app/package.json" <<EOF
{ "name": "piana", "version": "$version", "main": "main.js" }
EOF
cat > "$dest/Contents/Resources/app/main.js" <<EOF
// Piana runs from its checkout; this bundle only launches it.
require('$root/electron/main.cjs');
EOF

# Editing a bundle invalidates its signature, and macOS on Apple Silicon will
# not launch a Mach-O whose signature does not check out - it is killed on
# sight with nothing said about why. Ad-hoc (-s -) is what Electron's own
# prebuilt dist carries, so this puts back what was there.
codesign --force --deep --sign - "$dest" >/dev/null 2>&1 || {
  echo "codesign failed - the bundle will not launch. Is the Xcode command line tools' codesign on PATH?" >&2
  exit 1
}

# Finder caches an icon against the bundle's mtime.
touch "$dest"

echo "Built $dest"
echo "Drag it to the Dock. If the old icon lingers there, 'killall Dock'."
