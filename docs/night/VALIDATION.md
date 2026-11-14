# Validation

`npm test` checks unloading policy, request validation, bounded history, channel suspension/redirect behavior and module integration. These tests do not substitute for a browser runtime.

## Native tests

```sh
python tests/native/smoke.py --binary /path/to/firefox --app-ini /path/to/browser/application.ini --preview
python tests/native/product.py --binary /path/to/firefox --app-ini /path/to/browser/application.ini --output test-artifacts
```

The smoke test uses a local HTTP server to verify real interception, method/header/UTF-8 body edits, replay, same-origin URL edits, unrelated-tab isolation, cancellation before transmission and safe native tab discard.

The product test checks the rendered Night home page, a Firefox WebExtension with a minimum Firefox version, workspace isolation, pins, moving tabs, two visible split panels, split unloading protection, workspace controls, filtering and new-tab controls. It restarts the browser and verifies workspace membership, pinning and the per-tab memory exception survive.

Windows also launches `Night.exe` from a Unicode path and checks the separate portable profile. Screenshots, logs and memory.json are uploaded as the `windows-preview-tests` Actions artifact.

## Memory measurement

```sh
python tests/native/memory.py --stock /path/to/stock/firefox --night /path/to/night/runtime/firefox --app-ini /path/to/night/runtime/browser/application.ini --output test-artifacts
```

Both browsers use fresh profiles on the same runner. Seven local pages each touch and retain a 32 MiB byte array. A real visible window is minimized before measuring the process tree. Five samples at one-second intervals are summarized by median. Night's idle clock advances 15 minutes, then safe discard runs while protecting the active tab and one explicit exception. No forced GC or working-set trimming is performed.

On Windows, `private_working_set_mib` is the sum of unique resident memory (USS) across processes, `working_set_mib` includes shared pages, and `private_bytes_mib` is commit. These values are not interchangeable. The result demonstrates behavior on a controlled workload; it is not a measurement of YouTube/ChatGPT/Censys, rendering speed or battery life. CI variability is expected; no fixed memory budget is enforced as a test.

For a personal workload, use equivalent extensions, pages and media state in separate profiles and sample all descendants with `scripts/measure-memory.ps1`. Measure before and after the configured inactivity timeout; keep page reload cost in the comparison.

## Published 0.2 result

