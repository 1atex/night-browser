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
