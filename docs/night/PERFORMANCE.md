# Rendering work and engine performance

## Measured shell change, 2026-11-14

The sidebar previously traversed all tabs for each folder and rewrote unchanged text and attributes on every render. It now builds a parent/children layout once, preserves DOM nodes and updates only affected rows for tab attribute events. Structural changes still reconcile the tree. This reduces browser-main-thread work while pages are loading and keeps focus and row identity stable.

The local Linux headless test uses the same pinned Gecko 160 runtime, 100 restored tabs (99 sleeping), 20 folders, seven rounds of 20 full renders, and a burst of 100 identical tab-attribute notifications. Raw [before](performance/2026-11-14/before.json) and [after](performance/2026-11-14/after.json) reports are included.

| Measurement | Before | After |
| --- | ---: | ---: |
| Median full sidebar render | 3.17 ms | 0.48 ms |
| DOM mutations across 140 unchanged renders | 123,340 | 0 |
| DOM mutations for the single-tab event burst | 881 | 0 |
| Unrelated row text node preserved | No | Yes |
| Synthetic page JS median | 33 ms | 28 ms |
| Synthetic style/layout median | 63.5 ms | 59.5 ms |

The deterministic result is removal of unnecessary DOM work. Timings vary: an earlier baseline render median was 1.82 ms, and the event burst's frame-wait latency did not improve. The content timings do **not** establish faster JavaScript or CSS: Gecko/SpiderMonkey binaries are unchanged, runs are sequential on a shared machine, and this is not a real-site, GPU or Windows-user measurement. No engine speedup is claimed.

## Reproduce and guard regressions

```sh
python tests/native/rendering.py --binary /path/to/NightBrowser.exe --app-ini /path/to/browser/application.ini --output test-artifacts --optimized
```

Omit `--optimized` for an old build. The test also loads 1,200 local HTML cards, records navigation phases, sorts JS objects and alternates CSS followed by layout reads. Its assertions guard DOM churn and node preservation rather than a noisy milliseconds budget. The Windows preview workflow publishes `rendering.json` for every build.

## Engine optimization work

Page-level improvements require a reproducible slow path and a separately compiled engine candidate. Changing the branding or memory reserve does not change the parser or JIT. The next comparison should use matched Windows profiles/extensions and pinned workloads for Gmail, YouTube and ChatGPT alongside Speedometer, with warm/cold runs separated.

Capture profiles through the Gecko profiler (`about:profiling`) and separate main-thread script, GC/CC, style recalculation, layout, painting/compositing and network wait. Compare responsiveness and time to usable page along with process-tree memory; unloading a tab can reduce memory while adding a reload delay. Keep Fission, the sandbox and hardware acceleration enabled during baseline measurements.

Only then change the identified engine path, compile both variants with comparable optimization/PGO settings, and run correctness plus representative regressions. This release adds the baseline and removes shell overhead; it does not ship an unmeasured SpiderMonkey/HTML/CSS parser patch.

## Request retention and home lifecycle — 2026-11-15

`tests/native/shell_memory.py` compares the unchanged 0.10 baseline (`be5e373`) with the 0.11 implementation on the same pinned Gecko 160 Linux runtime. It allocates 50 distinct 64 KiB request bodies, measures five rounds after collection and compares ten 1 MiB responses per round. Forced collection is confined to this measurement fixture; product code never forces GC or trims process working sets.

| Metric | Before | After |
| --- | ---: | ---: |
| Median additional parent heap allocated while retaining history | 13,114,864 bytes | 798,720 bytes |
| Retained request count in this large-body fixture | 50 | 3 |
| Retained text budget (conservative two bytes per character) | 6,557,860 bytes | 393,474 bytes |
| Median comparison time per response | 15.01 ms | 3.90 ms |

Raw rounds: [before](measurements/2026-11-15-shell-before.json), [after](measurements/2026-11-15-shell-after.json). This is a deliberately heavy request-history workload, not a claim that Gmail, YouTube or the entire Windows browser now consumes 94% less RAM. The heap delta includes allocator/runtime activity and is not Task Manager's process-group total.

History now has both a 50-entry limit and a 512 KiB conservative retained-text budget. Oldest records are evicted first. Up to eight actively intercepted requests remain protected separately so reducing history cannot lose a suspended channel; the current editor/previous response are also separate. The limit is stated in the workbench UI. Completed held requests no longer keep evicted records in the channel lookup map.

Response comparison scans the common prefix without creating per-line arrays. Replays decode incoming UTF-8 incrementally instead of retaining chunks and allocating another full response byte buffer. The request selector reuses existing DOM options, and its stylesheet is attached only while the tool is open. Closed tab rows and the workspace's last-tab references are released immediately rather than waiting for a rendering frame. Home widgets unsubscribe when hidden; the clock stops when hidden or disabled; completed suggestion contexts are released.

Gecko's JIT, site isolation, sandbox and GPU rendering have not been weakened. Changing CSS colours or minifying source is not presented as a web-engine memory optimisation. The existing real Windows minimized-memory and rendering workloads remain in CI to catch regressions outside this synthetic measurement.
