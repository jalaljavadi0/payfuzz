import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram, runCli } from '../src/cli';
import { cleanupTempRepos, makeTempRepo } from './helpers/tempRepo';

afterAll(cleanupTempRepos);

const DECIMAL_BUG = 'export const total = 0.1 + 0.2;';
const MEDIUM_BUG = 'export const total = price + fee;';

beforeEach(() => {
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('CLI', () => {
  it('writes the Markdown and JSON report and exits cleanly', async () => {
    const root = await makeTempRepo({ 'src/payments/wallet.ts': MEDIUM_BUG });
    const reportPath = path.join(root, 'report.md');

    await runCli(['node', 'payfuzz', root, '-o', reportPath, '--json', '--fail-on', 'never']);

    expect(process.exitCode).toBeUndefined();
    await expect(readFile(reportPath, 'utf8')).resolves.toContain('<!-- payfuzz-report -->');

    const json = JSON.parse(await readFile(path.join(root, 'report.json'), 'utf8')) as {
      tool: string;
      findings: unknown[];
      sensitivity: string;
      version: string;
    };
    expect(json.tool).toBe('payfuzz');
    expect(json.version).toBe('0.1.0');
    expect(json.sensitivity).toBe('medium');
    expect(json.findings.length).toBeGreaterThan(0);
  });

  it('fails the gate when a finding reaches --fail-on', async () => {
    const root = await makeTempRepo({ 'src/payments/wallet.ts': DECIMAL_BUG });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCli(['node', 'payfuzz', root, '-o', path.join(root, 'report.md')]);

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('--fail-on high');
  });

  it('applies --sensitivity for the run', async () => {
    const root = await makeTempRepo({ 'src/payments/wallet.ts': DECIMAL_BUG });
    const reportPath = path.join(root, 'report.json');

    await runCli([
      'node',
      'payfuzz',
      root,
      '-o',
      reportPath,
      '--json',
      '--sensitivity',
      'low',
      '--fail-on',
      'never',
    ]);

    const json = JSON.parse(await readFile(`${reportPath}.json`, 'utf8')) as {
      sensitivity: string;
    };
    expect(json.sensitivity).toBe('low');
  });

  it('fails when an explicitly named config is missing', async () => {
    const root = await makeTempRepo({ 'src/payments/wallet.ts': DECIMAL_BUG });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await runCli(['node', 'payfuzz', root, '-c', 'nope.yml', '-o', path.join(root, 'report.md')]);

    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join('\n')).toContain('SECURITY.md');
  });

  it('tells the user when no payment files were selected', async () => {
    const root = await makeTempRepo({ 'src/lib/strings.ts': 'export const x = 1;' });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runCli(['node', 'payfuzz', root, '-o', path.join(root, 'report.md')]);

    expect(process.exitCode).toBeUndefined();
    expect(log.mock.calls.flat().join('\n')).toContain('No payment files were selected');
  });

  it('names a JSON report next to a non-Markdown output', async () => {
    const root = await makeTempRepo({ 'src/payments/wallet.ts': MEDIUM_BUG });
    const reportPath = path.join(root, 'report.txt');

    await runCli(['node', 'payfuzz', root, '-o', reportPath, '--json', '--fail-on', 'never']);

    await expect(readFile(`${reportPath}.json`, 'utf8')).resolves.toContain('"tool": "payfuzz"');
  });

  it('exposes the documented name and version', () => {
    const program = createProgram();

    expect(program.name()).toBe('payfuzz');
    expect(program.version()).toBe('0.1.0');
  });
});
