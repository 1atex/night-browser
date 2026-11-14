# Night Browser ↔ Night Island

Proposal, not an implemented connection. Reference: Night Island commit `a4391355d8c05087ed3d8ccb30df41ef16879c94`.

## Start with media

Island already uses Windows GlobalSystemMediaTransportControlsSessionManager in `src/platform/media.rs`: session metadata, artwork, timeline, seeking and playback commands. Keep this system path for media from browser tabs. First verify YouTube and music with Night's Windows application identity, multiple media sessions and minimized windows. Playing tabs already have protection from automatic unloading.

A separate enhancement is “Open playing tab”: Island asks Night to focus the existing tab and its workspace. SMTC alone does not provide that tab mapping; it needs a browser connection. No duplicate playback widget in the browser is necessary.

## Downloads in the island

Night sends download start, bounded progress updates, completion and failure. Island shows a compact progress indicator; expanding exposes pause, resume, cancel and reveal-file actions supported by that specific download. Commands reference an opaque download ID, never arbitrary paths or shell commands. Finished items disappear after acknowledgement; opening a downloaded file always requires an explicit user action.

This is the first useful custom connection: the browser can stay minimized, and the user can follow long downloads without reopening it.

## Find an existing tab from Island

An explicit search action in Island queries open Night windows, spaces and saved tabs. Selecting a loaded tab focuses it; selecting a sleeping one activates it and restores its saved state. Search returns bounded results on demand, rather than continuously broadcasting browsing history. Private windows are excluded. Folder paths clarify identical page titles in different projects.

## Send selected text or a link to Island

A browser context-menu action sends the user's selection and optional source URL to an Island note. The user chooses this action; page contents are never scraped in the background. A note's source action opens its URL in Night or focuses the existing matching tab. Confirmation and undo belong in the destination UI.

Island has notes and clipboard facilities, but there is no browser import API yet. Its `WM_COPYDATA` handler currently routes Everything responses; this is not an existing general browser protocol.

## Connection and implementation order

1. Verify existing SMTC support and application identity, without a new helper process.
2. Add opt-in download events and commands.
3. Add on-demand tab search/focus and “Open playing tab”.
4. Add explicit note/link transfer if it proves useful in daily use.

For custom features, use a versioned Windows named pipe with an ACL restricted to the current user, peer identity checks, bounded message sizes and capability negotiation. Island hosts the endpoint while running. Night connects only when integration is enabled; it releases the connection when disabled and uses backoff when Island is absent. No extra daemon, local HTTP listener or permanent polling of all tabs is required. Events are coalesced and there are strict queue limits.

Expose separate settings for downloads, tab search and sending to notes. Do not send passwords, cookies, request headers, private tabs or a continuous page history. Validate URLs for navigation and use opaque session IDs for commands. Unknown versions and stale tab/download IDs fail without executing an action. Either application remains usable when the other is closed or uninstalled.

Measure CPU wakeups, resident/private memory and reconnect behavior with both applications minimized before enabling the connection by default. This proposal makes no RAM savings claim.
