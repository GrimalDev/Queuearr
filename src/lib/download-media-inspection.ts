import { execFile } from 'node:child_process';
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { confinedFile, languageCodes } from '@/lib/movie-audio-media';
import { isDescriptiveAudioStream, isMainAudioStream, type AudioStreamMetadata } from '@/lib/audio-description';
import type { RadarrLanguage } from '@/types';
import type { InspectionTorrent } from '@/lib/api/transmission';

export const INSPECTION_PREFIX_BYTES = 32 * 1024 * 1024;
const MEDIA_EXTENSION = /\.(mkv|mp4|m4v|avi|ts|m2ts|mpg|mpeg)$/i;

export async function hasInspectionMount(torrent: InspectionTorrent): Promise<boolean> {
  const root = torrent.downloadDir.startsWith('/data/queuearr-audio/') ? '/data/queuearr-audio' : '/data/transmission';
  return realpath(root).then(() => true, () => false);
}

export function isMediaFilename(name: string): boolean {
  return MEDIA_EXTENSION.test(name) && !/(^|[\/._ -])(sample|trailer)([\/._ -]|$)/i.test(name);
}

export function hasUnsafeTorrentFiles(files: { name: string }[]): boolean {
  return files.some((file) => /\.(exe|com|scr|msi|bat|cmd|ps1|lnk|zipx)$/i.test(file.name)) ||
    !files.some((file) => isMediaFilename(file.name)) && files.some((file) => /\.(zip|rar|7z)$/i.test(file.name));
}

/** Count only hash-verified contiguous pieces, never sparse file length or aggregate bytesCompleted. */
export function verifiedFilePrefix(torrent: InspectionTorrent, index: number): number {
  const file = torrent.files[index];
  if (!file || !Number.isSafeInteger(torrent.pieceSize) || torrent.pieceSize <= 0) return 0;
  const offset = torrent.files.slice(0, index).reduce((sum, item) => sum + item.length, 0);
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(file.length) || file.length <= 0) return 0;
  const pieces = Buffer.from(torrent.pieces, 'base64');
  let position = offset;
  while (position < offset + file.length && position - offset < INSPECTION_PREFIX_BYTES) {
    const piece = Math.floor(position / torrent.pieceSize);
    if (!(pieces[Math.floor(piece / 8)] & (1 << (7 - piece % 8)))) break;
    position = Math.min((piece + 1) * torrent.pieceSize, offset + file.length);
  }
  return Math.min(file.length, INSPECTION_PREFIX_BYTES, position - offset);
}

function vint(buffer: Buffer, offset: number, keepMarker: boolean): { value: number; next: number; unknown: boolean } | undefined {
  const first = buffer[offset];
  if (!first) return;
  let length = 1;
  while (length <= 8 && !(first & (1 << (8 - length)))) length++;
  if (length > 8 || offset + length > buffer.length) return;
  let value = keepMarker ? first : first & ((1 << (8 - length)) - 1);
  let unknown = !keepMarker && value === ((1 << (8 - length)) - 1);
  for (let n = 1; n < length; n++) { value = value * 256 + buffer[offset + n]; unknown = unknown && buffer[offset + n] === 255; }
  return { value, next: offset + length, unknown };
}

/** A partial probe must contain the complete track table before it can reject an AD-only language. */
export function hasCompleteTrackHeader(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.readUInt32BE(0) === 0x1a45dfa3) {
    let offset = 0;
    for (let count = 0; offset < buffer.length && count < 1024; count++) {
      const id = vint(buffer, offset, true);
      const size = id && vint(buffer, id.next, false);
      if (!id || !size) return false;
      if (id.value === 0x18538067) { offset = size.next; continue; }
      if (size.unknown || !Number.isSafeInteger(size.value) || size.value < 0 || size.next + size.value > buffer.length) return false;
      if (id.value === 0x1654ae6b) return size.value > 0;
      offset = size.next + size.value;
    }
    return false;
  }
  for (let offset = 0, count = 0; offset + 8 <= buffer.length && count < 1024; count++) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) return false;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      size = Number(large); headerSize = 16;
    }
    if (size < headerSize || offset + size > buffer.length) return false;
    if (type === 'moov') return true;
    offset += size;
  }
  return false;
}

