# Windows preview

Use the Night 0.5 release ZIP or the successful `Windows preview` Actions artifact. Extract the entire `Night` directory into a writable location and run `Night.exe`. A local `Night.lnk` shortcut and a separate `profile` directory are created beside it.

The Windows executable, icon, version resource, taskbar grouping and relaunch metadata identify Night. Pin the new Night window or use the new shortcut. A pin created for 0.2 still points at the old executable; remove that old pin yourself. Night does not alter pins belonging to other browsers.

To update an existing Night installation, close it and replace the application files from the new archive while retaining its `profile` directory. Alternatively, copy that profile beside the new Night.exe while both versions are closed. Keep a backup of the old folder. Each Night build has its own application BuildID so cached chrome from an earlier release is invalidated; the Gecko compatibility version stays unchanged.

The workspace selector is at the bottom of the sidebar. Pins are shared across workspaces. Right-click a tab for pinning, moving, muting and memory protection. Alt+P searches tabs, Alt+B toggles the sidebar, Alt+S splits or separates pages.

Use the toolbar autohide button or **Настройки → Внешний вид → Скрывать верхнюю панель** to reclaim the top strip. Ctrl+L or the top edge reveals the native address bar over the page; Escape returns to the page. Alt+Shift+F or the focus button beside the Night wordmark hides both panels. Repeat the shortcut or use the leftmost return button in the revealed toolbar to exit focus mode. The previous sidebar state is retained; only the autohide preference persists across restarts.

Settings open as a page: appearance, tabs, memory, privacy, search and about. Palette, density and sidebar width apply immediately. The memory section has an inactivity timeout and domain exceptions; per-tab exceptions remain in the tab context menu. Advanced engine controls remain available through “Все параметры”.

The request workbench opens below the page. Capture starts explicitly and is scoped to a selected tab. Closing capture or the workbench cancels held requests. Night is not a system proxy.

This portable preview is unsigned and has no automatic updater or default-browser installer. Gecko remains the official Firefox engine; Windows resources are changed to Night and the upstream certificate is removed from the modified EXE. Legal notices and exact upstream source references are retained in about:license, the Night about section and BUILD.json.

For migration from Zen, use **Переехать из Zen** or **Настройки → Переезд из Zen**. See [the import guide](ZEN_IMPORT.md) for what transfers, the replacement/backup behavior and recovery.
