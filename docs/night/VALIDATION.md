# Validation

`npm test` checks unloading policy, request validation, bounded history, channel suspension/redirect behavior and module integration. These tests do not substitute for a browser runtime.

## Profile and account checks

`tests/native/accounts.py` presses real Ctrl+Shift+N, verifies private cookie isolation, waits for the last-private-context shutdown, reopens a private window and checks that private cookies/history are absent. It checks that private windows cannot enable Sync and that normal settings do not enable it merely by opening. An explicit click initializes native FxA/WebChannel and opens the official account URL. It inspects a real native Sync preferences record for Night palette/navigation values and excluded Island settings. Remote-page completion is recorded separately because external TLS/network availability is not a local feature assertion. No real Mozilla account is supplied; authenticated two-device synchronization is not tested.

`tests/native/profiles.py` runs two visible Windows browser processes through the actual launcher. Fixture passwords, bookmarks, cookies, localStorage, a temporary extension and palette settings must remain separate. It switches back to an existing window, routes an external URL to the selected profile, rejects invalid IDs and restarts the last-selected profile with its saved storage. Installer tests also verify that the installed profile is recognized in LocalAppData. The actual Zen import fixture checks that the source account file is unchanged and is not copied to Night.

## Home and native surface checks

`tests/native/home_ux.py` clicks the real sidebar new-tab control, types without another click, changes widget visibility and checks persistence in another new tab. It collapses a workspace containing a folder, checks its saved session data and verifies that the active tab is unchanged. The compact address check opens the actual native permission popup and checks that detailed mode restores its indicator. The active-sharing visibility assertion uses an attribute fixture; it does not exercise capture hardware.

`tests/native/surfaces.py` opens eleven browser-owned pages, switches their palettes live, checks preserved configuration warnings and confirms that an ordinary web page receives no Night styles. It also opens the real Library, Page Info, About and DevTools console, checks the find bar, and confirms that closing the request workbench releases its stylesheet. The local audit separately opened and cancelled an actual print preview; Windows print layout and OS file pickers are outside this automated surface suite.

`tests/native/island_hub.py` additionally opens the real Island Pocket from the new Home widget. Hidden Home clocks and widget preferences have unit checks. Request-history byte retention and comparison of empty, trailing-newline and long responses are covered by the 67 Node checks; the separate native allocation measurement is documented in [PERFORMANCE.md](PERFORMANCE.md).

## Search and Island hub checks

`tests/native/search.py` exercises the packaged start page against actual Places history, cached favicons and a local OpenSearch suggestion server. It checks keyboard selection, navigation, Escape/outside dismissal, delayed-response rejection and the network-suggestion preference. Native address checks cover repeated Ctrl+L/Escape and focus restoration after animated expansion. These fixtures do not depend on a public search engine's current responses.

`tests/native/island_hub.py` runs a real Windows Island process alongside Night. Native global hotkeys and clicks search a sleeping tab with a nested folder path and cached favicon; a local HTTP log proves that search alone does not load it. The test saves a real page selection through its context menu, removes/undoes it, converts it into a note and restarts Island before checking persistence. Native OLE pointer input drags a link into Pocket. It excludes a private browser window and exercises the native activity mute button with a tab-audio state fixture.

Actual intercepted HTTP requests test all three Island actions. Forward must preserve the original upload and header; edit must focus the matching browser editor; reject must send nothing. Camera/microphone capture hardware and every possible media application are not covered by this fixture. Pocket stores image URLs rather than image files.

The native drag fixture records both processes' Windows integrity levels and requires them to match. GitHub's elevated runner starts the fixture browser with `-no-deelevate`; otherwise Gecko lowers its own integrity while Island inherits the runner's level and Windows blocks OLE across that boundary. This argument exists only in the test, not in the product launcher or installer.

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

## Night 0.8 setup and saved-tab checks

The installer check exercises silent per-user installation, browser URL registration, a profile outside the application directory, in-place upgrade, a Unicode file URL and uninstall. Upgrade and uninstall preserve the profile. The portable launcher remains a separate tested path.

