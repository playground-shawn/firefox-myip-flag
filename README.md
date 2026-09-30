# My IP Flag

Browser extension that shows the country flag of your current public IP in the toolbar.
Hover the icon for the IP, country, city, VPN status and when it was fetched. Click it to refetch.

The Firefox build lives in the repo root (Manifest V2); the Chrome build is in `chrome/` (Manifest V3).

## How it works

- `api.ipify.org` is polled to detect IP changes (every 20s on Firefox; every 30s on Chrome, the MV3 alarm floor).
- `ipwho.is` (location) and `proxycheck.io` (VPN check) are called only when the IP changes or on click.
  Results are cached per IP for 24 hours, with per-browser daily caps to stay within their free quotas.
- Chrome MV3 has no persistent background page, so the service worker keeps state in `chrome.storage`,
  polls via `chrome.alarms`, and renders the flag emoji through an offscreen document.

## Build

```bash
npx web-ext lint --ignore-files amo-metadata.json
npx web-ext build --overwrite-dest --ignore-files amo-metadata.json
```

Snap Firefox cannot read the source folder from `about:debugging`, so load the built zip in `web-ext-artifacts/`.

For Chrome, build the upload zip and load it unpacked from `chrome://extensions` (Developer mode -> Load unpacked -> `chrome/`):

```bash
cd chrome && zip -X ../web-ext-artifacts/my-ip-flag-chrome-1.0.zip \
  manifest.json background.js offscreen.html offscreen.js icon-16.png icon-32.png icon-48.png icon-128.png
```

## Publish

Firefox (addons.mozilla.org):

```bash
export WEB_EXT_API_KEY=...  WEB_EXT_API_SECRET=...
npx web-ext sign --channel=listed --amo-metadata=amo-metadata.json --ignore-files amo-metadata.json web-ext-artifacts
```

Chrome: upload `web-ext-artifacts/my-ip-flag-chrome-1.0.zip` at the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 registration fee).

## License

MIT
