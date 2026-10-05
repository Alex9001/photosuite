/**
 * color-controls pack/clamp / swatch default goldens.
 */
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

import { installBrowserGlobals } from "../../../helpers/stub-browser-globals.js";
import { EventType } from "../../../../src/core/event-bus.js";

installBrowserGlobals();

let packRgbChannels;
let unpackPackedRgb;
let clampByte;
let clampUnit;
let DEFAULT_SWATCH_COLORS;
let ColorSwatchGrid;
let ColorSampleWidget;
let ColorWheel;
let CropConstraintWidget;
let NamedColorPicker;
let NAMED_COLOR_LABEL_KEYS;
let NAMED_COLOR_VALUES;

before(async () => {
  ({
    packRgbChannels,
    unpackPackedRgb,
    clampByte,
    clampUnit,
    DEFAULT_SWATCH_COLORS,
    ColorSwatchGrid,
    ColorSampleWidget,
    ColorWheel,
    CropConstraintWidget,
    NamedColorPicker,
    NAMED_COLOR_LABEL_KEYS,
    NAMED_COLOR_VALUES
  } = await import("../../../../src/ui/widgets/controls/color-controls.js"));
});

describe("ui/widgets/controls/color-controls.js", () => {
  it("packRgbChannels / unpackPackedRgb round-trip", () => {
    assert.equal(packRgbChannels(255, 128, 0), 16744448);
    assert.deepEqual(unpackPackedRgb(0xff8000), { h: 255, l: 128, O: 0 });
    assert.deepEqual(unpackPackedRgb(packRgbChannels(12, 34, 56)), { h: 12, l: 34, O: 56 });
  });

  it("clampByte / clampUnit goldens", () => {
    assert.equal(clampByte(-1), 0);
    assert.equal(clampByte(300), 255);
    assert.equal(clampUnit(1.5), 1);
    assert.equal(clampUnit(-0.2), 0);
  });

  it("DEFAULT_SWATCH_COLORS golden head", () => {
    assert.deepEqual(DEFAULT_SWATCH_COLORS.slice(0, 3), [16711680, 65280, 255]);
    assert.equal(DEFAULT_SWATCH_COLORS.length, 9);
  });

  it("exports constructors", () => {
    assert.equal(typeof ColorSwatchGrid, "function");
    assert.equal(typeof ColorSampleWidget, "function");
    assert.equal(typeof ColorWheel, "function");
    assert.equal(typeof CropConstraintWidget, "function");
    assert.equal(typeof NamedColorPicker, "function");
  });

  // The picker speaks in colours, not in rows of its own list, so that a stored
  // colour decides what the list shows rather than the other way round.
  describe("NamedColorPicker", () => {
    it("names a colour it has a name for, and calls the rest Custom", () => {
      assert.equal(NAMED_COLOR_LABEL_KEYS.length, NAMED_COLOR_VALUES.length);
      const picker = new NamedColorPicker("colour.title");
      const customRow = NAMED_COLOR_VALUES.length;

      picker.setValue(NAMED_COLOR_VALUES[2]);
      assert.equal(picker.getValue(), NAMED_COLOR_VALUES[2]);
      assert.equal(picker.nameDropdown.getValue(), 2);

      picker.setValue(0x123456);
      assert.equal(picker.getValue(), 0x123456);
      assert.equal(picker.nameDropdown.getValue(), customRow);
      assert.equal(picker.swatch.getPackedRgb(), 0x123456);
    });

    it("picking a name is the choice; picking Custom only opens the picker", () => {
      const picker = new NamedColorPicker("colour.title");
      const changes = [];
      picker.on(EventType.widgetSelect, () => changes.push(picker.getValue()));

      picker.nameDropdown.setValue(3);
      picker.onNamePicked();
      assert.deepEqual(changes, [NAMED_COLOR_VALUES[3]]);

      let picksOpened = 0;
      picker.swatch.triggerColorPicker = () => picksOpened++;
      picker.nameDropdown.setValue(NAMED_COLOR_VALUES.length);
      picker.onNamePicked();
      assert.equal(picksOpened, 1);
      assert.deepEqual(changes, [NAMED_COLOR_VALUES[3]], "nothing is chosen until the picker answers");
      assert.equal(picker.nameDropdown.getValue(), 3, "a dismissed picker leaves the colour showing");
    });
  });
});
