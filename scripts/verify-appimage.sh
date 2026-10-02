#!/usr/bin/env bash
# Structural, delta-update and X11 startup checks on the exact staged bytes.
set -euo pipefail
candidate_dir=$(realpath "${1:?candidate directory required}")
images=("$candidate_dir"/*.AppImage)
[[ ${#images[@]} == 1 && -f ${images[0]} ]]
image=${images[0]}
work=$(mktemp -d)
evidence=$(realpath -m evidence)
mkdir -p "$evidence"
trap 'test ! -f "$work/startup.log" || cp "$work/startup.log" "$evidence/linux-startup.log"; rm -rf "$work"' EXIT
chmod +x "$image"
python3 - "$image" <<'PY'
import sys
from pathlib import Path
with open(sys.argv[1], 'rb') as stream:
    header = stream.read(11)
assert header[:4] == b'\x7fELF' and header[8:11] == b'AI\x02', 'Expected a type-2 AppImage'
image = Path(sys.argv[1])
control = Path(str(image) + '.zsync').read_bytes().split(b'\n\n', 1)[0].decode('utf-8')
fields = dict(line.split(': ', 1) for line in control.splitlines() if ': ' in line)
assert fields.get('Filename') == image.name, 'Wrong zsync Filename'
assert fields.get('URL') == image.name, 'Wrong zsync URL'
assert int(fields['Length']) == image.stat().st_size, 'Wrong zsync Length'
PY
(
  cd "$work"
  env -u APPIMAGE_EXTRACT_AND_RUN "$image" --appimage-extract >/dev/null
  desktop-file-validate squashfs-root/PhotoSuite.desktop
  appstreamcli validate --no-net squashfs-root/usr/share/metainfo/app.photosuite.PhotoSuite.metainfo.xml
  test -s squashfs-root/usr/lib/PhotoSuite/LICENSE
  test -s squashfs-root/usr/lib/PhotoSuite/THIRD-PARTY-NOTICES.md
  zsync -i "$image" -o reconstructed.AppImage "$image.zsync"
  cmp "$image" reconstructed.AppImage
)
expected="gh-releases-zsync|${GITHUB_REPOSITORY%/*}|${GITHUB_REPOSITORY#*/}|latest|PhotoSuite-*-linux-x86_64.AppImage.zsync"
actual=$(env -u APPIMAGE_EXTRACT_AND_RUN "$image" --appimage-updateinformation)
[[ "$actual" == "$expected" ]]
# Isolate state so a developer's saved session cannot satisfy the startup test.
export HOME="$work/home" XDG_CONFIG_HOME="$work/config" XDG_CACHE_HOME="$work/cache"
mkdir -p "$HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
export LANG=C LC_ALL=C GDK_BACKEND=x11
# This verifies a real visible window, not a successful --help exit. The catalog
# worker additionally captures/reviews the window for meaningful offline content.
timeout --kill-after=5 40 xvfb-run -a bash -c '
  set -euo pipefail
  APPIMAGE_EXTRACT_AND_RUN=1 "$1" > "$2" 2>&1 &
  pid=$!
  trap "kill $pid 2>/dev/null || true" EXIT
  for i in {1..30}; do
    kill -0 "$pid"
    if xdotool search --onlyvisible --name "PhotoSuite" >/dev/null 2>&1; then
      sleep 3
      kill -0 "$pid"
      exit 0
    fi
    sleep 1
  done
  cat "$2" >&2
  exit 1
' _ "$image" "$work/startup.log"
