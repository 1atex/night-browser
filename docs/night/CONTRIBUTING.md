# Development

Use `main` for reviewed changes and `feature/<name>` or `fix/<name>` for work.
Keep commits scoped to one change. Run `npm run test:night` before sharing a branch.
Do not commit profiles, browsing history, captured traffic, credentials or build output.

Night is a source fork of Zen and Firefox, covered by the existing MPL-2.0 license.
Keep upstream license notices. The initial source revision is recorded in
`upstream.json`; engine sources are downloaded into the ignored `engine/` directory.

## Setup

See the upstream [build guide](https://docs.zen-browser.app/contribute/desktop/building).
Windows requires MozillaBuild, Visual Studio's Desktop C++ workload, 7-Zip,
Node.js, Python and Rust. Reserve at least 30 GB for source, tools and build output.

```sh
npm ci
npm run init
npm run build
npm start
```

`npm run test:night` runs standalone logic and source-integration checks without
compiling Gecko. Native browser tests are separate and are not implied by these
checks. After an initial build, JavaScript/CSS iterations can use `npm run build:ui`.

## Updating upstream

Fetch Zen into an `upstream` remote and review the difference from the revision
in `upstream.json`. Apply upstream changes in a dedicated branch, resolve the
Night integration points, update the pin, and rerun native tests. The initial
import is a source snapshot, not a copy of Zen's historical binary artifacts.

The inherited release and scheduled workflows are archived under
`.github/upstream-workflows/`. Do not enable them unchanged: they target Zen's
release infrastructure. Night releases and automatic updates need their own
tested, signed distribution pipeline.
