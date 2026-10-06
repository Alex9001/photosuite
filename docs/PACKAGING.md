# Packaging and release verification

Every installer is produced by [`.github/workflows/build.yml`](../.github/workflows/build.yml).
Packages are built only for a `v*` tag push or a manual `workflow_dispatch` run;
a plain branch push stops after the JavaScript lint and test job. A tag push also
publishes the files to a **draft** GitHub release, which a maintainer reviews and
publishes by hand.

| Platform | Outputs | Compiled on | Packaged on |
| --- | --- | --- | --- |
| macOS | universal `.dmg` (arm64 + x86_64) | `macos-latest` | same |
| Windows | NSIS `.exe` | `windows-latest` | same |
| Linux x86_64 | `.deb`, `.rpm`, `.flatpak`, `.pkg.tar.zst` | `ubuntu-22.04` | `ubuntu-24.04` |
| Linux x86_64 | `.AppImage` + `.AppImage.zsync` | `ubuntu-22.04` | `ubuntu-22.04` |
| Linux arm64 | `.deb`, `.rpm` | `ubuntu-22.04-arm` | `ubuntu-24.04-arm` |

## How the Linux side is laid out

Compiling is far more expensive than packaging, so `build-linux` compiles one
binary per architecture and uploads it as a short-lived artifact. `package-linux`
then fans out one runner per package format, each downloading that binary and
running only its own bundler. Seven `tauri build` runs would otherwise pay for
the same compile seven times.

Each leg bundles on a runner of the architecture it packages. The `.deb` and
`.rpm` bundlers take the package architecture from the host they run on, so an
arm64 package assembled on an x86_64 runner would be mislabelled `amd64`.

arm64 is limited to `.deb` and `.rpm`. Those cover the distributions people
actually run on arm64 hardware, while each remaining format would need its own
arm64 story: an arm64 AppImage runtime, an arm64 Flatpak runtime, and an arm64
`makepkg` container image.

Tauri has no Flatpak or pacman bundler, so those two legs bundle a `.deb` and
repackage its payload — see [`packaging/flatpak/`](../packaging/flatpak) and
[`packaging/arch/`](../packaging/arch). Doing that inside each leg, rather than
depending on the `.deb` leg, keeps the formats independent: a broken Flatpak
runtime cannot take the `.deb` down with it.

## The glibc baseline

Linux binaries are compiled on Ubuntu 22.04, not 24.04. glibc is backward but
not forward compatible, so a binary linked against 24.04's glibc 2.39 refuses to
start on anything older — which rules out Debian 12, Ubuntu 22.04 and RHEL 9,
and on the arm64 side Raspberry Pi OS. Compiling on 22.04 puts the floor at
glibc 2.35 and still runs on current distributions.

The AppImage is *packaged* on 22.04 for the same reason: linuxdeploy copies the
webkit and GTK libraries off the packaging runner into the bundle, so building it
on 24.04 would wrap a glibc 2.35 binary in glibc 2.39 libraries and undo the
portability. Every other leg declares dependencies (`.deb`, `.rpm`) or
repackages an existing payload (Flatpak, pacman) and embeds nothing from its
host, so those stay on the current runner.

The AppImage also ships `packaging/linux/zenity` as `usr/bin/zenity`. The
portal dialog backend launches the host's Zenity for confirmations; loading
AppImage GTK/GLib libraries into a newer host Zenity can crash it and silently
turn every unsaved-work confirmation into Cancel. The wrapper removes bundled
library/module paths for that child process while retaining the display and
session environment. Keep this wrapper executable and ahead of the host
Zenity in the AppImage's PATH.

This also fixes the AppStream metadata spelling: the 22.04 `appstreamcli` is
AppStream 0.15, which predates the `<developer id>` element, so the AppImage's
metainfo uses the older `<developer_name>`.

**This runner image retires with 22.04's standard support in April 2027.** The
replacement is to compile and bundle inside an `ubuntu:22.04` container on a
current runner, which holds the same floor without depending on the runner
image. Moving the floor up to 24.04 instead means dropping the distributions
listed above.

## AppImage delta updates

`LDAI_UPDATE_INFORMATION` is exported before the AppImage leg bundles.
linuxdeploy passes it to appimagetool, which embeds the update information in the
AppImage *and* writes the `.AppImage.zsync` control file published beside it.

The value uses the `gh-releases-zsync` transport, so AppImageUpdate resolves the
newest published release through the GitHub API instead of a fixed URL. That is
what keeps the channel working when the version in the filename changes. The
filename in it is a glob (`PhotoSuite_*_amd64.AppImage.zsync`) for the same
reason.

[`scripts/verify-appimage.sh`](../scripts/verify-appimage.sh) runs against the
exact bytes about to be uploaded and checks that:

- the filename still matches the glob in the update information, so a rename in
  Tauri's bundler surfaces here instead of as a silently broken update channel;
- the file is a type-2 AppImage, and its `.zsync` names these bytes and their
  length;
- the payload carries a valid desktop entry, AppStream metadata that
  `appstreamcli` accepts, and the bundled `LICENSE` and `THIRD-PARTY-NOTICES.md`;
- `zsync` can rebuild the image from its own control file, byte for byte.

It only unpacks the AppImage, never launches it, so it needs no display. It does
need `desktop-file-utils`, `appstream` and `zsync`, which the AppImage leg
installs.

## AppStream metadata

Two copies, deliberately:
[`packaging/linux/`](../packaging/linux/app.photosuite.PhotoSuite.metainfo.xml)
is embedded in the AppImage by the `appimage.files` entry in
`tauri.linux.conf.json`, and
[`packaging/flatpak/`](../packaging/flatpak/app.photosuite.PhotoSuite.metainfo.xml)
is installed by the Flatpak manifest. They carry the same metadata and differ
in `<launchable>` — the Flatpak renames the desktop file to its application ID,
while the AppImage keeps the `PhotoSuite.desktop` that Tauri generates — and in
how the developer is declared, for the AppStream version reason above. Keep the
rest in step.

## Building a package locally

Install [Tauri's prerequisites](https://tauri.app/start/prerequisites/), then:

```sh
git submodule update --init --recursive
npm ci
npm run vendor:fixlinks
npx tauri build --no-bundle -- --locked
npx tauri bundle -b deb          # or rpm, appimage
```

The Flatpak and pacman builds repackage a `.deb`; their manifests document the
exact commands.

## Known constraints

- **CUPS on aarch64.** `cups_rs` 0.3.0 hardcodes `i8` for C strings, which does
  not compile where a C `char` is unsigned. `src-tauri/Cargo.toml` pins the first
  upstream commit after the 0.3.0 tag, whose only change is those casts. Replace
  the pin with a plain version requirement once a release carrying the fix exists.
- **The Flatpak runtime is end of life.** The manifest targets GNOME 47, which
  went EOL on 15 October 2025. Builds still succeed, but Flathub will not accept
  an EOL runtime on submission.
- **macOS signing is opt-in.** Without the Apple secrets the job still produces
  an unsigned, un-notarized `.dmg`. The secrets are listed in the workflow.
