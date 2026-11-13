# Validation

## Automated checks

`npm run test:night` checks the unloading policy, request validation, bounded
history, channel lifecycle and source packaging. The channel tests use adapters;
they do not replace native browser tests.

The native smoke test uses a fresh temporary profile and a local HTTP server:

```sh
python -m pip install -r tests/native/requirements.txt
python tests/native/smoke.py --binary /path/to/night --log /tmp/night-smoke.log
```

Run it against a built browser containing the Night modules. It checks interception
before transmission, method/header/body editing, UTF-8 replay, same-origin URL
editing, unrelated-tab isolation, cancellation and native tab unloading. The idle
clock is advanced by the test; it does not claim a long-running memory benchmark.

The first module integration run uses Firefox 160.0 on Linux with Night modules
added to a disposable test runtime. This validates Gecko APIs, not the full Zen
shell, Windows packaging, add-on compatibility or performance.
On 2026-11-13, all six native scenarios above and all 37 standalone checks passed.

The in-tree browser test can also run after a native build:

```sh
cd engine
./mach test zen/tests/night/browser.toml --headless
```

## Experimental request tools

Set `night.network.enabled` to `true` in `about:config` for development testing.
Open **Night → Запросы**, select a web tab and explicitly start capture.
Starting another capture clears the previous history. Closing the panel cancels
held requests and clears history; nothing is saved to disk.

- Capture is scoped to one tab, including its frames.
- At most eight requests can wait for a decision. Additional requests are cancelled.
- A held request expires after 60 seconds and is cancelled.
- Editing/replay accepts HTTP(S). A captured request cannot change origin.
- Editable UTF-8 request bodies and headers are limited to 64 KiB.
- Replay runs at most two requests, times out after 30 seconds and shows up to 1 MiB of response data.
- Replays use explicitly supplied headers, the tab's principal and no ambient cookie/authentication lookup.
- Redirects from replay are not followed automatically.
- Response interception, WebSocket editing and full binary-body editing are not implemented.

Capture registers a WebRequest redirect listener to preserve ChannelWrapper
identity during redirects. Suspension uses the underlying channel's own counter,
so it does not resume an extension's suspension. URL edits are applied to the
replacement channel because Gecko can restore the original upload stream during
a redirect. Both listeners and held-channel references are released on stop.

## Windows memory comparison

Use separate, equivalent profiles in Night and unmodified Zen, the same extensions,
the same 5–7 tabs, and the same playback state. Keep one browser open per run.
Find the parent browser PID in Task Manager or the browser's process page.

```powershell
.\scripts\measure-memory.ps1 -RootProcessId 1234 -OutputPath zen-minimized.csv
.\scripts\measure-memory.ps1 -RootProcessId 5678 -OutputPath night-minimized.csv
```

The script samples the process tree every five seconds for ten minutes. It records
private working set, total working set and private committed bytes separately.
Summed total working set can double-count shared pages; use private working set
when comparing with Task Manager's private-memory column. The script has not yet
been exercised on Windows.

Repeat with active playback, paused YouTube, exclusions enabled and exclusions
disabled. Record restore latency and loss of page state as well as memory.
Unloading a tab requires reloading it when selected; arbitrary page state cannot
be guaranteed. No memory or rendering-speed improvement is currently established.
