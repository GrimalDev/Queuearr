# AGENTS.md — Queuearr

Guidelines for agentic coding agents working in this repository.

Use standard technical English and short, clear explanations. The user's shell is fish.

## Local development workflow

- Run the app with Docker Compose and the dev override by default. Use both
  `docker-compose.yml` and `docker-compose.dev.yml`; the dev file is not standalone.
- Run the stack in a new pane of the existing `queuarr` tmux session. Inspect the
  session first and preserve the editor and other running processes. Do not start
  a competing host `npm run dev` server on port 3000.
- Check that Docker, Compose, and a running Docker engine are available before
  starting. A missing Docker runtime is a setup blocker, not an application error.
- Use the project's `.env` for Docker configuration. Next.js reads `.env.local`,
  but Compose does not automatically load it. Do not print secrets or copy them
  into logs, commands, commits, or documentation.
- Verify startup in the pane and check the HTTP response. A successful `/login`
  response does not prove that Plex authentication is configured or working.

## Project Overview

**Queuearr** is a Next.js 16 (App Router) media management dashboard integrating Plex, Radarr, Sonarr, and Transmission. Stack: React 19, TypeScript (strict), Tailwind CSS + shadcn/ui, Drizzle ORM (SQLite), NextAuth, Zustand.

---

## Build & Dev Commands

```fish
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

The current dev override runs the built standalone app, without hot reload.
Rebuild the image after code changes. Use host commands for checks with a
compatible Node.js version; the existing SQLite dependency does not support
Node.js 26. Node.js 24 was used for local verification.

```fish
npm install          # Install dependencies (bun.lock present — bun install also works)
npm run dev          # Host dev server, only when explicitly requested
npm run build        # Production build (next build)
npm run start        # Start production server — requires build first
npm run lint         # Run ESLint (eslint-config-next/core-web-vitals + typescript presets)
```

> **No test runner is configured.** There are no unit or integration tests. Playwright is mentioned in docs for E2E but no config exists yet. Do not add or remove test infrastructure without explicit instruction.

---

## Database Commands (Drizzle + SQLite)

```bash
npm run db:generate  # Generate migration files from schema changes
npm run db:migrate   # Apply pending migrations
npm run db:push      # Push schema directly to DB (dev shortcut)
npm run db:studio    # Open Drizzle Studio (visual DB browser)
```

Schema lives at `src/lib/db/schema.ts`. DB file defaults to `./data/queuearr.db` (override with `QUEUEARR_DATA_DIR` env var). Ensure the `./data/` directory exists before running migrations.

---

## Linting

```bash
npm run lint                                      # Uses eslint with next presets
npx eslint "src/**/*.{ts,tsx}"                    # Explicit target (recommended in CI)
npx eslint "src/**/*.{ts,tsx}" --fix              # Auto-fix
```

Config: `eslint.config.mjs` — extends `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. No Prettier configured — do not add it unless explicitly asked.

---

## Type Checking

```bash
npx tsc --noEmit     # Type-check entire project without emitting files
```

Config: `tsconfig.json` — `strict: true`, `noEmit: true`, `moduleResolution: bundler`, path alias `@/*` → `./src/*`.

---

## Environment Setup

Use the existing project `.env` when available. For a new setup, copy
`.env.example` to `.env` and fill in the required values. Do not overwrite an
existing environment file. Generate a session secret with
`openssl rand -base64 32` and a unique client ID with `uuidgen`.

Plex login requires a stable `PLEX_CLIENT_ID`, `PLEX_SERVER_MACHINE_IDENTIFIER`,
and `NEXTAUTH_SECRET`. Set `NEXTAUTH_URL` to the local URL used in the browser.
The same client ID must be used to create and poll a Plex PIN; changing it during
sign-in makes Plex reject the PIN. Never bypass the server-access restriction to
make an unconfigured local login succeed.

| Variable | Purpose |
|---|---|
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | NextAuth session config |
| `PLEX_CLIENT_ID`, `PLEX_SERVER_MACHINE_IDENTIFIER`, `PLEX_ADMIN_TOKEN` | Plex integration |
| `RADARR_URL` / `RADARR_API_KEY` | Radarr integration |
| `SONARR_URL` / `SONARR_API_KEY` | Sonarr integration |
| `TRANSMISSION_URL` | Transmission integration |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Push notifications |
| `SMTP_*` | Email notifications |
| `DATA_PATH` | Host data directory for Compose; set explicitly, e.g. `./data` |
| `QUEUEARR_DATA_DIR` | App database directory; Compose sets `/app/data` |

---

## Project Structure

```
src/
  app/                   # Next.js App Router — pages, layouts, API routes
    api/                 # API route handlers (route.ts files)
    (dashboard)/         # Dashboard route group
  components/
    ui/                  # shadcn/ui primitives (Button, Dialog, etc.)
    features/            # Feature-level composite components
  hooks/                 # Custom React hooks (use-*.ts)
  lib/
    api/                 # External service clients (radarr.ts, sonarr.ts, plex.ts, etc.)
    db/                  # Drizzle DB setup and schema
    auth.ts              # NextAuth config
  store/                 # Zustand global state (app-store.ts)
  types/                 # Centralized TypeScript interfaces and enums (index.ts)
drizzle/                 # Generated migration files
public/                  # Static assets
```

