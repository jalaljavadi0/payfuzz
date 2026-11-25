import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempRepos, makeTempRepo } from './helpers/tempRepo';

const actions = vi.hoisted(() => ({
  inputs: {} as Record<string, string>,
  getInput: vi.fn((name: string) => actions.inputs[name] ?? ''),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@actions/core', () => actions);

const { run } = await import('../src/index');

afterAll(cleanupTempRepos);

const HIGH_BUG = 'export const total = 0.1 + 0.2;';
const MEDIUM_BUG = 'export const total = price + fee;';

beforeEach(() => {
  actions.inputs = {};
  actions.setOutput.mockClear();
  actions.setFailed.mockClear();
  actions.warning.mockClear();
  process.env['GITHUB_TOKEN'] = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GitHub Action entry point', () => {
  it('writes the report to the workspace and sets report-path', async () => {
    const workspace = await makeTempRepo({ 'src/payments/wallet.ts': MEDIUM_BUG });
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    actions.inputs['fail-on'] = 'none';

    await run();

    expect(actions.setFailed).not.toHaveBeenCalled();
    expect(actions.setOutput).toHaveBeenCalledWith(
      'report-path',
      path.join(workspace, 'payfuzz-report.md'),
    );
    const report = await readFile(path.join(workspace, 'payfuzz-report.md'), 'utf8');
    expect(report).toContain('<!-- payfuzz-report -->');
  });

  it('fails the job when a finding reaches fail-on and points at SECURITY.md', async () => {
    const workspace = await makeTempRepo({ 'src/payments/wallet.ts': HIGH_BUG });
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    actions.inputs['fail-on'] = 'high';

    await run();

    expect(actions.setFailed).toHaveBeenCalledOnce();
    expect(String(actions.setFailed.mock.calls[0]?.[0])).toContain('SECURITY.md');
    expect(String(actions.setFailed.mock.calls[0]?.[0])).toContain('fail-on high');
  });

  it('does not fail when only medium findings exist below a high gate', async () => {
    const workspace = await makeTempRepo({ 'src/payments/wallet.ts': MEDIUM_BUG });
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    actions.inputs['fail-on'] = 'high';

    await run();

    expect(actions.setFailed).not.toHaveBeenCalled();
  });

  it('reports an invalid config as a failure without a report', async () => {
    const workspace = await makeTempRepo({
      'src/payments/wallet.ts': HIGH_BUG,
      '.payfuzz.yml': 'sensitivity: paranoid',
    });
    vi.stubEnv('GITHUB_WORKSPACE', workspace);

    await run();

    expect(actions.setFailed).toHaveBeenCalledOnce();
    expect(String(actions.setFailed.mock.calls[0]?.[0])).toContain('SECURITY.md');
  });

  it('rejects an unsupported fail-on value', async () => {
    const workspace = await makeTempRepo();
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    actions.inputs['fail-on'] = 'sometimes';

    await run();

    expect(actions.setFailed).toHaveBeenCalledOnce();
    expect(String(actions.setFailed.mock.calls[0]?.[0])).toContain('must be one of none');
  });

  it('skips the PR comment when there is no token or pull request', async () => {
    const workspace = await makeTempRepo({ 'src/payments/wallet.ts': MEDIUM_BUG });
    vi.stubEnv('GITHUB_WORKSPACE', workspace);
    actions.inputs['fail-on'] = 'none';

    await run();

    expect(actions.warning).not.toHaveBeenCalled();
    expect(actions.setFailed).not.toHaveBeenCalled();
  });
});
