import { afterAll, describe, expect, it } from 'vitest';
import { findPaymentFiles } from '../../src/detectors/findPaymentFiles';
import { cleanupTempRepos, makeTempRepo } from '../helpers/tempRepo';

afterAll(cleanupTempRepos);

describe('findPaymentFiles — auto-detection', () => {
  it('selects files by payment name and by payment directory', async () => {
    const root = await makeTempRepo({
      'src/payments/checkout.ts': 'export const x = 1;',
      'src/lib/strings.ts': 'export const y = 2;',
    });

    const { files } = await findPaymentFiles({ rootDir: root });

    expect(files.map((file) => file.path)).toEqual(['src/payments/checkout.ts']);
    expect(files[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('selects a file that uses the Stripe SDK even when its name says nothing', async () => {
    const root = await makeTempRepo({
      'src/lib/money.ts':
        "import Stripe from 'stripe';\nexport const stripe = new Stripe('sk_test_x');",
    });

    const { files } = await findPaymentFiles({ rootDir: root });

    expect(files).toHaveLength(1);
    expect(files[0]?.reasons).toContain('uses the Stripe SDK');
  });

  it('needs two weak content markers before selecting a file', async () => {
    const root = await makeTempRepo({
      'src/lib/one.ts': 'const amount = 10;',
      'src/lib/two.ts': 'const amount = 10;\nconst currency = "usd";',
    });

    const { files } = await findPaymentFiles({ rootDir: root });

    expect(files.map((file) => file.path)).toEqual(['src/lib/two.ts']);
    expect(files[0]?.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('skips generated and dependency directories', async () => {
    const root = await makeTempRepo({
      'node_modules/pkg/checkout.ts': 'export const x = 1;',
      'dist/checkout.ts': 'export const x = 1;',
      'fixtures/checkout.ts': 'export const x = 1;',
      '.next/checkout.ts': 'export const x = 1;',
    });

    expect((await findPaymentFiles({ rootDir: root })).files).toEqual([]);
  });

  it('detects Python files without parsing them', async () => {
    const root = await makeTempRepo({ 'billing/pay.py': 'balance = 1' });

    const { files } = await findPaymentFiles({ rootDir: root });

    expect(files.map((file) => file.path)).toEqual(['billing/pay.py']);
  });

  it('stops at the file cap and reports truncation', async () => {
    const root = await makeTempRepo({
      'payments/b.ts': 'export const x = 1;',
      'payments/a.ts': 'export const x = 1;',
    });

    const selection = await findPaymentFiles({ rootDir: root, maxFiles: 1 });

    expect(selection.files).toHaveLength(1);
    expect(selection.files[0]?.path).toBe('payments/a.ts');
    expect(selection.truncated).toBe(true);
  });

  it('does not read files above the sniff size limit', async () => {
    const root = await makeTempRepo({
      'src/lib/big.ts': "import Stripe from 'stripe';",
    });

    const { files } = await findPaymentFiles({ rootDir: root, maxFileSizeBytes: 10 });

    expect(files).toEqual([]);
  });
});

describe('findPaymentFiles — payment_paths', () => {
  it('scans every file below a listed directory without detection', async () => {
    const root = await makeTempRepo({
      'src/wallet/util.ts': 'export const x = 1;',
      'src/wallet/deep/helper.ts': 'export const y = 2;',
      'src/other/checkout.ts': 'export const z = 3;',
    });

    const { files } = await findPaymentFiles({ rootDir: root, includePaths: ['src/wallet'] });

    expect(files.map((file) => file.path)).toEqual([
      'src/wallet/deep/helper.ts',
      'src/wallet/util.ts',
    ]);
    expect(files[0]?.reasons).toEqual(['listed in .payfuzz.yml']);
  });

  it('accepts a single explicit file', async () => {
    const root = await makeTempRepo({ 'src/charge.ts': 'export const x = 1;' });

    const { files } = await findPaymentFiles({ rootDir: root, includePaths: ['src/charge.ts'] });

    expect(files.map((file) => file.path)).toEqual(['src/charge.ts']);
  });

  it('normalises duplicates and trailing slashes', async () => {
    const root = await makeTempRepo({ 'src/wallet/a.ts': 'export const x = 1;' });

    const { files } = await findPaymentFiles({
      rootDir: root,
      includePaths: ['src/wallet/', './src/wallet', 'src\\wallet'],
    });

    expect(files).toHaveLength(1);
  });

  it('rejects a path that does not exist', async () => {
    const root = await makeTempRepo();

    await expect(findPaymentFiles({ rootDir: root, includePaths: ['src/nope'] })).rejects.toThrow(
      'does not exist',
    );
  });

  it('rejects a path outside the scanned repository', async () => {
    const root = await makeTempRepo();

    await expect(findPaymentFiles({ rootDir: root, includePaths: ['../outside'] })).rejects.toThrow(
      'must stay inside',
    );
  });

  it('rejects an explicit file PayFuzz cannot parse', async () => {
    const root = await makeTempRepo({ 'docs/notes.md': '# notes' });

    await expect(
      findPaymentFiles({ rootDir: root, includePaths: ['docs/notes.md'] }),
    ).rejects.toThrow('not a source file');
  });

  it('reports truncation across explicit files', async () => {
    const root = await makeTempRepo({
      'a.ts': 'export const x = 1;',
      'b.ts': 'export const y = 2;',
    });

    const selection = await findPaymentFiles({
      rootDir: root,
      includePaths: ['a.ts', 'b.ts'],
      maxFiles: 1,
    });

    expect(selection.files).toHaveLength(1);
    expect(selection.truncated).toBe(true);
  });
});