The onboarding check changes appearance preferences, completes the wizard and restarts to verify that it does not repeat. A persisted upstream skeleton preference is reset. The ordinary Windows launch test seeds the per-executable skeleton cache, checks its removal and captures the early window frame and first-run page. It also uses native pointer input to maximize, restore and minimize the window. The automated control test checks the upper-right position, hover reveal and the always-visible setting.

The real Zen fixture imports through the first-run wizard, including explicit consent, progress and restart. Existing encrypted login, cookie, extension-storage, nested-folder, scoped-pin, backup and source-preservation assertions remain active. Appearance choices survive the import and completion is not lost after profile replacement.

The saved-tab test cancels a real before-unload prompt, retries unloading, restarts with the folder entry still sleeping, restores a typed draft on activation, explicitly removes a saved entry and closes an ordinary tab. It uses BiDi because classic Marionette accepts before-unload prompts automatically. Before native pointer actions, the test waits for the sidebar row itself to render; a title update alone is insufficient.

Local Linux onboarding, saved-tab and nested-sidebar checks passed. The complete Windows branch run [43570061876](https://github.com/1atex/night-browser/actions/runs/43570061876) passed all 47 Node checks and every native check at revision `dc9292e82af70b48e38b6df950bd6e8627ee4f2c`. The first-run, window-control and sleeping-folder captures were visually inspected. Sleeping rows have a visible fallback favicon and a state badge; feedback from a cancelled unload clears on a subsequent successful attempt.

## Published 0.8 result

Release [v0.8.0-preview.3](https://github.com/1atex/night-browser/releases/tag/v0.8.0-preview.3), source `dc9292e82af70b48e38b6df950bd6e8627ee4f2c`, passed all 47 Node checks and every Windows runtime check in [tag run 43570592429](https://github.com/1atex/night-browser/actions/runs/43570592429). The run was initially cancelled after the same revision passed on the branch, then rerun in full to publish through Actions when direct release uploads failed authentication. Both build and publication jobs completed successfully. The public binaries come from this tag run, not the earlier branch artifact. The unpublished preview 2 tag is retained in history; its sidebar-render timing race was fixed before preview 3.

Both public binaries were downloaded after publication and passed SHA-256 verification. The ZIP additionally passed CRC and comparison against 80 source files at the tag, including the initial-paint guard and skeleton preference. It contains 111 entries, version 0.8.0 and BuildID `20261114071317`, with no pre-created profile or installed marker. Native executable names, launcher configuration and process-reserve preferences were checked.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Portable ZIP | 145,535,442 | `c5c3b3b8c6fcbaf2c4ff30c59d9ee6f91906b3602d41a7c452a743f62a17888e` |
| Windows installer | 135,424,060 | `b8b4c245e2a88669103274178b88ae8d9c87ffeb07169b99980fa87fcdbcb0bb` |

The public [ordinary first-run capture](https://github.com/1atex/night-browser/releases/download/v0.8.0-preview.3/night-first-launch.png), [window controls](https://github.com/1atex/night-browser/releases/download/v0.8.0-preview.3/night-window-controls.png) and [sleeping folder tab](https://github.com/1atex/night-browser/releases/download/v0.8.0-preview.3/night-sleeping-folder.png) were visually inspected after download. The latter two come from automated tests; their striped address-bar indicator belongs to Marionette. Installer, onboarding, saved-tab and Zen migration result files ship alongside the binaries. This verifies the tested Windows environment and fixtures, not every GPU configuration or the user's real profile.

## Published 0.9 result

[Browser v0.9.0-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.9.0-preview.2) was built from `69c6bfa6daee300a79668c19e4621a82965a3ff0` in [Windows tag run 43609825723](https://github.com/1atex/night-browser/actions/runs/43609825723). Both the preview and publication jobs passed. All 52 Node checks and the full native suite passed, including first-run/installer, import, saved tabs, pointer interactions, rendering, ordinary Windows startup, memory and launcher checks.

The paired [Island v0.3.1-browser-preview.3](https://github.com/1atex/night-island/releases/tag/v0.3.1-browser-preview.3) uses `02e0aa2e5f1c36cf0d98eeac982bd6126a9dcfdc`. [Island tag run 43609824247](https://github.com/1atex/night-island/actions/runs/43609824247) passed 238 Rust tests with 15 existing ignored tests and built the release executable without demo hooks.

`tests/native/island.py` launches both actual applications and clicks Island's native buttons. It verifies the handshake, public progress, private-download exclusion, pause/resume/cancel, disabled connection and released worker, reconnect after Island exits/restarts, completion and reveal-in-folder. Cancellation drains IO completion packets before freeing buffers on both sides. The focused test also passed in [run 43609622397](https://github.com/1atex/night-browser/actions/runs/43609622397).

The published installer, portable ZIP and Island executable were downloaded and matched their release SHA-256 files. ZIP CRC passed. The embedded BUILD.json identifies the expected Night commit, version and pinned Gecko revision; the packaged pipe worker contains the tested completion-draining shutdown. Onboarding and Island download captures were visually inspected. Synthetic rendering results and their limitations are documented in [PERFORMANCE.md](PERFORMANCE.md); no Gecko/SpiderMonkey speedup is claimed.

| File | SHA-256 |
| --- | --- |
| Portable ZIP | `b38538e601256842ae6a4a6d0d2831b12b5578e35bb5c485e7ac56a10a1b26f5` |
| Windows setup | `481471dc6ce338f54e9f9ae7208fc8035e662590b9c220b635ddf1236b44c865` |
| Island EXE | `c96d13087a44fcba8a29d2142d0592de8b02e13f614fa1e7b8d8fd4ceacc5dcb` |

## Published 0.9.1 result

[Browser v0.9.1-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.9.1-preview.2) was built from `0713d60e2febe17d724eadf99727baeb37971f78` in [Windows tag run 43638521985](https://github.com/1atex/night-browser/actions/runs/43638521985). All 53 Node checks, the full native Windows suite and publication passed. The first 0.9.1 tag was cancelled before publication after a native test clicked during the collapse transition. The test now waits for settled geometry and separates a click from hover expansion. The corrected focused run [43638360529](https://github.com/1atex/night-browser/actions/runs/43638360529) and the complete tag run both passed.

The paired [Island v0.3.2-browser-preview.1](https://github.com/1atex/night-island/releases/tag/v0.3.2-browser-preview.1) was built from `55afc0f34a6f3e161f4e9358e1a06a0154991dd2` in [tag run 43638024187](https://github.com/1atex/night-island/actions/runs/43638024187). It includes the requested `7d9bc801af2e41627ad7d15a6d2400bbda150aca` foundation through a history-preserving merge. Formatting, Clippy with warnings denied and 554 Rust tests passed; 119 pre-existing tests remain ignored. Browser workflows load the companion pin from `scripts/preview/island.json` and assert this ancestor before testing.

The cross-app test checks indicator navigation, progress, pause/resume/cancel, in-flight command feedback and duplicate prevention, private exclusion, worker cleanup on disable, reconnect after restart, the connection settings and retry button, completion and reveal. The public Windows binaries were downloaded and checked against SHA-256. ZIP CRC, both manifests and packaged Night source files were checked. The integration settings and native download cards were visually inspected. These checks cover the runner's Windows environment and test profiles; they do not establish engine or real-site rendering speedups.

| File | SHA-256 |
| --- | --- |
| night-browser-0.9.1-preview-windows-x64.zip | `b48f399d78bbaa3349f77d77b0586356d6160c564f72e9535fc325bc9f53fc72` |
| night-browser-0.9.1-preview-windows-x64-setup.exe | `76c0e8cfb9c2014133597879f24c885ea995b06810d68baaf5d9a2b8ac3bf67d` |
| night-island.exe | `bb798eadeb88890c0bcd83c3c025da8459390944de60a67ea069025d08e9b0c0` |


## Start-page and visual integration checks (0.9.2)

The last-page test closes an ordinary tab with a saved folder tab unloaded, verifies that the start page appears, and checks the local server receives no request for the saved page. It types without clicking after last-page close, sidebar new-tab and Ctrl+T. An explicit saved-page selection restores it; Ctrl+W unloads it while preserving the folder entry. The start form accepts an address and reflects a changed default search engine. This passed locally and on Windows. Existing saved-tab tests retain cancellation of before-unload prompts and form restoration.

The real Windows pair passed [focused run 43644211103](https://github.com/1atex/night-browser/actions/runs/43644211103). It rejects an unrelated EXE name, reconnects to `night-island (1).exe`, negotiates appearance and native panel opening, and checks the indicator and appearance switches. Clicking the browser capsule opens the actual Island Downloads panel. Existing pointer-driven pause/resume/cancel/reveal, duplicate suppression, private exclusion and restart checks remain active. The pinned companion includes the required `7d9bc80` foundation.

All 58 Node tests passed. Island formatting, Clippy with warnings denied and 555 Rust tests passed (553 app + 2 helper, 119 existing ignored) in [run 43644186298](https://github.com/1atex/night-island/actions/runs/43644186298). The standalone release build also passed in [run 43644182439](https://github.com/1atex/night-island/actions/runs/43644182439).

The actual Windows browser capsule, connected settings and native Island download panel captures were inspected. Additional Linux visual fixtures cover Graphite and a light palette, the 240 px sidebar minimum and long download names. They have no running idle animations. Those palette fixtures simulate state and are not substitutes for the Windows connection test. Appearance sharing covers RGB panel/accent colors and the motion setting, not native window glass or a shared font installation.

## Published 0.9.2 result

[Browser v0.9.2-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.9.2-preview.1) uses `331d58554a5ab791aa4563aebea8ac7f1c6fc0f4` and passed the complete native Windows suite in [tag run 43644602067](https://github.com/1atex/night-browser/actions/runs/43644602067). The first attempt stopped while capturing the split-view screenshot after its geometry assertions passed. The second attempt reran the complete job on the same revision and passed, including the screenshot; no check was removed. Both build and publication jobs succeeded.

The paired [Island v0.3.3-browser-preview.1](https://github.com/1atex/night-island/releases/tag/v0.3.3-browser-preview.1) uses `62882637a8a6e09f874e1737cf9c9a016dc7b13e` and passed [tag run 43644604774](https://github.com/1atex/night-island/actions/runs/43644604774). Both public executables and the browser ZIP were downloaded and verified against their published SHA-256 files. ZIP CRC, source manifests, native tab-selection patches and 87 packaged Night source files passed verification with text line endings normalized. The browser BuildID is `20261114214642`.

The published [start-flow result](https://github.com/1atex/night-browser/releases/download/v0.9.2-preview.1/start-flow-result.json) and [Island result](https://github.com/1atex/night-browser/releases/download/v0.9.2-preview.1/island-result.json) contain passing assertions. The ordinary first-launch capture, start-flow screenshot and native-pair captures were inspected. The striped address bar in automation captures is Marionette's indicator, not the shipped visual theme.

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.9.2-preview-windows-x64.zip | `a3384a8be874160d0686d0b658188ecf8afcbd6ae0dba863a476dcc849ded4ed` |
| night-browser-0.9.2-preview-windows-x64-setup.exe | `af25ff6e6db7f9234aeb44e013ec84e87061011873a26d00a6449e374195704c` |
| night-island.exe | `5a2198b3419828b12b155bbcecf52701aebaf2933a9cea2501f28a4370c28b06` |

## Startup-cache recovery (0.9.3)

A reported reboot restored an early Night sidebar and the upstream start page despite BuildID `20261114214642`. The installed browser JAR SHA-256 was `1397f5116de7c37303b298fba13625fe8fdff3f1eca7b5fcacfb83f703e31f5f`, matching the published 0.9.2 file. Clearing the startup cache restored the current interface. A local runtime fixture reproduced stale module execution after the JAR was replaced without changing the application BuildID.

The Windows launcher compares the package revision and executable path with a profile marker acknowledged by the loaded Night modules. Missing, corrupt or outdated acknowledgement adds `-purgecaches`; the launcher does not mark an unverified launch as current. Once the correct modules have loaded, normal launches keep the startup cache. Profile data is not deleted.

The new native test first proves that direct runtime startup still executes the deliberately seeded stale module. It then launches through `Night.exe`, checks recovery and acknowledgement, preserves a real Places bookmark and a preference, restarts without cache purging or rewriting the marker, and simulates a subsequent revision change. All six assertions passed in the complete Windows [run 43656692245](https://github.com/1atex/night-browser/actions/runs/43656692245) at `71c0bb3c607848f5bfdc7b89ce6ecf551f5e2b35`.

The final focused [Island run 43657715477](https://github.com/1atex/night-browser/actions/runs/43657715477) passed at `e37fbb09d23d1b35019fe6e126d16f5572105bb2`. It changes placement and visibility through the settings controls' change handlers, checks top placement geometry, verifies idle/completed hiding and paused/offline visibility, and opens the native Downloads panel from settings. Earlier test captures changed preferences directly and left the settings controls displaying their initial values; the corrected test exercises those controls and captures their selected values. The connected settings and top-capsule screenshots were inspected.

## Published 0.9.3 result

[Browser v0.9.3-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.9.3-preview.2) was built from `e37fbb09d23d1b35019fe6e126d16f5572105bb2` in [tag run 43657748901](https://github.com/1atex/night-browser/actions/runs/43657748901). All 58 Node checks, every native Windows check and both build/publication jobs passed. The first 0.9.3 tag was cancelled before publication to improve the settings test; its tag remains in history. Redundant branch builds were cancelled after replacement tag runs started. Island 0.3.3 remains unchanged and compatible.

The public installer and ZIP were downloaded and matched their release SHA-256 file. ZIP CRC, BUILD.json, native tab patches and 88 packaged Night source files passed verification; the generated NightBuild module contains the tagged revision. BuildID is `20261115002046`. Published startup-cache, start-flow and Island result files contain passing assertions. The ordinary first-launch and top-position indicator captures were inspected. The striped address field in automated captures is Marionette's indicator.

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.9.3-preview-windows-x64.zip | `f0f241c545cd56c12de9b0b96c9a0c5ec14df3ec068eada492465072c232b552` |
| night-browser-0.9.3-preview-windows-x64-setup.exe | `c861fb586339a743595eb72549444ddd5f6d3e05c1c4712aee7ef90c5583a75a` |


## Published 0.10.0 result

[Browser v0.10.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.10.0-preview.1) uses `5ef837f7c8ab674fe90753449b5b5fc23f3c3f0a` and passed all 62 Node checks and the complete native Windows suite in [tag run 43666094132](https://github.com/1atex/night-browser/actions/runs/43666094132). The same source passed [branch run 43665419113](https://github.com/1atex/night-browser/actions/runs/43665419113) and the [focused native Island pair 43665419152](https://github.com/1atex/night-browser/actions/runs/43665419152). Both tag build and publication jobs succeeded.

The compatible [Island v0.4.0-browser-preview.1](https://github.com/1atex/night-island/releases/tag/v0.4.0-browser-preview.1) uses `bf85a4182121072e509b07fcb97aecb8b386cc6b` and passed [tag run 43665923392](https://github.com/1atex/night-island/actions/runs/43665923392). Its [CI 43665410352](https://github.com/1atex/night-island/actions/runs/43665410352) passed formatting, Clippy with warnings denied and 559 Rust tests (557 app, two helper; 119 existing ignored). Foundation `7d9bc801af2e41627ad7d15a6d2400bbda150aca` remains an ancestor.

The public installer, ZIP and Island EXE were downloaded and verified against their release SHA-256 files. The 145,562,553-byte ZIP passed CRC, manifest, native tab-patch and all 91 Night source-file checks, normalizing text line endings and checking the generated build-revision module separately. BuildID is `20261115015638`. Published startup-cache, start-flow, search and Island result files contain passing assertions; the hub result identifies the tagged source and records the unchanged HTTP upload/header. Published home-suggestion and native request-panel captures were visually inspected.

Evidence: [home suggestions](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/night-home-suggestions.png), [search result](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/search-result.json), [Island search](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/night-island-tab-search.png), [Pocket](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/night-island-pocket.png), [request controls](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/night-island-request.png) and [hub result](https://github.com/1atex/night-browser/releases/download/v0.10.0-preview.1/hub-result.json). The local OpenSearch provider and colored favicon are test fixtures. These checks do not measure a real user profile's memory or prove a Gecko rendering speedup.

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.10.0-preview-windows-x64.zip | `20b5e56b4e5b980c5a43e1230f0de0f03af24fd6d67fa7a8ea5d2102d5b8f182` |
| night-browser-0.10.0-preview-windows-x64-setup.exe | `21d228f18a4873b07aa3ab65c17cec4c76d92a8fad723abf533dde1a93e77adf` |
| night-island.exe | `e7661fa09282d9fb78262e13286a12a9bca2c490f4e2db148464e41434d46972` |


## Published 0.11.0 result

[Browser v0.11.0-preview.2](https://github.com/1atex/night-browser/releases/tag/v0.11.0-preview.2) uses `1db0c0a834dfeed9175edc746d99448ac8bfb90d` and passed all 65 Node checks and the complete native Windows suite in [tag run 43737556680](https://github.com/1atex/night-browser/actions/runs/43737556680). Both build and publication jobs succeeded. The first 0.11 tag was cancelled before publication after visual review found remaining upstream artwork; its tag remains unchanged. The redundant branch build was cancelled in favor of the final tag's full suite. Compatible Island remains 0.4.0.

The public installer and ZIP were downloaded and matched their release SHA-256 file. The 145,456,212-byte ZIP passed CRC, source manifest, native tab-patch and all 101 Night source-file checks. Text line endings were normalized; PNG/ICO resources were compared byte-for-byte. The generated build-revision module and final advanced-settings/error-page patches were checked separately. BuildID is `20261115164730`.

Published [Home UX results](https://github.com/1atex/night-browser/releases/download/v0.11.0-preview.2/home-ux-result.json), [native surface results](https://github.com/1atex/night-browser/releases/download/v0.11.0-preview.2/surfaces-result.json) and [Island hub results](https://github.com/1atex/night-browser/releases/download/v0.11.0-preview.2/hub-result.json) pass. The hub report identifies the tagged source and confirms that the Home widget opens the actual Island Pocket. The suite also retains installer, startup-cache recovery, first launch, search, real-Zen import, session restoration, unloading, rendering and network-tool coverage. The final Windows advanced-settings and error-page captures were visually inspected from the test artifact. Native Linux Home, surface and 100-tab rendering checks also passed on the final source.

The [published Windows memory workload](https://github.com/1atex/night-browser/releases/download/v0.11.0-preview.2/memory.json) reports Night private working set at 610.94 MiB before inactivity and 394.58 MiB after five safe discards, with the selected and explicitly protected tabs still loaded. This is the seven-local-page fixture described above, not a measurement of the user's Gmail/YouTube profile or a Gecko speedup. Separate request-history allocation measurements and their limits are in [PERFORMANCE.md](PERFORMANCE.md).

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.11.0-preview-windows-x64.zip | `054e9360d9df39a6c742a26a706847e4d848e3496cfe92936f95dcebf80b4798` |
| night-browser-0.11.0-preview-windows-x64-setup.exe | `54fc4c65abd6157eda14fda55c76cb5803ecd8836f49d0907257b68464b13c1b` |


## Published 0.12.0 result

[Browser v0.12.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.12.0-preview.1) uses `f4f2d2db917d506b453f8a0b6c2cb43ad0732e2c`. All 67 Node checks and the complete native Windows suite passed in [tag run 43743403083](https://github.com/1atex/night-browser/actions/runs/43743403083); build and publication succeeded. The duplicate branch build was cancelled after the tag run started. Island remains 0.4.0, with the same pinned foundation and passing download/hub integration tests.

The public installer and ZIP were downloaded again and matched SHA-256. The ZIP passed CRC, manifest, native patch and all 107 packaged Night source-file checks. BuildID is `20261115175055`. The published account settings capture was inspected. A separate native Linux run using the tagged package checked the managed-profile form and real profile metadata; Linux private/account/chrome checks also passed.

[Profile results](https://github.com/1atex/night-browser/releases/download/v0.12.0-preview.1/profiles-result.json) confirm separate passwords/bookmarks/cookies/storage/extensions, independent palettes, existing-window reuse, external URL routing, last-profile restart and invalid-ID rejection. The installer recognizes the installed LocalAppData profile, and the real Zen fixture excludes the account file while preserving source hashes, passwords and extension storage.

[Account results](https://github.com/1atex/night-browser/releases/download/v0.12.0-preview.1/accounts-result.json) confirm the native private shortcut and cookie/history boundaries, explicit connection, official OAuth URL, native Sync preference record and native settings/action routing. The public account page returned **Client Challenge** on the Windows automation runner; Linux encountered the environment's certificate/proxy problem. No challenge bypass or authenticated login was attempted. End-to-end synchronization between real devices remains unverified. The striped address field in automated images is Marionette's indicator.

The same seven-local-tab workload reports Night private working set at 582.34 MiB before inactivity and 394.55 MiB after five safe discards. This is regression evidence for unloading, not a YouTube measurement or an improvement over 0.11: that release's post-discard result was essentially the same. The active-video investigation and its limits are documented in [PERFORMANCE.md](PERFORMANCE.md).

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.12.0-preview-windows-x64.zip | `a68351fd7bff3f9b17ad919471e9e9d2ce039cb5159a1ebc9dcaa669d31c4802` |
| night-browser-0.12.0-preview-windows-x64-setup.exe | `6e2a447a3d945dc21977a854c69ce75c2f994a2a673714294ac30c6c695e314f` |


## Published 0.13.0 result

[Browser v0.13.0-preview.5](https://github.com/1atex/night-browser/releases/tag/v0.13.0-preview.5) uses `610d38b4295457d59c31d35c12d3310a50693750`. All 69 Node checks and the complete Windows suite passed in [tag run 43748175870](https://github.com/1atex/night-browser/actions/runs/43748175870). Docker validation also passed in [Linux CI 43748180993](https://github.com/1atex/night-browser/actions/runs/43748180993). Earlier tags were not published: 1/2 were cancelled as the deployment requirement changed to Docker; 3 encountered a typing-focus test timeout and was superseded while the archive layout was corrected. The fourth tag stopped while the unmodified Firefox baseline waited for seven local pages. The baseline now disables first-run flows, waits for delayed startup and allows a longer cold load. Tags and history remain intact.

The Windows installer test copies the actual updater helper to a temporary directory, verifies the official setup fixture hash, reinstalls silently and relaunches the selected profile. The profile sentinel survives; the temporary setup and plan are removed. It also retains first install, URL routing, upgrade and uninstall coverage. This tests the helper's real installation path; it does not publish a dummy future release to test the entire remote update chain.

`updates_together.py` checks update controls and one-time changelog opening. Its real local HTTP server drives registration, ID copying boundaries, confirmed friendship, room creation and invitation through Night settings. Website-player synchronization is intentionally not implemented by this foundation. The public domain is pinned in the client, but the VPS was not configured or tested remotely: the owner will deploy the Docker archive.

The Docker test builds Node 22 Alpine, runs as non-root with a read-only root filesystem and a named data volume, registers a fixture identity, restarts the container and checks that the identity is retained. It validates Compose and adapts/validates the Caddy configuration. The same test passed locally; an extracted server archive also built successfully. This does not prove ACME issuance or DNS correctness on the owner's VPS.

All three public downloads matched SHA-256. The browser ZIP passed CRC, manifest and 112 packaged Night source-file checks. The server ZIP passed CRC and byte/source comparison for its six tracked server/deployment files, including the stable `services/together/...` paths, Compose, Dockerfile, Caddyfile and installation instructions. Browser build ID: 20261115184132.

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.13.0-preview-windows-x64.zip | `1ba684048d1ddcdca2e79beb81247047cb18b66c96ed8a284d2356d294b59e83` |
| night-browser-0.13.0-preview-windows-x64-setup.exe | `0d097cb286124af3969a4f76ed26e5c1edcb84d0ec81a354e61ac5cac66ef46e` |
| night-together-server-0.13.0.zip | `0e1d37b4510c9ffbdb14f1a78f9ac6665e0d211847a8d41e6a0d005847fb05dd` |


## Published 0.14.0 result

[Browser v0.14.0-preview.1](https://github.com/1atex/night-browser/releases/tag/v0.14.0-preview.1) uses `0e854ce7c4c91a2625f2cb5a1c8d5cd28b19e742`. All 73 Node checks and the full native Windows suite passed in [tag run 43759933537](https://github.com/1atex/night-browser/actions/runs/43759933537). Docker and nginx validation passed in [Linux CI 43759939092](https://github.com/1atex/night-browser/actions/runs/43759939092). The duplicate branch build was cancelled. One earlier candidate timed out in the existing new-tab typing check; the tagged run passed that check. A prior watch test exposed a source-change race against the old document; it was fixed before the tag and passed locally and on Windows.

The [watch result](https://github.com/1atex/night-browser/releases/download/v0.14.0-preview.1/watch-result.json) uses two actual Gecko processes, a real local HTTP backend and HTML5 WebM video. It verifies host play/pause, seeking, playback rate, source changes, guest correction, duplicate Watch returning to the same tab, connection-loss pause without resetting position, backend restart retaining ID/name, tab-close cleanup and private exclusion. The Windows drift sample was 0.645 seconds; a separate Linux run reported 0.058 seconds. These are local fixture samples, not a WAN timing guarantee. The fixture explicitly allows autoplay. Live YouTube could not be tested: the local request reached the environment's proxy error page. Ads, DRM, live and embedded players remain unverified.

The social name/color/icon are edited through settings and read back by the other browser. The managed-profile Windows test also edits the local color/icon through the real settings form, checks the footer badge and retention after rename, then repeats the existing password/bookmark/cookie/storage/extension isolation and launcher restart checks. The protocol-1 persistence unit fixture retains the old identities and friendship while adding profile defaults. Tokens are excluded from public snapshots.

Public installer, portable ZIP and server ZIP were downloaded and matched SHA-256. Both ZIPs passed CRC. Browser source comparison covered all 116 tracked Night files, generated build revision, new-tab aliases and native patches. The server ZIP's nine tracked source/deployment files matched the tagged source, including loopback Compose defaults and the rootless upgrade instructions. Browser build ID: `20261115204620`. The published Together and watch frames were inspected; managed badge editing is asserted by the Windows test.

The server upgrade is prepared for `/home/noon/night-together` with the existing Compose project/data volume and host reverse proxy; sudo, nginx and Cloudflare changes are not needed. The owner reported the previous deployed server healthy on localhost and public HTTPS. This new server package has not been deployed remotely by this task. Existing Mozilla Sync authentication and active-YouTube memory limitations remain unchanged.

| Artifact | SHA-256 |
| --- | --- |
| night-browser-0.14.0-preview-windows-x64.zip | `c240b95beedf5594b61be7a582c724d36c701f6660e2fc78bef488f7d561eada` |
| night-browser-0.14.0-preview-windows-x64-setup.exe | `4a326e60d0b0a63596a0e489924b00564f070d9306c42abf618907c586094cbd` |
| night-together-server-0.14.0.zip | `b859c26bce57c53549b44d5e527493df973fef31202b7456c1f632f3391f4618` |
