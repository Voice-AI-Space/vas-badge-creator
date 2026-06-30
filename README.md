# VAS Badge Generator — static build

A plain client-side (Vite + React) build of the Voice AI Space badge generator,
designed to deploy to **GitHub Pages**. No server, no backend, no API keys —
everything (image dithering, ASCII, captions, PNG export) runs in the browser.

This is a standalone copy of the TanStack Start app; the original SSR version
lives in `../pixel-badge-creator-main` and is unchanged.

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
npm run preview  # serve the built dist/
npm run typecheck
```

## Deploy to GitHub Pages

1. Create a new GitHub repo and push this folder to the `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. The included workflow (`.github/workflows/deploy.yml`) builds
   and publishes automatically.

Your site will be at `https://<username>.github.io/<repo>/`.

`vite.config.ts` uses `base: "./"` (relative asset paths), so it works under any
repo subpath without extra configuration. For a root user/org site
(`<username>.github.io`), relative paths still work.

## What's inside

- `src/lib/dither.ts` — pixel/bitmap/ASCII renderers + cover-crop/pan math
- `src/lib/captions.ts` — per-platform, per-event-type caption templates
- `src/App.tsx` — the generator UI (canvas badge + controls + captions)
