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

## Container user and database permissions

`PUID` and `PGID` select the application identity at container startup. They default
to `1001:1001`. In Dokploy, set them under Environment, save, and rebuild/redeploy
the image. For media services using `1000:1000`, configure:

```dotenv
PUID=1000
PGID=1000
```

Startup briefly runs as root to prepare the dedicated database directory, SQLite
DB/WAL/SHM files, migration lock, and Next.js output/cache. It then drops to the
configured UID/GID before starting Node. Media mounts and their ownership are
left alone. No Patches or Run Command changes are needed. Do not override the
container user or entrypoint when relying on this setup. IDs must be positive
integers; running the app as root is rejected.

For an existing SQLite deployment, keep one replica and use the Swarm stop-first
update order when switching identities. The database must remain on local storage.
If its filesystem refuses ownership changes, grant the configured user access on
the storage host. Startup reports the blocked directory or file and stops before
running the app when permissions cannot be prepared. These variables affect the
Docker image only; host `npm` commands use the shell user's identity.

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

Push notifications require a browser-trusted HTTPS certificate and both
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the running container.
Generate a pair once with `npx web-push generate-vapid-keys`, then store it in
Dokploy's environment settings. Keep the private key secret and preserve the pair
across deployments. Set `VAPID_SUBJECT` to a contact email such as
`mailto:admin@example.com`, then redeploy the container.

The browser loads the public key from the authenticated `/api/push/subscribe`
endpoint at runtime, so Docker images do not need a key embedded during build.
A certificate error on `/sw.js` blocks push registration even if the page opens.
Install a trusted certificate or trust the issuing local CA on the client device.
Queuearr reports setup errors and closes the reminder only after the server
confirms the subscription. Existing browser subscriptions are registered again
on login, including after a database restore.


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

Unused managed audio profiles are checked at startup and hourly. A profile must
be observed unused at least an hour apart before it is removed. Cleanup
checks the generated configuration fingerprint and current movie assignments,
shares the profile-creation lock, and preserves manually edited profiles and
configured base profiles. Radarr also protects profiles used by import lists or
collections. Shared custom formats are retained. Failed or busy cleanup runs
retry after five minutes; results are recorded in the server logs.

The worker checks requests every 30 seconds and searches at most once every 15
minutes per waiting request. Adding a language first queues an explicit search
for a complete movie containing every explicitly requested language. An eligible
release at equal or better quality replaces the whole movie through Radarr;
the old file cannot complete the request before the replacement is imported.
Only a successful search with no eligible full replacement enables the separate
audio donor fallback. A failed or still-running search does not start a donor.
Retries exclude individual rejected releases and still consider other complete
replacements. Adding another language while a donor is active starts a new full
replacement search; a superseded unfinished donor is paused and its data kept.
The Downloads card starts as a movie replacement search and becomes an audio
download only when the donor fallback is selected. No environment switch is required.

For an initial movie download, the worker reads Radarr's release decisions and
explicitly grabs an accepted release, preserving quality and language rules.
It waits for any active Radarr movie search instead of starting a competing grab.
No accepted result produces **Error** on the card and a summary in server logs;
the worker checks again after 15 minutes. When Radarr identifies a movie as still
in cinemas and the search returns no eligible release, the card instead shows
**Still in cinemas. No suitable release is available yet.** This also applies to
initial movie downloads with a language request. Connection and service errors
remain generic. Cinema searches retain automatic retries and manual retry controls.
A submitted release shows its indexer
and **Waiting for the download client**. Queuearr does not resubmit an uncertain
grab. If no download appears within five minutes, it logs the problem and pauses
the request for review.

Older tracked movie requests without worker jobs are recovered on startup and
subsequent worker ticks. Recovery keeps their current Radarr quality/language
profile and requester associations. It does not start work for cancelled or
completed requests, active transfers, or tracking rows without a requester.
Existing audio policies retain their audio worker; ordinary movies use a durable
search job without changing Radarr configuration. Movies already present are
completed without another grab.