function probe(path: string): Promise<AudioStreamMetadata[]> {
  return new Promise((resolveProbe, reject) => {
    execFile('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,mov,avi,mpeg,mpegts',
      '-analyzeduration', '0', '-probesize', '1048576', '-show_entries', 'stream=codec_type:stream_tags=language,title:stream_disposition', '-of', 'json', path],
    { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error('Audio inspection is incomplete.')); return; }
      try {
        const data = JSON.parse(stdout) as { streams?: AudioStreamMetadata[] };
        if (!Array.isArray(data.streams) || !data.streams.some((stream) => stream.codec_type === 'audio')) throw new Error();
        resolveProbe(data.streams);
      } catch { reject(new Error('Audio inspection is incomplete.')); }
    });
  });
}

export function hasOnlyDescriptiveRequestedAudio(streams: AudioStreamMetadata[], required: RadarrLanguage[]): boolean {
  const audio = streams.filter((stream) => stream.codec_type === 'audio');
  if (!required.length) return audio.length > 0 && audio.every(isDescriptiveAudioStream);
  return required.some((language) => {
    let codes: string[];
    try { codes = languageCodes(language); } catch { return false; }
    const matching = audio.filter((stream) => codes.includes(stream.tags?.language?.toLowerCase().split('-')[0] ?? '') &&
      (isMainAudioStream(stream) || isDescriptiveAudioStream(stream)));
    // An untagged track might be normal audio in the requested language. Do not reject on that ambiguity.
    return !audio.some((stream) => (!stream.tags?.language || /^(?:und|unknown|mul|zxx)$/i.test(stream.tags.language)) && isMainAudioStream(stream)) &&
      matching.length > 0 && matching.every(isDescriptiveAudioStream);
  });
}

export async function inspectTorrentFile(torrent: InspectionTorrent, index: number, incompleteDirectory?: string): Promise<AudioStreamMetadata[] | undefined> {
  const file = torrent.files[index];
  if (!file || file.name.split(/[\/\\]/).some((part) => part === '..' || part === '.') || file.name.startsWith('/')) return;
  const complete = torrent.percentDone === 1 && file.bytesCompleted === file.length;
  const prefix = verifiedFilePrefix(torrent, index);
  if (!complete && prefix < 4096) return;
  for (const directory of [...new Set([torrent.downloadDir, ...(incompleteDirectory ? [incompleteDirectory] : [])])]) {
    // Fixed read-only mount of Transmission's /data. Donors already use the shared /data/queuearr-audio mount.
    const root = directory.startsWith('/data/queuearr-audio/') ? '/data/queuearr-audio' : '/data/transmission';
    const mapped = root === '/data/queuearr-audio' ? directory : directory === '/data' || directory.startsWith('/data/')
      ? resolve(root, directory.slice('/data'.length).replace(/^\//, '')) : undefined;
    if (!mapped) continue;
    for (const suffix of ['', '.part']) {
      let temporary: string | undefined;
      try {
        const path = await confinedFile(root, join(mapped, file.name + suffix));
        if (complete) return await probe(path);
        const handle = await open(path, 'r');
        const buffer = Buffer.alloc(prefix);
        try { if ((await handle.read(buffer, 0, prefix, 0)).bytesRead !== prefix) continue; }
        finally { await handle.close(); }
        if (!hasCompleteTrackHeader(buffer)) continue;
        temporary = await mkdtemp(join(tmpdir(), 'queuearr-inspect-'));
        const copy = join(temporary, 'prefix.media');
        await writeFile(copy, buffer, { mode: 0o600 });
        return await probe(copy);
      } catch { /* Missing mounts, moving files and incomplete probes remain unverified. */ }
      finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
    }
  }
}
