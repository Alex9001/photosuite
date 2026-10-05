/**
 * PluginToolPanel overlay install + path append helper.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../helpers/stub-browser-globals.js";
import { clonePath } from "../../../src/engine/compositing/anti-alias.js";

installBrowserGlobals();

let installPluginToolOverlays;
let PluginToolPanel;

before(async () => {
  globalThis.Typr = {
    U: {
      pathToContext() {},
    },
  };
  ({ installPluginToolOverlays } = await import(
    "../../../src/ui/panels/plugin-tool-overlays.js"
  ));
  ({ PluginToolPanel } = await import("../../../src/ui/panels/plugin-tool-panel.js"));
  await import("../../../src/engine/layer-system.js");
});

describe("ui/panels/plugin-tool-overlays.js", () => {
  it("exports installPluginToolOverlays", () => {
    assert.equal(typeof installPluginToolOverlays, "function");
  });

  it("appendPathToCanvasContext begins a path and clones via antiAlias", () => {
    const calls = [];
    const canvasCtx = {
      beginPath() {
        calls.push("beginPath");
      },
    };
    const pathShape = { commands: ["M", "L"], coords: [0, 0, 10, 10] };
    PluginToolPanel.prototype.appendPathToCanvasContext.call({}, pathShape, null, canvasCtx);
    assert.deepEqual(calls, ["beginPath"]);
    assert.ok(clonePath(pathShape));
  });

  it("drawDocumentGrid strokes one set of lines per subdivision level", () => {
    const strokeStyles = [];
    const dashPatterns = [];
    const canvasCtx = makeGridContext(strokeStyles, dashPatterns);
    PluginToolPanel.prototype.drawDocumentGrid.call({}, gridDocument(), canvasCtx, 10, 10, {
      unitRgb: [1, 0, 0],
      opacity: 1,
      style: 1,
      subdivisions: 2,
      invertAgainstBackground: false,
    });
    assert.deepEqual(dashPatterns, [[4 / 8, 3 / 8]], "the style's dash pattern, in document units");
    assert.equal(strokeStyles.length, 2, "subdivision lines, then the gridlines over them");
    assert.equal(strokeStyles[0], "rgba(255,0,0,0.5)", "subdivisions are the fainter pass");
    assert.equal(strokeStyles[1], "rgba(255,0,0,1)");
  });

  // Subdividing a gridline that is already near the crowding limit would draw
  // the finer lines on top of each other, so they are dropped instead.
  it("drawDocumentGrid drops subdivisions that would crowd", () => {
    const strokeStyles = [];
    const canvasCtx = makeGridContext(strokeStyles, []);
    PluginToolPanel.prototype.drawDocumentGrid.call({}, gridDocument(), canvasCtx, 10, 10, {
      unitRgb: [.5, .5, .5],
      opacity: 1,
      style: 0,
      subdivisions: 40,
      invertAgainstBackground: false,
    });
    assert.equal(strokeStyles.length, 1);
  });
});

/** A 100x100 document at 8x zoom, the view the grid tests draw into. */
function gridDocument() {
  return { width: 100, height: 100, pathViewport: { zoomScale: 8 } };
}

/** A 2D context stub recording the stroke colour and dash pattern of each pass. */
function makeGridContext(strokeStyles, dashPatterns) {
  return {
    strokeStyle: "",
    save() {},
    restore() {},
    rect() {},
    clip() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    setLineDash(pattern) {
      if (pattern.length !== 0) dashPatterns.push(pattern);
    },
    stroke() {
      strokeStyles.push(this.strokeStyle);
    },
  };
}
