/**
 * Tauri menu bridge (HTML bar hide, action/path dispatch, install).
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { EventType } from "../../../src/core/event-bus.js";

installBrowserGlobals();

let setHtmlMenuBarHidden;
let installTauriMenuActionBridge;
let installNativeMenuFromMenuBarData;
let refreshNativeMenuFromMenuBarData;
let isNativeMenuBarInstalled;
let PHOTOSUITE_MENU_ACTION_EVENT;
let PHOTOSUITE_CHROME_EVENT;

before(async () => {
  ({
    setHtmlMenuBarHidden,
    installTauriMenuActionBridge,
    installNativeMenuFromMenuBarData,
    refreshNativeMenuFromMenuBarData,
    isNativeMenuBarInstalled,
    PHOTOSUITE_MENU_ACTION_EVENT,
    PHOTOSUITE_CHROME_EVENT,
  } = await import("../../../src/ui/menu/tauri-menu-bridge.js"));
});

function installBodyClassList() {
  const classes = new Set();
  globalThis.document.body = {
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      has(name) {
        return classes.has(name);
      },
    },
  };
  return classes;
}

describe("ui/menu/tauri-menu-bridge.js", () => {
  it("export / event name goldens", () => {
    assert.equal(PHOTOSUITE_MENU_ACTION_EVENT, "photosuite:menu-action");
    assert.equal(PHOTOSUITE_CHROME_EVENT, "photosuite:chrome");
    assert.equal(isNativeMenuBarInstalled(), false);
  });

  it("setHtmlMenuBarHidden toggles body class", () => {
    const classes = installBodyClassList();
    setHtmlMenuBarHidden(true);
    assert.equal(classes.has("photosuite-hide-html-menu"), true);
    setHtmlMenuBarHidden(false);
    assert.equal(classes.has("photosuite-hide-html-menu"), false);
  });

  it("installTauriMenuActionBridge is a no-op without Tauri", () => {
    const dispose = installTauriMenuActionBridge({
      getMenuData: () => [],
      dispatchTarget: {},
    });
    assert.equal(typeof dispose, "function");
    dispose();
  });

  it("installNativeMenuFromMenuBarData resolves without Tauri", async () => {
    const result = await installNativeMenuFromMenuBarData({
      getMenuData: () => [],
    });
    assert.equal(result, undefined);
    assert.equal(await refreshNativeMenuFromMenuBarData({ getMenuData: () => [] }), undefined);
  });

  it("menu-action path payload dispatches resolved descriptor", async () => {
    installBodyClassList();
    const listeners = {};
    const events = [];
    const dispatchTarget = {
      dispatch(evt) {
        events.push(evt);
      },
    };
    globalThis.window.__TAURI__ = {
      event: {
        listen(name, handler) {
          listeners[name] = handler;
          return Promise.resolve(() => {
            delete listeners[name];
          });
        },
      },
    };
    const dispose = installTauriMenuActionBridge({
      getMenuData: () => [
        {
          menuActions: [{ appEventType: EventType.uiDispatch, payload: { dispatchKind: 1 } }],
        },
      ],
      dispatchTarget,
    });
    await Promise.resolve();
    listeners[PHOTOSUITE_MENU_ACTION_EVENT]({ payload: { path: [0, 0] } });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, EventType.uiDispatch);
    dispose();
    delete globalThis.window.__TAURI__;
  });

  it("menu-action descriptor payload dispatches without path", async () => {
    const listeners = {};
    const events = [];
    const dispatchTarget = {
      dispatch(evt) {
        events.push(evt);
      },
    };
    globalThis.window.__TAURI__ = {
      event: {
        listen(name, handler) {
          listeners[name] = handler;
          return Promise.resolve(() => {});
        },
      },
    };
    installTauriMenuActionBridge({
      getMenuData: () => [],
      dispatchTarget,
    });
    await Promise.resolve();
    listeners[PHOTOSUITE_MENU_ACTION_EVENT]({
      payload: {
        action: { appEventType: EventType.uiDispatch, payload: { ok: true } },
      },
    });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].data, { ok: true });
    delete globalThis.window.__TAURI__;
  });

  it("chrome hideHtmlMenuBar hides strip and fires resize", async () => {
    const classes = installBodyClassList();
    const listeners = {};
    let resized = false;
    globalThis.window.dispatchEvent = (evt) => {
      if (evt.type === "resize") resized = true;
    };
    globalThis.window.__TAURI__ = {
      event: {
        listen(name, handler) {
          listeners[name] = handler;
          return Promise.resolve(() => {});
        },
      },
    };
    installTauriMenuActionBridge({
      getMenuData: () => [],
      dispatchTarget: {},
    });
    await Promise.resolve();
    listeners[PHOTOSUITE_CHROME_EVENT]({ payload: { hideHtmlMenuBar: true } });
    assert.equal(classes.has("photosuite-hide-html-menu"), true);
    assert.equal(resized, true);
    delete globalThis.window.__TAURI__;
  });
});

describe("quit handshake", () => {
  it("enables interception only after the listener exists and acknowledges after dispatch", async () => {
    const old = window.__TAURI__;
    const calls = [];
    let quitHandler, finishRegistration;
    window.__TAURI__ = {
      core: { invoke: async (...args) => calls.push(args) },
      event: { listen: (name, handler) => {
        if (name === "photosuite:quit-requested") {
          quitHandler = handler;
          return new Promise(resolve => { finishRegistration = () => resolve(() => {}); });
        }
        return Promise.resolve(() => {});
      } },
    };
    try {
      const dispose = installTauriMenuActionBridge({ getMenuData: () => [], dispatchTarget: {
        dispatch: () => calls.push(["dispatch"]),
      } });
      await Promise.resolve();
      assert.deepEqual(calls, []);
      finishRegistration();
      await Promise.resolve();
      assert.deepEqual(calls, [["photosuite_quit_ready"]]);
      quitHandler({ payload: { requestId: 3 } });
      assert.deepEqual(calls.slice(1), [["dispatch"], ["photosuite_acknowledge_quit", { requestId: 3 }]]);
      dispose();
    } finally { window.__TAURI__ = old; }
  });
});

describe("menu bridge disposal", () => {
  it("removes late listener registrations without enabling quit interception", async () => {
    const old = window.__TAURI__;
    const registrations = [];
    const removed = [];
    const invoked = [];
    window.__TAURI__ = {
      core: { invoke: async (command) => invoked.push(command) },
      event: { listen: (name) => new Promise(resolve => {
        registrations.push(() => resolve(() => removed.push(name)));
      }) },
    };
    try {
      const dispose = installTauriMenuActionBridge({ getMenuData: () => [], dispatchTarget: {} });
      dispose();
      for (const register of registrations) register();
      await Promise.resolve();
      dispose();
      assert.deepEqual(removed, [
        "photosuite:menu-action", "photosuite:chrome", "photosuite:quit-requested",
      ]);
      assert.deepEqual(invoked, [], "a disposed quit listener must never announce readiness");
    } finally { window.__TAURI__ = old; }
  });

  it("ignores queued events after disposal, including quit acknowledgements", async () => {
    const old = window.__TAURI__;
    const classes = installBodyClassList();
    const listeners = {};
    const calls = [];
    window.__TAURI__ = {
      core: { invoke: async (command) => calls.push(command) },
      event: { listen: async (name, handler) => {
        listeners[name] = handler;
        return () => {};
      } },
    };
    try {
      const dispose = installTauriMenuActionBridge({ getMenuData: () => [], dispatchTarget: {
        dispatch: () => calls.push("dispatch"),
      } });
      await Promise.resolve();
      assert.deepEqual(calls, ["photosuite_quit_ready"]);
      dispose();
      calls.length = 0;
      listeners["photosuite:menu-action"]({ payload: {
        action: { appEventType: EventType.uiDispatch, payload: {} },
      } });
      listeners["photosuite:chrome"]({ payload: { hideHtmlMenuBar: true } });
      listeners["photosuite:quit-requested"]({ payload: { requestId: 9 } });
      assert.deepEqual(calls, [], "stale quit callbacks must leave native recovery active");
      assert.equal(classes.has("photosuite-hide-html-menu"), false);
    } finally { window.__TAURI__ = old; }
  });

  it("only removes its own listeners when the same target gets another bridge", async () => {
    const old = window.__TAURI__;
    const removed = [];
    let listenerId = 0;
    window.__TAURI__ = { event: { listen: async () => {
      const id = listenerId++;
      return () => removed.push(id);
    } } };
    try {
      const options = { getMenuData: () => [], dispatchTarget: {} };
      const disposeFirst = installTauriMenuActionBridge(options);
      await Promise.resolve();
      const disposeSecond = installTauriMenuActionBridge(options);
      await Promise.resolve();
      disposeFirst();
      disposeFirst();
      assert.deepEqual(removed, [0, 1, 2]);
      disposeSecond();
      assert.deepEqual(removed, [0, 1, 2, 3, 4, 5]);
    } finally { window.__TAURI__ = old; }
  });
});
