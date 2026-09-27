import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installBrowserGlobals } from "../helpers/stub-browser-globals.js";

installBrowserGlobals();

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clipboardPath = path.join(repoRoot, "src/core/system-clipboard.js");

let clipboardImageSignature;
let isStaleClipboardFrame;
let CLIPBOARD_SIGNATURE_PENDING;
let nameClipboardImageFile;
let applyDataTransferToController;

before(async () => {
  ({
    clipboardImageSignature,
    isStaleClipboardFrame,
    CLIPBOARD_SIGNATURE_PENDING,
    nameClipboardImageFile,
    applyDataTransferToController,
  } = await import("../../src/core/system-clipboard.js"));
});

describe("core/system-clipboard.js", () => {
  it("exports clipboard helpers for Tauri plugin", () => {
    const source = fs.readFileSync(clipboardPath, "utf8");
    assert.match(source, /export function getTauriClipboardManager/);
    assert.match(source, /export function writeClipboardText/);
    assert.match(source, /export function writeClipboardRgba/);
    assert.match(source, /export function readClipboardText/);
    assert.match(source, /export function readSystemClipboardForPaste/);
    assert.match(source, /export function readClipboardImageSignature/);
  });

  it("routes vector path clipboard via uiDispatch wire payload", () => {
    const source = fs.readFileSync(clipboardPath, "utf8");
    assert.match(source, /pasteVectorPathsFromClipboard/);
    assert.match(source, /value:\s*text/);
    assert.match(source, /indexOf\("vcb;"\)/);
  });

  it("caps OS clipboard RGBA writes", () => {
    const source = fs.readFileSync(clipboardPath, "utf8");
    assert.match(source, /OS_CLIPBOARD_WRITE_MAX_PIXELS\s*=\s*1024 \* 1024/);
  });

  describe("clipboardImageSignature", () => {
    it("is width x height for a real frame", () => {
      assert.equal(clipboardImageSignature({ width: 4000, height: 3000 }), "4000x3000");
      assert.equal(clipboardImageSignature({ width: 512, height: 512 }), "512x512");
    });
    it("is 'none' for absent or empty frames", () => {
      assert.equal(clipboardImageSignature(null), "none");
      assert.equal(clipboardImageSignature({ width: 0, height: 0 }), "none");
      assert.equal(clipboardImageSignature({ width: 10 }), "none");
    });
  });

  describe("isStaleClipboardFrame — paste prefers in-app payload when pasteboard is unchanged", () => {
    const car = { width: 4000, height: 3000 };
    const pngIcon = { width: 512, height: 512 };
    const external = { width: 800, height: 600 };

    it("no frame is never stale", () => {
      assert.equal(isStaleClipboardFrame(null, "512x512"), false);
    });

    it("no baseline (no in-app copy tracked) → external content wins", () => {
      assert.equal(isStaleClipboardFrame(external, null), false);
      assert.equal(isStaleClipboardFrame(external, undefined), false);
    });

    it("pending baseline (copy just happened, probe not resolved) → treat OS image as stale", () => {
      // A large copy leaves a stale PNG-file icon on the pasteboard while the real
      // image is still being written; nothing may import it in that window.
      assert.equal(isStaleClipboardFrame(pngIcon, CLIPBOARD_SIGNATURE_PENDING), true);
      assert.equal(isStaleClipboardFrame(car, CLIPBOARD_SIGNATURE_PENDING), true);
    });

    it("pasteboard unchanged since copy (matches baseline) → stale, use in-app payload", () => {
      assert.equal(isStaleClipboardFrame(pngIcon, "512x512"), true);
    });

    it("pasteboard changed since copy (another app copied) → not stale, import it", () => {
      assert.equal(isStaleClipboardFrame(external, "512x512"), false);
    });
  });

  // WebView2 is the only webview that puts the copied image on the paste
  // event's DataTransfer, so Windows was the only platform to reach this code —
  // where naming the file by assigning `file.name` threw, because it is a
  // getter. Every paste on Windows died there and pasted nothing.
  describe("pasted image files", () => {
    /** An image off the clipboard: real bytes, no name, as WebView2 hands it over. */
    const clipboardFile = (type) => new File([new Uint8Array([137, 80, 78, 71])], "", { type });

    it("names an unnamed file from the type the clipboard declared", () => {
      assert.equal(nameClipboardImageFile(clipboardFile("image/png")).name, "image.png");
      assert.equal(nameClipboardImageFile(clipboardFile("image/jpeg")).name, "image.jpg");
      assert.equal(nameClipboardImageFile(clipboardFile("image/webp")).name, "image.webp");
      assert.equal(nameClipboardImageFile(clipboardFile("")).name, "image.png");
    });

    it("leaves a file that already has a name alone", () => {
      const named = new File([new Uint8Array([1])], "screenshot.png", { type: "image/png" });
      assert.equal(nameClipboardImageFile(named), named, "should not copy a file that needs nothing");
    });

    it("keeps the result a File, which the open path checks for", () => {
      const renamed = nameClipboardImageFile(clipboardFile("image/png"));
      assert.ok(renamed instanceof File);
      assert.equal(renamed.type, "image/png");
      assert.equal(renamed.size, 4, "the bytes must survive the rename");
    });

    it("hands the loader a named file instead of throwing on a read-only name", () => {
      const loaded = [];
      const controller = {
        appData: { lastClipboardImageFileSize: 0 },
        fileLoader: { loadLocalFiles: (files) => loaded.push(files[0]) },
      };
      const dataTransfer = { items: [{ type: "image/png", getAsFile: () => clipboardFile("image/png") }] };

      assert.equal(applyDataTransferToController(controller, dataTransfer, null, null), true);
      assert.equal(loaded.length, 1, "nothing was handed to the loader");
      assert.equal(loaded[0].name, "image.png");
    });
  });
});
