import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const created: string[] = [];

/**
 * Create a throwaway repository below `tests/` (never in the system temp directory) and write the
 * given files into it. Paths are POSIX-style and relative to the repository root.
 */
export async function makeTempRepo(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(process.cwd(), 'tests', '.tmp-'));
  created.push(root);

  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }

  return root;
}

/** Remove every repository this helper created. Call from `afterAll`. */
export async function cleanupTempRepos(): Promise<void> {
  await Promise.all(created.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
