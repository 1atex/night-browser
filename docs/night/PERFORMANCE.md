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

## YouTube memory investigation — 2026-11-15

The user screenshots show **1471.8 MB for the entire Zen group**, with **288.0 MB** in the process labelled with the video's title, and **990.0 MB for the Night group**, with **277.9 MB** in the YouTube-labelled process. Those are different workloads/profile states, not a controlled benchmark. Anonymous child processes cannot be classified from these screenshots. The labelled process is also not the full cost of playback: decoding, audio and graphics can live in other processes.

YouTube retains application objects, DOM, thumbnail images, comments and recommendations, compressed media segments and decoded frames. One 1920×1080 8-bit YUV420 frame is about 3 MiB; a 3840×2160 frame is about 12 MiB before implementation-dependent alignment/copies. Several reference/queued frames can coexist. These arithmetic examples do not identify how much of this user's measured memory belongs to frames.

The pinned Gecko source initializes Media Source eviction thresholds to **150 MiB for video and 20 MiB for audio** in [`TrackBuffersManager.cpp`](https://hg.mozilla.org/releases/mozilla-release/file/d84e7a6936554efe26097d9d9b24a0e11330e630/dom/media/mediasource/TrackBuffersManager.cpp). These are eviction thresholds, not upfront reservations, whole-tab limits, or guaranteed savings. Lower values can evict useful media and affect seeking/buffering; no global reduction is shipped without a playback regression test. `media.memory_cache_max_size` controls a different media-cache path and is not a reliable YouTube MSE memory knob.

A fresh-profile Linux headless attempt to open a public YouTube video failed with `proxyConnectFailure`, before any video element or playback existed. It provides **no valid YouTube memory measurement** and cannot establish savings on the user's Windows/GPU setup. No site CSS injection, periodic forced GC, process working-set trimming or disabling the GPU/Fission/JIT was introduced.

Useful existing controls:

- Night's default YouTube domain exceptions keep even paused background pages loaded. Removing `youtube.com` and `youtu.be` under Memory → Keep loaded permits ordinary idle unloading. Active, playing, PiP and explicitly protected tabs remain protected. A discarded page reloads on return; playback position is not guaranteed by this setting.
- YouTube's Ambient mode adds a background visual effect; it can be turned off in the player. This targets graphics work, with no guaranteed RAM reduction. See [YouTube's instructions](https://support.google.com/youtube/answer/12827017?co=GENIE.Platform%3DDesktop&hl=en).
- Lower video resolution reduces the dimensions of decoded frames and usually the bitrate, at a visible quality cost. Disable feed previews if they are not useful.
- Compare extensions separately with the same video, account, quality, viewport and playback position. Keep hardware acceleration enabled for the baseline; [Mozilla documents](https://support.mozilla.org/en-US/kb/firefox-uses-too-much-memory-or-cpu-resources) that it can reduce CPU and memory use.

The next valid experiment needs a real Windows playback baseline: identify all process roles in `about:processes`; collect `about:memory` and a Gecko profile; record codec, resolution, frame drops and buffered seconds; compare short and sustained playback plus seeking, including a slower network. Judge private working set and commit alongside smoothness. A flat stable allocation is different from growth after repeated videos. Do not infer a leak or an engine fix from a single Task Manager total.
