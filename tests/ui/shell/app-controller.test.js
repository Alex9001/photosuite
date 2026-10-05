/**
 * AppController shell: pure helpers (edge pan, doc index, cap blurb, file-loader ref).
 *
 * Golden values covering the module’s public behaviour.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";

installBrowserGlobals();

let computeEdgeAutoPanDeltas;
let scaleEdgeAutoPanForFrame;
let resolveCurrentDocFromOpenList;
let buildCapFormatBlurbHtml;
let createFileLoaderProcessRef;
let resolveScrollGestureToolId;
let UiCommand;
let KeyboardHandler;
let ToolId;
let CHROME_LAYOUT_NORMAL;
let CHROME_LAYOUT_MENU_ONLY;
let CHROME_LAYOUT_FULLSCREEN;
let FileLoader;
let AppController;

before(async () => {
  ({
    computeEdgeAutoPanDeltas,
    scaleEdgeAutoPanForFrame,
    resolveCurrentDocFromOpenList,
    buildCapFormatBlurbHtml,
    createFileLoaderProcessRef,
    resolveScrollGestureToolId,
    CHROME_LAYOUT_NORMAL,
    CHROME_LAYOUT_MENU_ONLY,
    CHROME_LAYOUT_FULLSCREEN,
    AppController
  } = await import("../../../src/ui/shell/app-controller.js"));
  ({ FileLoader } = await import("../../../src/ui/shell/file-loader.js"));
  ({ KeyboardHandler } = await import("../../../src/core/keyboard-handler.js"));
  ({ UiCommand } = await import("../../../src/core/event-bus.js"));
  ({ ToolId } = await import("../../../src/document/model/tool-base.js"));
});

describe("ui/shell/app-controller.js", () => {
  it("exports AppController and chrome layout mode constants", () => {
    assert.equal(typeof AppController, "function");
    assert.equal(CHROME_LAYOUT_NORMAL, 0);
    assert.equal(CHROME_LAYOUT_MENU_ONLY, 1);
    assert.equal(CHROME_LAYOUT_FULLSCREEN, 2);
  });

  it("computeEdgeAutoPanDeltas matches edge margins", () => {
    assert.deepEqual(
      computeEdgeAutoPanDeltas({ x: 4, y: 100 }, 800, 600),
      { scrollDeltaX: 12, scrollDeltaY: 0 }
    );
    assert.deepEqual(
      computeEdgeAutoPanDeltas({ x: 790, y: 10 }, 800, 600),
      { scrollDeltaX: 6, scrollDeltaY: 6 }
    );
    assert.deepEqual(
      computeEdgeAutoPanDeltas({ x: 400, y: 300 }, 800, 600),
      { scrollDeltaX: 0, scrollDeltaY: 0 }
    );
  });

  it("scaleEdgeAutoPanForFrame caps and flips away from top-left edge", () => {
    assert.deepEqual(
      scaleEdgeAutoPanForFrame(12, 0, { x: 4, y: 100 }),
      { scrollDeltaX: 5, scrollDeltaY: 0 }
    );
    assert.deepEqual(
      scaleEdgeAutoPanForFrame(10, 10, { x: 790, y: 590 }),
      { scrollDeltaX: -5, scrollDeltaY: -5 }
    );
  });

  it("resolveCurrentDocFromOpenList clamps activeDocIndex", () => {
    assert.deepEqual(resolveCurrentDocFromOpenList([], 0), {
      doc: null,
      activeDocIndex: 0
    });
    assert.deepEqual(resolveCurrentDocFromOpenList(["a", "b"], 9), {
      doc: "b",
      activeDocIndex: 1
    });
    assert.deepEqual(resolveCurrentDocFromOpenList(["a", "b"], -1), {
      doc: "a",
      activeDocIndex: 0
    });
    assert.deepEqual(resolveCurrentDocFromOpenList(["a", "b"], null), {
      doc: "a",
      activeDocIndex: 0
    });
  });

  it("buildCapFormatBlurbHtml matches narrow/wide strings", () => {
    assert.equal(
      buildCapFormatBlurbHtml(true),
      "Free online editor supporting <b>PSD</b>, <b>XCF</b>, <b>Sketch</b>, <b>XD</b> and <b>CDR</b> formats."
    );
    assert.equal(
      buildCapFormatBlurbHtml(false),
      "Free online editor supporting <b>PSD</b>, <b>XCF</b>, <b>Sketch</b>, <b>XD</b> and <b>CDR</b> formats. (<b>Adobe Photoshop</b>, <b>GIMP</b>, <b>Sketch App</b>,  <b>Adobe XD</b>, <b>CorelDRAW</b>)."
    );
  });

  it("createFileLoaderProcessRef exposes processLoadedBytes (not opaque qb)", () => {
    const ref = createFileLoaderProcessRef();
    assert.equal(ref.processLoadedBytes, FileLoader.processLoadedBytes);
    assert.equal(ref.qb, undefined);
  });

  // Restoring the layout reads the registered panels off the controller. It was
  // written as `this.getRegisteredPanelIds()` inside a plain function that is
  // handed the controller, so every launch threw and no stored setting applied.
  describe("applyPersistedAppState", () => {
    function layoutController(registeredPanelIds) {
      const controller = Object.create(AppController.prototype);
      controller.appData = { effectRows: [0, 1, 2], prefs: {}, storedPanelLayout: null };
      controller.getRegisteredPanelIds = () => registeredPanelIds;
      return controller;
    }

    it("opens the panels the stored layout says, and keeps the rest closed", () => {
      const controller = layoutController([0, 1, 2]);
      controller.applyPersistedAppState({
        panelLayout: [
          { id: 0, visible: true },
          { id: 1, visible: false },
          { id: 2, visible: true },
        ],
      });
      assert.deepEqual(controller.appData.effectRows, [0, 2]);
    });

    it("keeps the layout whole for panels that register later", () => {
      const controller = layoutController([0]);
      const layout = [{ id: 0, visible: true }, { id: "plg_ocr", visible: false }];
      controller.applyPersistedAppState({ panelLayout: layout });
      assert.deepEqual(controller.appData.storedPanelLayout, layout);
    });

    it("falls back to the older panels key when there is no layout", () => {
      const controller = layoutController([0, 1, 2]);
      controller.applyPersistedAppState({ panels: [1, 2] });
      assert.deepEqual(controller.appData.effectRows, [1, 2]);
    });
  });

  // WebKitGTK gives the paste event no image data for a picture copied in
  // another application, so on Linux a keyboard paste fell through to whatever
  // the internal clipboard still held — the image pasted the time before.
  // Edit > Paste asks the system clipboard first, which is why it was right and
  // Ctrl+V was a step behind.
  describe("onSystemPaste", () => {
    function pasteController(appData) {
      const dispatched = [];
      const controller = Object.create(AppController.prototype);
      controller.appData = appData;
      controller.toolRegistry = { entriesById: {} };
      controller.textInputTagNames = ["input", "textarea"];
      controller._pasteInFlight = false;
      controller.dispatch = (event) => dispatched.push(event);
      controller.dispatched = dispatched;
      return controller;
    }

    /** A paste event as WebKitGTK delivers it: no image on the transfer. */
    const emptyPasteEvent = () => ({ target: { tagName: "BODY" }, clipboardData: { items: [] } });

    it("asks the paste command to consult the system clipboard", () => {
      const controller = pasteController({ clipboardPixelPayload: { rect: {} }, pathClipboard: null });
      controller.onSystemPaste(emptyPasteEvent());

      assert.equal(controller.dispatched.length, 1, "nothing was dispatched");
      const data = controller.dispatched[0].data;
      assert.equal(data.dispatchKind, UiCommand.clipboardPasteLayers);
      assert.notEqual(
        data.skipInternalClipboard,
        true,
        "skipping the system clipboard is what pasted the previous image",
      );
    });

    // That handler takes the guard itself for the read it starts; held here it
    // would see the paste as re-entrant and drop it.
    it("releases the in-flight guard before handing the paste on", () => {
      const controller = pasteController({ clipboardPixelPayload: { rect: {} }, pathClipboard: null });
      let guardWhenDispatched = null;
      controller.dispatch = (event) => {
        guardWhenDispatched = controller._pasteInFlight;
        controller.dispatched.push(event);
      };
      controller.onSystemPaste(emptyPasteEvent());
      assert.equal(guardWhenDispatched, false, "the handler would refuse a paste it thinks is re-entrant");
    });

    it("still ignores a paste aimed at a text field", () => {
      const controller = pasteController({ clipboardPixelPayload: { rect: {} } });
      controller.onSystemPaste({ target: { tagName: "INPUT" }, clipboardData: { items: [] } });
      assert.deepEqual(controller.dispatched, []);
    });
  });

  // One wheel gesture, two meanings, and a preference that swaps them. The
  // router is the only place that decides, so this is the whole contract:
  // whichever tool it names acts on what it is handed.
  describe("resolveScrollGestureToolId", () => {
    // Built inside each test: the key constants arrive with the module import.
    const keyboardWith = (...pressedKeys) => ({
      isPressed: (key) => pressedKeys.indexOf(key) !== -1,
    });

    it("scrolls on a bare wheel and zooms on Alt by default", () => {
      assert.equal(resolveScrollGestureToolId(keyboardWith(), false, false), ToolId.TOOL_HAND);
      assert.equal(
        resolveScrollGestureToolId(keyboardWith(KeyboardHandler.Alt), false, false),
        ToolId.TOOL_ZOOM,
      );
      assert.equal(
        resolveScrollGestureToolId(keyboardWith(KeyboardHandler.Ctrl), false, false),
        ToolId.TOOL_HAND,
      );
    });

    it("swaps the two when Zoom with Scroll Wheel is on", () => {
      assert.equal(resolveScrollGestureToolId(keyboardWith(), false, true), ToolId.TOOL_ZOOM);
      assert.equal(
        resolveScrollGestureToolId(keyboardWith(KeyboardHandler.Alt), false, true),
        ToolId.TOOL_HAND,
      );
    });

    it("leaves Ctrl scrolling sideways under either setting", () => {
      const ctrl = keyboardWith(KeyboardHandler.Ctrl);
      assert.equal(resolveScrollGestureToolId(ctrl, false, true), ToolId.TOOL_HAND);
      assert.equal(resolveScrollGestureToolId(ctrl, true, true), ToolId.TOOL_HAND);
    });

    // A trackpad pinch reaches the app as a Ctrl-less wheel flagged by the host.
    it("zooms a reported pinch whatever the preference says", () => {
      assert.equal(resolveScrollGestureToolId(keyboardWith(), true, false), ToolId.TOOL_ZOOM);
      assert.equal(resolveScrollGestureToolId(keyboardWith(), true, true), ToolId.TOOL_ZOOM);
    });
  });
});
