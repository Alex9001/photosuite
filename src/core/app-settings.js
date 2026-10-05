/**
 * Tauri plugin-store persistence for application settings and editor prefs sync.
 */

import { Locale } from "./i18n/locale.js";
import { snapshotEditorParamsFromPrefs } from "./editor-preferences.js";
import { buildPanelLayout } from "./panel-layout.js";
import { getWindowSize, setWindowSize } from "./tauri-host.js";

/** Persisted under app_data_dir; see tauri-plugin-store. */
export const APP_SETTINGS_FILE = "settings.json";

const SETTINGS_VERSION = 1;

/** @type {Promise<import("@tauri-apps/plugin-store").Store> | null} */
let settingsStorePromise = null;

function getTauriStoreApi() {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  return tauri && tauri.store ? tauri.store : null;
}

async function openSettingsStore() {

  const storeApi = getTauriStoreApi();
  if (!storeApi || typeof storeApi.load !== "function") return null;

  if (!settingsStorePromise) {
    settingsStorePromise = storeApi.load(APP_SETTINGS_FILE, {
      autoSave: 100,
    });
  }

  return settingsStorePromise;
}

/** Copy store keys into the launch `environment` object shape when present. */
async function readEnvironmentFieldsFromStore(store) {
  const state = {};
  const lang = await store.get("lang");
  const theme = await store.get("theme");
  const panels = await store.get("panels");
  const panelLayout = await store.get("panelLayout");
  const windowSize = await store.get("windowSize");
  const eparams = await store.get("eparams");

  if (lang != null) state.lang = lang;
  if (theme != null) state.theme = theme;
  if (panels != null) state.panels = panels;
  if (panelLayout != null) state.panelLayout = panelLayout;
  if (windowSize != null) state.windowSize = windowSize;
  if (eparams != null) state.eparams = eparams;

  return Object.keys(state).length !== 0 ? state : null;
}

/**
 * Reads disk settings and returns a plain object for
 * {@link AppController.prototype.applyPersistedAppState}.
 * Keys match the launch `environment` payload (`lang`, `theme`, `panels`, `eparams`, …).
 */
export async function loadPersistedAppStateFromStore() {
  const store = await openSettingsStore();
  if (!store) return null;
  return readEnvironmentFieldsFromStore(store);
}

/**
 * Every panel the app knows and whether it is open, for `panelLayout`.
 *
 * `panels` is still written beside it: it is the list this app has always
 * stored, and a version that only knows that key must keep working if the user
 * goes back to it.
 */
function buildPanelLayoutSnapshot(appController) {
  const appData = appController.appData;
  const knownPanelIds = typeof appController.getRegisteredPanelIds === "function"
    ? appController.getRegisteredPanelIds()
    : appData.effectRows.slice();
  return buildPanelLayout(knownPanelIds, appData.effectRows, appData.storedPanelLayout);
}

/** Snapshot editor prefs from the live controller into `eparams` for persistence. */
function buildEditorParamsSnapshot(prefs) {
  return snapshotEditorParamsFromPrefs(prefs);
}

/**
 * Snapshots user-facing prefs from the live controller into the store file.
 * Does not write `filesystem` — the Rust open dialog owns `lastOpenDirectory`.
 */
export async function persistAppSettings(appController) {

  const store = await openSettingsStore();
  if (!store) return;

  const appData = appController.appData;
  if (!appData || !appData.prefs) return;

  await store.set("version", SETTINGS_VERSION);
  await store.set("lang", Locale.getCurrentLanguageCode());
  await store.set("theme", appData.theme);
  await store.set("panels", appData.effectRows.slice());
  await store.set("panelLayout", buildPanelLayoutSnapshot(appController));
  if (appData.windowSize != null) await store.set("windowSize", appData.windowSize);
  await store.set("eparams", buildEditorParamsSnapshot(appData.prefs));
  await store.save();
}

/**
 * Record the window's current size so the next launch opens at it.
 *
 * Reads the size from the host rather than the webview, so the number stored is
 * the one the window manager will be given back. Saving is left to whatever
 * writes the settings next — a resize is not worth a disk write of its own.
 *
 * @param {object} appController
 * @returns {Promise<void>}
 */
export async function captureWindowSize(appController) {
  const size = await getWindowSize();
  if (!Array.isArray(size) || !(size[0] > 0) || !(size[1] > 0)) return;
  appController.appData.windowSize = { width: Math.round(size[0]), height: Math.round(size[1]) };
}

/**
 * Open the window at the size the last session left it.
 * @param {object} storedState
 * @returns {Promise<void>}
 */
export async function applyStoredWindowSize(storedState) {
  const stored = storedState == null ? null : storedState.windowSize;
  if (stored == null || !(stored.width > 0) || !(stored.height > 0)) return;
  await setWindowSize(stored.width, stored.height);
}

/**
 * Loads store settings into the controller, then continues startup.
 * URL / query-string launch config still wins when present (applied afterward).
 */
export async function applyStoredSettingsOnStartup(appController) {
  let storedState = null;
  try {
    storedState = await loadPersistedAppStateFromStore();
  } catch (err) {
    console.warn("PhotoSuite: failed to read app settings", err);
    return;
  }
  if (storedState == null) return;

  // Applied separately: the window size and the editor state are unrelated, and
  // one of them failing is not a reason to leave the other at its default.
  try {
    appController.applyPersistedAppState(storedState);
  } catch (err) {
    console.warn("PhotoSuite: failed to apply stored app settings", err);
  }
  try {
    await applyStoredWindowSize(storedState);
  } catch (err) {
    console.warn("PhotoSuite: failed to restore the window size", err);
  }
}
