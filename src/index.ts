/**
 * PayFuzz GitHub Action entry point.
 *
 * Runs the same pipeline as the CLI (`scanRepository`), writes one Markdown report into the
 * workspace, optionally updates the pull request comment, and fails the job when a finding reaches
 * `fail-on`.
 *
 * SECURITY: this entry point never reads credentials of the scanned project, never executes the
 * scanned code, and never calls anything but the GitHub API for its own comment. See SECURITY.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { scanRepository } from './core/scan';
import { REPORT_MARKER, renderMarkdownReport } from './report/markdown';
import type { Severity } from './types';
import { severityRank } from './utils/severity';

const REPORT_FILENAME = 'payfuzz-report.md';

type FailOn = Severity | 'none';

export interface ActionOptions {
  workspace: string;
  configPath: string;
  failOn: FailOn;
  commentOnPr: boolean;
}

export async function run(): Promise<void> {
  try {
    await runAction(readOptions());
  } catch (error) {
    core.setFailed(withSecurityReference(reasonOf(error)));
  }
}

async function runAction(options: ActionOptions): Promise<void> {
  const result = await scanRepository({
    rootDir: options.workspace,
    configPath: options.configPath,
  });

  for (const warning of result.warnings) core.warning(warning);
  if (result.truncated)
    core.warning('The file cap was reached; some payment files were not scanned.');

  const report = renderMarkdownReport({
    findings: result.findings,
    scannedFiles: result.scannedFiles,
    sensitivity: result.sensitivity,
    generatedAt: result.generatedAt,
    version: result.version,
  });

  const reportPath = path.join(options.workspace, REPORT_FILENAME);
  await fs.writeFile(reportPath, report, 'utf8');
  core.setOutput('report-path', reportPath);

  core.info(
    `PayFuzz ${result.version}: scanned ${count(result.files.length, 'payment file')} at sensitivity \`${result.sensitivity}\` — ${count(result.findings.length, 'finding')} (${String(result.counts.high)} high, ${String(result.counts.medium)} medium, ${String(result.counts.low)} low).`,
  );

  if (options.commentOnPr) await commentOnPullRequest(report);

  if (options.failOn !== 'none' && result.worst !== undefined) {
    if (severityRank(result.worst) >= severityRank(options.failOn)) {
      core.setFailed(
        withSecurityReference(
          `A ${result.worst} finding is at or above fail-on ${options.failOn}. See the report at ${REPORT_FILENAME}.`,
        ),
      );
    }
  }
}

function readOptions(): ActionOptions {
  return {
    workspace: process.env['GITHUB_WORKSPACE'] ?? process.cwd(),
    configPath: core.getInput('config-path') || '.payfuzz.yml',
    failOn: normalizeFailOn(core.getInput('fail-on') || 'high'),
    commentOnPr: (core.getInput('comment-on-pr') || 'true').trim().toLowerCase() !== 'false',
  };
}

function normalizeFailOn(raw: string): FailOn {
  const value = raw.trim().toLowerCase();
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  if (value === 'none' || value === 'never') return 'none';
  throw new Error(`\`fail-on\` must be one of none, low, medium or high — received \`${raw}\`.`);
}

/**
 * Update PayFuzz's own comment instead of posting a new one on every push. A failure here is a
 * warning, not a failed scan: the report file is already written.
 */
async function commentOnPullRequest(report: string): Promise<void> {
  const token = process.env['GITHUB_TOKEN'];
  if (token === undefined || token.length === 0) return;
  if (github.context.payload.pull_request === undefined) return;

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const issueNumber = github.context.issue.number;

  try {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    const existing = comments.find(
      (comment) => typeof comment.body === 'string' && comment.body.includes(REPORT_MARKER),
    );

    if (existing === undefined) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: report,
      });
    } else {
      await octokit.rest.issues.updateComment({
        owner,
        repo,
        comment_id: existing.id,
        body: report,
      });
    }
  } catch (error) {
    core.warning(
      withSecurityReference(`Could not post the pull request comment: ${reasonOf(error)}`),
    );
  }
}

function count(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withSecurityReference(message: string): string {
  return message.includes('SECURITY.md')
    ? message
    : `${message}\nSee SECURITY.md for the security model and how to report an issue.`;
}

// Run only when this file is the action entry point, so importing it from tests stays side-effect free.
const entry = process.argv[1] ?? '';
if (/(^|[\\/])index\.(?:ts|js|cjs|mjs)$/.test(entry)) {
  void run();
}
