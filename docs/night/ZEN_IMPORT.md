# Import from Zen

On Windows, open **Переехать из Zen** at the bottom of the sidebar, or **Настройки → Переезд из Zen**. Choose a discovered profile, or point to the profile directory shown by Zen's `about:profiles`. Close Zen, confirm the replacement of Night's current data, and import. Restart Night when the copy is ready.

The importer clones the selected profile into a separate staging directory. It carries bookmarks/history, saved logins and their NSS keys, cookies, site storage, permissions, containers, installed extensions and their data. Zen session data becomes Night tabs and workspaces; current `zen-sessions.jsonlz4` and older Places workspace/pin tables are supported. A primary password stays in effect. Sites or extensions can require another sign-in, especially when credentials are tied to an account or operating system.

The data replaces Night's current profile rather than merging it. The old Night profile is renamed to a unique `profile-backup-…` directory beside Night.exe. Zen's original profile is not modified. Do not delete that backup until you have checked the imported data.

## Boundaries

- Pinned tabs and Essentials become Night's shared pins. Workspace names, membership, tab history and container IDs are retained.
- Zen folders, tab groups and split views become individual tabs. Zen Mods, userChrome/userContent, Zen appearance, key bindings and Sync setup are not activated in Night.
- Engine-specific UI preferences, `user.js`, startup caches and compatibility caches are excluded. A limited set of user data/search/download/privacy preferences is retained. Night's security defaults, extension signature checks, shell and update policy remain in control.
- A profile written by a newer Gecko version is rejected until Night is updated. Importing into an older engine is not forced.
- The source profile is locked during copying. Open Zen profiles are rejected. Symbolic links and junctions within the profile are not followed.
- Copying is local. Profile contents are not uploaded. Enough disk space is needed for both the imported copy and the retained Night backup.

## Failure recovery

An incomplete copy never replaces the active profile. Activation happens through Night.exe after Night has closed, with a journal and a readiness marker. A failed directory swap restores the previous profile when possible; a subsequent launch can finish an interrupted swap. A locked Night profile is left intact.

To return to the previous Night profile, close Night, keep the current `profile` directory under another name, and rename the matching `profile-backup-…` directory to `profile`. The import report inside the imported profile records the backup name. Never swap profile directories while either browser is running.

## Verification

`tests/native/zen_import.py` uses an official, checksum-pinned Zen 1.24.2b runtime and a signed uBlock Origin test extension. It creates real encrypted credentials, a bookmark, cookies/site storage and a workspace in Zen, closes it, imports it, and verifies the data in Night after restart. These external binaries are test fixtures only and are not included in Night's distribution.

`tests/native/import-transaction.ps1` checks incomplete staging, a locked destination, retained backups and recovery at both sides of the directory swap. Pure model tests cover newer/older session shapes, duplicate URLs with different identities, private/temporary tab exclusion, preference filtering and extension path relocation.
