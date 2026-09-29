# My IP Flag

Firefox extension that shows the country flag of your current public IP in the toolbar.
Hover the icon for the IP, country, city, VPN status and how long ago it was fetched.
Click it to refetch.

## How it works

- `api.ipify.org` is checked every 20 seconds to detect IP changes.
- `ipwho.is` (location) and `proxycheck.io` (VPN check) are called only when the IP changes or on click.
  Results are cached per IP for 24 hours, with per-browser daily caps to stay within their free quotas.

## Build

```bash
npx web-ext lint --ignore-files amo-metadata.json
npx web-ext build --overwrite-dest --ignore-files amo-metadata.json
```

Snap Firefox cannot read the source folder from `about:debugging`, so load the built zip in `web-ext-artifacts/`.

## Publish

```bash
export WEB_EXT_API_KEY=...  WEB_EXT_API_SECRET=...
npx web-ext sign --channel=listed --amo-metadata=amo-metadata.json --ignore-files amo-metadata.json web-ext-artifacts
```

## License

MIT
