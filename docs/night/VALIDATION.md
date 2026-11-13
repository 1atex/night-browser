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
