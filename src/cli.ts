/**
 * PayFuzz CLI — local, offline usage.
 *
 * Phase 1 skeleton: argument surface only. Config loading, detection and reporting land later.
 * See SECURITY.md before changing anything here.
 */
import { Command } from 'commander';

export function createProgram(): Command {
  return new Command()
    .name('payfuzz')
    .description('Fuzz and simulate attacks on your payment logic — safely, in CI.')
    .version('0.1.0')
    .option('-c, --config <path>', 'path to .payfuzz.yml', '.payfuzz.yml')
    .option('--json', 'also write a JSON report', false);
}

export function runCli(argv: readonly string[]): void {
  createProgram().parse(argv as string[]);
}

runCli(process.argv);
