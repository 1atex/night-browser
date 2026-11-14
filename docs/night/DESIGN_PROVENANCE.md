# Interface and upstream boundaries

Night's interface is authored in this repository. The 0.4 work uses common interaction patterns also found in Zen: vertical tabs, compact site pins, a clear selected-tab state, workspace switching, short opening/closing transitions and quiet chrome. The implementation, CSS and copy are authored here; icon provenance is listed below. Zen logos, product artwork and branding are not bundled.

The migration code reads Zen's profile formats for interoperability. Format references were inspected in the public Zen source at `bf360bf72071d576b54ece76a953dfd4145b4db1`, particularly the session manager, tab-state additions and workspace/pin storage. No Zen implementation files were copied into the Night runtime for this work. The Zen name is used to identify the import source, without suggesting affiliation.

Zen is published under [MPL-2.0](https://github.com/zen-browser/desktop/blob/stable/LICENSE). Sections 3.1–3.4 require source availability and preservation of notices for covered code; section 2.3 does not grant trademark or logo rights. Any future direct reuse of covered code must retain applicable notices and satisfy those source obligations. A license does not provide a blanket guarantee against every legal claim.

Firefox/Gecko remains the underlying engine. Its license, source revision and attribution are preserved in the package, about:license and Night's about page. The existing Zen-based prototype remains in Git history; the current product does not ship that shell.

Night 0.5 styles the current Gecko URL component rather than replacing its navigation, suggestion or site-identity logic. Toolbar autohide, focus mode and the window-edge reveal behavior are implemented in Night. The 0.5 icons were originally drawn here; 0.7 replaces interface glyphs with Material Symbols.

Site favicons identify linked third-party websites, not the Night product. The YouTube favicon and ChatGPT mark in `src/night/sites/` come from the pinned Mozilla distribution (`activity-stream/data/content/tippytop/favicons/youtube-com.png` and `browser/genai/assets/brands/chatgpt.svg`); the latter's context-fill was replaced with a fixed light fill for an ordinary image element, and its trademark notice is retained. The GitHub favicon was downloaded from https://github.com/favicon.ico. These marks remain their owners' property. They are bundled locally so opening a new tab does not contact those sites to load icons. Censys keeps a text fallback on the start page; visited tabs use the actual site favicon supplied by Gecko.

## Motion

Transitions last 115–260 ms and run on interaction. Tab opening/closing, workspace changes, context menus, settings sections and the request workbench use opacity and transform animations. There is no decorative animation loop or resident helper process. Native reduced-motion preferences and Night's animation setting disable these effects. Motion tests verify active transitions, their completion, absence of idle animation and both disabling modes.

## Interface identity

The 0.5.1 interface keeps the product identity in the about page, native Windows metadata and native internal-page identity indicators. Daily browsing surfaces use functional names: “Новая вкладка”, “Настройки” and “Запросы”. The sidebar and start page have no wordmark, product slogan or persistent release badge. Internal tabs use purpose-specific icons; website favicons are unchanged. Settings descriptions explain controls rather than advertise the product. Version and license information remain accessible in “О браузере”.

Night 0.5.2 provides an original main-menu component and navigation glyphs. Menu actions call the engine's existing window, library, zoom, find, printing and DevTools APIs. Address suggestions keep Gecko's data and navigation behavior but use an independently styled surface. Extension icons, permission text, badges and popup contents remain owned by their extensions; browser-owned controls share Night's spacing and hover states. No Zen menu or icon assets are included.

Night 0.6 adds original sidebar navigation, resizing and a folder tree. Zen's folder metadata (`groupId`, `parentId`, `workspaceId`, `prevSiblingInfo`) is read for migration, with cycle and cross-workspace checks. The wrapped toolbar uses a small integration hook in the pinned Mozilla CustomizableUI source to suspend single-row overflow while the sidebar layout is active; top navigation keeps native overflow behavior.

## Night Island reference (0.7)

The reference is [Night Island a4391355d8c05087ed3d8ccb30df41ef16879c94](https://github.com/1atex/night-island/tree/a4391355d8c05087ed3d8ccb30df41ef16879c94). `src/ui/theme.rs`, `src/view/frame.rs`, `src/view/widgets.rs`, `src/ui/menu.rs`, `src/ui/anim.rs` and `src/view/settings_window.rs` informed the browser design: Graphite #17171a, accent #c3ccd9, white opacity levels, 36px controls, capsule selection, 12px panels, flat settings sections, and cubic-bezier(.34,1.45,.64,1) spring motion. Night's black palette is the new default; Graphite and other palettes remain selectable.

`src/night/theme.css` supplies the common tokens for chrome, settings and the start page. Night's address controller adds a current-site favicon and the sidebar input expands while focused; Gecko retains address navigation, search, suggestions and security handlers. Browser-owned popup surfaces share these tokens. Extension popup contents remain controlled by each extension, and advanced engine pages still use Gecko components. This change does not claim every engine dialog has been replaced.

Interface SVGs use Google Material Symbols. Shared symbols came from Night Island's `assets/material/svg`; missing browser symbols came from Google's Material Symbols Rounded set. The fill attribute was adapted for context fill with a standalone-image fallback. Apache-2.0 is preserved in `licenses/Material-Symbols-Apache-2.0.txt`, distributed in preview packages and linked from the browser's about settings. No Zen icons or visual implementation were copied.
