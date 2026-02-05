# Queuearr

A simple web interface for searching and adding movies/series to Radarr or Sonarr, then monitoring their progress in download clients like Transmission while detecting issues.

## Features

- **Unified Search Bar**: Quickly find films, series, or any video content and add directly to Radarr/Sonarr
- **Download Tracking**: Monitors if items reach Transmission (or similar clients) and watches progress
- **Problem Detection**: Alerts for stalled downloads, missing files, or other issues
- **Secure Access**: Plex OAuth authentication for easy, safe logins

## Tech Stack

- Next.js 15 with App Router
- TypeScript
- Tailwind CSS + shadcn/ui
- Zustand
- NextAuth.js with Plex OAuth
- Radarr, Sonarr, Transmission APIs

## Getting Started

See the full setup guide in [docs/SETUP.md](docs/SETUP.md).

## Roadmap

[x] Radarr/Sonarr search
[x] Sending Download request
[] Monitor Download status
[] Profile option
[] Select and save video content language and video quality
[] Select language setting on the website

## License

MIT
