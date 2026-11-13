# Night Browser

Firefox-based desktop browser for Windows, built on the Zen source foundation.
Night Island graphite styling, vertical tabs, workspaces, pinned sites and split view.

This repository contains an early source prototype. No verified Windows installer
or measured memory improvement is available yet. Network tools remain experimental.

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
