import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../../src/config/loadConfig';
import { cleanupTempRepos, makeTempRepo } from '../helpers/tempRepo';

afterAll(cleanupTempRepos);

describe('loadConfig — defaults', () => {
  it('falls back to defaults when the file is absent', async () => {
    const root = await makeTempRepo();
    const loaded = await loadConfig({ rootDir: root });

    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.configPath).toBeUndefined();
    expect(loaded.warnings).toEqual([]);
  });

  it('fails when the user named a config that does not exist', async () => {
    const root = await makeTempRepo();

    await expect(
      loadConfig({ rootDir: root, configPath: 'custom.yml', requireFile: true }),
    ).rejects.toThrow('SECURITY.md');
  });

  it('rejects a config file outside the scanned repository', async () => {
    const root = await makeTempRepo({ 'app/.keep': '' });

    await expect(
      loadConfig({ rootDir: path.join(root, 'app'), configPath: '../.payfuzz.yml' }),
    ).rejects.toThrow('must live inside the scanned repository');
  });

  it('reports an unreadable config file instead of using defaults', async () => {
    const root = await makeTempRepo();
    await mkdir(path.join(root, 'conf-dir'));

    await expect(loadConfig({ rootDir: root, configPath: 'conf-dir' })).rejects.toThrow(
      'Could not read config file',
    );
  });
});

describe('loadConfig — parsing', () => {
  it('reads every supported key', async () => {
    const root = await makeTempRepo({
      '.payfuzz.yml': [
        'payment_paths:',
        '  - src/payments',
        '  - ./src/wallet/checkout.ts',
        '  - src/billing/**',
        'scenarios:',
        '  race_condition: true',
        '  float_drift: false',
        '  overflow_amount: false',
        'sensitivity: high',
      ].join('\n'),
    });

    const loaded = await loadConfig({ rootDir: root });

    expect(loaded.config.paymentPaths).toEqual([
      'src/payments',
      'src/wallet/checkout.ts',
      'src/billing',
    ]);
    expect(loaded.config.scenarios).toEqual({
      race_condition: true,
      float_drift: false,
      overflow_amount: false,
    });
    expect(loaded.config.sensitivity).toBe('high');
    expect(loaded.configPath).toBe(path.join(root, '.payfuzz.yml'));
  });

  it('accepts an empty document', async () => {
    const root = await makeTempRepo({ '.payfuzz.yml': '' });

    expect((await loadConfig({ rootDir: root })).config).toEqual(DEFAULT_CONFIG);
  });

  it('accepts Windows separators in payment paths', async () => {
    const root = await makeTempRepo({ '.payfuzz.yml': 'payment_paths: ["src\\\\payments"]' });

    expect((await loadConfig({ rootDir: root })).config.paymentPaths).toEqual(['src/payments']);
  });

  it('warns about unknown keys and unknown scenarios', async () => {
    const root = await makeTempRepo({
      '.payfuzz.yml': ['ignore: everything', 'scenarios:', '  chargeback: true'].join('\n'),
    });

    const loaded = await loadConfig({ rootDir: root });

    expect(loaded.warnings).toHaveLength(2);
    expect(loaded.warnings.join('\n')).toContain('Unknown config key `ignore`');
    expect(loaded.warnings.join('\n')).toContain('Unknown scenario `chargeback`');
  });

  it('deduplicates repeated payment paths', async () => {
    const root = await makeTempRepo({
      '.payfuzz.yml': 'payment_paths: ["src/payments", "src/payments/"]',
    });

    expect((await loadConfig({ rootDir: root })).config.paymentPaths).toEqual(['src/payments']);
  });
});

describe('loadConfig — rejections', () => {
  const cases: { name: string; yaml: string; message: string }[] = [
    { name: 'invalid YAML', yaml: 'payment_paths: [unclosed', message: 'not valid YAML' },
    { name: 'a list at the root', yaml: '- src/payments', message: 'must be a YAML mapping' },
    {
      name: 'a non-list paths value',
      yaml: 'payment_paths: src/payments',
      message: 'must be a list',
    },
    { name: 'an empty path', yaml: 'payment_paths: [""]', message: 'non-empty string' },
    { name: 'the repository root', yaml: 'payment_paths: ["/"]', message: 'repository root' },
    { name: 'an absolute path', yaml: 'payment_paths: ["/etc/passwd"]', message: 'is absolute' },
    {
      name: 'a Windows absolute path',
      yaml: 'payment_paths: ["C:/secrets"]',
      message: 'is absolute',
    },
    {
      name: 'a parent escape',
      yaml: 'payment_paths: ["../outside"]',
      message: 'leaves the repository root',
    },
    { name: 'an unsupported glob', yaml: 'payment_paths: ["src/*.ts"]', message: 'glob pattern' },
    {
      name: 'a non-boolean scenario',
      yaml: 'scenarios:\n  race_condition: yes',
      message: 'must be `true` or `false`',
    },
    {
      name: 'an unknown sensitivity',
      yaml: 'sensitivity: paranoid',
      message: 'must be `low`, `medium` or `high`',
    },
  ];

  for (const testCase of cases) {
    it(`rejects ${testCase.name}`, async () => {
      const root = await makeTempRepo({ '.payfuzz.yml': testCase.yaml });

      await expect(loadConfig({ rootDir: root })).rejects.toThrow(testCase.message);
      await expect(loadConfig({ rootDir: root })).rejects.toThrow('SECURITY.md');
    });
  }
});
