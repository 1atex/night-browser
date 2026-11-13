# Night Browser

## Product contract

- Windows desktop first, for machines with 16 GB of RAM.
- Firefox extensions, vertical tabs, pinned sites, workspaces and split view.
- Night Island graphite styling with Zen's layout and navigation.
- Configurable idle-tab unloading, persistent per-site and per-tab exceptions.
- Preserve active pages, split views, media playback, picture-in-picture, calls and intercepted requests.
- A developer workspace with request capture, editing, replay and request interception inside Night.
- Prepare for a future Night Island integration; no integration service in the initial release.

## Scope of the first source prototype

The Firefox-based Zen stable source is the initial foundation. Its existing
browser features remain available. Night-specific modules live in `src/zen/night`.
Network tools are experimental until tested in a native build; they must remain
off by default and must never start capture on browser startup.

Response interception, system-wide proxying, WebSocket frame editing and a
published update service are outside this first prototype. Request history is
session-only and bounded. Closing the tools must release observers and abort
requests waiting for a decision.

## Acceptance before a Windows preview

1. Build and launch on Windows with a separate Night profile.
2. Confirm Firefox add-ons, workspaces, pins and split view still work.
3. Verify idle unloading, exceptions, media/call protection and session restore.
4. Exercise request capture, editing, replay and abort against a local HTTP server.
5. Confirm no cross-window, container or private-session leakage in network tools.
6. Measure all browser processes against unmodified Zen on the same machine and profile.

Use the user's YouTube, ChatGPT and Censys workload with 5–7 tabs. Measure startup,
page responsiveness, memory after loading, memory after ten minutes minimized,
and tab restoration latency. Keep playback and paused-video runs separate.
No RAM reduction or rendering-speed improvement is claimed before these measurements.