---

## Code Style

### Imports

- **Always use the `@/` path alias** for internal imports — never relative paths like `../../`.
  ```ts
  import { useAppStore } from '@/store/app-store';
  import { RadarrMovie } from '@/types';
  import { createRadarrClient } from '@/lib/api/radarr';
  ```
- Use named imports from external packages where possible; default import only when the library requires it.
  ```ts
  import axios, { AxiosInstance } from 'axios';
  import { useEffect, useState } from 'react';
  ```

### Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Classes | PascalCase | `RadarrClient`, `PlexAuthClient` |
| React components | PascalCase | `PlexLogin`, `MediaCard` |
| Interfaces / Types | PascalCase | `RadarrMovie`, `PlexServer` |
| Enums | PascalCase | `TransmissionStatus` |
| Functions / variables | camelCase | `createRadarrClient`, `useSearch` |
| Custom hooks | camelCase, `use` prefix | `useMedia`, `usePushNotifications` |
| Files (non-page) | kebab-case | `use-media.ts`, `plex.ts` |

### Exports

- **Named exports** for all library code, utilities, hooks, and components under `src/lib/`, `src/hooks/`, `src/store/`, `src/components/`.
  ```ts
  export class RadarrClient { ... }
  export function createRadarrClient(): RadarrClient | null { ... }
  export interface RadarrMovie { title: string; tmdbId: number; }
  ```
- **Default exports** only for Next.js page files (`src/app/**/page.tsx`, `src/app/**/layout.tsx`).
  ```ts
  export default function LoginPage() { return <Login />; }
  ```

### TypeScript

- All public functions and methods **must have explicit return types**.
- Use `interface` for object shapes; use `type` for unions, utility types, and mapped types.
- Use generics on axios calls to type responses:
  ```ts
  const { data } = await this.client.get<RadarrMovie[]>('/api/v3/movie');
  ```
- Shared types live in `src/types/index.ts` — add new shared types there, not inline in component files.
- **Never use `any`** — prefer `unknown` and narrow with type guards. Never use `@ts-ignore` or `@ts-expect-error`.

### Error Handling

- Wrap all async external calls (HTTP, DB) in `try/catch`.
- For axios errors, always check `axios.isAxiosError(error)` before accessing `error.response`:
  ```ts
  try {
    const { data } = await this.client.post<T>(url, payload);
    return { success: true, data };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      // normalize and handle
    }
    throw error; // or return safe fallback
  }
  ```
- API utility functions (in `src/lib/api/`) return safe fallbacks (boolean, empty array, structured result object) rather than throwing to callers unless the error is unrecoverable.
- React hooks use `console.error` for logging and surface user-visible errors via the app store's alert mechanism.

### React & Next.js

- Use the **App Router** — no `pages/` directory patterns.
- API routes go in `src/app/api/**/route.ts` using `NextRequest`/`NextResponse`.
- Use `async`/`await` in Server Components and Route Handlers; keep Client Components minimal.
- Mark client components with `'use client'` only when hooks or browser APIs are needed.

---

## Docker

```fish
# Run from the repository directory, with .env configured and Docker running.
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Inspect the same stack.
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=80 queuearr

# Production configuration only.
docker compose up --build
```

`next.config.ts` sets `output: 'standalone'` for containerized deployment.
The app is available at `http://localhost:3000`. Compose starts Queuearr only;
Plex, Radarr, Sonarr, and Transmission must already be reachable at their
configured URLs. Inside a container, `localhost` refers to that container. Use
`host.docker.internal` for services running directly on the Mac.

The dev override does not require a certificate. If local services require a
custom CA, provide an actual `./plex-local.pem` file and add
`-f docker-compose.cert.yml` after the dev override. This mounts the certificate
read-only under `/run/queuearr-certs/` and sets `NODE_EXTRA_CA_CERTS` and
`SERVICE_CA_CERT_PATH`. Service-specific `*_CA_CERT_PATH` values take precedence;
if configured, those must also point to files inside the container. Its bind
mount rejects missing paths instead of creating a directory. Do not create an
empty certificate or disable TLS verification. Remove any obsolete
`NODE_EXTRA_CA_CERTS=/app/plex-local.pem` setting from the local `.env` when
running without the certificate override. Preserve existing data volumes when
stopping or restarting the stack.

Example new pane in the existing session:

```fish
tmux split-window -v -t '=queuarr' -c /Users/grimaldev/code/projects/queuarr fish -c 'docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build; exec fish'
```

---

## Key Config Files

| File | Purpose |
|---|---|
| `tsconfig.json` | TypeScript config — strict mode, `@/` alias |
| `eslint.config.mjs` | ESLint — Next.js core-web-vitals + TypeScript |
| `drizzle.config.ts` | Drizzle ORM — SQLite, schema path, migrations output |
| `next.config.ts` | Next.js — standalone output, image domains, SW headers |
| `postcss.config.mjs` | PostCSS — Tailwind CSS plugin |
| `components.json` | shadcn/ui component registry config |
