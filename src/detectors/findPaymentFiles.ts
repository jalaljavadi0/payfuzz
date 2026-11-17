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

/**
 * Find payment-related source files by path first and by content second.
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

  const files: PaymentFile[] = [];
  const directories: string[] = [''];
  let truncated = false;

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
      let reasons = matchPaymentPath(relativePath);
      if (reasons.length === 0) reasons = await sniffContent(absolutePath, maxFileSizeBytes);
      if (reasons.length === 0) continue;

      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      files.push({ path: relativePath, absolutePath, reasons });
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, truncated };
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
