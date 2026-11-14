# Night Browser ↔ Night Island

## Implemented in 0.9 preview: downloads

Install the companion [Island browser preview](https://github.com/1atex/night-island/tree/feature/browser-downloads). Enable **Night Browser downloads** in Island's integration settings, then **Настройки → Интеграции → Показывать загрузки в Island** in the browser. Both settings default to off.

A download appears in the existing Island pill. Its Downloads tab provides pause, resume, cancel and reveal-in-folder when supported by the download's current state. Completed files are not executed. Horizontal and vertical docking are supported. Private downloads are excluded; only a sanitized basename, opaque ID, state and byte counts are sent. URLs, full paths, cookies and request headers stay in the browser.

The current session retains at most 32 items, dropping older finished items first. Existing active or resumable downloads join when enabled; completed history is not imported. Disabling clears the connection's in-memory list. Closing Island does not interrupt downloads. A single browser process can connect, including all its windows; simultaneous separate profiles are not yet multiplexed.

## Transport

Island hosts `\\.\pipe\NightIsland.Browser.v1.<SID>`. The pipe rejects remote clients, uses a current-user ACL, and both sides check the peer's SID and executable basename. These checks are not protection against a malicious process already running as the same user and able to impersonate the application.

Messages are newline-delimited JSON with version 1 and a downloads capability handshake. Frames are bounded to less than 32 KiB, commands are bounded and reference existing opaque IDs, and actions are rechecked against current download state. No arbitrary file paths or shell commands are accepted. Duplicate request IDs and stale asynchronous responses cannot replay actions into a reconnected session.

Both sides use overlapped Windows IO and completion ports. The browser has one worker while enabled; Island has one waiting thread, without a helper process or TCP listener. Unchanged snapshots are not sent. Download changes are coalesced over 500 ms; reconnect attempts back off from 1 to 30 seconds when Island is absent. Disabling cancels pending IO and releases the connection.

`tests/native/island.py` launches both real applications on Windows, downloads from a local server, and clicks Island's actual controls. It checks private exclusion, pause/resume/cancel, disable/re-enable, restart/reconnect, completion and reveal. The Island fixture's demo build exposes only UI geometry and state to the test file; commands still travel through native pointer input and the production pipe. The shipped Island executable is built without demo.

## Next slices

- **Media:** Island already uses Windows SMTC for playback controls. Verify Night's app identity and multiple sessions before adding anything. An explicit “Open playing tab” action would need an opaque tab mapping over this connection.
- **Find a tab:** query bounded results on demand, with workspace and folder paths; selecting a sleeping tab restores it. Private windows remain excluded. No continuous transmission of browsing history.
- **Send to notes:** an explicit browser context-menu action sends selected text/link to an Island note, with source and undo. No background extraction from pages.

Each future capability should have its own opt-in. Idle CPU wakeups and memory overhead need representative desktop measurement before considering default enablement; this preview makes no RAM-saving claim for integration.
