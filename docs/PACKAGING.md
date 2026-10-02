# Native release pipeline

The workflow follows TodoBench's native-target and verified-candidate approach,
adapted to Tauri rather than copying its Qt deployment tooling.

| Target | Runner baseline | Outputs |
| --- | --- | --- |
| Linux x86_64 | Ubuntu 22.04 | AppImage, AppImage.zsync, tar.gz, DEB, RPM |
| Windows x64 | Windows 2025 | NSIS installer, portable ZIP |
| macOS Intel | macOS 15 Intel | DMG, application ZIP |
| macOS Apple Silicon | macOS 14 | DMG, application ZIP |

The Linux archive contains the self-contained AppImage and notices. The Windows
archive contains the executable and its external license resources; WebView2 must
be installed (the NSIS installer handles the normal WebView2 installation flow).
Mac ZIPs preserve application metadata with `ditto`. CI launches the extracted
Mac ZIP through LaunchServices and waits for the frontend-specific editor menus
and either the home-screen title/New/Open actions or the editor toolbar to
appear using screenshot OCR, so a running but blank webview cannot pass. macOS builds are separate
native architectures, replacing the previous universal DMG.

## Build and verify

Every branch push and external pull request builds candidates. Same-repository
PRs reuse their branch's push checks. Manual runs also build candidates without
creating a release. Compilation uses Cargo.lock and npm ci. Each platform stages
exactly its expected outputs, including portable archives, and records the
version, checked-out commit, file sizes and SHA-256 hashes. The aggregate check
rejects missing, extra, empty, damaged or mixed-revision candidates.

Linux builds on Ubuntu 22.04 to match AppImageHub's current runner baseline.
The AppImage smoke gate checks type-2 headers, extracted desktop and AppStream
metadata, license resources, update information, zsync reconstruction and a visible
X11 window. An independent job runs the pinned upstream catalog worker against
the same candidate served locally. It retains logs/screenshots and checks that
the worker tested identical bytes. This is a preflight, not catalog acceptance.

Run packaging regressions locally with:

```sh
python3 -m unittest discover -s tests/packaging -p 'test_*.py'
```

For a native build, install the prerequisites documented by Tauri, initialize all
submodules recursively, run `npm ci` and `npm run vendor:fixlinks`, then:

```sh
npx tauri build --target x86_64-unknown-linux-gnu -- --locked
python3 scripts/package-release.py stage linux-x86_64 dist
```

Linux staging requires `zsyncmake`. CI additionally sets
`LDAI_UPDATE_INFORMATION` before building to embed the actual publishing
repository's stable release channel. The final `.zsync` is generated after
renaming, so its internal filename/URL match the final public AppImage. Do not
rename either file after staging. AppImage updates are distinct from Tauri's
in-app updater; this change does not add an in-app update UI.

## Signing and release ownership

No maintainer certificate is required for contribution builds. Mac candidates use
ad-hoc signing unless a release tag has the configured Apple signing secrets.
They are not notarized without those secrets; do not describe unsigned/ad-hoc
artifacts as trusted Developer ID releases. The existing optional signing and
notarization secrets remain supported. Windows signing is not configured here.

A `v<version>` tag must match `src-tauri/tauri.conf.json`. Only after every native
build, aggregate verification and catalog preflight succeeds does the workflow
create/update a **draft** release. It refuses to clobber a published release.
Maintainers review the outputs and signing state before publishing manually.
Do not push a tag just to test a PR; branch and manual runs provide artifacts.

## AppImageHub submission

After the maintainer publishes a stable release with the verified AppImage and
sidecar, submit one extensionless file named `data/PhotoSuite` to
[AppImage/appimage.github.io](https://github.com/AppImage/appimage.github.io).
Its sole line is `https://github.com/eolix/photosuite`. No catalog PR is created
by this workflow, and a draft/private release is not downloadable by the catalog.
Follow the [current catalog requirements](https://github.com/AppImage/appimage.github.io#how-to-submit-appimages-to-the-catalog),
including meaningful offline English startup and X11 support. Automated preflight
results do not replace the catalog maintainer's review.

The maintainer also has a separate `feat/linux-extra-packages` branch for Flatpak
and Arch packages. This change deliberately keeps those separate and retains
DEB/RPM support. Its AppStream descriptions follow the upstream metadata's
terminology, with the Tauri AppImage desktop name `PhotoSuite.desktop`.
