import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loadConfig, type PayFuzzConfig } from '../config/loadConfig';
import { findPaymentFiles, type PaymentFile } from '../detectors/findPaymentFiles';
import { floatDriftScenario } from '../scenarios/floatDrift';
import { overflowAmountScenario } from '../scenarios/overflowAmount';
import { raceConditionScenario } from '../scenarios/raceCondition';
import { compareFindings, countBySeverity, worstSeverity } from '../utils/findings';
import { createProject, parseSource } from '../utils/parse';
import type { Finding, Scenario, ScenarioId, Sensitivity, Severity } from '../types';
import { VERSION } from '../version';

/**
 * Shared scan pipeline: config → payment files → enabled scenarios → findings.
 *
 * Both the CLI and the GitHub Action call this, so they can never drift apart. It is pure filesystem
 * work: no network, no execution of the scanned code, no writes.
 */

export const SCENARIOS: readonly Scenario[] = [
  floatDriftScenario,
  raceConditionScenario,
  overflowAmountScenario,
];

/** Same ceiling as the detector: a payment file is source code, not a data dump. */
const MAX_SOURCE_BYTES = 512 * 1024;

/** Scenarios parse TypeScript/JavaScript only; `.py` files are detected but not parsed yet. */
const PARSEABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export interface ScanOptions {
  readonly rootDir: string;
  /** Defaults to `<rootDir>/.payfuzz.yml`. */
  readonly configPath?: string;
  /** Fail when the config file is missing instead of using the defaults. */
  readonly configRequired?: boolean;
  /** CLI override for `sensitivity`. */
  readonly sensitivity?: Sensitivity;
}

export interface ScanResult {
  readonly rootDir: string;
  readonly config: PayFuzzConfig;
  readonly configPath?: string;
  readonly warnings: readonly string[];
  readonly sensitivity: Sensitivity;
  readonly enabledScenarios: readonly ScenarioId[];
  readonly files: readonly PaymentFile[];
  /** Repository-relative paths of every payment file that was selected. */
  readonly scannedFiles: readonly string[];
  readonly findings: readonly Finding[];
  readonly counts: Record<Severity, number>;
  readonly worst?: Severity;
  readonly truncated: boolean;
  readonly generatedAt: Date;
  readonly version: string;
}

export async function scanRepository(options: ScanOptions): Promise<ScanResult> {
  const rootDir = path.resolve(options.rootDir);
  await assertDirectory(rootDir);

  const loaded = await loadConfig({
    rootDir,
    configPath: options.configPath,
    requireFile: options.configRequired,
  });
  const sensitivity = options.sensitivity ?? loaded.config.sensitivity;
  const enabled = SCENARIOS.filter((scenario) => loaded.config.scenarios[scenario.id]);

  const selection = await findPaymentFiles({
    rootDir,
    includePaths: loaded.config.paymentPaths,
  });

  const warnings: string[] = [...loaded.warnings];
  const findings: Finding[] = [];
  const project = createProject();

  for (const file of selection.files) {
    if (!PARSEABLE_EXTENSIONS.has(path.extname(file.path).toLowerCase())) continue;

    let sourceText: string;
    try {
      sourceText = await readSource(file.absolutePath);
    } catch (error) {
      warnings.push(`Could not read \`${file.path}\`: ${reasonOf(error)}`);
      continue;
    }

    const sourceFile = parseSource(project, file.path, sourceText);
    for (const scenario of enabled) {
      findings.push(...scenario.run({ sourceFile, relativePath: file.path, sensitivity }));
    }
  }

  const sortedFindings = [...findings].sort(compareFindings);

  return {
    rootDir,
    config: loaded.config,
    configPath: loaded.configPath,
    warnings,
    sensitivity,
    enabledScenarios: enabled.map((scenario) => scenario.id),
    files: selection.files,
    scannedFiles: selection.files.map((file) => file.path),
    findings: sortedFindings,
    counts: countBySeverity(sortedFindings),
    worst: worstSeverity(sortedFindings),
    truncated: selection.truncated,
    generatedAt: new Date(),
    version: VERSION,
  };
}

async function readSource(absolutePath: string): Promise<string> {
  const stats = await fs.stat(absolutePath);
  if (!stats.isFile()) throw new Error('not a regular file');
  if (stats.size > MAX_SOURCE_BYTES) throw new Error('file is larger than 512 KiB');
  return fs.readFile(absolutePath, 'utf8');
}

async function assertDirectory(rootDir: string): Promise<void> {
  try {
    const stats = await fs.stat(rootDir);
    if (stats.isDirectory()) return;
  } catch {
    // Reported below with one message for both "missing" and "not a directory".
  }
  throw new Error(`\`${rootDir}\` is not a readable directory.`);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
