#!/usr/bin/env bash
# Structural and delta-update checks on the exact AppImage bytes CI is about to
# publish. Run from the repository root with the bundle directory as $1:
#
#   bash scripts/verify-appimage.sh src-tauri/target/release/bundle/appimage
#
# Needs desktop-file-utils (desktop-file-validate), appstream (appstreamcli) and
# zsync on PATH. The AppImage itself is only unpacked, never launched, so this
# runs on a headless runner without a display.
set -euo pipefail

candidate_dir=$(realpath "${1:?bundle directory required}")
images=("$candidate_dir"/*.AppImage)
[[ ${#images[@]} == 1 && -f ${images[0]} ]]
image=${images[0]}

# Must match the filename glob in the embedded update information, otherwise
# AppImageUpdate would look for a .zsync asset that the release does not carry.
# Tauri derives this name from productName and the version, so a rename upstream
# surfaces here rather than as a silently broken update channel.
case "$(basename "$image")" in
  PhotoSuite_*_amd64.AppImage) ;;
  *) echo "Unexpected AppImage name: $(basename "$image")" >&2; exit 1 ;;
esac

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
chmod +x "$image"

# Type-2 AppImage magic, and a .zsync control file that actually describes
# these bytes.
python3 - "$image" <<'PY'
import sys
from pathlib import Path

image = Path(sys.argv[1])
with image.open('rb') as stream:
    header = stream.read(11)
assert header[:4] == b'\x7fELF' and header[8:11] == b'AI\x02', 'Expected a type-2 AppImage'

control = Path(str(image) + '.zsync').read_bytes().split(b'\n\n', 1)[0].decode('utf-8')
fields = dict(line.split(': ', 1) for line in control.splitlines() if ': ' in line)
assert fields.get('Filename') == image.name, 'Wrong zsync Filename'
assert fields.get('URL') == image.name, 'Wrong zsync URL'
assert int(fields['Length']) == image.stat().st_size, 'Wrong zsync Length'
PY

# The payload: a valid desktop entry, catalogable AppStream metadata and the
# license resources Tauri is told to bundle.
(
  cd "$work"
  env -u APPIMAGE_EXTRACT_AND_RUN "$image" --appimage-extract >/dev/null
  desktop-file-validate squashfs-root/PhotoSuite.desktop
  appstreamcli validate --no-net squashfs-root/usr/share/metainfo/app.photosuite.PhotoSuite.metainfo.xml
  test -s squashfs-root/usr/lib/PhotoSuite/LICENSE
  test -s squashfs-root/usr/lib/PhotoSuite/THIRD-PARTY-NOTICES.md
  test -x squashfs-root/usr/bin/zenity

  # A delta update is only useful if the control file can rebuild the image, so
  # reconstruct it and compare byte for byte.
  zsync -i "$image" -o reconstructed.AppImage "$image.zsync"
  cmp "$image" reconstructed.AppImage
)

# linuxdeploy embeds this from LDAI_UPDATE_INFORMATION; without it AppImageUpdate
# has no way to find the .zsync and delta updates silently never happen.
expected="gh-releases-zsync|${GITHUB_REPOSITORY%/*}|${GITHUB_REPOSITORY#*/}|latest|PhotoSuite_*_amd64.AppImage.zsync"
actual=$(env -u APPIMAGE_EXTRACT_AND_RUN "$image" --appimage-updateinformation)
if [[ "$actual" != "$expected" ]]; then
  echo "Embedded update information mismatch" >&2
  echo "  expected: $expected" >&2
  echo "  actual:   $actual" >&2
  exit 1
fi

echo "AppImage OK: $(basename "$image")"
