# Night Browser

Firefox-based desktop browser for Windows, built on the Zen source foundation.
Night Island graphite styling, vertical tabs, workspaces, pinned sites and split view.

This repository contains an early preview. The Windows preview workflow packages
Night with a pinned Zen native runtime and uploads a portable archive after native
startup and launcher tests pass. No measured memory improvement is established yet.

- [Download and run the Windows preview](docs/night/PREVIEW.md)

- [Product requirements and acceptance](docs/night/PRODUCT.md)
- [Build and contribution guide](docs/night/CONTRIBUTING.md)
- [Validation and memory comparison](docs/night/VALIDATION.md)
- [License](LICENSE)

```sh
npm ci
npm run test:night
```

Building the native browser additionally requires the Mozilla toolchain; see the
build guide. `engine/`, profiles and generated binaries are not committed.
