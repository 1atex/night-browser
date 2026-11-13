# Windows preview

The [Windows preview workflow](https://github.com/1atex/night-browser/actions/workflows/windows-preview.yml)
builds a portable Windows x64 package. Choose a successful run and download the
`night-browser-windows-x64-preview` artifact. GitHub requires signing in to download
workflow artifacts.

1. Extract the downloaded artifact, then extract `night-browser-0.1.0-preview-windows-x64.zip`.
2. Put the complete `Night` folder somewhere writable, such as your Downloads folder.
3. Launch `Night.exe`. Node.js, Rust, Visual Studio and MozillaBuild are not needed.

The `profile` folder beside `Night.exe` stores this preview's tabs, extensions,
settings and sign-ins. Keep it when moving the preview. The launcher does not use
an existing Firefox or Zen profile. Launch the top-level `Night.exe`, not the
upstream executable under `runtime`.

The **Night** button at the bottom of the sidebar opens memory settings and request
tools. In this preview, request tools are available without an `about:config`
change. They only start capturing after you press **Начать** for a selected web tab.

## What is in the archive

The package uses the unchanged native executable and libraries from Zen 1.24.2b,
based on Gecko 160.0. Its revision exactly matches the source foundation recorded
in `upstream.json`. `scripts/preview/runtime.json` pins the download and SHA-256.
Night's JS modules, startup integration, memory hooks, styles and labels are
assembled from this repository. `Night.exe` is a small Windows launcher compiled
by the workflow. Some upstream icons and executable metadata still say Zen.

This workflow does not recompile Gecko. Changes to native C++ or Rust code require
the full source build described in [CONTRIBUTING.md](CONTRIBUTING.md).

The workflow runs the standalone checks, launches the packaged browser on Windows,
checks the visible Night button and panel, and exercises real interception, replay,
URL editing, cancellation and tab unloading. It also launches `Night.exe` from a
path containing spaces and Cyrillic characters and checks the portable profile.
Only successful builds upload a downloadable archive. The `windows-preview-tests`
artifact contains the screenshot and native test output.

This is an unsigned test preview with automatic application updates disabled.
Use a newer preview to update the application. See [VALIDATION.md](VALIDATION.md)
for current request-tool limits and the memory measurement procedure.
