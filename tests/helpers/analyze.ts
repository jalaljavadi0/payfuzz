import type { Finding, Scenario, Sensitivity } from '../../src/types';
import { createProject, parseSource } from '../../src/utils/parse';

/** Parse a source string and run one scenario on it, exactly as the scan pipeline does. */
export function analyze(
  scenario: Scenario,
  code: string,
  sensitivity: Sensitivity = 'medium',
  relativePath = 'src/payments/sample.ts',
): Finding[] {
  const project = createProject();
  const sourceFile = parseSource(project, relativePath, code);
  return scenario.run({ sourceFile, relativePath, sensitivity });
}

/** Rule ids in order, which reads better in assertions than whole finding objects. */
export function rulesOf(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.rule);
}
