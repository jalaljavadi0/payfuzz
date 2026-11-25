import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ScenarioId, Sensitivity } from '../types';

/**
 * `.payfuzz.yml` loader.
 *
 * The config only corrects detection and toggles scenarios; it can never widen what PayFuzz reads.
 * Every path in it must stay inside the repository being scanned, and every failure points the
 * reader at SECURITY.md.
 */

export const DEFAULT_CONFIG_FILENAME = '.payfuzz.yml';

export const SCENARIO_IDS: readonly ScenarioId[] = [
  'race_condition',
  'float_drift',
  'overflow_amount',
];

const SENSITIVITIES: readonly Sensitivity[] = ['low', 'medium', 'high'];

const KNOWN_KEYS: readonly string[] = ['payment_paths', 'scenarios', 'sensitivity'];

export interface PayFuzzConfig {
  /** Explicit files/directories, relative to the scanned root. Empty means auto-detection. */
  readonly paymentPaths: readonly string[];
  readonly scenarios: Readonly<Record<ScenarioId, boolean>>;
  /** `low` relaxes each rule one level, `high` raises it one level; the base is `medium`. */
  readonly sensitivity: Sensitivity;
}

export const DEFAULT_CONFIG: PayFuzzConfig = {
  paymentPaths: [],
  scenarios: { race_condition: true, float_drift: true, overflow_amount: true },
  sensitivity: 'medium',
};

export interface LoadedConfig {
  readonly config: PayFuzzConfig;
  /** Absolute path of the file that was read; undefined when defaults were used. */
  readonly configPath?: string;
  /** Non-fatal problems, e.g. an unknown scenario id or config key. */
  readonly warnings: readonly string[];
}

export interface LoadConfigOptions {
  readonly rootDir: string;
  /** Defaults to `<rootDir>/.payfuzz.yml`. */
  readonly configPath?: string;
  /** A missing file is an error instead of a silent fallback (set when the user named the path). */
  readonly requireFile?: boolean;
}

/** Invalid configuration. The message always points at the security model. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(`${message}\nSee SECURITY.md for the security model and how to report an issue.`);
    this.name = 'ConfigError';
  }
}

export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const rootDir = path.resolve(options.rootDir);
  const requested = options.configPath ?? DEFAULT_CONFIG_FILENAME;
  const configPath = path.resolve(rootDir, requested);
  assertInsideRoot(rootDir, configPath);

  let text: string;
  try {
    text = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      if (options.requireFile === true) {
        throw new ConfigError(`Config file \`${requested}\` was not found under \`${rootDir}\`.`);
      }
      return { config: DEFAULT_CONFIG, warnings: [] };
    }
    throw new ConfigError(`Could not read config file \`${requested}\`: ${reasonOf(error)}.`);
  }

  const warnings: string[] = [];
  const config = parseConfig(text, warnings);
  return { config, configPath, warnings };
}

/** Reject a config file outside the scanned repository: PayFuzz reads nothing else. */
function assertInsideRoot(rootDir: string, target: string): void {
  const relative = path.relative(rootDir, target);
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ConfigError('The config file must live inside the scanned repository.');
  }
}

function parseConfig(text: string, warnings: string[]): PayFuzzConfig {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (error) {
    throw new ConfigError(`The config file is not valid YAML: ${reasonOf(error)}.`);
  }

  if (document === null || document === undefined) return DEFAULT_CONFIG;
  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new ConfigError(
      'The config file must be a YAML mapping with `payment_paths`, `scenarios` and `sensitivity` keys.',
    );
  }

  const record = document as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.includes(key)) warnings.push(`Unknown config key \`${key}\` was ignored.`);
  }

  return {
    paymentPaths: parsePaymentPaths(record['payment_paths']),
    scenarios: parseScenarios(record['scenarios'], warnings),
    sensitivity: parseSensitivity(record['sensitivity']),
  };
}

function parsePaymentPaths(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ConfigError('`payment_paths` must be a list of file or directory paths.');
  }

  const paths: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new ConfigError('Every entry in `payment_paths` must be a non-empty string.');
    }
    const normalized = normalizePaymentPath(entry.trim());
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

/** Accept `src/payments` and `src/payments/**`; reject anything that would leave the repository. */
function normalizePaymentPath(raw: string): string {
  const posix = raw
    .replace(/[\\/]\*\*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^\.\//, '');

  if (posix.length === 0) {
    throw new ConfigError(
      '`payment_paths` cannot contain the repository root; list a subdirectory or file instead.',
    );
  }
  if (path.isAbsolute(posix) || /^[A-Za-z]:\//.test(posix)) {
    throw new ConfigError(
      `\`${raw}\` is absolute. \`payment_paths\` entries must be relative to the repository root.`,
    );
  }
  if (posix.split('/').includes('..')) {
    throw new ConfigError(
      `\`${raw}\` leaves the repository root. PayFuzz only reads files inside the scanned repository.`,
    );
  }
  if (/[*?{}[\]]/.test(posix)) {
    throw new ConfigError(
      `\`${raw}\` uses a glob pattern PayFuzz cannot match yet; list a directory or file instead (a trailing \`/**\` is accepted).`,
    );
  }
  return posix;
}

function parseScenarios(raw: unknown, warnings: string[]): Record<ScenarioId, boolean> {
  const scenarios: Record<ScenarioId, boolean> = { ...DEFAULT_CONFIG.scenarios };
  if (raw === undefined || raw === null) return scenarios;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('`scenarios` must be a mapping of scenario id to `true`/`false`.');
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!SCENARIO_IDS.includes(key as ScenarioId)) {
      warnings.push(
        `Unknown scenario \`${key}\` was ignored. Known scenarios: ${SCENARIO_IDS.join(', ')}.`,
      );
      continue;
    }
    if (typeof value !== 'boolean') {
      throw new ConfigError(`\`scenarios.${key}\` must be \`true\` or \`false\`.`);
    }
    scenarios[key as ScenarioId] = value;
  }
  return scenarios;
}

function parseSensitivity(raw: unknown): Sensitivity {
  if (raw === undefined || raw === null) return DEFAULT_CONFIG.sensitivity;
  if (typeof raw !== 'string' || !SENSITIVITIES.includes(raw as Sensitivity)) {
    throw new ConfigError('`sensitivity` must be `low`, `medium` or `high`.');
  }
  return raw as Sensitivity;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
