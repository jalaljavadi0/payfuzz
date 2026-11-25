import { afterAll, describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/core/scan';
import { cleanupTempRepos, makeTempRepo } from '../helpers/tempRepo';

afterAll(cleanupTempRepos);

const WALLET = 'export const total = 0.1 + 0.2;';

describe('scanRepository', () => {
  it('runs every scenario and sorts findings by severity', async () => {
    const root = await makeTempRepo({
      'src/payments/wallet.ts': WALLET,
      'src/payments/checkout.ts': 'export const total = price + fee;',
    });

    const result = await scanRepository({ rootDir: root });

    expect(result.files).toHaveLength(2);
    expect(result.scannedFiles).toEqual(['src/payments/checkout.ts', 'src/payments/wallet.ts']);
    expect(result.enabledScenarios).toEqual(['float_drift', 'race_condition', 'overflow_amount']);
    expect(result.sensitivity).toBe('medium');
    expect(result.version).toBe('0.1.0');
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.findings[0]?.severity).toBe('high');
    expect(result.counts.high).toBe(1);
    expect(result.worst).toBe('high');
    expect(result.truncated).toBe(false);
    expect(result.configPath).toBeUndefined();
  });

  it('honours scenarios and sensitivity from .payfuzz.yml', async () => {
    const root = await makeTempRepo({
      'src/payments/wallet.ts': WALLET,
      '.payfuzz.yml': [
        'scenarios:',
        '  race_condition: false',
        '  float_drift: false',
        '  overflow_amount: false',
        'sensitivity: low',
      ].join('\n'),
    });

    const result = await scanRepository({ rootDir: root });

    expect(result.enabledScenarios).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.sensitivity).toBe('low');
    expect(result.worst).toBeUndefined();
    expect(result.configPath).toBeDefined();
  });

  it('restricts the scan to payment_paths', async () => {
    const root = await makeTempRepo({
      '.payfuzz.yml': 'payment_paths: ["src/payments"]',
      'src/payments/checkout.ts': WALLET,
      'src/other/wallet.ts': WALLET,
    });

    const result = await scanRepository({ rootDir: root });

    expect(result.scannedFiles).toEqual(['src/payments/checkout.ts']);
  });

  it('lets the CLI override the configured sensitivity', async () => {
    const root = await makeTempRepo({
      'src/payments/wallet.ts': WALLET,
      '.payfuzz.yml': 'sensitivity: low',
    });

    const result = await scanRepository({ rootDir: root, sensitivity: 'high' });

    expect(result.sensitivity).toBe('high');
    expect(result.findings[0]?.severity).toBe('high');
  });

  it('lists Python files without parsing them', async () => {
    const root = await makeTempRepo({
      'billing/pay.py': 'balance = 0.1 + 0.2',
      'billing/charge.ts': WALLET,
    });

    const result = await scanRepository({ rootDir: root });

    expect(result.scannedFiles).toEqual(['billing/charge.ts', 'billing/pay.py']);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.file).toBe('billing/charge.ts');
  });

  it('warns about a payment file it refuses to read', async () => {
    const root = await makeTempRepo({
      'src/payments/huge.ts': 'x'.repeat(520 * 1024),
    });

    const result = await scanRepository({ rootDir: root });

    expect(result.files).toHaveLength(1);
    expect(result.findings).toEqual([]);
    expect(result.warnings.join('\n')).toContain('larger than 512 KiB');
  });

  it('propagates an invalid config instead of scanning', async () => {
    const root = await makeTempRepo({ '.payfuzz.yml': 'sensitivity: paranoid' });

    await expect(scanRepository({ rootDir: root })).rejects.toThrow('SECURITY.md');
  });

  it('rejects a root that is not a directory', async () => {
    const root = await makeTempRepo();

    await expect(scanRepository({ rootDir: `${root}/missing` })).rejects.toThrow(
      'is not a readable directory',
    );
  });

  it('returns an empty result for a repository without payment code', async () => {
    const root = await makeTempRepo({ 'src/lib/strings.ts': 'export const x = 1;' });

    const result = await scanRepository({ rootDir: root });

    expect(result.files).toEqual([]);
    expect(result.counts).toEqual({ high: 0, medium: 0, low: 0 });
    expect(result.worst).toBeUndefined();
  });

  it('uses the file cap from the detector', async () => {
    const root = await makeTempRepo({ 'payments/a.ts': WALLET, 'payments/b.ts': WALLET });

    const result = await scanRepository({ rootDir: root });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });
});
