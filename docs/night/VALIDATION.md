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
