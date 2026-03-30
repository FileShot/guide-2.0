# guIDE 2.0 — Deployment & Infrastructure Reference

> Single source of truth for deployment workflow. Read before any deploy-related changes.

---

## Architecture Overview

```
DEV PC (this machine)              SERVER PC
─────────────────────              ──────────
C:\Users\brend\IDE\website\   ──Syncthing──>   C:\SelfHost\IDE-website\
                                                    │
                                                    ├── PM2 process: "graysoft" (port 3200)
                                                    ├── .next-ready/standalone/server.js
                                                    └── Cloudflare tunnel → graysoft.dev
```

- **Dev PC** — code is edited here, at `C:\Users\brend\IDE\website\`
- **Server PC** — code syncs via Syncthing to `C:\SelfHost\IDE-website\`
- **PM2** — process named `graysoft` runs `next start` from `.next-ready/standalone/server.js` on port 3200
- **Cloudflare** — tunnel routes `graysoft.dev` to the server

## Website Source

- **Location (dev PC):** `C:\Users\brend\IDE\website\`
- **Location (server):** `C:\SelfHost\IDE-website\`
- **Framework:** Next.js (App Router, standalone output, distDir: `.next-ready`)
- **Config:** `next.config.js` — output: 'standalone', distDir: '.next-ready'
- **PM2 config:** `ecosystem.config.js` — process name 'graysoft', port 3200
- **Build output:** `.next-ready/standalone/`

## Key Pages

| Page | File | Purpose |
|------|------|---------|
| Download | `src/app/download/page.tsx` | Download links, version display, platform tabs |
| Home | `src/app/page.tsx` | Landing page |
| Account | `src/app/account/page.tsx` | User account (login, OAuth) |
| Login | `src/app/login/page.tsx` | Login form |
| Register | `src/app/register/page.tsx` | Registration |
| Models | `src/app/models/page.tsx` | Model catalog |
| Blog | `src/app/blog/page.tsx` | Blog |
| Admin | `src/app/admin/page.tsx` | Admin panel |

## Download Page Details

- **Version constant:** `CURRENT_VERSION` at top of `src/app/download/page.tsx`
- **GitHub release base URL:** `https://github.com/FileShot/{REPO}/releases/download/v{VERSION}`
- **Currently pointing to:** `FileShot/guIDE` (v1 repo) with v1.8.34 naming convention
- **Needs updating to:** `FileShot/guide-2.0` with v2.0.0 naming convention
- **Cache headers:** `/download` route has `no-store` cache headers (prevents Cloudflare caching stale versions)

### v2.0.0 Release Assets

| Asset | File | Size |
|-------|------|------|
| Windows CPU | `guIDE-2.0.0-cpu-x64-setup.exe` | 127 MB |
| Windows CUDA | `guIDE-2.0.0-cuda-x64-setup.exe` | 338 MB |
| Linux CPU | `guIDE-2.0.0-cpu-linux-x64.AppImage` | 135 MB |
| Linux CUDA | `guIDE-2.0.0-cuda-linux-x64.AppImage` | 135 MB |
| macOS ARM | `guIDE-2.0.0-cpu-mac-arm64.dmg` | 127 MB |
| macOS Intel | `guIDE-2.0.0-cpu-mac-x64.dmg` | 131 MB |

## Control Plane

- **Location:** `C:\Users\brend\all site work\control-plane\`
- **Port:** 4500
- **Features:** PM2 management, Syncthing management, site monitoring, Cloudflare DNS, analytics, Stripe, uptime pings
- **Site registry:** `lib/sites.js` — graysoft entry: PM2 processes ['graysoft', 'tunnel-graysoft']
- **Build endpoint:** `routes/pm2.js` — graysoft build config: `{ dir: '${SELFHOST_ROOT}\\IDE-website', pm2: 'graysoft', port: 3200, distDir: '.next-ready' }`

## Deployment Workflow

### To update the download page:

1. Edit `C:\Users\brend\IDE\website\src\app\download\page.tsx` — update `CURRENT_VERSION` and file naming
2. Build on dev PC: `cd C:\Users\brend\IDE\website && npm run build`
3. Build output goes to `.next-ready/`
4. Syncthing syncs `.next-ready/` to `C:\SelfHost\IDE-website\.next-ready\` on server
5. Restart PM2 on server: via control plane dashboard or `pm2 restart graysoft`

### Alternative — rebuild via control plane:

The control plane has a rebuild endpoint in `routes/pm2.js` that:
1. Runs `npm run build` in the site directory
2. Promotes standalone output
3. Restarts the PM2 process

## GitHub Release Workflow

1. Bump version in `package.json`
2. Commit and push
3. Tag: `git tag v{VERSION} && git push origin v{VERSION}`
4. GitHub Actions runs `.github/workflows/build.yml`
5. Builds 5 variants (win-cpu, win-cuda, linux-cpu, linux-cuda, mac)
6. Release job uploads all assets to GitHub release
7. Update download page version constant to match

## Important Notes

- **Syncthing:** Bidirectional sync between dev PC and server PC. Changes on EITHER side propagate.
- **Stale references warning:** The website has been updated multiple times. Always verify references are current.
- **Cache busting:** Download page has no-store headers to prevent Cloudflare from caching stale version numbers.
- **Server port 3200:** Both graysoft.dev (production) and guide dev server use 3200 — never both simultaneously.
