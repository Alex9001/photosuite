/**
 * Which panels are open, as it is stored between sessions.
 *
 * The stored shape is one entry per panel — `{ id, visible }` — rather than a
 * list of the open ones, so a panel the user closed is a recorded decision
 * rather than an absence. That distinction is what lets a newly installed
 * plugin open by default while a panel the user closed stays closed.
 *
 * An id is a built-in panel's number or a plugin's `plg_<id>` string. Entries
 * are kept across a session even when nothing claims them, so uninstalling a
 * plugin and putting it back does not lose how it was left; nothing reads an
 * entry it does not recognise, so a stale one costs nothing.
 *
 * Position and size are not stored yet. When they are, they become more fields
 * on the same entry — which is why this is a list of records and not a list of
 * ids.
 */

/**
 * @typedef {object} PanelLayoutEntry
 * @property {number|string} id Panel id, as the sidebar registry knows it.
 * @property {boolean} visible Whether the panel is open.
 */

/** Panel ids are numbers for built-ins and strings for plugins. */
function samePanelId(left, right) {
  return String(left) === String(right);
}

/**
 * The layout to store: every panel the app currently knows, plus any entry from
 * the previous layout whose panel is not registered in this session.
 *
 * @param {Array<number|string>} knownPanelIds Every registered panel.
 * @param {Array<number|string>} visiblePanelIds The open ones.
 * @param {PanelLayoutEntry[]} [storedLayout] The layout being replaced.
 * @returns {PanelLayoutEntry[]}
 */
export function buildPanelLayout(knownPanelIds, visiblePanelIds, storedLayout) {
  const layout = [];
  for (let idIdx = 0; idIdx < knownPanelIds.length; idIdx++) {
    const panelId = knownPanelIds[idIdx];
    if (layout.some((entry) => samePanelId(entry.id, panelId))) continue;
    layout.push({
      id: panelId,
      visible: visiblePanelIds.some((visibleId) => samePanelId(visibleId, panelId)),
    });
  }
  if (storedLayout == null) return layout;
  for (let entryIdx = 0; entryIdx < storedLayout.length; entryIdx++) {
    const entry = storedLayout[entryIdx];
    if (entry == null || entry.id == null) continue;
    if (knownPanelIds.some((panelId) => samePanelId(panelId, entry.id))) continue;
    // A panel this session does not have — a plugin that is not installed right
    // now. Carried through so reinstalling it restores how it was left.
    layout.push({ id: entry.id, visible: entry.visible === true });
  }
  return layout;
}

/**
 * Which of `knownPanelIds` should be open, reading the stored layout and
 * falling back to `defaultVisibleIds` for anything it does not mention.
 *
 * A stored entry naming a panel that no longer exists is skipped rather than
 * treated as an error: an uninstalled plugin must not stop the sidebar from
 * coming up.
 *
 * @param {PanelLayoutEntry[]|null} storedLayout
 * @param {Array<number|string>} knownPanelIds
 * @param {Array<number|string>} defaultVisibleIds
 * @returns {Array<number|string>}
 */
export function visiblePanelIdsFromLayout(storedLayout, knownPanelIds, defaultVisibleIds) {
  const visibleIds = [];
  for (let idIdx = 0; idIdx < knownPanelIds.length; idIdx++) {
    const panelId = knownPanelIds[idIdx];
    const entry = findLayoutEntry(storedLayout, panelId);
    const isVisible = entry != null
      ? entry.visible === true
      : defaultVisibleIds.some((defaultId) => samePanelId(defaultId, panelId));
    if (isVisible) visibleIds.push(panelId);
  }
  return visibleIds;
}

/**
 * The stored entry for one panel, or null when the layout does not mention it.
 * @param {PanelLayoutEntry[]|null} storedLayout
 * @param {number|string} panelId
 * @returns {PanelLayoutEntry|null}
 */
export function findLayoutEntry(storedLayout, panelId) {
  if (!Array.isArray(storedLayout)) return null;
  for (let entryIdx = 0; entryIdx < storedLayout.length; entryIdx++) {
    const entry = storedLayout[entryIdx];
    if (entry != null && entry.id != null && samePanelId(entry.id, panelId)) return entry;
  }
  return null;
}

/**
 * Whether a panel should be open on startup — for a panel that registers after
 * the layout was applied, such as a plugin discovered during launch.
 *
 * @param {PanelLayoutEntry[]|null} storedLayout
 * @param {number|string} panelId
 * @param {boolean} visibleByDefault
 * @returns {boolean}
 */
export function isPanelVisibleInLayout(storedLayout, panelId, visibleByDefault) {
  const entry = findLayoutEntry(storedLayout, panelId);
  return entry == null ? visibleByDefault === true : entry.visible === true;
}
