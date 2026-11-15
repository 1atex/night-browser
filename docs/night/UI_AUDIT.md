# UI audit — 0.11 preview

The browser still uses Gecko's native security, password, print and developer tools. Night styles those browser-owned surfaces while retaining their real actions and warnings. No Zen runtime or artwork was added. Mozilla/MPL and existing icon notices remain in the distribution.

| Surface | Finding in 0.10 | Change | Verification |
| --- | --- | --- | --- |
| New tab | Clicking the sidebar did not reliably focus the page's search input | Focus handoff covers manual clicks and selecting an existing home tab; immediate typing before load stays in the address field | `home_ux.py`, `start_flow.py`, `search.py` |
| Home | Only clock and fixed links | Optional clock, shortcuts, workspace tabs/counts and Island actions; settings persist; hidden pages unsubscribe | `home_ux.py`, clock unit test |
| Workspace | Folders collapse individually, workspace does not | Accessible disclosure button hides workspace folders and tabs without unloading or selecting them; global favourites and new-tab button stay available | `home_ux.py`, saved session data assertion |
| Address | Duplicate permission symbols, zoom and bookmark occupy scarce width | Compact by default; page actions menu exposes permissions, bookmark, zoom reset and page information; detailed mode is selectable | `home_ux.py`, native sharing indicator assertion |
| Site security | Native functionality must remain inspectable | Security/tracking indicators remain; active sharing stays visible even in compact mode | `chrome.py`, `home_ux.py` |
| Panels and menus | Separate field/footer/focus colours | Night tokens for downloads, extensions, permission prompts, bookmark editor, context menus and find bar | Existing native chrome tests; `surfaces.py` for find bar |
| Extensions | Firefox logo, fox illustration, promotional introduction and selected category colours | Night logo assets, plain catalogue introduction, text-only discovery card and Night navigation | `surfaces.py`; screenshots |
| Passwords | Firefox fox and instructions to enable unavailable Firefox account sync | Remove decorative fox and inapplicable sync instructions; keep password creation, import and support controls | `surfaces.py`; native import suite |
| Downloads, diagnostics, configuration | Old slate/blue palette | Shared Night tokens with live palette/Island appearance | `surfaces.py` |
| Private page | Firefox wordmark and promotions | Remove decorative wordmark/promotions; preserve privacy explanation and search | `surfaces.py`; normal and private-window checks remain separate |
| Error/recovery pages | Upstream colours and typography | Night surface tokens; keep error explanation, recovery controls and advanced warnings | `surfaces.py` |
| Advanced settings | Hardcoded colours different from main settings | Shared live palette and field/category styling | `surfaces.py`, `settings.py` |
| Library, page info, About dialog | Native chrome windows use separate palette | Scoped Night document actor and branded About assets | `surfaces.py` opens actual windows |
| DevTools | Separate toolbar and sidebar colours | Night variables in toolbox and browser-owned tool documents; syntax/error colours remain semantic | `surfaces.py` opens the actual console |
| Request workbench | Hardcoded colours and small text; CSS loaded in every window | Night tokens, readable labels, stylesheet present only while workbench is open | `surfaces.py`, native network smoke |
| Print/common dialogs | Browser-owned document styling | Same scoped palette; printed page preview remains content | Actual print preview opened and cancelled in the Linux audit; palette asserted on `chrome://global/content/print.html`. Printed page remains unmodified. |

The document actor has an explicit browser-owned URI allowlist. It does not inject CSS into sites or extension popup documents. OS file pickers keep the Windows theme. `surfaces.py` checks that an ordinary web document receives no Night variables. Browser-owned panels retain the native Gecko implementation; this audit is not a replacement of the rendering engine.

Native automation screenshots may show Marionette's red address-bar stripe, which is absent from ordinary launches. The Windows job also captures an ordinary launch and native menus without automation flags.
