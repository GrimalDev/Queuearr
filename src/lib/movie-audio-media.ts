import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, realpath, stat, mkdir, mkdtemp, rmdir, rename, unlink, chmod, link } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { RadarrLanguage } from '@/types';

export class AudioReviewError extends Error {}

interface MediaStream {
  index: number;
  codec_type: string;
  codec_name: string;
  start_time?: string;
  tags?: { language?: string; title?: string };
  disposition?: { attached_pic?: number; comment?: number; default?: number };
}
interface MediaInfo {
  streams: MediaStream[];
  format: { duration?: string; start_time?: string };
}

// Radarr names, not numeric IDs, also support a movie's original language.
const LANGUAGE_CODES: Record<string, string[]> = {
  english: ['eng', 'en'], french: ['fra', 'fre', 'fr'], spanish: ['spa', 'es'],
  german: ['deu', 'ger', 'de'], italian: ['ita', 'it'], danish: ['dan', 'da'],
  dutch: ['nld', 'dut', 'nl'], japanese: ['jpn', 'ja'], icelandic: ['isl', 'ice', 'is'],
  chinese: ['zho', 'chi', 'zh'], mandarin: ['cmn', 'zh'], cantonese: ['yue'],
  russian: ['rus', 'ru'], polish: ['pol', 'pl'], vietnamese: ['vie', 'vi'],
  swedish: ['swe', 'sv'], norwegian: ['nor', 'nob', 'nno', 'no', 'nb', 'nn'],
  finnish: ['fin', 'fi'], turkish: ['tur', 'tr'], portuguese: ['por', 'pt'],
  flemish: ['nld', 'dut', 'nl'], greek: ['ell', 'gre', 'el'], korean: ['kor', 'ko'],
  hungarian: ['hun', 'hu'], czech: ['ces', 'cze', 'cs'], arabic: ['ara', 'ar'],
  hindi: ['hin', 'hi'], bulgarian: ['bul', 'bg'], romanian: ['ron', 'rum', 'ro'],
  ukrainian: ['ukr', 'uk'], hebrew: ['heb', 'he'], thai: ['tha', 'th'],
  indonesian: ['ind', 'id'], persian: ['fas', 'per', 'fa'], tamil: ['tam', 'ta'],
  telugu: ['tel', 'te'], bengali: ['ben', 'bn'], malay: ['msa', 'may', 'ms'],
  slovak: ['slk', 'slo', 'sk'], slovenian: ['slv', 'sl'], croatian: ['hrv', 'hr'],
  serbian: ['srp', 'sr'], estonian: ['est', 'et'], latvian: ['lav', 'lv'],
  lithuanian: ['lit', 'lt'], catalan: ['cat', 'ca'], malayalam: ['mal', 'ml'],
};

export function languageCodes(language: RadarrLanguage): string[] {
  const codes = LANGUAGE_CODES[language.name.toLowerCase()];
  if (!codes) throw new AudioReviewError(`Automatic merging does not yet recognize ${language.name} language tags.`);
  return codes;
}
function matchesLanguage(stream: MediaStream, language: RadarrLanguage): boolean {
  const tag = stream.tags?.language?.toLowerCase().split('-')[0];
  return stream.codec_type === 'audio' && !!tag && languageCodes(language).includes(tag);
}

