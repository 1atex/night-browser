# Windows preview

Download the [tested Night 0.2 ZIP](https://github.com/1atex/night-browser/releases/download/v0.2.0-preview.1/night-browser-0.2.0-preview-windows-x64.zip), published by [Windows run 43369643347](https://github.com/1atex/night-browser/actions/runs/43369643347). Extract the entire `Night` folder into a writable location and run `Night.exe`. The launcher creates `profile` beside itself. Keep the whole folder together; use a fresh profile for 0.2.

The dropdown changes workspaces. The plus beside it creates one. Right-click a tab for pinning, moving, muting and memory protection. Pins appear in every workspace. Alt+P searches tabs, Alt+B toggles the sidebar, Alt+S splits or separates pages. The footer buttons open split view, request tools, memory settings and browser settings.

Memory defaults to ten idle minutes with YouTube excluded. Configure the timeout and domain exceptions in the memory panel. Active tabs, visible split panes, media/calls and interception remain loaded.

The request panel captures only after clicking Start. It edits and forwards selected held requests or sends an explicit copy. Closing the panel cancels held requests. It is not a system proxy.

This preview uses pinned Firefox native binaries and Night's own browser chrome. Firefox executable metadata and some inherited dialogs remain upstream. The launcher is unsigned, no installer/default-browser integration is provided, and automatic updates are disabled. `BUILD.json` identifies Night and Firefox source revisions; the runtime's about:license retains dependency notices.
