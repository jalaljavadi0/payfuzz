#!/usr/bin/env node
/**
 * PayFuzz CLI — local, offline usage.
 *
 * Reads `.payfuzz.yml`, scans the payment files below the given path, runs the enabled scenarios and
 * writes one Markdown report (plus an optional JSON one). Nothing leaves the machine.
 *
 * See SECURITY.md before changing anything here.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Command, Option } from 'commander';
import { scanRepository, type ScanResult } from './core/scan';
import { renderMarkdownReport } from './report/markdown';
import type { Sensitivity, Severity } from './types';
import { severityRank } from './utils/severity';
import { VERSION } from './version';

type FailOn = Severity | 'never';

interface CliFlags {
  config: string;
  output: string;
  json: boolean;
  failOn: FailOn;
  sensitivity?: Sensitivity;
}

export function createProgram(): Command {
  return new Command()
    .name('payfuzz')
    .description('Fuzz and simulate attacks on your payment logic — safely, in CI.')
    .version(VERSION)
    .argument('[path]', 'repository root (or subdirectory) to scan', '.')
    .addOption(
      new Option('-c, --config <path>', 'config file, relative to <path>').default('.payfuzz.yml'),
    )
    .addOption(
      new Option('-o, --output <path>', 'where to write the Markdown report').default(
        'payfuzz-report.md',
      ),
    )
    .addOption(new Option('--json', 'also write a machine-readable JSON report').default(false))
    .addOption(
      new Option('--fail-on <severity>', 'exit non-zero when a finding reaches this severity')
        .choices(['low', 'medium', 'high', 'never'])
        .default('high'),
    )
    .addOption(
      new Option('--sensitivity <level>', 'override the configured sensitivity').choices([
        'low',
        'medium',
        'high',
      ]),
    )
    .action(async (targetPath: string, flags: CliFlags, command: Command) => {
      await runScan(targetPath, flags, command);
    });
}

export async function runCli(argv: readonly string[]): Promise<void> {
  await createProgram().parseAsync(argv as string[]);
}

async function runScan(targetPath: string, flags: CliFlags, command: Command): Promise<void> {
  const rootDir = path.resolve(targetPath);
  const outputPath = path.resolve(flags.output);
  const jsonPath = flags.json ? jsonReportPath(outputPath) : undefined;

  let result: ScanResult;
  try {
    result = await scanRepository({
      rootDir,
      configPath: flags.config,
      configRequired: command.getOptionValueSource('config') === 'cli',
      sensitivity: flags.sensitivity,
    });
  } catch (error) {
    process.exitCode = 1;
    console.error(describeError(error));
    return;
  }

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (result.truncated) {
    console.warn('warning: the file cap was reached; some payment files were not scanned.');
  }

  try {
    const report = renderMarkdownReport({
      findings: result.findings,
      scannedFiles: result.scannedFiles,
      sensitivity: result.sensitivity,
      generatedAt: result.generatedAt,
      version: result.version,
    });
    await fs.writeFile(outputPath, report, 'utf8');
    if (jsonPath !== undefined) {
      await fs.writeFile(jsonPath, `${JSON.stringify(toJson(result), null, 2)}\n`, 'utf8');
    }
  } catch (error) {
    process.exitCode = 1;
    console.error(describeError(error));
    return;
  }

  const counts = result.counts;
  console.log(
    `PayFuzz ${result.version}: scanned ${count(result.files.length, 'payment file')} at sensitivity \`${result.sensitivity}\` — ${count(result.findings.length, 'finding')} (${String(counts.high)} high, ${String(counts.medium)} medium, ${String(counts.low)} low).`,
  );
  console.log(`Report: ${displayPath(outputPath)}`);
  if (jsonPath !== undefined) console.log(`JSON:   ${displayPath(jsonPath)}`);
  if (result.files.length === 0) {
    console.log(
      'No payment files were selected. Add `payment_paths` to .payfuzz.yml or check the scanned path.',
    );
  }

  if (flags.failOn !== 'never' && result.worst !== undefined) {
    if (severityRank(result.worst) >= severityRank(flags.failOn)) {
      console.error(
        `Failing because a ${result.worst} finding is at or above --fail-on ${flags.failOn}.`,
      );
      process.exitCode = 1;
    }
  }
}

function toJson(result: ScanResult): Record<string, unknown> {
  return {
    tool: 'payfuzz',
    version: result.version,
    generatedAt: result.generatedAt.toISOString(),
    root: result.rootDir,
    configPath: result.configPath ?? null,
    sensitivity: result.sensitivity,
    scenarios: result.enabledScenarios,
    scannedFiles: result.scannedFiles,
    counts: result.counts,
    findings: result.findings,
  };
}

function jsonReportPath(outputPath: string): string {
  return outputPath.toLowerCase().endsWith('.md')
    ? `${outputPath.slice(0, -3)}.json`
    : `${outputPath}.json`;
}

function displayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative.length === 0 ? absolutePath : relative;
}

function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('SECURITY.md')
    ? message
    : `${message}\nSee SECURITY.md for the security model and how to report an issue.`;
}

// Run only when this file is the entry point, so importing it from tests stays side-effect free.
const entry = process.argv[1] ?? '';
if (/(^|[\\/])cli\.(?:ts|js|cjs|mjs)$/.test(entry)) {
  void runCli(process.argv);
}
