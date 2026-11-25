import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_IGNORED_DIRS,
  STRONG_CONTENT_MARKERS,
  WEAK_CONTENT_MARKERS,
  isSourcePath,
  matchPaymentPath,
} from './patterns';

export interface PaymentFile {
  /** Repository-relative, POSIX-style path. */
  path: string;
  absolutePath: string;
  /** Why this file was selected — surfaced in the report so detection stays explainable. */
  reasons: string[];
}

export interface FindPaymentFilesOptions {
  /** Repository root to scan. Only files below this directory are read. */
  rootDir: string;
  /**
   * Explicit repository-relative files or directories from `payment_paths`. When present, only
   * these are scanned and everything below a listed directory counts as payment code.
   */
  includePaths?: readonly string[];
  /** Files larger than this are matched by name only, never read. Default 512 KiB. */
  maxFileSizeBytes?: number;
  /** Hard cap on selected files. Default 500. */
  maxFiles?: number;
}

export interface PaymentFileSelection {
  files: PaymentFile[];
  /** True when `maxFiles` stopped the scan early. */
  truncated: boolean;
}

const DEFAULT_MAX_FILE_SIZE = 512 * 1024;
const DEFAULT_MAX_FILES = 500;
const MAX_SNIFF_BYTES = 64 * 1024;
const MAX_REASONS = 3;
const CONFIGURED_PATH_REASON = 'listed in .payfuzz.yml';

/**
 * Find payment-related source files by path first and by content second.
 *
 * With `includePaths` the scan is restricted to those paths and needs no detection: naming a path
 * in `.payfuzz.yml` is the assertion that it holds payment logic.
 *
 * SECURITY: reads files below `rootDir` only. No symlink following (dirents are not resolved),
 * no network, no writes.
 */
export async function findPaymentFiles(
  options: FindPaymentFilesOptions,
): Promise<PaymentFileSelection> {
  const rootDir = path.resolve(options.rootDir);
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const includePaths = [...new Set((options.includePaths ?? []).map(normalizeIncludePath))];

  const files = new Map<string, PaymentFile>();
  const directories: string[] = [];
  let truncated = false;

  if (includePaths.length === 0) {
    directories.push('');
  } else {
    for (const entry of includePaths) {
      const absolutePath = resolveInsideRoot(rootDir, entry);
      let stats;
      try {
        stats = await fs.stat(absolutePath);
      } catch {
        throw new Error(
          `Configured payment path \`${entry}\` does not exist under \`${rootDir}\`.`,
        );
      }

      if (stats.isDirectory()) {
        directories.push(entry);
      } else if (stats.isFile()) {
        if (!isSourcePath(entry)) {
          throw new Error(
            `Configured payment path \`${entry}\` is not a source file PayFuzz can scan.`,
          );
        }
        if (files.size >= maxFiles) {
          truncated = true;
          break;
        }
        files.set(entry, { path: entry, absolutePath, reasons: [CONFIGURED_PATH_REASON] });
      } else {
        throw new Error(`Configured payment path \`${entry}\` is not a regular file or directory.`);
      }
    }
  }

  while (directories.length > 0 && !truncated) {
    const directory = directories.shift() ?? '';
    let entries: Dirent[];
    try {
      entries = await fs.readdir(path.join(rootDir, directory), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = directory === '' ? entry.name : `${directory}/${entry.name}`;

      if (entry.isDirectory()) {
        if (shouldDescend(entry.name, relativePath)) directories.push(relativePath);
        continue;
      }
      if (!entry.isFile() || !isSourcePath(relativePath)) continue;

      const absolutePath = path.join(rootDir, relativePath);
      const reasons = await reasonsFor(
        relativePath,
        absolutePath,
        includePaths.length > 0,
        maxFileSizeBytes,
      );
      if (reasons.length === 0) continue;

      if (files.size >= maxFiles) {
        truncated = true;
        break;
      }
      files.set(relativePath, { path: relativePath, absolutePath, reasons });
    }
  }

  const sorted = [...files.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return { files: sorted, truncated };
}

async function reasonsFor(
  relativePath: string,
  absolutePath: string,
  explicitScan: boolean,
  maxFileSizeBytes: number,
): Promise<string[]> {
  if (explicitScan) return [CONFIGURED_PATH_REASON];

  const byPath = matchPaymentPath(relativePath);
  if (byPath.length > 0) return byPath;
  return sniffContent(absolutePath, maxFileSizeBytes);
}

function normalizeIncludePath(entry: string): string {
  return entry.replace(/\\/g, '/').replace(/\/+$/, '').replace(/^\.\//, '');
}

/** Resolve a configured path and refuse anything that escapes the scanned root. */
function resolveInsideRoot(rootDir: string, entry: string): string {
  const absolutePath = path.resolve(rootDir, entry);
  const relative = path.relative(rootDir, absolutePath);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Configured payment path \`${entry}\` must stay inside \`${rootDir}\`.`);
  }
  return absolutePath;
}

/** Dot-directories (`.git`, `.venv`, `.next`) are always skipped. */
function shouldDescend(name: string, relativePath: string): boolean {
  if (name.startsWith('.')) return false;
  if (DEFAULT_IGNORED_DIRS.has(name.toLowerCase())) return false;
  return relativePath.length > 0;
}

async function sniffContent(absolutePath: string, maxFileSizeBytes: number): Promise<string[]> {
  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile() || stats.size > maxFileSizeBytes) return [];
    const text = (await fs.readFile(absolutePath, 'utf8')).slice(0, MAX_SNIFF_BYTES);

    const strong = STRONG_CONTENT_MARKERS.filter((marker) => marker.pattern.test(text)).map(
      (marker) => marker.reason,
    );
    if (strong.length > 0) return strong.slice(0, MAX_REASONS);

    const weak = WEAK_CONTENT_MARKERS.filter((marker) => marker.pattern.test(text)).map(
      (marker) => marker.reason,
    );
    return weak.length >= 2 ? weak.slice(0, MAX_REASONS) : [];
  } catch {
    // Unreadable file: skip it rather than failing the run.
    return [];
  }
}
