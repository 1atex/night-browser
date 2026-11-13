# Interface and upstream boundaries

Night's interface is authored in this repository. The 0.4 work uses common interaction patterns also found in Zen: vertical tabs, compact site pins, a clear selected-tab state, workspace switching, short opening/closing transitions and quiet chrome. The implementation, CSS, graphics, colors and copy are Night's own. Zen logos, product artwork and branding are not bundled.

The migration code reads Zen's profile formats for interoperability. Format references were inspected in the public Zen source at `bf360bf72071d576b54ece76a953dfd4145b4db1`, particularly the session manager, tab-state additions and workspace/pin storage. No Zen implementation files were copied into the Night runtime for this work. The Zen name is used to identify the import source, without suggesting affiliation.

Zen is published under [MPL-2.0](https://github.com/zen-browser/desktop/blob/stable/LICENSE). Sections 3.1–3.4 require source availability and preservation of notices for covered code; section 2.3 does not grant trademark or logo rights. Any future direct reuse of covered code must retain applicable notices and satisfy those source obligations. A license does not provide a blanket guarantee against every legal claim.

Firefox/Gecko remains the underlying engine. Its license, source revision and attribution are preserved in the package, about:license and Night's about page. The existing Zen-based prototype remains in Git history; the current product does not ship that shell.

Night 0.5 styles the current Gecko URL component rather than replacing its navigation, suggestion or site-identity logic. Toolbar autohide, focus mode and the window-edge reveal behavior are implemented in Night. The focus, toolbar and fallback globe icons are original graphics.

Site favicons identify linked third-party websites, not the Night product. The YouTube favicon and ChatGPT mark in `src/night/sites/` come from the pinned Mozilla distribution (`activity-stream/data/content/tippytop/favicons/youtube-com.png` and `browser/genai/assets/brands/chatgpt.svg`); the latter's context-fill was replaced with a fixed light fill for an ordinary image element, and its trademark notice is retained. The GitHub favicon was downloaded from https://github.com/favicon.ico. These marks remain their owners' property. They are bundled locally so opening a new tab does not contact those sites to load icons. Censys keeps a text fallback on the start page; visited tabs use the actual site favicon supplied by Gecko.

## Motion

Transitions last 115–230 ms and run on interaction. Tab opening/closing, workspace changes, context menus, settings cards and the request workbench use opacity and transform animations. There is no decorative animation loop or resident helper process. Native reduced-motion preferences and Night's animation setting disable these effects. Motion tests verify active transitions, their completion, absence of idle animation and both disabling modes.

## Interface identity

The 0.5.1 interface keeps the product identity in the about page, native Windows metadata and native internal-page identity indicators. Daily browsing surfaces use functional names: “Новая вкладка”, “Настройки” and “Запросы”. The sidebar and start page have no wordmark, product slogan or persistent release badge. Internal tabs use purpose-specific icons; website favicons are unchanged. Settings descriptions explain controls rather than advertise the product. Version and license information remain accessible in “О браузере”.
