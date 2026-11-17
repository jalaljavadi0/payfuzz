import { Node, SyntaxKind, type BinaryExpression } from 'ts-morph';
import { isMoneyIdentifier } from '../detectors/patterns';
import type { Finding, Scenario, ScenarioContext, Sensitivity, Severity } from '../types';
import { positionOf, snippetOf, unwrap } from '../utils/ast';
import { compareFindings } from '../utils/findings';
import { adjustSeverity } from '../utils/severity';

/**
 * Floating point drift.
 *
 * Money stored in IEEE-754 doubles cannot represent most decimal amounts, so `0.1 + 0.2` is
 * `0.30000000000000004`. PayFuzz does not execute the user's code: it reads the AST and, when
 * both operands are literals, reproduces the drift with plain number arithmetic to show the
 * concrete value the code would produce.
 */

interface Rule {
  id: string;
  title: string;
  baseSeverity: Severity;
  risk: string;
  fix: string;
}

const DECIMAL_LITERAL_ARITHMETIC: Rule = {
  id: 'PF-FLOAT-001',
  title: 'Decimal literal arithmetic on money',
  baseSeverity: 'high',
  risk: 'Binary floating point cannot represent most decimal amounts exactly: in JavaScript `0.1 + 0.2` is `0.30000000000000004`. Once a total drifts, it stops reconciling with the payment provider, so the app can under-charge a customer, over-refund one, or leave a balance that never reaches zero.',
  fix: 'Keep money in integer minor units (cents, paise, satoshi) and do the arithmetic on integers. Format only at the edge: `(amountCents / 100).toFixed(2)`. If decimals are unavoidable, use an exact decimal type such as `decimal.js` or `dinero.js` instead of `number`.',
};

const MONEY_ARITHMETIC: Rule = {
  id: 'PF-FLOAT-002',
  title: 'Money amount arithmetic on a floating point number',
  baseSeverity: 'medium',
  risk: 'Every `+`/`-` on a `number` that holds money can introduce a rounding error, and the error compounds with volume. Fractions of a cent drift between your ledger and your provider, which surfaces later as failed reconciliation, short payouts or duplicate refunds.',
  fix: 'Convert input into integer minor units once (`Math.round(parseFloat(value) * 100)`), keep every balance and total integral, and convert back only for display or for the provider API.',
};

const MONEY_EQUALITY: Rule = {
  id: 'PF-FLOAT-003',
  title: 'Exact equality comparison on a money amount',
  baseSeverity: 'medium',
  risk: 'After floating point arithmetic two economically equal amounts can compare unequal (`0.3 !== 0.1 + 0.2`). A "paid?" or idempotency guard built on `===` can silently take the wrong branch and charge the customer twice, or skip a capture entirely.',
  fix: 'Compare integer minor units, or compare with an explicit tolerance: `Math.abs(a - b) < 0.005`. Never use `===`/`==` on money amounts.',
};

const ARITHMETIC_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
]);

const COMPOUND_ARITHMETIC_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
]);

const EQUALITY_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.EqualsEqualsEqualsToken,
  SyntaxKind.ExclamationEqualsToken,
  SyntaxKind.ExclamationEqualsEqualsToken,
]);

export function analyzeFloatDrift(context: ScenarioContext): Finding[] {
  const { sourceFile, relativePath, sensitivity } = context;
  const byRuleAndLine = new Map<string, Finding>();

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const rule = classify(expression);
    if (rule === undefined) continue;

    const { line } = positionOf(expression);
    // One finding per rule per line: nested sums (`total + fee + tax`) describe one defect.
    const key = `${rule.id}:${line}`;
    if (byRuleAndLine.has(key)) continue;

    byRuleAndLine.set(key, toFinding(expression, rule, relativePath, sensitivity));
  }

  return [...byRuleAndLine.values()].sort(compareFindings);
}

