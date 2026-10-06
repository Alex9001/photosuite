/**
 * FileLoader / FileProcessor pure helpers (base64, encode specs, names), and
 * the open veil across a deferred parser fetch.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";

installBrowserGlobals();

let FileLoader;
let FileProcessor;
let parseEncodeFormatSpec;
let resolveLoadDisplayNames;
let shouldSkipZipEntry;
let bindFormatCodecMap;
let hasFormatLoaders;
let installToastPainter;
let DETECT_ONLY_FORMAT_NAMES;

before(async () => {
  ({
    FileLoader,
    FileProcessor,
    parseEncodeFormatSpec,
    resolveLoadDisplayNames,
    shouldSkipZipEntry
  } = await import("../../../src/ui/shell/file-loader.js"));
  ({ bindFormatCodecMap, DETECT_ONLY_FORMAT_NAMES } = await import(
    "../../../src/document/formats/registry/registry-helpers.js"
  ));
  ({ installToastPainter } = await import("../../../src/core/user-prompts.js"));
  ({ hasFormatLoaders } = await import(
    "../../../src/document/formats/registry/format-loader-imports.js"
  ));
});

describe("ui/shell/file-loader.js", () => {
  it("parseEncodeFormatSpec jpg/webp quality and psd flags", () => {
    assert.deepEqual(parseEncodeFormatSpec("jpg:0.85"), {
      formatId: "jpg",
      encodeOptions: [85]
    });
    assert.deepEqual(parseEncodeFormatSpec("webp:1"), {
      formatId: "webp",
      encodeOptions: [100]
    });
    assert.deepEqual(parseEncodeFormatSpec("psd:full"), {
      formatId: "psd",
      encodeOptions: [true, true]
    });
    assert.deepEqual(parseEncodeFormatSpec("png"), {
      formatId: "png",
      encodeOptions: null
    });
  });

  // The document is named after the file it came from, so the loader keeps the
  // full file name next to the extension-less base name used for save defaults.
  it("resolveLoadDisplayNames from name and url", () => {
    assert.deepEqual(resolveLoadDisplayNames({ name: "photo.PSD" }), {
      fileName: "photo.PSD",
      baseName: "photo",
      displayName: "photo.PSD"
    });
    assert.deepEqual(resolveLoadDisplayNames({ name: "/home/pat/my.photo.jpg" }), {
      fileName: "my.photo.jpg",
      baseName: "my.photo",
      displayName: "/home/pat/my.photo.jpg"
    });
    assert.deepEqual(resolveLoadDisplayNames({ url: "https://x.test/a/b/c.png?v=2" }), {
      fileName: "c.png",
      baseName: "c",
      displayName: "https://x.test/a/b/c.png?v=2"
    });
    assert.deepEqual(resolveLoadDisplayNames({ url: "data:image/png;base64,xx" }), {
      fileName: "image",
      baseName: "image",
      displayName: "data:image/png;base64,xx"
    });
  });

  it("shouldSkipZipEntry filters metadata and empty", () => {
    assert.equal(shouldSkipZipEntry("__MACOSX/._foo", new Uint8Array([1])), true);
    assert.equal(shouldSkipZipEntry("meta.xml", new Uint8Array([1])), true);
    assert.equal(shouldSkipZipEntry("layer.png", new Uint8Array([])), true);
    assert.equal(shouldSkipZipEntry("layer.png", new Uint8Array([1, 2])), false);
  });

  it("exports FileLoader and FileProcessor", () => {
    assert.equal(typeof FileLoader, "function");
    assert.equal(typeof FileProcessor.processLoadedBytes, "function");
    assert.equal(typeof FileProcessor.encodeDocumentWithFormat, "function");
  });
});

/**
 * A file whose parser is not in the bundle opens in two passes: the first
 * reports "decode pending" and fetches the parser, the second decodes. The veil
 * covers the whole thing, so whoever reports pending owns hiding it — get that
 * wrong and the document appears underneath a "Loading..." panel that never
 * goes away.
 */
