# Privacy policy — Session Copy (Firefox edition)

**Last updated:** 2026-10-10

## What this add-on does

Session Copy reads **localStorage**, **sessionStorage**, and **cookies** for the **active tab's origin** (from that tab's own cookie store, so container tabs and private windows stay separate), applies optional filters to reduce non-essential data, then **encrypts** that bundle on your device. You can place the result on the clipboard or save an encrypted file. Another user with the extension (Firefox or Chrome) can import it to open the same site and apply the same data.

## Data we do not collect

- **No accounts**, **no analytics**, and **no cloud session database**. The manifest declares `data_collection_permissions: none`.
- Encrypted payloads are **only** where you put them (clipboard, file, or whatever channel you use). The add-on makes no network requests of its own.
- No content scripts run on the websites you visit; page storage is only read or written when you press Copy, Export, Paste, Import, or Clear.

## Permissions (Firefox)

| Permission | Why it is needed |
|------------|------------------|
| `tabs` | Read the active tab's URL and container, and open the target site when restoring. |
| `scripting` | Read storage from the page and write storage after restore. |
| `cookies` | Read the tab's cookies (including HttpOnly) and set them on restore; open tabs in a specific container. |
| `clipboardRead` / `clipboardWrite` | Read/write the encrypted token when you use paste/copy. |
| `storage` | Remember settings (capture mode, theme). |
| `host_permissions` `http(s)://*/*` | Access the sites you copy from, restore to, or clear. Can be withdrawn in about:addons. |

## Security expectations

- The encrypted token or file is a **bearer credential**: the decryption key travels inside it. Anyone who has it can use that session until the site's cookies expire or the site revokes the session.
- Some sites use **extra protections** (device binding, IP checks, IndexedDB-only state). This add-on cannot bypass those; restores may be partial.

## Contact

Questions and reports: [github.com/itinfra7/session-copy-firefox/issues](https://github.com/itinfra7/session-copy-firefox/issues).