/** No shell, local inputs only, bounded output and runtime; abort on a lost lease. */
function runMedia(binary: string, args: string[], signal: AbortSignal, digest = false): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { signal, stdio: ['ignore', 'pipe', 'pipe'] });
    const hash = createHash('sha256');
    let output = '';
    let pending = '';
    let failed = false;
    const fail = (): void => { failed = true; child.kill('SIGKILL'); };
    const timeout = setTimeout(fail, 2 * 60 * 60 * 1000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (!digest) {
        output += chunk.toString();
        if (output.length > 4 * 1024 * 1024) fail();
      } else {
        pending += chunk.toString();
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) if (line && !line.startsWith('#')) hash.update(line.trim() + '\n');
      }
    });
    // Drain stderr without exposing file paths or allowing unbounded logs.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timeout); reject(new AudioReviewError(`${binary} could not run. Check its installation and the audio worker configuration.`)); });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (failed || code !== 0 || signal.aborted) reject(new AudioReviewError(`${binary} did not finish successfully. The merge needs review.`));
      else resolveResult(digest ? hash.digest('hex') : output);
    });
  });
}
const INPUT_OPTIONS = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm,mov,avi,mpeg,mpegts'];
export async function inspectMedia(path: string, signal: AbortSignal): Promise<MediaInfo> {
  const text = await runMedia('ffprobe', ['-v', 'error', ...INPUT_OPTIONS, '-show_streams', '-show_format', '-of', 'json', path], signal);
  return JSON.parse(text) as MediaInfo;
}
export async function verifyAudio(path: string, required: RadarrLanguage[], signal: AbortSignal): Promise<void> {
  const info = await inspectMedia(path, signal);
  if (!required.every((language) => info.streams.some((stream) => matchesLanguage(stream, language)))) {
    throw new AudioReviewError('The file does not contain all requested, language-tagged audio tracks.');
  }
}

export function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + '/') && !isAbsolute(rel);
}
export async function confinedFile(root: string, path: string): Promise<string> {
  const [actualRoot, actualPath] = await Promise.all([realpath(root), realpath(path)]).catch(() => {
    throw new AudioReviewError('A required media file or shared folder is missing. Check the mounts and files before retrying.');
  });
  if (!isInside(actualRoot, actualPath) || !(await stat(actualPath)).isFile()) {
    throw new AudioReviewError('A media path is outside the configured shared folder or is not a regular file.');
  }
  return actualPath;
}

