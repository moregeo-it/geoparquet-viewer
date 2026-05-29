# GeoParquet Viewer

A simple GeoParquet Viewer for the Web.

## Environment variables

The app requires a [SmartMaps](https://smartmaps.net) tile API key at build time.
The key is baked into the static JS bundle, so it will be visible to anyone who uses the app.
Restrict it to your deployment domain in the SmartMaps dashboard to prevent misuse.

| Variable | Description |
|---|---|
| `VITE_SMARTMAPS_API_KEY` | SmartMaps tile API key |

## Development

```sh
npm install
npm run load-extensions
```

Copy `.env.example` to `.env.local` and fill in your SmartMaps API key:

```sh
cp .env.example .env.local
# then edit .env.local
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Compile and Minify for Production

```sh
npm run build
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```

## CI / GitHub Actions

The deploy workflow reads `VITE_SMARTMAPS_API_KEY` from a GitHub Actions secret and passes
it to Vite at build time.

**One-time setup:**

1. Go to your repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret**.
3. Name: `SMARTMAPS_API_KEY`, Value: your SmartMaps API key.
4. Save.

The [deploy workflow](.github/workflows/deploy.yml) picks it up automatically on every push to `main`.
The [test workflow](.github/workflows/test.yml) (lint + format check) does not need the key.


## URL Parameters

The app state is shareable via URL query parameters. This allows users to bookmark or share
a specific view of a remote Parquet file, including which columns are visible, the map position, and pagination settings.

### How it works

1. **On page load** — `parseUrlState()` reads the query string once and returns a frozen state object.
   The app uses this to restore the file source, visible columns, page size, and map viewport.
2. **On state change** — `syncUrlParams()` writes the current app state back to the URL using
   `history.replaceState()` (no navigation, no history entry). Only non-default values are written;
   if no file is loaded the query string is cleared entirely.
3. **Debouncing** — Map viewport changes call a debounced variant (300 ms) to avoid flooding `replaceState`.

### Supported parameters

| Param      | Format                            | Description                                  | Example                                       |
|------------|-----------------------------------|----------------------------------------------|-----------------------------------------------|
| `url`      | Absolute URL                      | Remote Parquet/GeoParquet file to load       | `url=https://example.com/data.parquet`        |
| `c`        | Column name (repeatable)          | Columns to display; geometry col first entry | `c=geom&c=name&c=pop`                         |
| `pageSize` | Positive integer                  | Rows per page (default: 10 000)              | `pageSize=5000`                               |
| `map`      | `{zoom}~{lat}~{lng}`              | Map camera position                          | `map=12.00~48.20000~16.37000`                 |
| `bbox`     | `{west}~{south}~{east}~{north}`   | Spatial filter bounding box (WGS 84)         | `bbox=16.200000~48.100000~16.500000~48.300000`|

### Design notes

- **Tilde (`~`) separator** — Compound values use `~` instead of `,` to avoid URL-encoding issues
  (commas are technically allowed in query values but are often percent-encoded by browsers/tools).
- **No hash routing** — All state lives in the query string (`?`), keeping the URL simple and
  compatible with static hosting.
- **Omit defaults** — Parameters that match the default (e.g. no column filter, default page size)
  are omitted to keep URLs short.
- **Local files** — URL syncing is skipped entirely for files loaded from disk since
  `file://` paths are not shareable.

