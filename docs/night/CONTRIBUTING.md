# Development

Use `feature/<topic>` and `fix/<topic>` branches. Keep changes in focused commits. The repository is MPL-2.0; preserve upstream license notices.

## Fast checks

Node 22 or newer, Python 3.12:

```sh
npm test
python -m pip install -r tests/native/requirements.txt
```

There are no npm dependencies. The test suite covers memory decisions, request validation and channel lifecycle. Real Gecko integration is checked separately.

## Package locally

Download the exact platform archive from `scripts/preview/runtime.json`, verify its SHA-256 and extract it. For Windows, extract the installer with 7-Zip; the runtime is its `core` directory. For Linux, extract the tar.xz; the runtime is `firefox`.

```sh
python scripts/preview/package.py --runtime /path/to/firefox --archive /path/to/firefox.tar.xz --platform linux_x64 --output dist/Night
./dist/Night/runtime/firefox -app "$PWD/dist/Night/runtime/browser/application.ini" -no-remote -profile /path/to/test-profile
```

Output must be a new directory. Use a separate test profile. Changing JS/CSS only requires repackaging, not compiling Gecko. Packaging uses Python's standard library and records the Git revision in `BUILD.json`.

On Windows, `windows_brand.py` uses the resource update API to replace icon groups, string tables and version resources in `NightBrowser.exe`. It removes the original Authenticode certificate because the modified executable is no longer Mozilla-signed. The workflow compiles `scripts/preview/Launcher.cs` and `scripts/preview/ProfileImport.cs` with the .NET Framework C# compiler and the Night icon. It then runs native tests, the minimized-memory comparison and the portable launcher test from a Unicode path. `first-launch.ps1` also starts an ordinary visible browser without automation environment flags, inspects Windows metadata/UI, captures screenshots and relaunches its shortcut. See `.github/workflows/windows-preview.yml` for exact commands. No Mozilla signing credentials are needed for this portable preview; the launcher is currently unsigned.

## Upstream updates

Update the official Firefox URLs, source revision and hashes together. Review the changed browser chrome and Gecko APIs. Package and run every native test on Windows before publishing. Never allow the stock updater to replace Night resources. Keep Firefox's process/sandbox defaults unless an independently reviewed change has measured evidence.

Push a `v*-preview.*` tag to publish only after the Windows job passes. The publish job requires the passing test job and attaches the ZIP and checksum to a prerelease. Normal branch pushes provide Actions artifacts.

The Windows workflow also downloads checksum-pinned Zen and a signed extension as test fixtures. The migration test verifies data created by a real Zen runtime after import into Night; these fixture binaries are not packaged. `import-transaction.ps1` checks the profile swap journal, and `motion.py` checks finite interaction animation and reduced-motion behavior.
