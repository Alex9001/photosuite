import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("AppImage dialogs use host libraries and preserve arguments/session", { skip: process.platform !== "linux" }, () => {
  const temp = mkdtempSync(join(tmpdir(), "photosuite-dialog-"));
  const appdir = join(temp, "App Dir"), host = join(temp, "host");
  mkdirSync(join(appdir, "usr", "bin"), { recursive: true });
  mkdirSync(host);
  writeFileSync(join(appdir, "usr", "bin", "zenity"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  writeFileSync(join(host, "zenity"), '#!/bin/sh\nprintf "%s\\n" "$LD_LIBRARY_PATH" "$GTK_PATH" "$GIO_MODULE_DIR" "$DISPLAY" "$@"\n', { mode: 0o755 });
  try {
    const result = spawnSync(resolve("packaging/linux/zenity"), ["--question", "--text", "Discard unsaved work?"], {
      encoding: "utf8",
      env: { ...process.env, APPDIR: appdir, PATH: `${appdir}/usr/bin:${host}:/usr/bin`,
        LD_LIBRARY_PATH: appdir, GTK_PATH: appdir, GIO_MODULE_DIR: appdir, DISPLAY: ":test" },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "\n\n\n:test\n--question\n--text\nDiscard unsaved work?\n");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
