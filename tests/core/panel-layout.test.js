/**
 * The stored panel layout: which panels are open, kept between sessions.
 *
 * The shape is one entry per panel rather than a list of the open ones,
 * because "closed" has to survive a restart — a panel missing from a list of
 * open panels is indistinguishable from a panel the app has not heard of yet.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

let buildPanelLayout;
let visiblePanelIdsFromLayout;
let findLayoutEntry;
let isPanelVisibleInLayout;

before(async () => {
  ({ buildPanelLayout, visiblePanelIdsFromLayout, findLayoutEntry, isPanelVisibleInLayout } =
    await import("../../src/core/panel-layout.js"));
});

describe("core/panel-layout.js", () => {
  describe("buildPanelLayout", () => {
    it("records every known panel, open or closed", () => {
      const layout = buildPanelLayout([0, 2, "plg_ocr"], [0, "plg_ocr"]);
      assert.deepEqual(layout, [
        { id: 0, visible: true },
        { id: 2, visible: false },
        { id: "plg_ocr", visible: true },
      ]);
    });

    // Uninstalling a plugin must not throw away how its panel was left: put it
    // back and it should be where the user had it.
    it("carries forward an entry for a panel this session does not have", () => {
      const stored = [{ id: "plg_gone", visible: false }, { id: 0, visible: true }];
      const layout = buildPanelLayout([0], [0], stored);
      assert.deepEqual(layout, [
        { id: 0, visible: true },
        { id: "plg_gone", visible: false },
      ]);
    });

    it("does not record a panel twice when the registry repeats one", () => {
      assert.deepEqual(buildPanelLayout([3, 3], [3]), [{ id: 3, visible: true }]);
    });
  });

  describe("visiblePanelIdsFromLayout", () => {
    it("opens what the layout says, whatever the defaults are", () => {
      const stored = [{ id: 0, visible: false }, { id: 2, visible: true }];
      assert.deepEqual(visiblePanelIdsFromLayout(stored, [0, 2], [0]), [2]);
    });

    // The reported bug: a closed panel came back on the next launch.
    it("keeps a panel the user closed closed", () => {
      const stored = [{ id: 7, visible: false }];
      assert.deepEqual(visiblePanelIdsFromLayout(stored, [7], [7]), []);
    });

    it("falls back to the default for a panel the layout has never seen", () => {
      const stored = [{ id: 0, visible: true }];
      assert.deepEqual(visiblePanelIdsFromLayout(stored, [0, 5], [0, 5]), [0, 5]);
      assert.deepEqual(visiblePanelIdsFromLayout(stored, [0, 5], [0]), [0]);
    });

    // A settings file naming a plugin that is not installed must not stop the
    // sidebar coming up.
    it("ignores an entry for a panel that no longer exists", () => {
      const stored = [{ id: "plg_uninstalled", visible: true }, { id: 1, visible: true }];
      assert.deepEqual(visiblePanelIdsFromLayout(stored, [1], [1]), [1]);
    });

    it("survives a layout that is missing, empty or malformed", () => {
      assert.deepEqual(visiblePanelIdsFromLayout(null, [1], [1]), [1]);
      assert.deepEqual(visiblePanelIdsFromLayout([], [1], [1]), [1]);
      assert.deepEqual(visiblePanelIdsFromLayout([null, {}, "x"], [1], [1]), [1]);
    });

    // Built-in ids are numbers and plugin ids are strings; a settings file is
    // JSON, which does not always keep that difference.
    it("matches an id stored as a string against a numeric panel id", () => {
      assert.deepEqual(visiblePanelIdsFromLayout([{ id: "3", visible: false }], [3], [3]), []);
    });
  });

  describe("isPanelVisibleInLayout", () => {
    it("answers for a panel that registers after the layout was applied", () => {
      const stored = [{ id: "plg_ocr", visible: false }];
      assert.equal(isPanelVisibleInLayout(stored, "plg_ocr", true), false);
      assert.equal(isPanelVisibleInLayout(stored, "plg_new", true), true, "a new plugin opens");
      assert.equal(isPanelVisibleInLayout(null, "plg_new", true), true);
    });
  });

  it("findLayoutEntry returns the entry or null, never throws", () => {
    assert.deepEqual(findLayoutEntry([{ id: 4, visible: true }], 4), { id: 4, visible: true });
    assert.equal(findLayoutEntry([{ id: 4, visible: true }], 5), null);
    assert.equal(findLayoutEntry(undefined, 4), null);
  });

  // What a session does: read the layout, toggle a panel, write it back.
  it("round-trips a closed panel through a save and a reload", () => {
    const knownPanelIds = [0, 2, 7, "plg_ocr"];
    const defaults = [0, 2, 7, "plg_ocr"];

    let visible = visiblePanelIdsFromLayout(null, knownPanelIds, defaults);
    assert.deepEqual(visible, defaults, "a fresh install opens the defaults");

    visible = visible.filter((id) => id !== 7); // the user closes History
    const saved = buildPanelLayout(knownPanelIds, visible);

    const reopened = visiblePanelIdsFromLayout(saved, knownPanelIds, defaults);
    assert.deepEqual(reopened, [0, 2, "plg_ocr"], "the closed panel came back");
  });
});