Windows release [v0.2.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.2.0-preview.1), source `c0d8ba5226cbb321762fbb2dcf09c58570872b94`, passed all 37 Node checks, native smoke/product checks and the Unicode-path launcher test in [run 43369643347](https://github.com/1atex/night-browser/actions/runs/43369643347). The downloaded release ZIP passed SHA-256 and ZIP CRC verification.

SHA-256: `6a967545c8b09341f36a683391ce31345315983b5564b43d77b15c6efec5c398`.

The [published raw memory result](https://github.com/1atex/night-browser/releases/download/v0.2.0-preview.1/memory.json) uses the synthetic method above:

| Browser / phase | Private working set (MiB) | Total working set (MiB) | Private bytes (MiB) | Sleeping tabs |
| --- | ---: | ---: | ---: | ---: |
| Firefox, before | 697.26 | 1179.30 | 901.66 | 0 |
| Night, before | 697.80 | 1172.88 | 928.93 | 0 |
| Firefox, after settling | 618.67 | 1105.79 | 781.60 | 0 |
| Night, after idle discard | 469.84 | 880.85 | 624.32 | 5 |

The all-loaded private working sets were essentially equal in this run. The reduction comes from unloading inactive pages; this is not evidence of a faster renderer. The active tab and one manually protected tab remained loaded. Previous runs varied, so use the raw measurements and reproduce on the target machine before setting a product memory budget.

## Night 0.3 identity and interface checks

`tests/native/settings.py` checks every Night default against the running engine and exercises the actual settings page: live palette and density changes, memory timeout and domain persistence, all six sections, search-engine availability, a 980-pixel window and the advanced settings fallback. Gecko loads packaged preference files in reverse alphabetical order; `00-night.js` must load after upstream defaults. Checking only the generated file would miss upstream values replacing Night's startup settings.

`tests/native/first-launch.ps1` launches Night normally from a clean portable directory, with no headless or Marionette flags. It verifies the native PE name/version and absence of the old executable and invalid upstream certificate; inspects the final browser window's AppUserModelID, relaunch command, display name and icon; checks the accessible first-run UI and desktop for unsolicited OS pin prompts; captures the ordinary home/settings windows; then closes and relaunches through Night.lnk with the same profile. This validates the metadata Windows uses for pinning, not a simulation of the taskbar UI. Old user-created pins are not silently edited.

The startup test refreshes the Process window handle after the temporary startup window is replaced. Capturing a stale startup handle is not a valid branding test.

## Published 0.3 result

Windows release [v0.3.0-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.3.0-preview.2), source `d695ea7326aa73f5c3dc08ea61a75b880c558a75`, passed all 37 Node checks and the native smoke, product, settings, ordinary desktop startup, memory and launcher tests in [run 43375660472](https://github.com/1atex/night-browser/actions/runs/43375660472). The ordinary desktop check found no unsolicited Firefox pin notification. Night.lnk reopened the same portable profile with the same Night AppUserModelID.

The public ZIP was downloaded and verified against SHA-256 and ZIP CRC. It contains Night.exe and runtime/NightBrowser.exe, no firefox.exe or pre-created profile, the expected source revision and application BuildID `20261113060004`, and the final settings and preference bundle.

SHA-256: `9bcb9baf9e7ff5af868b3e4f3d3158a72ce50f6537b6b0995137d6de175f7a02`.

Actual ordinary Windows screenshots: [first launch](https://github.com/1atex/night-browser/releases/download/v0.3.0-preview.2/night-first-launch.png) and [Night settings](https://github.com/1atex/night-browser/releases/download/v0.3.0-preview.2/night-settings.png). These were visually inspected after downloading the published assets; they are not mockups or headless captures.

## Night 0.4 motion and migration checks

The 43 Node checks include session conversion, duplicate tab identities, workspace and pin migration, preference filtering and extension path relocation. `tests/native/motion.py` checks actual chrome animations during tab opening and workspace changes, waits for completion, then verifies zero idle animations and zero effects with either reduced-motion mode enabled.

`tests/native/zen_import.py` builds a profile in the checksum-pinned Zen 1.24.2b Windows runtime and imports it into Night. It verifies an encrypted password, bookmark, cookies and site storage, a signed uBlock Origin installation and its extension-local storage, two tabs and two workspaces. The source directory is renamed before Night starts, proving that the imported profile does not depend on its former path. Source file hashes remain unchanged, and the previous Night profile remains in its backup. The test also checks rejection of a running source and a newer-engine profile.

`tests/native/import-transaction.ps1` exercises incomplete staging, a locked Night profile, retained backups, and recovery from interruptions before and after the profile swap. Windows copying handles extended-length paths used by extension storage.

The full Windows checks passed for source `81ba7e49edc269af767e3562f3fccf81f0f8e1fc` in [run 43382324509](https://github.com/1atex/night-browser/actions/runs/43382324509). The migration fixture copied 72 files and restored both tabs and both workspaces. The motion result recorded six active opening animations, two workspace-switch animations, and zero for idle, disabled and system-reduced modes. Ordinary Windows settings and the migration page were visually inspected from the downloaded test artifact.

## Published 0.4 result

Windows release [v0.4.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.4.0-preview.1), source `3462e97b0354850b3213bba52dabacefbb3641fc`, passed all 43 Node checks and every Windows runtime check in [run 43383005899](https://github.com/1atex/night-browser/actions/runs/43383005899). Both packaging and publication completed successfully. The actual Zen migration test passed again, including its signed extension data and operation after the source path was moved.

The public 145,488,767-byte ZIP was downloaded and passed SHA-256 and ZIP CRC verification. Its 108 entries include Night.exe, the long-path configuration Night.exe.config and runtime/NightBrowser.exe, with no firefox.exe, pre-created profile or Zen test installer. BUILD.json identifies version 0.4.0, the source above and application BuildID `20261113070333`. The packaged browser archive includes both import modules, the updated settings and shell, and `00-night.js`.

SHA-256: `24ac77f33fdab4459410b99777c9b70bf27a702bd6df91d4da9488fb1d06dae1`.

Published evidence: [ordinary Windows settings](https://github.com/1atex/night-browser/releases/download/v0.4.0-preview.1/night-settings.png), [import page](https://github.com/1atex/night-browser/releases/download/v0.4.0-preview.1/night-import.png), [migration result](https://github.com/1atex/night-browser/releases/download/v0.4.0-preview.1/zen-import-result.json) and [motion result](https://github.com/1atex/night-browser/releases/download/v0.4.0-preview.1/motion.json). The ordinary settings screenshot was visually inspected after downloading the release.

## Night 0.5 browser chrome checks

`tests/native/chrome.py` checks the actual Gecko URL component's computed styles and the start-page search focus, rather than only checking stylesheet text. It loads a local HTTP site with a real favicon, changes its image, pins the tab and verifies rendered image loading. Night's internal tabs are checked separately.

Real keyboard and pointer actions verify Ctrl+L, Escape, top-edge reveal, native address navigation and Alt+Shift+F. The test measures the content rectangle: focus mode must fill the complete browser window, and revealing the toolbar must not resize that rectangle. It opens a native menu while the toolbar is hidden, exercises an F11 round trip, checks both animation disabling modes and restarts the browser to verify the autohide preference. Ordinary Windows startup also captures focus mode and its revealed address bar without automation flags.

## Published 0.5 result

Windows release [v0.5.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.5.0-preview.1), source `eb679fe416922a2dece665840a6e29919dd2df8c`, passed all 43 Node checks and the native runtime checks in [run 43387116867](https://github.com/1atex/night-browser/actions/runs/43387116867). The new chrome checks passed on Windows and Linux. The release also passed the existing real-Zen migration, transaction recovery, request tools, settings, motion, session restoration, memory and ordinary Windows launcher/identity checks.

The public ZIP was downloaded and passed SHA-256 and ZIP CRC verification: 145,496,542 bytes, 108 entries, product version 0.5.0 and application BuildID `20261113073334`. It contains the expected native executables/configuration, toolbar and import modules, final reduced-motion styles and Night preferences, with no pre-created profile, old firefox.exe or Zen test installer.

SHA-256: `662c69cea23b6b68d954181bcc2fd67a27f919dabd1ed71447dd356725318352`.

Published evidence: [first launch](https://github.com/1atex/night-browser/releases/download/v0.5.0-preview.1/night-first-launch.png), [focus mode](https://github.com/1atex/night-browser/releases/download/v0.5.0-preview.1/night-focus.png), [address overlay](https://github.com/1atex/night-browser/releases/download/v0.5.0-preview.1/night-address.png) and [chrome checks](https://github.com/1atex/night-browser/releases/download/v0.5.0-preview.1/chrome-result.json). Ordinary focus-mode/overlay captures were visually inspected from the Windows artifact, and first launch was inspected again from the public release.

## Published 0.5.1 result

Windows release [v0.5.1-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.5.1-preview.1), source `1b062062ccc3cb53ea9967e575c92962ec82f49c`, passed all 43 Node checks and the Windows runtime checks in [run 43389903326](https://github.com/1atex/night-browser/actions/runs/43389903326). Product, settings and chrome checks also passed locally on Linux. The product check now exercises clearing an empty tab-search result before continuing with the existing workspace and session checks.

The public ZIP passed SHA-256 and ZIP CRC verification: 145,494,322 bytes, 108 entries, version 0.5.1 and application BuildID `20261113075953`. Native executables, source revision and the bundled home/settings documents were checked after download.

SHA-256: `a30e4b65d854fec7a8d23f953908bd41a005fdf58882846ca02ca4e0bb54a008`.

Published [first launch](https://github.com/1atex/night-browser/releases/download/v0.5.1-preview.1/night-first-launch.png) and [settings](https://github.com/1atex/night-browser/releases/download/v0.5.1-preview.1/night-settings.png) were visually inspected. Routine surfaces use functional labels and icons without repeated wordmarks, slogans or permanent preview badges. Windows identity, the native internal-page identity indicator and the About page remain identifiable.

## Night 0.5.2 navigation checks

The chrome test opens the custom main menu while toolbar autohide is enabled, verifies its anchor remains visible, moves focus with the keyboard and checks Escape returns focus to its button. It invokes actual zoom/reset, page-find and DevTools commands. Existing address navigation, favicon, full-window geometry, native fullscreen, reduced-motion and persisted-setting checks continue to run.

The product fixture now has a real WebExtension action, icon, badge and popup. Pointer input opens the pinned action and its content, then the test unpins it and opens the unified extensions panel. This covers extension-owned UI alongside the browser's new controls. When every extension is pinned, Gecko deliberately opens the extensions manager instead of an empty panel.

The ordinary Windows launch check locates the menu through Windows accessibility APIs and opens it with native pointer input, then captures the whole native window, including its popup. It also captures the address suggestion surface. These captures do not use headless mode or Marionette.

## Published 0.5.2 result

Windows release [v0.5.2-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.5.2-preview.1), source `688cffb9e698f8c315734513bfc92c1c4815d6e7`, passed all 43 Node checks and every Windows runtime check in [run 43395201562](https://github.com/1atex/night-browser/actions/runs/43395201562). Packaging took 4m7s and publication 19s. The product and chrome checks also passed locally on Linux.

The public ZIP passed SHA-256, ZIP CRC and source-content verification after download: 145,501,034 bytes, 108 entries, product version 0.5.2 and application BuildID `20261113083850`. The custom menu, toolbar modules, final suggestion geometry styles, home/settings documents and navigation icons match the source. Native executables/configuration are present, with no pre-created profile, old firefox.exe or Zen installer.

SHA-256: `5987037642469900481d95c5f6970b00f7daf94f662eeebc9b0f7403771ad051`.

Published evidence: [own menu](https://github.com/1atex/night-browser/releases/download/v0.5.2-preview.1/night-menu.png), [address suggestions](https://github.com/1atex/night-browser/releases/download/v0.5.2-preview.1/night-suggestions.png), [first launch](https://github.com/1atex/night-browser/releases/download/v0.5.2-preview.1/night-first-launch.png) and [chrome checks](https://github.com/1atex/night-browser/releases/download/v0.5.2-preview.1/chrome-result.json). The ordinary Windows menu and suggestion captures were visually inspected from the matching source artifact; the menu was inspected again from the public release. Closing with Alt+F4 and shortcut relaunch passed without forcing process termination.

## Night 0.6 workspace and memory checks

`tests/native/sidebar.py` restores a converted Zen session with global favorites, workspace pins, nested/empty folders and cached icons. A local HTTP request log verifies that only the selected page loads: folding the tree, displaying saved icons, moving tabs/folders and repairing metadata do not load background pages. The test resizes the sidebar with pointer input, checks workspace isolation and cycle prevention, creates a pre-repair session backup and restarts the browser with all eight background tabs still pending.

The real Zen migration fixture also creates nested folders inside Zen and verifies their hierarchy and scoped pins after copying. `tests/native/preallocation.py` checks that the engine maintains one spare process, removes it when the settings switch is disabled, persists that choice through restart and recreates one when enabled. The memory workload includes an unprotected pinned tab and a protected pinned tab, repeats the unload scan and verifies that the former stays discarded while the latter stays loaded.

## Published 0.6 result

Release [v0.6.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.6.0-preview.1), source `238413d7cff0fc6de264d94ce37407ca8ca32c0d`, passed all 47 Node checks and all Windows runtime checks in [run 43561590180](https://github.com/1atex/night-browser/actions/runs/43561590180). The public ZIP passed SHA-256, CRC and comparison against 70 source files: 145,511,275 bytes, BuildID `20261114052636`, SHA-256 `71b8abbe89bac94bd747eadcd2bc23f8a84280c777fde8c412b11fb2d0a6ad77`.

The controlled memory run measured Night's private working set at 582.11 MiB before discard and 427.22 MiB after, with five background tabs pending. This is a synthetic workload, not the user's Gmail/YouTube/extensions profile.

## Night 0.7 interface checks

Chrome tests additionally verify live start-page palette changes, the current-site favicon in the address bar, expansion of the sidebar input without leaving the viewport, native navigation from the expanded input and accessibility of the connection/security panel. The displayed toolbar icons are checked against Night's icon resources, including the native download button.

Product tests check both empty and populated extension states. The empty panel must display the functional Night message and no upstream illustration. A real WebExtension still supplies its content script, badge, pinned action and popup. The start page is checked for absence of React/ReactDOM/Redux/ReactRedux globals; checking document script tags alone would miss Gecko's direct script-loader injection.

The normal Windows launch uses accessibility APIs and native pointer input to open the empty extensions panel and verify its text. Its screenshot includes the popup. Headless chrome screenshots alone do not capture native popup windows, so the ordinary Windows captures are the visual evidence for these surfaces.

Local Linux checks passed for native product, chrome, settings, motion and nested sidebar restore/drag operations. The ordinary Windows captures from `c7c5588` exposed the upstream fox illustration in the empty extensions panel; that finding was fixed before the final release. The unreleased `v0.7.0-preview.1` run was cancelled; its tag is retained in Git history.

## Published 0.7 result

Release [v0.7.0-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.7.0-preview.2), source `5beb1cd852d5f36e11ef8c8077d58f0453868f2f`, passed all 47 Node checks and every Windows runtime check in [run 43564369269](https://github.com/1atex/night-browser/actions/runs/43564369269). The preview job took 3m47s; publication took 17s.

The public ZIP passed SHA-256, ZIP CRC and comparison against 75 source files: 145,525,403 bytes, 111 entries, product version 0.7.0, BuildID `20261114060221`. The checks include bundled Material Symbols licensing, final localized site-security copy, the one-process reserve and the self-loading preference that prevents Activity Stream injection.

SHA-256: `f77f3839732aa575fc57b6df763bc1b491e9699a3b4b84d7e81de09e917b1e84`.

The published [first launch](https://github.com/1atex/night-browser/releases/download/v0.7.0-preview.2/night-first-launch.png), [extensions panel](https://github.com/1atex/night-browser/releases/download/v0.7.0-preview.2/night-extensions.png), [menu](https://github.com/1atex/night-browser/releases/download/v0.7.0-preview.2/night-menu.png) and [settings](https://github.com/1atex/night-browser/releases/download/v0.7.0-preview.2/night-settings.png) were inspected after download. These are ordinary Windows captures. The empty extensions panel has no upstream illustration; the initial address bar stays compact. Source checks and runtime tests validate the new behavior; the synthetic memory result remains distinct from a real-site performance claim.
