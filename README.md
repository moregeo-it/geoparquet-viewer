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
