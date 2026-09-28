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

## Voluntary payments

Voluntary payment prompts are disabled by default. Set
`FAKE_PAYWALL_ENABLED=true` in `.env` and recreate the Docker container to enable
them. False or unset overrides the Admin Settings switch and disables payment
confirmations. Existing payment records and settings are preserved.

When enabled, signed-in users see a payment reminder when they open or return to Queuearr.
Pay later keeps access open for the visit; navigating between pages does not
show another reminder. Pay now opens a QR code and payment link. Only clicking
I've paid records a self-reported payment and pauses reminders for one calendar
month. At month-end, the date is capped to the last day of the next month.
Repeated confirmations during an active month do not extend that month.

Admin Settings includes an editable payment URL, a QR preview, and a switch to
disable reminders. Once the environment flag is enabled, the default payment URL
is `https://revolut.me/grimaldev`. The Users list shows reported payments, reminder
expiry, and how often each user chose Pay later. Use Refresh to update the list.
There is no transfer verification or automatic charge, and payment never controls
Plex access or access to Queuearr features.

Migration `0010_voluntary_payments` adds payment fields and settings. It runs
automatically on startup and preserves existing users and tokens.

## Roadmap

[x] Radarr/Sonarr search
[x] Sending Download request
[x] Monitor Download status
[x] Profile option
[] Select and save video content language and video quality
[] Select language setting on the website

## License

MIT
