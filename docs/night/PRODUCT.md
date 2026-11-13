# Product and architecture

Night targets Windows x64 and a 16 GB desktop with roughly seven tabs. Firefox provides Gecko, networking, process isolation, extension compatibility, permissions, browser history, bookmarks, downloads and DevTools. Night owns its sidebar, workspace model, tab controls, start page, unloading policy and request workbench.

The 0.2 tree contains no Zen shell or Zen build dependency. The earlier Zen-based prototype remains in Git history. The native engine comes from the official, checksum-pinned Mozilla release. Windows executable resources and its name are changed to Night; the modified executable is unsigned. This does not change Gecko's renderer.

## Components

- `NightShell.sys.mjs`: DOM-based chrome, keyed tab rows, search, pin/context actions, drag ordering, workspace controls and native split-view control. No framework or additional UI process.
- `NightWorkspaces.sys.mjs`: per-window workspace catalogue, per-tab membership, visibility and last selection. SessionStore persists both tab and window metadata. Pinned tabs are shared; deleting an area moves its tabs rather than closing them.
- `NightMemory.sys.mjs` and `MemoryPolicy.mjs`: one configurable idle policy, native safe discard, persistent per-tab exceptions, domain exceptions, media/call/intercept/split protections. Background session tabs restore on demand. No sandbox reduction or forced working-set trimming.
- `NightBrowser.sys.mjs`: lazy three-column request workbench below the page.
- `settings.xhtml`, `settings.js`, `settings.css`: Night settings at about:preferences, live appearance controls, memory rules, startup/privacy/search controls and about information. The original preferences remain an explicitly opened advanced page.
- `NightWindows.sys.mjs` and `Launcher.cs`: per-install Windows grouping, local shortcut, taskbar relaunch/name/icon properties and separate portable profile. The helper runs transiently per window, with no resident background service.
- `NightNetwork.sys.mjs` and `RequestModel.mjs`: selected-tab request capture, independent channel suspension, edits, replay, bounded in-memory history and responses.
- `start.html` and `start.css`: small clock/search start page served by Firefox's existing about:newtab/about:home mapping. One local clock script, no React bundle or sponsored feed UI.
- `scripts/preview/package.py`: version/checksum checks, explicit Firefox chrome integration points, policies, provenance and portable packaging. An unknown upstream layout fails the build.

Native navigation/security indicators remain visible. The normal address bar is not recreated. App compatibility version remains the pinned Firefox version so extension compatibility checks continue to work; Night's product version is in package.json, launcher and release metadata.

## Request scope

Capture starts explicitly and only observes the selected tab's browsing context and its subframes. Captured authentication stays within the original origin when editing. Closing capture, its panel, tab or window cancels paused requests; the 60-second deadline cancels instead of transmitting. At most eight requests are paused. Replays use anonymous channels without ambient cookies; explicit edited headers may be supplied. History is memory-only, up to 50 entries. Editable request bodies are UTF-8 text up to 64 KiB, responses up to 1 MiB. Binary uploads, response interception, WebSocket frames and cross-origin interception edits are not implemented.

## Remaining work

Real-site Windows performance profiling; wider extension compatibility testing; signed distribution and automatic security updates; installer/default-browser integration. Night Island integration has not been implemented; no background bridge/service is shipped. Current modules leave that as a separate service boundary.