New ordinary movie and series requests save tracking, requesters, and a search
job in one SQLite transaction before external search/grab calls. Season and
episode selections are persisted and reused on retries. Legacy series requests
without a saved selection show **Error** with **Retry search**. Clicking retry
saves a series search using Sonarr's current monitored seasons and episodes.
Startup recovery does not automatically search these legacy series. Saved season
and episode selections remain unchanged. Recovered requests retain the existing
five-minute manual retry cooldown and admin override.

Error cards for blocked/failed imports offer retry even if the service reports
an import-related status. The server rechecks ownership, queue IDs, active imports,
and audio publication safeguards before changing a download.

Indexer names are saved by torrent hash when available in Radarr/Sonarr's queue.
For unmatched Transmission torrents in the admin **All downloads** view, Queuearr
also checks Radarr/Sonarr grab history in bounded background batches. Confirmed
names appear on subsequent polls and survive restarts. History failures do not
delay download updates; missing matches remain **Indexer unavailable**. Filenames
and tracker URLs are not used to guess the indexer. This metadata does not change
request ownership, filtering, or download controls.

### Separate audio downloads and merging

Movies, series, and additional audio share the Downloads card design. Movie
requests and regrabs appear immediately in **Searching**, with a **View downloads**
link. Saved jobs keep them visible across reloads and turn into transfer cards
without duplicates. The same request card follows Search, Download, Import, and
Ready. Language requests add an Audio stage for checks, merging or replacement.
Ready requires a confirmed library file and every requested language, ready for
Plex's normal scan. Seeding alone never confirms import. Recent ready cards stay
visible for 24 hours, capped at 100 completed requests.

All download cards show one audio pill with short codes, such as **Audio: FR, EN**.
It uses verified library languages when ready, release estimates during download,
and the requested language while search results are unknown. The tooltip identifies
the source and full language names. Estimates come from release/queue metadata or
exact torrent-hash history matches; languages are not guessed from MULTI.
Magnets waiting for peers show **Fetching torrent metadata** instead of a zero-byte download. Animations
respect reduced-motion preferences. Indexer names are saved for newly selected
releases; older jobs can show **Indexer unavailable**.

**Try another release** switches an unfinished audio donor to a different eligible
source. Requesters and administrators can use it before validation or publication.
The worker verifies ownership and pauses the old donor, retains its files, and
remembers rejected release digests and torrent hashes across restarts. If it
finishes before the switch, it stays available for audio checks. Transient failures
preserve the switch request; uncertain ownership and publication still require
review. The retry does not bypass language, quality, edition, or synchronization
checks. Ordinary movie retries use Radarr's existing blocklist/retry handling.

Searching cards also offer **Cancel search**, including during the retry cooldown.
The requester or an administrator can remove the pending Queuearr request and
stop its audio worker job. Existing library files and saved language preferences
are kept, and a new request can start the search again.
Active cards offer **Cancel download**, including isolated audio donors.
Cancellation stops the saved job and removes its matching service queue entries.
Audio donors are paused and removed from Transmission without deleting their
files. Exact donor ownership and isolation are rechecked; active import and file
publication cannot be interrupted. Failed cancellation stays reserved for a safe
retry, so a worker cannot restart it. It does not abort a search command already
running inside Radarr or Sonarr.

Active downloads appear first, earliest start first. Importing, problem, and
waiting/searching cards follow. Ordering uses Transmission's start time, falling
back to its added time and then the Queuearr request time when unavailable.

Manual retries have a five-minute cooldown after the initial request and each
retry attempt. The deadline is stored in SQLite and shown as a countdown, so
refreshing the page does not reset it. The countdown appears inside the retry
button. Administrators can use **Retry now (m:ss)** to override the timer; media
ownership and publication checks still apply.
Searching cards offer **Retry search** when no release has entered the queue.
**My downloads** includes only requests the user follows; **All downloads** keeps
the shared view. Seeing another user's title does not grant retry access. Late
responses are discarded when the filter, account, or role changes. Adding a
series with automatic searching disabled does not create an active download.