describe("ui/shell/file-loader.js deferred parser open", () => {
  it("keeps the veil up for the fetch and drops it once the retry decodes", async () => {
    assert.equal(hasFormatLoaders("fig"), false, "fig parser should start deferred");

    const decoded = [];
    bindFormatCodecMap({
      FIG: {
        isLayered: true,
        decode(bytes, doc) {
          decoded.push(doc.name);
        },
      },
    });

    let veilHidden = 0;
    const fileLoader = {
      hideOpenVeil() {
        veilHidden += 1;
      },
      dispatch() {},
    };

    // Not a recognisable magic number; the .fig name is what picks the format.
    const bytes = new Uint8Array([0, 0, 0, 0]).buffer;
    const pending = FileProcessor.dispatchOpenBytes(
      { name: "poster.fig" },
      bytes,
      fileLoader,
      null,
    );

    // First pass: parser not here yet, so nothing decoded and the veil stays.
    assert.equal(pending, true, "should report decode pending while fetching");
    assert.deepEqual(decoded, []);
    assert.equal(veilHidden, 0, "veil must stay up during the fetch");

    // Let the dynamic import and the retry it schedules run.
    for (let tick = 0; tick < 20 && decoded.length === 0; tick++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.deepEqual(decoded, ["poster.fig"], "retry should decode the document");
    assert.equal(veilHidden, 1, "veil must come down exactly once, after the retry");
  });

  // The detector knows more formats than the codecs decode. Calling one of
  // those "unknown" is wrong twice over: the file was recognised, and the user
  // is left wondering whether it is corrupt. Name it and say we cannot read it.
  describe("a format the detector knows but nothing decodes", () => {
    function openBytesCapturingToast(header) {
      const toasts = [];
      installToastPainter((message) => toasts.push(message));
      bindFormatCodecMap({});
      const bytes = new Uint8Array(64);
      bytes.set(header, 0);
      try {
        FileProcessor.dispatchOpenBytes(
          { name: "sample.bin" },
          bytes.buffer,
          { hideOpenVeil() {}, dispatch() {} },
          null,
        );
      } finally {
        installToastPainter(null);
      }
      return toasts;
    }

    it("names the format instead of reporting an unknown file", () => {
      const toasts = openBytesCapturingToast([80, 86, 82, 3]);
      assert.equal(toasts.length, 1);
      assert.match(toasts[0], /PowerVR texture \(\.pvr\)/);
      assert.doesNotMatch(toasts[0], /Unknown file format/);
    });

    it("covers every id in the detect-only table", () => {
      for (const [formatId, header] of [
        ["acv", [0, 4, 0, 5]],
        ["ciff", [73, 73, 26, 0]],
        ["msh", [0, 0, 0, 2, 121, 102, 113, 76]],
      ]) {
        const toasts = openBytesCapturingToast(header);
        assert.equal(toasts.length, 1, formatId);
        assert.equal(
          toasts[0],
          "PhotoSuite cannot open " + DETECT_ONLY_FORMAT_NAMES[formatId] + " files.",
          formatId,
        );
      }
    });

    it("still reports a genuinely unrecognised file as unknown", () => {
      const toasts = openBytesCapturingToast([170, 187, 204, 221]);
      assert.equal(toasts.length, 1);
      assert.match(toasts[0], /Unknown file format/);
    });
  });
});

describe("URL loading", () => {
  it("downloads HTTP URLs in the native host and preserves import options", async () => {
    const oldTauri = window.__TAURI__;
    const oldProcessor = FileLoader.processLoadedBytes;
    const bytes = new Uint8Array([56, 66, 80, 83]).buffer;
    const spec = { url: " https://example.test/template.psd ", placeIntoDocIndex: 2, requestHeaders: { Authorization: "Bearer test" } };
    const loader = new FileLoader((loadedSpec, loadedBytes, emitter) => {
      assert.equal(loadedSpec, spec);
      assert.equal(loadedBytes, bytes);
      assert.equal(emitter, loader);
      assert.equal(loadedSpec.placeIntoDocIndex, 2);
      return false;
    });
    let busy = 0;
    loader.showOpenVeil = () => busy++;
    loader.hideOpenVeil = () => busy--;
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      assert.equal(command, "read_url_raw");
      assert.deepEqual(args, { url: "https://example.test/template.psd", requestHeaders: spec.requestHeaders });
      return bytes;
    } } };
    try {
      await loader.enqueueUrlLoad(spec);
      assert.equal(busy, 0);
      assert.equal(loader.urlLoadInProgress, false);
    } finally { window.__TAURI__ = oldTauri; FileLoader.processLoadedBytes = oldProcessor; }
  });

  it("reports failed downloads and continues with the next queued file", async () => {
    const oldTauri = window.__TAURI__;
    const oldProcessor = FileLoader.processLoadedBytes;
    const opened = [], messages = [];
    let rejectFirst;
    const loader = new FileLoader(spec => { opened.push(spec.url); return false; });
    let busy = 0;
    loader.showOpenVeil = () => busy++;
    loader.hideOpenVeil = () => busy--;
    installToastPainter(message => messages.push(message));
    window.__TAURI__ = { core: { invoke: (_command, args) => args.url.endsWith("missing.psd")
      ? new Promise((_resolve, reject) => { rejectFirst = reject; })
      : Promise.resolve(new ArrayBuffer(4)) } };
    try {
      const first = loader.enqueueUrlLoad({ url: "https://example.test/missing.psd" });
      loader.enqueueUrlLoad({ url: "https://example.test/next.psd" });
      rejectFirst("HTTP 404 Not Found");
      await first;
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(opened, ["https://example.test/next.psd"]);
      assert.match(messages[0], /HTTP 404/);
      assert.equal(busy, 0);
      assert.equal(loader.urlLoadInProgress, false);
    } finally { window.__TAURI__ = oldTauri; FileLoader.processLoadedBytes = oldProcessor; installToastPainter(null); }
  });

  function installNativeUrlHarness(invoke) {
    const oldTauri = window.__TAURI__;
    const oldProcessor = FileLoader.processLoadedBytes;
    const oldFileReader = globalThis.FileReader;
    const opened = [];
    const loader = new FileLoader((spec, bytes, emitter, channelRasterCallback) => {
      opened.push({ spec, bytes, emitter, channelRasterCallback });
      return false;
    });
    let busy = 0;
    loader._setOpenBusy = on => { busy += on ? 1 : -1; };
    window.__TAURI__ = { core: { invoke } };
    // Exercise the former native-path bridge too, so these regressions fail
    // for lost metadata and incorrect destinations rather than a missing API.
    globalThis.FileReader = class FileReader {
      readAsArrayBuffer(file) {
        file.arrayBuffer().then(bytes => {
          this.result = bytes;
          this.onload({ target: this });
        });
      }
    };
    return {
      loader,
      opened,
      busy: () => busy,
      restore() {
        window.__TAURI__ = oldTauri;
        FileLoader.processLoadedBytes = oldProcessor;
        globalThis.FileReader = oldFileReader;
      },
    };
  }

  it("preserves file URL metadata and the decoded native save path", async () => {
    const bytes = new ArrayBuffer(4), calls = [];
    const harness = installNativeUrlHarness(async (command, args) => {
      calls.push({ command, args });
      return bytes;
    });
    const spec = {
      url: " file:///media/Website%20PSD/home%20page.psd ",
      placeIntoDocIndex: 2,
      insertLayerIndex: 3,
      scriptHostData: { startupScript: "runFirst();", hostServer: "https://host.test" },
      parentDocRef: { id: "parent" },
    };
    try {
      await harness.loader.enqueueUrlLoad(spec);
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls, [{ command: "read_file_raw", args: { path: "/media/Website PSD/home page.psd" } }]);
      assert.equal(harness.opened.length, 1);
      assert.equal(harness.opened[0].spec, spec, "the original import metadata must reach the processor");
      assert.equal(spec.url, "file:///media/Website%20PSD/home%20page.psd");
      assert.equal(spec.name, "home page.psd");
      assert.equal(spec.nativeFilePath, "/media/Website PSD/home page.psd");
      assert.equal(spec.placeIntoDocIndex, 2);
      assert.equal(spec.insertLayerIndex, 3);
      assert.equal(spec.scriptHostData.startupScript, "runFirst();");
      assert.equal(spec.parentDocRef.id, "parent");
      assert.equal(harness.opened[0].bytes, bytes);
      assert.equal(harness.opened[0].emitter, harness.loader);
      assert.equal(harness.opened[0].channelRasterCallback, null);
      assert.equal(harness.busy(), 0);
    } finally { harness.restore(); }
  });

  it("queues file URLs without mixing their target document indexes", async () => {
    const reads = new Map(), paths = [];
    const harness = installNativeUrlHarness((_command, args) => {
      paths.push(args.path);
      return new Promise(resolve => reads.set(args.path, resolve));
    });
    const firstSpec = { url: "file:///tmp/first.psd", placeIntoDocIndex: 2 };
    const secondSpec = { url: "file:///tmp/second.psd", placeIntoDocIndex: 7 };
    try {
      harness.loader.enqueueUrlLoad(firstSpec);
      harness.loader.enqueueUrlLoad(secondSpec);
      const initiallyRequested = paths.slice();
      reads.get("/tmp/first.psd")(new ArrayBuffer(4));
      await new Promise(resolve => setImmediate(resolve));
      const busyDuringSecondRead = harness.busy();
      reads.get("/tmp/second.psd")(new ArrayBuffer(4));
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(initiallyRequested, ["/tmp/first.psd"], "only the first queued read should start");
      assert.deepEqual(harness.opened.map(open => open.spec.placeIntoDocIndex), [2, 7]);
      assert.deepEqual(harness.opened.map(open => open.spec), [firstSpec, secondSpec]);
      assert.equal(busyDuringSecondRead, 1);
      assert.equal(harness.busy(), 0);
      assert.equal(harness.loader.urlLoadInProgress, false);
      assert.equal(harness.loader.pendingLoadSpecs.length, 0);
    } finally { harness.restore(); }
  });

  it("reports failed native URL reads and continues to the next HTTP URL", async () => {
    let rejectFirst;
    const calls = [], messages = [];
    const harness = installNativeUrlHarness((command, args) => {
      calls.push({ command, args });
      return command === "read_file_raw"
        ? new Promise((_resolve, reject) => { rejectFirst = reject; })
        : Promise.resolve(new ArrayBuffer(4));
    });
    installToastPainter(message => messages.push(message));
    try {
      const first = harness.loader.enqueueUrlLoad({ url: "file:///tmp/missing.psd" });
      harness.loader.enqueueUrlLoad({ url: "https://example.test/next.psd" });
      rejectFirst(new Error("Permission denied"));
      await first;
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(calls.map(call => call.command), ["read_file_raw", "read_url_raw"]);
      assert.deepEqual(harness.opened.map(open => open.spec.url), ["https://example.test/next.psd"]);
      assert.match(messages[0], /Could not open the file URL.*Permission denied/);
      assert.equal(harness.busy(), 0);
      assert.equal(harness.loader.urlLoadInProgress, false);
    } finally { harness.restore(); installToastPainter(null); }
  });

  it("retains Windows, UNC, and localhost file URL path handling", async () => {
    const paths = [];
    const harness = installNativeUrlHarness(async (_command, args) => {
      paths.push(args.path);
      return new ArrayBuffer(4);
    });
    try {
      for (const url of [
        "file:///C:/My%20Files/home.psd",
        "file://server/share/home.psd",
        "file://localhost/tmp/home.psd",
      ]) {
        await harness.loader.enqueueUrlLoad({ url });
      }
      assert.deepEqual(paths, ["C:/My Files/home.psd", "//server/share/home.psd", "/tmp/home.psd"]);
      assert.deepEqual(harness.opened.map(open => open.spec.nativeFilePath), paths);
      assert.deepEqual(harness.opened.map(open => open.spec.name), ["home.psd", "home.psd", "home.psd"]);
      assert.equal(harness.busy(), 0);
    } finally { harness.restore(); }
  });

  it("leaves the veil owned by a pending native file decode while advancing the queue", async () => {
    const harness = installNativeUrlHarness(async () => new ArrayBuffer(4));
    let finishDecode;
    FileLoader.processLoadedBytes = (spec, _bytes, loader) => {
      if (!spec.url.startsWith("file:")) return false;
      finishDecode = () => loader.hideOpenVeil();
      return true;
    };
    try {
      const first = harness.loader.enqueueUrlLoad({ url: "file:///tmp/deferred.psd" });
      harness.loader.enqueueUrlLoad({ url: "https://example.test/next.psd" });
      await first;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(harness.loader.urlLoadInProgress, false);
      assert.equal(harness.loader.pendingLoadSpecs.length, 0);
      assert.equal(harness.busy(), 1, "download completion must not release the decoder's veil");
      finishDecode();
      assert.equal(harness.busy(), 0);
    } finally { harness.restore(); }
  });

  it("keeps HTTP and data URLs on the browser path without a native host", async () => {
    const oldXhr = globalThis.XMLHttpRequest;
    const requests = [], bytes = new ArrayBuffer(4);
    const harness = installNativeUrlHarness(() => { throw new Error("Unexpected native read"); });
    window.__TAURI__ = undefined;
    globalThis.XMLHttpRequest = class XMLHttpRequest {
      constructor() { this.headers = {}; requests.push(this); }
      open(method, url) { this.method = method; this.url = url; }
      setRequestHeader(name, value) { this.headers[name] = value; }
      send() { this.status = 200; this.response = bytes; this.onload(); }
    };
    try {
      await harness.loader.enqueueUrlLoad({
        url: "https://example.test/template.psd",
        requestHeaders: { Authorization: "Bearer test" },
      });
      await harness.loader.enqueueUrlLoad({ url: "data:image/png;base64,AAAA" });
      assert.deepEqual(requests.map(request => request.url), ["https://example.test/template.psd", "data:image/png;base64,AAAA"]);
      assert.deepEqual(requests[0].headers, { Authorization: "Bearer test" });
      assert.ok(requests.every(request => request.method === "GET" && request.responseType === "arraybuffer" && request.timeout === 120000));
      assert.equal(harness.opened.length, 2);
      assert.ok(harness.opened.every(open => open.bytes === bytes));
      assert.equal(harness.busy(), 0);
    } finally { harness.restore(); globalThis.XMLHttpRequest = oldXhr; }
  });
});