async function videoFingerprint(path: string, index: number, signal: AbortSignal): Promise<string> {
  return runMedia('ffmpeg', ['-v', 'error', '-nostdin', ...INPUT_OPTIONS, '-i', path,
    '-map', `0:${index}`, '-vf', 'setpts=PTS-STARTPTS', '-fps_mode', 'passthrough',
    '-enc_time_base', '1:1000000', '-f', 'framehash', '-hash', 'sha256', '-'], signal, true);
}
async function packetFingerprint(path: string, index: number, signal: AbortSignal): Promise<string> {
  return runMedia('ffmpeg', ['-v', 'error', '-nostdin', ...INPUT_OPTIONS, '-i', path,
    '-map', `0:${index}`, '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-'], signal);
}
function video(info: MediaInfo): MediaStream {
  const streams = info.streams.filter((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (streams.length !== 1) throw new AudioReviewError('Automatic merging requires exactly one main video stream.');
  return streams[0];
}
function finiteTime(value: string | undefined): number {
  const result = Number(value);
  if (value === undefined || !Number.isFinite(result)) throw new AudioReviewError('Media timing metadata is incomplete.');
  return result;
}

export interface PreparedAudioMerge {
  outputPath: string;
  publish: (beforePublish: () => Promise<void>) => Promise<void>;
  dispose: () => Promise<void>;
}

function preparedPublication(
  source: string, donor: string, sourceStat: Awaited<ReturnType<typeof stat>>, donorStat: Awaited<ReturnType<typeof stat>>,
  outputPath: string, temporary: string, dispose: () => Promise<void>, backupRoot: string, signal: AbortSignal,
): PreparedAudioMerge {
  return {
    outputPath, dispose,
    publish: async (beforePublish): Promise<void> => {
      const unchanged = async (): Promise<void> => {
        for (const [path, previous] of [[source, sourceStat], [donor, donorStat]] as const) {
          const current = await stat(path);
          if (current.ino !== previous.ino || current.size !== previous.size || current.mtimeMs !== previous.mtimeMs) {
            throw new AudioReviewError('A source file changed while the merge was running.');
          }
        }
        if (signal.aborted) throw new AudioReviewError('The audio worker lost its processing lock.');
      };
      await unchanged();
      await mkdir(backupRoot, { recursive: true });
      const backup = join(backupRoot, `${Date.now()}-${randomUUID()}-${basename(source)}`);
      await copyFile(source, backup, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      await beforePublish();
      await unchanged();
      // Never write into the existing inode: it may be hard-linked to a seeding torrent.
      if (source === outputPath) await rename(temporary, outputPath);
      else {
        // An exclusive hard link publishes the complete file atomically without overwriting another MKV.
        await link(temporary, outputPath);
        await unlink(source);
      }
    },
  };
}

/** Only exact decoded video timelines are auto-merged. Different cuts/encodes need review. */
export async function prepareAudioMerge(
  source: string, donor: string, language: RadarrLanguage, required: RadarrLanguage[],
  backupRoot: string, signal: AbortSignal,
): Promise<PreparedAudioMerge> {
  const sourceStat = await stat(source);
  const donorStat = await stat(donor);
  const [baseInfo, donorInfo] = await Promise.all([inspectMedia(source, signal), inspectMedia(donor, signal)]);
  const baseVideo = video(baseInfo);
  const donorVideo = video(donorInfo);
  const durationDifference = Math.abs(finiteTime(baseInfo.format.duration) - finiteTime(donorInfo.format.duration));
  const baseOffset = finiteTime(baseVideo.start_time) - finiteTime(baseInfo.format.start_time);
  const donorOffset = finiteTime(donorVideo.start_time) - finiteTime(donorInfo.format.start_time);
  if (durationDifference > 0.25 || Math.abs(baseOffset - donorOffset) > 0.02) {
    throw new AudioReviewError('The releases have different durations or starting offsets. Audio synchronization needs review.');
  }
  const audio = donorInfo.streams.filter((stream) => matchesLanguage(stream, language) &&
    !stream.disposition?.comment && !/commentary|description|descriptive/i.test(stream.tags?.title ?? ''))
    .sort((a, b) => (b.disposition?.default ?? 0) - (a.disposition?.default ?? 0))[0];
  if (!audio) throw new AudioReviewError(`The downloaded release has no usable, tagged ${language.name} audio track.`);
  const baseFingerprint = await videoFingerprint(source, baseVideo.index, signal);
  if (baseFingerprint !== await videoFingerprint(donor, donorVideo.index, signal)) {
    throw new AudioReviewError('The decoded video timelines differ. Review synchronization before merging these releases.');
  }
  const outputPath = join(dirname(source), basename(source, extname(source)) + '.mkv');
  if (outputPath !== source && await stat(outputPath).then(() => true, () => false)) {
    throw new AudioReviewError('An MKV already exists beside the current movie. Review the files before merging.');
  }
  // Radarr excludes hidden subfolders, but does not exclude arbitrary dot-prefixed movie files.
  // Stage on the library filesystem for atomic publication without exposing an incomplete movie.
  const staging = await mkdtemp(join(dirname(source), '.queuearr-audio-'));
  const temporary = join(staging, 'output.mkv');
  const dispose = async (): Promise<void> => {
    await unlink(temporary).catch(() => undefined);
    await rmdir(staging).catch(() => undefined);
  };
  try {
    const audioIndex = baseInfo.streams.filter((stream) => stream.codec_type === 'audio').length;
    const args = ['-v', 'error', '-nostdin', '-n', ...INPUT_OPTIONS, '-i', source, ...INPUT_OPTIONS, '-i', donor,
      '-map', '0', '-map', `1:${audio.index}`, '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'];
    // MP4 timed text cannot be copied into Matroska. Keep its text as SubRip.
    baseInfo.streams.filter((stream) => stream.codec_type === 'subtitle').forEach((stream, i) => {
      if (stream.codec_name === 'mov_text') args.push(`-c:s:${i}`, 'srt');
    });
    args.push(`-metadata:s:a:${audioIndex}`, `language=${languageCodes(language)[0]}`,
      `-metadata:s:a:${audioIndex}`, `title=${language.name}`, `-disposition:a:${audioIndex}`, '0', temporary);
    await runMedia('ffmpeg', args, signal);
    await verifyAudio(temporary, required, signal);
    const result = await inspectMedia(temporary, signal);
    if (result.streams.length !== baseInfo.streams.length + 1 ||
        baseFingerprint !== await videoFingerprint(temporary, video(result).index, signal)) {
      throw new AudioReviewError('The merged file did not preserve the original video and stream count.');
    }
    // Matroska may reorder attachments after the audio tracks. Match within each stream type.
    for (const type of new Set(baseInfo.streams.map((stream) => stream.codec_type))) {
      const expected = baseInfo.streams.filter((stream) => stream.codec_type === type).length + (type === 'audio' ? 1 : 0);
      if (result.streams.filter((stream) => stream.codec_type === type).length !== expected) {
        throw new AudioReviewError('The merged file did not retain every original stream type.');
      }
    }
    const originalAudio = baseInfo.streams.filter((stream) => stream.codec_type === 'audio');
    const outputAudio = result.streams.filter((stream) => stream.codec_type === 'audio');
    for (let i = 0; i < originalAudio.length; i++) {
      if (await packetFingerprint(source, originalAudio[i].index, signal) !==
          await packetFingerprint(temporary, outputAudio[i].index, signal)) {
        throw new AudioReviewError('An original audio track changed during the merge.');
      }
    }
    if (await packetFingerprint(donor, audio.index, signal) !==
        await packetFingerprint(temporary, outputAudio.at(-1)!.index, signal)) {
      throw new AudioReviewError('The requested audio track changed during the merge.');
    }
    await chmod(temporary, sourceStat.mode & 0o777);
    return preparedPublication(source, donor, sourceStat, donorStat, outputPath, temporary, dispose, backupRoot, signal);
  } catch (error) {
    await dispose();
    throw error;
  }
}

/** Keep a complete release's own video and audio together. Never splice its tracks into the old cut. */
export async function prepareMovieReplacement(
  source: string, donor: string, required: RadarrLanguage[], backupRoot: string, signal: AbortSignal,
): Promise<PreparedAudioMerge> {
  const [sourceStat, donorStat] = await Promise.all([stat(source), stat(donor)]);
  await verifyAudio(donor, required, signal);
  const donorInfo = await inspectMedia(donor, signal);
  video(donorInfo);
  const outputPath = join(dirname(source), basename(source, extname(source)) + '.mkv');
  if (outputPath !== source && await stat(outputPath).then(() => true, () => false)) {
    throw new AudioReviewError('An MKV already exists beside the current movie. Review the files before replacement.');
  }
  const staging = await mkdtemp(join(dirname(source), '.queuearr-audio-'));
  const temporary = join(staging, 'output.mkv');
  const dispose = async (): Promise<void> => { await unlink(temporary).catch(() => undefined); await rmdir(staging).catch(() => undefined); };
  try {
    const args = ['-v', 'error', '-nostdin', '-n', ...INPUT_OPTIONS, '-i', donor,
      '-map', '0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'];
    donorInfo.streams.filter((stream) => stream.codec_type === 'subtitle').forEach((stream, i) => {
      if (stream.codec_name === 'mov_text') args.push(`-c:s:${i}`, 'srt');
    });
    args.push(temporary);
    await runMedia('ffmpeg', args, signal);
    await verifyAudio(temporary, required, signal);
    const output = await inspectMedia(temporary, signal);
    if (output.streams.length !== donorInfo.streams.length) throw new AudioReviewError('Replacement did not retain every source stream.');
    for (const type of new Set(donorInfo.streams.map((stream) => stream.codec_type))) {
      const original = donorInfo.streams.filter((stream) => stream.codec_type === type);
      const copied = output.streams.filter((stream) => stream.codec_type === type);
      if (original.length !== copied.length) throw new AudioReviewError('Replacement changed the source stream layout.');
      if (type === 'video' || type === 'audio') {
        for (let i = 0; i < original.length; i++) {
          if (await packetFingerprint(donor, original[i].index, signal) !== await packetFingerprint(temporary, copied[i].index, signal)) {
            throw new AudioReviewError('Replacement changed a source video or audio track.');
          }
        }
      }
    }
    await chmod(temporary, sourceStat.mode & 0o777);
    return preparedPublication(source, donor, sourceStat, donorStat, outputPath, temporary, dispose, backupRoot, signal);
  } catch (error) { await dispose(); throw error; }
}

export async function containsAudioLanguages(path: string, required: RadarrLanguage[], signal: AbortSignal): Promise<boolean> {
  const info = await inspectMedia(path, signal);
  return required.length > 0 && required.every((language) => info.streams.some((stream) => matchesLanguage(stream, language) &&
    !stream.disposition?.comment && !/commentary|description|descriptive/i.test(stream.tags?.title ?? '')));
}
