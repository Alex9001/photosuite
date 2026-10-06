/**
 * home-screen native file drop helpers.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";

installBrowserGlobals();

let homeScreenAcceptsFileDrop;
let dropPositionOverElement;
let DocumentTab;

before(async () => {
  ({ homeScreenAcceptsFileDrop, dropPositionOverElement } = await import(
    "../../../src/ui/shell/tauri-home-file-drop.js"
  ));
  ({ DocumentTab } = await import("../../../src/ui/layout/document-tab.js"));
});

describe("ui/shell/tauri-home-file-drop.js", () => {
  it("homeScreenAcceptsFileDrop requires intro with no open documents", () => {
    assert.equal(
      homeScreenAcceptsFileDrop({ appData: { intro: true }, openDocs: [] }),
      true
    );
    assert.equal(
      homeScreenAcceptsFileDrop({ appData: { intro: true }, openDocs: [{}] }),
      false
    );
    assert.equal(
      homeScreenAcceptsFileDrop({ appData: { intro: false }, openDocs: [] }),
      false
    );
  });

  it("dropPositionOverElement maps physical pixels to layout bounds", () => {
    const element = {
      getBoundingClientRect: function() {
        return { left: 100, top: 50, right: 300, bottom: 250 };
      }
    };
    assert.equal(dropPositionOverElement({ x: 150, y: 80 }, element), true);
    assert.equal(dropPositionOverElement({ x: 50, y: 80 }, element), false);
  });

  it("DocumentTab.isExternalFileDrag recognizes OS file drags", () => {
    assert.equal(
      DocumentTab.isExternalFileDrag({ dataTransfer: { types: ["Files"] } }),
      true
    );
    assert.equal(
      DocumentTab.isExternalFileDrag({
        dataTransfer: { types: ["text/plain", "Files"] }
      }),
      true
    );
    assert.equal(
      DocumentTab.isExternalFileDrag({ dataTransfer: { types: ["Text"] } }),
      false
    );
  });
});

describe("native workspace drops", () => {
  it("opens PSDs as documents even with an existing document and intro dismissed", async () => {
    const { installTauriHomeScreenFileDrop } = await import("../../../src/ui/shell/tauri-home-file-drop.js");
    const old = window.__TAURI__;
    const listeners = {};
    const opened = [];
    window.__TAURI__ = { event: { listen: async (name, fn) => {
      listeners[name] = fn;
      return () => delete listeners[name];
    } } };
    const controller = {
      appData: { intro: false }, openDocs: [{}], splashScreen: {},
      el: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 }) },
      runSavedScriptIfAny: () => false,
      fileLoader: { _openBusyCount: 0, openFilesByPaths: (...args) => opened.push(args) },
    };
    try {
      const dispose = installTauriHomeScreenFileDrop(controller);
      await Promise.resolve();
      const drop = listeners["tauri://drag-drop"];
      const payload = { paths: ["/templates/home.psd"], position: { x: 200, y: 100 } };
      drop({ payload });
      assert.deepEqual(opened, [[["/templates/home.psd"], null]]);
      controller.fileLoader._openBusyCount = 1;
      drop({ payload });
      assert.equal(opened.length, 1);
      controller.fileLoader._openBusyCount = 0;
      drop({ payload: { ...payload, position: { x: 900, y: 100 } } });
      assert.equal(opened.length, 1);
      dispose();
      assert.deepEqual(Object.keys(listeners), []);
      drop({ payload });
      assert.equal(opened.length, 1);
    } finally { window.__TAURI__ = old; }
  });
});
