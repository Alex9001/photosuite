# File loading and close fixes: review handoff

Work is on `fix/psd-file-loading`, based on `v0.9.16` (`4ec21d6`). At the
time of the clone, upstream `main` contained an audit notice and no application
source. Check upstream's current source branch and ancestry before preparing a
PR; do not assume this branch can be merged directly into that audit snapshot.
The user requested another agent's review before opening a PR.

## Findings and changes

- The original Linux AppImage passed its bundled library environment to the
  host Zenity confirmation program. Reproduction on the user's machine exited
  with `undefined symbol: g_once_init_leave_pointer` from `libxmlb.so.2`.
  Confirmation then returned false without a usable dialog. The packaged
  `usr/bin/zenity` wrapper now clears the bundled library/module paths before
  launching the host program. `docs/PACKAGING.md` explains this requirement.
- Rust blocked window closing whenever emitting a quit event succeeded, even
  if JavaScript never handled it. The new quit handshake waits for listener
  registration and acknowledgement, with a native recovery confirmation after
  five seconds without an acknowledgement. Frontend quit deduplicates prompts
  and bounds best-effort settings persistence to 1.5 seconds. Async desktop
  confirmations preserve Cancel/OK decisions.
- Native file drops were accepted only on the empty intro screen. The listener
  now accepts drops across the editor root, including with documents open,
  opening them as new documents. It ignores drops while a file open is busy.
- HTTP URL loading depended on browser CORS and silently hid network failures.
  `read_url_raw` now downloads HTTP(S) through reqwest with redirect and timeout
  handling, returning binary IPC. The frontend reports failures, advances the
  queue, and routes `file://` URLs through the filesystem loader.

## Validation completed on Linux

- `npm test`: 1,765 passed, none failed or cancelled.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 17 passed.
- `npm run verify`, ESLint on the changed JavaScript modules, and
  `git diff --check` passed.
- Release binary and AppImage built. Tests used WebKitWebDriver, injected native
  Tauri drop events, and the user's four local Intent PSD templates. All four
  opened: contact (128 layers), blog (253), home (178), portfolio (146).
- HTTP downloads from a local server without CORS headers, redirects, encoded
  file URLs, and HTTP 404 reporting were exercised in the binary and AppImage.
- Real AppImage close dialogs were exercised: Cancel preserved a modified test
  document, OK closed it. Disconnecting the quit listener produced the recovery
  dialog; both Cancel and OK worked. The standalone binary also closed with a
  deliberately stalled settings-save promise.

The sample PSDs are not committed. They remain in the user's supplied local
folder. Temporary desktop smoke scripts and logs were kept under
`/tmp/photosuite-*` on the development machine, not as portable repo tests.

## Follow-up review

- Review quit acknowledgement timing, repeated requests, frontend reloads,
  dialog failures, and whether further simplification is appropriate.
- Check the Zenity wrapper on other Linux distributions and environments;
  it relies on a host Zenity installation. macOS and Windows were not exercised.
- Review native download resource limits, header/redirect behavior, and URL
  compatibility. No response-size limit was added.
- Exercise actual file-manager dragging, scaling, and tab/canvas placement
  expectations; automated smoke tests injected native drop events.
- A WebKitWebDriver screenshot request stalled on the packaged AppImage after
  successful loading checks. The separate binary screenshot worked. The
  packaged app subsequently closed normally through its window manager.
  AppImage startup also logged a missing GStreamer appsink warning.
- Packaging overlapped the first binary smoke run, producing a nonfatal
  "Text file busy" warning while adding bundler-type metadata. Repackage from
  an idle binary for any release. The local build was made on the user's Linux
  system, not the project's Ubuntu portability baseline. Full release/delta
  update verification was not run.

A locally tested AppImage was installed at the user's existing launcher path,
with the original backed up. No GitHub release or upstream PR was created.