function classify(expression: BinaryExpression): Rule | undefined {
  const operator = expression.getOperatorToken().getKind();
  const left = expression.getLeft();
  const right = expression.getRight();

  if (ARITHMETIC_OPERATORS.has(operator)) {
    // `"$" + total` is formatting, not arithmetic.
    if (isStringLike(left) || isStringLike(right)) return undefined;
    if (hasDecimalLiteral(left) || hasDecimalLiteral(right)) return DECIMAL_LITERAL_ARITHMETIC;
    if (holdsMoney(left) || holdsMoney(right)) return MONEY_ARITHMETIC;
    return undefined;
  }

  if (COMPOUND_ARITHMETIC_OPERATORS.has(operator)) {
    if (isStringLike(left)) return undefined;
    return holdsMoney(left) || holdsMoney(right) ? MONEY_ARITHMETIC : undefined;
  }

  if (EQUALITY_OPERATORS.has(operator)) {
    return holdsMoney(left) || holdsMoney(right) ? MONEY_EQUALITY : undefined;
  }

  return undefined;
}

function toFinding(
  expression: BinaryExpression,
  rule: Rule,
  relativePath: string,
  sensitivity: Sensitivity,
): Finding {
  const { line, column } = positionOf(expression);
  return {
    scenario: 'float_drift',
    rule: rule.id,
    severity: adjustSeverity(rule.baseSeverity, sensitivity),
    title: rule.title,
    file: relativePath,
    line,
    column,
    snippet: snippetOf(expression),
    evidence: simulate(expression, rule),
    risk: rule.risk,
    fix: rule.fix,
  };
}

/** Reproduce the drift for literal-only expressions. No `eval`, no user code execution. */
function simulate(expression: BinaryExpression, rule: Rule): string | undefined {
  if (rule !== DECIMAL_LITERAL_ARITHMETIC) return undefined;
  const operator = expression.getOperatorToken().getKind();
  if (!ARITHMETIC_OPERATORS.has(operator)) return undefined;
  const left = numericLiteralValue(expression.getLeft());
  const right = numericLiteralValue(expression.getRight());
  if (left === undefined || right === undefined) return undefined;
  const result = operator === SyntaxKind.PlusToken ? left + right : left - right;
  return `\`${snippetOf(expression)}\` evaluates to \`${String(result)}\``;
}

function numericLiteralValue(node: Node): number | undefined {
  const unwrapped = unwrap(node);
  if (!Node.isNumericLiteral(unwrapped)) return undefined;
  const text = unwrapped.getLiteralText();
  return text.includes('.') ? Number(text) : undefined;
}

function hasDecimalLiteral(node: Node): boolean {
  return numericLiteralValue(node) !== undefined;
}

function isStringLike(node: Node): boolean {
  const unwrapped = unwrap(node);
  return (
    Node.isStringLiteral(unwrapped) ||
    Node.isNoSubstitutionTemplateLiteral(unwrapped) ||
    Node.isTemplateExpression(unwrapped)
  );
}

/** Does this expression read a value whose name says it is money? */
function holdsMoney(node: Node): boolean {
  const unwrapped = unwrap(node);
  if (Node.isIdentifier(unwrapped)) return isMoneyIdentifier(unwrapped.getText());
  if (Node.isPropertyAccessExpression(unwrapped)) return isMoneyIdentifier(unwrapped.getName());

  let found = false;
  unwrapped.forEachDescendant((descendant, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    if (Node.isIdentifier(descendant) && isMoneyIdentifier(descendant.getText())) {
      found = true;
      traversal.stop();
    } else if (Node.isPropertyAccessExpression(descendant) && isMoneyIdentifier(descendant.getName())) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

/** The float-drift scenario as a pluggable scenario. */
export const floatDriftScenario: Scenario = {
  id: 'float_drift',
  title: 'Floating point drift',
  description:
    'Simulates decimal money arithmetic that loses precision, e.g. `0.1 + 0.2 === 0.30000000000000004`.',
  run(context: ScenarioContext): Finding[] {
    return analyzeFloatDrift(context);
  },
};
