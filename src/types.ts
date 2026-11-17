/**
 * Shared domain types for PayFuzz.
 *
 * Findings are inert data: a scenario never executes the analysed code, it only describes what
 * it saw in the AST. See SECURITY.md for the security model.
 */
import type { SourceFile } from 'ts-morph';

/** Severity of a finding, and the sensitivity knob a user can set in `.payfuzz.yml`. */
export type Severity = 'low' | 'medium' | 'high';

/** How aggressively scenarios flag borderline patterns. */
export type Sensitivity = Severity;

export type ScenarioId = 'race_condition' | 'float_drift' | 'overflow_amount';

export interface Finding {
  scenario: ScenarioId;
  /** Stable rule id, e.g. `PF-FLOAT-001`. */
  rule: string;
  severity: Severity;
  title: string;
  /** Repository-relative, POSIX-style path. */
  file: string;
  /** 1-based line of the offending expression. */
  line: number;
  /** 1-based column of the offending expression. */
  column: number;
  /** The offending expression, whitespace-collapsed and truncated. */
  snippet: string;
  /** Concrete simulated result, when the scenario can compute one without executing user code. */
  evidence?: string;
  /** Why this costs money — written for the developer reading the PR comment. */
  risk: string;
  /** What to change instead. */
  fix: string;
}

export interface ScenarioContext {
  sourceFile: SourceFile;
  /** Repository-relative path, used in findings. */
  relativePath: string;
  sensitivity: Sensitivity;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  description: string;
  run(context: ScenarioContext): Finding[];
}
