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

## Invitations

Unaccepted invites expire seven days after sending. Resending starts a new
seven-day period. Admin Settings shows the expiration date and refreshes the
invite list every 30 seconds.

Queuearr removes invites after successful sign-in and reconciles existing records
on startup, every minute, and when the admin invite list is loaded. Accepted Plex
shares keep their access. Expired pending Plex invitations are cancelled before
their local records are removed. Failed Plex checks or cancellations are retried,
with a warning in Admin Settings.

The policy applies to existing invites using their last send date. Legacy invites
without a send date are treated as expired. Cleanup requires Queuearr to be running;
after downtime it runs on startup. No database migration is needed.

## Roadmap

[x] Radarr/Sonarr search
[x] Sending Download request
[] Monitor Download status
[] Profile option
[] Select and save video content language and video quality
[] Select language setting on the website

## License

MIT
