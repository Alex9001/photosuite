import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";

import {
  EDITOR_PERSISTED_PARAM_MAP,
  applyEditorParamsToPrefs,
  snapshotEditorParamsFromPrefs,
} from "../../src/core/editor-preferences.js";
import {
  installTauriWindowMock,
  makeMinimalAppController,
  makeMockSettingsStore,
} from "../helpers/minimal-app-controller.js";

let persistAppSettings;
let restoreWindow;

before(async () => {
  const mock = makeMockSettingsStore();
  restoreWindow = installTauriWindowMock({
    load() {
      return Promise.resolve(mock.store);
    },
  });
  const settingsMod = await import("../../src/core/app-settings.js");
  persistAppSettings = settingsMod.persistAppSettings;
});

after(() => {
  if (restoreWindow) restoreWindow();
});

describe("contract: app-settings ↔ editor prefs", () => {
  it("snapshotEditorParamsFromPrefs maps every persisted key", () => {
    const prefs = {
      guides: true,
      showGrid: false,
      gridSize: 20,
      gridUnits: 1,
      gridType: 0,
      AppWindow: 0,
      showSelectionEdges: true,
      paths: true,
      showPixelGrid: false,
      slices: true,
      gpuAcceleration: true,
      zoomWithScrollWheel: true,
      uiFontSize: 3,
    };

    assert.deepEqual(snapshotEditorParamsFromPrefs(prefs), {
      guides: true,
      grid: false,
      gsize: 20,
      gunits: 1,
      gtype: 0,
      runits: 0,
      sels: true,
      paths: true,
      pgrid: false,
      slices: true,
      gpu: true,
      zws: true,
      uifs: 3,
    });
  });

  it("applyEditorParamsToPrefs round-trips snapshot fields", () => {
    const prefs = {
      guides: false,
      showGrid: true,
      gridSize: 10,
      gridUnits: 2,
      gridType: 1,
      AppWindow: 1,
      showSelectionEdges: false,
      paths: false,
      showPixelGrid: true,
      slices: false,
    };
    const snapshot = snapshotEditorParamsFromPrefs(prefs);
    const restored = {
      guides: null,
      showGrid: null,
      gridSize: null,
      gridUnits: null,
      gridType: null,
      AppWindow: null,
      showSelectionEdges: null,
      paths: null,
      showPixelGrid: null,
      slices: null,
    };
    applyEditorParamsToPrefs(restored, snapshot);
    assert.deepEqual(restored, prefs);
  });

  it("persistAppSettings reads appData.prefs (not appController.prefs)", async () => {
    const mock = makeMockSettingsStore();
    const restore = installTauriWindowMock({
      load() {
        return Promise.resolve(mock.store);
      },
    });

    const appController = makeMinimalAppController();

    try {
      await persistAppSettings(appController);
      assert.deepEqual(
        mock.saved.eparams,
        snapshotEditorParamsFromPrefs(appController.appData.prefs)
      );
      assert.equal(mock.saved.theme, 2);
      assert.deepEqual(mock.saved.panels, [0, 1, 2]);
    } finally {
      restore();
    }
  });

  // Closing a panel is a setting. It used to live only in memory and reach the
  // file by accident, when some later change happened to save — so closing a
  // panel and quitting lost it.
  /**
   * A fresh module instance bound to a fresh store. `app-settings.js` memoises
   * the store it opened, so tests that share the module see one another's.
   */
  async function freshSettingsModule(caseName) {
    const mock = makeMockSettingsStore();
    const restore = installTauriWindowMock({ load: () => Promise.resolve(mock.store) });
    const module = await import("../../src/core/app-settings.js?case=" + caseName);
    return { mock, restore, persistAppSettings: module.persistAppSettings };
  }

  it("writes which panels are open, including ones that are not", async () => {
    const { mock, restore, persistAppSettings: persist } = await freshSettingsModule("panels");
    const appController = makeMinimalAppController({
      controller: {
        getRegisteredPanelIds: () => [0, 1, 2, 7, "plg_ocr"],
      },
    });

    try {
      await persist(appController);
      assert.deepEqual(mock.saved.panelLayout, [
        { id: 0, visible: true },
        { id: 1, visible: true },
        { id: 2, visible: true },
        { id: 7, visible: false },
        { id: "plg_ocr", visible: false },
      ]);
    } finally {
      restore();
    }
  });

  it("keeps an entry for a panel this session does not have", async () => {
    const { mock, restore, persistAppSettings: persist } = await freshSettingsModule("carry");
    const appController = makeMinimalAppController({
      appData: { storedPanelLayout: [{ id: "plg_uninstalled", visible: false }] },
      controller: { getRegisteredPanelIds: () => [0, 1, 2] },
    });

    try {
      await persist(appController);
      assert.deepEqual(mock.saved.panelLayout.at(-1), { id: "plg_uninstalled", visible: false });
    } finally {
      restore();
    }
  });

  // The window size and the editor state are unrelated, and the editor state is
  // the part that broke on launch — restoring one must not be hostage to the
  // other.
  it("restores the window size even when applying the editor state throws", async () => {
    const mock = makeMockSettingsStore();
    mock.saved.windowSize = { width: 1100, height: 700 };
    const invoked = [];
    const previousWindow = globalThis.window;
    globalThis.window = {
      __TAURI__: {
        store: { load: () => Promise.resolve(mock.store) },
        core: { invoke: (cmd) => { invoked.push(cmd); return Promise.resolve(); } },
      },
    };
    const { applyStoredSettingsOnStartup: applyStored } =
      await import("../../src/core/app-settings.js?case=resilience");

    try {
      await applyStored({
        appData: {},
        applyPersistedAppState() { throw new TypeError("as it did on every launch"); },
      });
      assert.ok(invoked.includes("photosuite_set_window_size"), "the window size was never restored");
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it("writes the window size only once something has recorded one", async () => {
    const { mock, restore, persistAppSettings: persist } = await freshSettingsModule("window");
    try {
      await persist(makeMinimalAppController());
      assert.equal("windowSize" in mock.saved, false, "nothing should be written before a resize");

      const sized = makeMinimalAppController({ appData: { windowSize: { width: 1200, height: 800 } } });
      await persist(sized);
      assert.deepEqual(mock.saved.windowSize, { width: 1200, height: 800 });
    } finally {
      restore();
    }
  });

  it("field map keys match snapshot output keys", () => {
    const snapshotKeys = Object.keys(
      snapshotEditorParamsFromPrefs(makeMinimalAppController().appData.prefs)
    );
    assert.deepEqual(snapshotKeys.sort(), Object.keys(EDITOR_PERSISTED_PARAM_MAP).sort());
  });
});
