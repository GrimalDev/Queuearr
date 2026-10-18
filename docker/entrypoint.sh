#!/bin/sh
set -eu

fail() {
  echo "[startup] $*" >&2
  exit 1
}

validate_id() {
  case "$2" in
    ''|*[!0-9]*|0*) fail "$1 must be a positive numeric ID, not root." ;;
  esac
  [ "${#2}" -le 10 ] && [ "$2" -le 2147483647 ] || fail "$1 is out of range."
}

PUID=${PUID-1001}
PGID=${PGID-1001}
export PUID PGID
validate_id PUID "$PUID"
validate_id PGID "$PGID"

[ "$#" -gt 0 ] || fail 'No application command was supplied.'
data_dir=${QUEUEARR_DATA_DIR:-/app/data}
[ ! -L "$data_dir" ] || fail 'The database directory must not be a symbolic link.'
mkdir -p "$data_dir"
data_dir=$(readlink -f "$data_dir")
case "$data_dir" in
  /|/app|/app/.next|/data|/movies|/movies/*|/audio-backups|/audio-backups/*|/data/queuearr-audio|/data/queuearr-audio/*)
    fail 'QUEUEARR_DATA_DIR must be a dedicated database directory, separate from application and media folders.' ;;
esac
export QUEUEARR_DATA_DIR="$data_dir"

if [ "$(id -u)" -eq 0 ]; then
  # Only Queuearr's database files and image-owned Next.js output are prepared.
  # Never recursively change ownership of the shared media mounts.
  chown "$PUID:$PGID" "$data_dir" || fail "Cannot prepare database directory $data_dir. Check host ownership and share permissions."
  chmod u+rwx "$data_dir"
  for name in queuearr.db queuearr.db-wal queuearr.db-shm .migration.lock; do
    file="$data_dir/$name"
    [ ! -L "$file" ] || fail "Database file $file must not be a symbolic link."
    if [ -e "$file" ]; then
      [ -f "$file" ] || fail "$file must be a regular file."
      chown "$PUID:$PGID" "$file" || fail "Cannot prepare $file. Check host ownership and share permissions."
      chmod u+rw "$file"
    fi
  done
  [ ! -L /app/.next ] || fail 'The Next.js output directory must not be a symbolic link.'
  mkdir -p /app/.next/cache
  find /app/.next -xdev \( -type d -o -type f \) -exec chown "$PUID:$PGID" '{}' +
  exec su-exec "$PUID:$PGID" "$0" "$@"
fi

[ "$(id -u)" = "$PUID" ] && [ "$(id -g)" = "$PGID" ] ||
  fail 'The container user override does not match PUID/PGID. Remove the override so startup can switch identities.'
[ -r "$data_dir" ] && [ -w "$data_dir" ] && [ -x "$data_dir" ] ||
  fail "Database directory $data_dir is not accessible to $PUID:$PGID."
for name in queuearr.db queuearr.db-wal queuearr.db-shm .migration.lock; do
  file="$data_dir/$name"
  [ ! -L "$file" ] || fail "Database file $file must not be a symbolic link."
  if [ -e "$file" ]; then
    [ -f "$file" ] && [ -r "$file" ] && [ -w "$file" ] ||
      fail "Database file $file is not readable and writable by $PUID:$PGID."
  fi
done
[ -w /app/.next/cache ] || fail "Next.js cache is not writable by $PUID:$PGID."
echo "[startup] Starting Queuearr as $PUID:$PGID"
exec "$@"