Transfer snapshots are cached for 15 seconds by default. Expired snapshots wait
for a live response; a failed refresh reports a service error instead of keeping
removed torrents visible. Refresh bypasses the queue caches. An older in-flight
response cannot repopulate a cache after invalidation or a newer forced refresh.

Configure the shared folders below for the automatic merging fallback.
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
Queuearr defaults to UID/GID 1001:1001. Set `PUID=1000` and `PGID=1000` to match
Radarr and Transmission running as 1000:1000, or grant both identities access to
the shared media folders. Queuearr needs
read/write/traverse permissions on all three mounts and read access to source
files. Transmission must also be able to write into donor folders created by
Queuearr. Use a shared writable group or access and default ACLs so newly created
files and folders retain access for both services. Existing bind mounts keep
their host permissions; image ownership does not change them.

An `EACCES` log means permission denied. Filesystem failures include their
operation and container path in server logs. Check ownership, parent directory
traversal, and share ACLs on the host or storage server for the corresponding
mount. The frontend continues to show only **Error**.

In Swarm, use one Queuearr replica on the node with these mounts and its SQLite
volume; do not share SQLite across hosts over network filesystems.

Donor metadata requests follow at most three redirects within a 20-second budget.
An HTTP redirect to a magnet link is passed to Transmission without trying to
fetch it as a web page. HTTP(S) redirects and direct torrent files are also
supported. Unsupported protocols, HTTPS downgrades, missing redirect destinations,
and non-torrent responses stop the request. Metadata is limited to 2 MiB.
Indexer HTTPS requests use `SERVICE_CA_CERT_PATH` or an optional
`INDEXER_CA_CERT_PATH` override while retaining public certificate authorities.
TLS verification remains enabled. Radarr headers and cookies are not forwarded
to the indexer or redirect destination; URL tokens stay out of logs.

Queuearr adds donor torrents paused in an isolated folder with a dedicated
`queuearr-audio-*` label, records them, then starts them. Configure Radarr's
Transmission download client with a **nonempty category distinct from those
labels** so Radarr never imports the donor as a replacement. Unknown rejection
reasons, blocked releases, wrong movies/editions and disallowed qualities are
not bypassed. A donor's rejection for missing the *other* requested languages
or not improving the existing file can be bypassed only if its base quality
profile rules still pass.

When a donor contains every existing and requested audio language and its saved
quality is equal or better in the base Radarr profile, Queuearr replaces the
whole movie with that donor's video and audio together. Edition and revision
checks still apply. This avoids combining audio with another cut's video.
FFprobe confirms the tracks, and FFmpeg preserves and verifies the donor streams.
The original movie is backed up and seeding files remain unchanged. After rescan,
Queuearr records the replacement quality in Radarr before marking Ready, preserving
the analyzed languages and preventing old filename quality tags from affecting
future upgrade decisions. If the donor
is incomplete or its quality cannot replace the current movie, it uses the
synchronization checks below.

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

Transmission version and Radarr isolation checks report separate failure reasons
in server logs, identifying the Radarr client when applicable. Configuration
failures retry every 15 minutes and show only **Error** on the movie card.
Requests paused by the older combined configuration error are rechecked
automatically, without resuming file or synchronization failures.

A job that needs review stops automated work for that movie. Its card displays
only **Error**. Technical error details are kept in server logs, including the
movie's TMDB ID, and are not returned in audio status or search responses.
There is no retry button on the movie card. After resolving the
reported file, metadata or synchronization issue, an authenticated administrator
can requeue the job through `POST /api/radarr/audio/retry` with its `tmdbId`.
Retrying retains the existing donor and rechecks the files. Service connection
failures are retried automatically; uncertain merge results are never accepted
as successful downloads.
