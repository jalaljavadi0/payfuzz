/**
 * PayFuzz GitHub Action entry point.
 *
 * Phase 1 skeleton: the action starts, proves it is wired to the runner, and exits.
 * Detectors, scenarios and the report writer are added in the next phases.
 *
 * SECURITY: this entry point must never read credentials, touch a network client of its own,
 * or write anywhere except the report file. See SECURITY.md.
 */
import * as core from '@actions/core';

export async function run(): Promise<void> {
  core.info('PayFuzz skeleton is wired up. Scenarios and reporting land in the next phases.');
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(`${message}\nSee SECURITY.md for the security model and how to report an issue.`);
});
