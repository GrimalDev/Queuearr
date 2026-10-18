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

## Notifications

Admin Settings supports multiline notification messages, including blank lines
and indentation. Formatting is preserved in storage, notification history, and
the Service Notifications page. Messages are limited to 1,000 characters.

Use Edit in Notification History to change a saved notification's title, message,
or link. Saving does not send another push notification or reset its send time
or read status. Native push notification appearance depends on the device.

## Voluntary payments

Voluntary payment prompts are disabled by default. Set
`FAKE_PAYWALL_ENABLED=true` in `.env` and recreate the Docker container to enable
them. False or unset overrides the Admin Settings switch and disables payment
confirmations. Existing payment records and settings are preserved.

When enabled, signed-in users other than admins see a payment reminder when they
open or return to Queuearr. Admins are exempt from payment reminders.
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

## Movie audio requests

Movie search includes **Original**, **English**, and **French** audio choices.
Original uses the movie's language from Radarr/TMDB. Requests accumulate across
users: asking for French does not remove an earlier English request or a known
language in the current file. The language dropdown sits beside **Grab** for a
first download or **Already available · Regrab** for an existing movie. Green
check marks identify audio already present. Both actions remain enabled when
that language exists; the old available-language list is removed.

Regrab manually submits a matching release through Radarr even when the current
file meets its cutoff. It retains all required languages and requires the same
quality or better. Blocklisted, wrong-movie, wrong-edition and unrelated rejected
releases are not accepted. If no suitable release exists, the card shows an
error and the current file remains in place. An active download is not duplicated.
Completion notifications wait for a replacement to be imported, rather than
counting the previous file as a finished regrab. Other audio requests still wait
for every requested language.

Queuearr copies the movie's base quality profile into a managed Radarr profile.
It preserves allowed qualities and existing custom-format scores, sets profile
language to Any, enables upgrades, and rejects releases missing required audio.
The shared base profile is not modified. Do not edit Queuearr-managed profiles or
custom formats. For a new movie, Radarr first obtains a base file with one requested
language; the worker then applies the combined language requirements.

The worker checks requests every 30 seconds and searches at most once every 15
minutes per waiting request. It prefers an eligible release containing every
required language. With `AUDIO_MERGE_ENABLED=false`, this is the only download
path. Requests remain pending if no suitable multi-audio release is available.

### Optional separate audio downloads

Set `AUDIO_MERGE_ENABLED=true` only after configuring the shared folders below.
The Docker image includes FFmpeg and FFprobe. Host development needs both tools
on PATH. This fallback requires Transmission 4+ and supports torrents only.

Container paths are fixed. Set the host folders directly in
`docker-compose.audio.yml`:

| Host folder | Container path | Purpose |
|---|---|---|
| `/mnt/plex/myflix/movies` | `/movies` | Existing movies, matching Radarr |
| `/mnt/plex/myflix/downloads/queuearr-audio` | `/data/queuearr-audio` | Extra downloads, matching Transmission |
| `/mnt/plex/myflix/audio-backups` | `/audio-backups` | Original-file backups |

Append `-f docker-compose.audio.yml` to the base/dev command, or add these mounts
to the Swarm service. No path environment variables are needed. Create the host
folders first; the override refuses to create missing folders. Keep them separate
and non-nested, with enough space and permissions for Queuearr and Transmission.
Queuearr runs as UID 1001. In Swarm, use one Queuearr replica on the node with
these mounts and its SQLite volume; do not share SQLite across hosts over network
filesystems.

Queuearr adds donor torrents paused in an isolated folder with a dedicated
`queuearr-audio-*` label, records them, then starts them. Configure Radarr's
Transmission download client with a **nonempty category distinct from those
labels** so Radarr never imports the donor as a replacement. Unknown rejection
reasons, blocked releases, wrong movies/editions and disallowed qualities are
not bypassed. A donor's rejection for missing the *other* requested languages
or not improving the existing file can be bypassed only if its base quality
profile rules still pass.

FFprobe checks language tags and timing. FFmpeg compares every decoded video
frame and timestamp before copying the original streams plus the requested
non-commentary audio into an MKV. MP4, MKV, AVI and supported MPEG inputs can be
used. Video and audio are copied without re-encoding; MP4 timed-text subtitles
are converted to SubRip. An unsupported stream/container combination stops the
merge rather than silently dropping a stream.

Automatic synchronization is deliberately conservative: different video
encodes, cuts, frame rates or offsets require review even when they might be
manually alignable. Matching runtime alone is not enough. The worker does not
automatically stretch or shift audio, and does not detect an already incorrect
audio synchronization in the donor release. Source audio must be tagged with a
recognized language; an untagged track is not guessed from the release name.

The worker stages output in a hidden folder excluded by Radarr scans, validates
the merged file, checks that source files have not changed,
backs up the original, briefly disables Radarr monitoring, publishes the MKV,
and requests a Radarr rescan. Monitoring is restored afterwards and after an
interrupted attempt. Seeding files are never modified in place. Donor torrents
and original backups are retained; administrators manage their later cleanup.
Avoid manual imports/upgrades for the same movie during publication.

Plex discovers the result through its normal library scan or your Radarr/Plex
connection. Enable automatic library scans or scan the library manually. Queuearr
does not itself trigger a Plex scan. Tagged tracks appear in Plex's audio menu.

A **needs review** message stops automated work for that movie. Resolve the
reported file, metadata or synchronization issue, then use **Retry after review**
on the movie card while signed in as an administrator. Retrying retains the
existing donor and rechecks the files. Service
connection failures are retried; uncertain merge results are never accepted as
successful downloads.
