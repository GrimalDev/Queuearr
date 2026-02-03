# Queuearr Setup Guide

This guide walks you through configuring Queuearr with Radarr, Sonarr, Transmission, and Plex OAuth.

## 1. Prerequisites

- Node.js 18+
- Radarr and/or Sonarr running with API access
- Transmission running with RPC enabled
- Plex account (required for login)

## 2. Create your `.env`

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

Then update the values in `.env`:

### Generate a secure NEXTAUTH_SECRET

```bash
openssl rand -base64 32
```

## 3. Find service API keys

### Radarr / Sonarr API keys

1. Open Radarr or Sonarr in the browser.
2. Go to Settings → General → Security.
3. Copy the API Key.

### Plex server machine identifier (required restriction)

Queuearr restricts access to a specific Plex server:

1. Go to http://<your-local-plex>/identity
2. Copy the `machineIdentifier`.
3. Paste it into `PLEX_SERVER_MACHINE_IDENTIFIER`.

## 4. Start Queuearr (local)

```bash
npm/bun install
npm/bun run dev
```

Open http://localhost:3000 and sign in with Plex.

## 5. Start Queuearr (Docker)

The compose file is self-contained and uses environment variables directly.

### Build + run with Docker Compose

1. Ensure your `.env` is populated.
2. Run:

```bash
docker-compose up -d --build
```

Queuearr will be available at http://localhost:3000

### Run from a pre-built image

```bash
docker build -t queuearr:latest .
docker run -p 3000:80 \
  -e NEXTAUTH_URL=http://localhost:3000 \
  -e NEXTAUTH_SECRET=change-me \
  -e PLEX_CLIENT_ID=queuearr-docker \
  -e RADARR_URL=http://host.docker.internal:7878 \
  -e RADARR_API_KEY= \
  -e SONARR_URL=http://host.docker.internal:8989 \
  -e SONARR_API_KEY= \
  -e TRANSMISSION_URL=http://host.docker.internal:9091 \
  -e TRANSMISSION_USERNAME= \
  -e TRANSMISSION_PASSWORD= \
  queuearr:latest
```

## 6. Verify connections

Open the **Settings** page in the app to see connection status for:

- Radarr
- Sonarr
- Transmission

If any service shows “Not configured” or “Error”, verify the URL and API key and restart the app.

## 7. Common issues

### “Radarr/Sonarr not configured”

Double‑check the URL and API key. Then restart the app.

### “Transmission not configured”

Verify the RPC endpoint is reachable (usually `http://host:9091/transmission/rpc`).

### Plex login fails

Ensure `PLEX_CLIENT_ID` is set. If you set `PLEX_SERVER_MACHINE_IDENTIFIER`, make sure your user has access to that server.

## Sequence Diagram: User Login Flow

```
┌─────────────┐         ┌──────────┐         ┌─────────────┐         ┌─────────────┐
│   Browser   │         │ Queuearr │         │  Plex API   │         │   Session   │
│             │         │ Backend  │         │             │         │   Store     │
└──────┬──────┘         └────┬─────┘         └──────┬──────┘         └──────┬──────┘
       │                     │                      │                        │
       │ 1. Click Login      │                      │                        │
       ├────────────────────>│                      │                        │
       │                     │ 2. POST /api/plex/pin                         │
       │                     ├─────────────────────>│                        │
       │                     │<─────────────────────┤ 3. Return PIN & URL   │
       │<────────────────────┤                      │                        │
       │ 4. Show PIN status  │                      │                        │
       │                     │                      │                        │
       │ 5. Open Plex Auth   │                      │                        │
       │    (window)         │                      │                        │
       │                     │                      │                        │
       │ 6. Plex Login       │                      │                        │
       ├─────────────────────────────────────────────────────────────────>  │
       │                     │                      │                        │
       │ 7. Poll PIN Status  │                      │                        │
       │ GET /api/plex/pin   │                      │                        │
       ├────────────────────>│ 8. GET /pins/{id}    │                        │
       │ (every 2 seconds)   ├─────────────────────>│                        │
       │                     │<─────────────────────┤ 9. Pin complete?      │
       │                     │    authToken         │                        │
       │<────────────────────┤                      │                        │
       │                     │                      │                        │
       │ 10. signIn('plex')  │                      │                        │
       │     {authToken}     │                      │                        │
       ├────────────────────>│ 11. authorize()      │                        │
       │                     │                      │                        │
       │                     │ 12. GET /user        │                        │
       │                     ├─────────────────────>│                        │
       │                     │ (with authToken)     │                        │
       │                     │<─────────────────────┤ 13. User data         │
       │                     │                      │                        │
       │                     │ 14. GET /resources   │                        │
       │                     ├─────────────────────>│                        │
       │                     │ (server list)        │                        │
       │                     │<─────────────────────┤ 15. Servers           │
       │                     │                      │                        │
       │                     │ 16. Validate access  │                        │
       │                     │ to configured server │                        │
       │                     │                      │                        │
       │                     │ 17. Create JWT       │                        │
       │                     ├───────────────────────────────────────────────>│
       │                     │                      │ 18. Store session     │
       │                     │                      │                        │
       │<────────────────────┤ 19. Session OK       │                        │
       │ 20. Redirect to /   │                      │                        │
       │                     │                      │                        │
       │ 21. Request /       │                      │                        │
       ├────────────────────>│ 22. Verify session   │                        │
       │                     ├───────────────────────────────────────────────>│
       │                     │                      │ 23. Valid?            │
       │<────────────────────┤ 24. Return dashboard │                        │
       │ Dashboard           │                      │                        │
       │                     │                      │                        │
```

---
