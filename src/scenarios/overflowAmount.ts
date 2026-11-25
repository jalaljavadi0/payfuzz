import { Node, SyntaxKind, type CallExpression, type ParameterDeclaration } from 'ts-morph';
import type { Finding, Scenario, ScenarioContext, Severity } from '../types';
import { positionOf, snippetOf, unwrap } from '../utils/ast';
import { compareFindings } from '../utils/findings';
import { monetaryNameOf, readsName, type FunctionLike } from '../utils/money';
import { adjustSeverity } from '../utils/severity';

/**
 * Negative / overflow amount.
 *
 * A payment amount is sign-, range- and type-sensitive in a way most `number`s are not: `-100`
 * reverses the direction of a transfer, `Infinity` poisons every total it touches, and anything
 * above 2^53 - 1 silently rounds to a different number. PayFuzz flags the three entry points where
 * an unchecked amount reaches money code.
 */

interface Rule {
  id: string;
  title: string;
  baseSeverity: Severity;
  risk: string;
  fix: string;
}

const UNGUARDED_AMOUNT: Rule = {
  id: 'PF-OVERFLOW-001',
  title: 'Monetary amount accepted without a range check',
  baseSeverity: 'medium',
  risk: 'A negative or oversized amount flows straight into the money path. `-100` turns a charge into a credit and inflates the payer, an amount above `Number.MAX_SAFE_INTEGER` silently rounds to a different number, and `NaN` propagates through every total it touches.',
  fix: 'Validate at the boundary before any arithmetic: `Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= MAX_AMOUNT`, or a schema such as `z.number().int().positive().max(MAX_AMOUNT)`. Reject with a 4xx and never fetch a balance first.',
};

const UNSAFE_LITERAL: Rule = {
  id: 'PF-OVERFLOW-002',
  title: 'Numeric literal outside the safe integer range',
  baseSeverity: 'high',
  risk: '`Number.MAX_SAFE_INTEGER` is 9007199254740991. Above it JavaScript silently rounds, so the literal you wrote is not the value that runs — a total computed from it can differ from the amount you believe you charged or refunded.',
  fix: 'Keep amounts in integer minor units far below 2^53, add an explicit upper bound, and for larger values use `BigInt` or a decimal library instead of `number`.',
};

const UNVALIDATED_PARSE: Rule = {
  id: 'PF-OVERFLOW-003',
  title: 'User input parsed into an amount without validation',
  baseSeverity: 'high',
  risk: '`parseFloat`/`Number` happily accept `-5`, `1e400` (Infinity), `NaN` and `0x10`. Unchecked, `Infinity` turns a charge into an unmetered transfer and a negative amount reverses the direction of the payment.',
  fix: 'Parse and validate in one step: `const n = Number(raw); if (!Number.isSafeInteger(n) || n <= 0 || n > MAX_AMOUNT) reject();`. Never pass a client-supplied amount to the ledger without an explicit upper bound.',
};

const PARSER_CALLS = new Set(['parseFloat', 'parseInt', 'Number']);

const USER_INPUT_HINT =
  /(^|[^A-Za-z0-9_$])(req|request|body|query|params|payload|form|formData|input|webhook|event|message|data)([^A-Za-z0-9_$]|$)/;

export function analyzeOverflowAmount(context: ScenarioContext): Finding[] {
  const findings = [
    ...findUnguardedAmounts(context),
    ...findUnsafeLiterals(context),
    ...findUnvalidatedParses(context),
  ];
  return dedupe(findings).sort(compareFindings);
}

function findUnguardedAmounts(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const parameter of sourceFile.getDescendantsOfKind(SyntaxKind.Parameter)) {
    const name = parameter.getName();
    if (!Node.isIdentifier(parameter.getNameNode())) continue;
    if (monetaryNameOf(parameter.getNameNode()) === undefined) continue;
    if (!isNumericParameter(parameter)) continue;

    const fn = parameter.getFirstAncestor((candidate) =>
      [
        SyntaxKind.FunctionDeclaration,
        SyntaxKind.FunctionExpression,
        SyntaxKind.ArrowFunction,
        SyntaxKind.MethodDeclaration,
      ].includes(candidate.getKind()),
    ) as FunctionLike | undefined;
    if (fn === undefined) continue;

    const body = fn.getBody();
    if (body === undefined || !readsName(body, name)) continue;
    if (hasNumericGuard(fn, name)) continue;

    const reachesWrite = fn
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => isAwaited(call))
      .some((call) => call.getArguments().some((argument) => readsName(argument, name)));

    findings.push(
      toFinding(
        parameter,
        UNGUARDED_AMOUNT,
        context,
        reachesWrite ? 'high' : UNGUARDED_AMOUNT.baseSeverity,
        `no sign or range check found for \`${name}\`${reachesWrite ? ' before it reaches an awaited write' : ''}`,
      ),
    );
  }

  return findings;
}

function findUnsafeLiterals(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const literal of sourceFile.getDescendantsOfKind(SyntaxKind.NumericLiteral)) {
    // `getText()` keeps the literal as written; `Number()` shows what the runtime will store.
    const raw = literal.getText().replace(/_/g, '');
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) <= Number.MAX_SAFE_INTEGER) continue;

    const stored = String(value);
    findings.push(
      toFinding(
        literal,
        UNSAFE_LITERAL,
        context,
        UNSAFE_LITERAL.baseSeverity,
        stored === raw
          ? `\`${raw}\` exceeds \`Number.MAX_SAFE_INTEGER\` (${String(Number.MAX_SAFE_INTEGER)})`
          : `\`${raw}\` is stored as \`${stored}\` — already a different number`,
      ),
    );
  }

  return findings;
}

function findUnvalidatedParses(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!PARSER_CALLS.has(calleeName(call))) continue;
    const argument = call.getArguments()[0];
    if (argument === undefined) continue;

    const parsedFrom = argument.getText();
    const looksMonetary =
      monetaryNameOf(argument) !== undefined ||
      hasMonetaryIdentifier(argument) ||
      USER_INPUT_HINT.test(parsedFrom);
    if (!looksMonetary) continue;

    const fn = unwindFunction(call);
    const target = assignedName(call) ?? parsedFrom;
    if (fn !== undefined && hasNumericGuard(fn, target)) continue;

    findings.push(
      toFinding(
        call,
        UNVALIDATED_PARSE,
        context,
        UNVALIDATED_PARSE.baseSeverity,
        `\`Number('1e400')\` is \`${String(Number('1e400'))}\`, \`Number('-12.5')\` is \`${String(Number('-12.5'))}\` — neither is rejected here`,
      ),
    );
  }

  return findings;
}

function isNumericParameter(parameter: ParameterDeclaration): boolean {
  const typeNode = parameter.getTypeNode();
  if (typeNode === undefined) return true;
  const typeText = typeNode.getText();
  return /\bnumber\b|\bNumber\b/.test(typeText);
}

function isAwaited(call: CallExpression): boolean {
  const parent = call.getParent();
  return parent !== undefined && Node.isAwaitExpression(parent);
}

function calleeName(call: CallExpression): string {
  const expression = call.getExpression();
  return Node.isIdentifier(expression) ? expression.getText() : '';
}

function hasMonetaryIdentifier(node: Node): boolean {
  return node
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((identifier) => monetaryNameOf(identifier) !== undefined);
}

function assignedName(call: CallExpression): string | undefined {
  let current: Node = call;
  for (let depth = 0; depth < 3; depth += 1) {
    const parent = current.getParent();
    if (parent === undefined) return undefined;
    if (Node.isVariableDeclaration(parent) && Node.isIdentifier(parent.getNameNode())) {
      return parent.getName();
    }
    if (
      Node.isAwaitExpression(parent) ||
      Node.isParenthesizedExpression(parent) ||
      Node.isAsExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function unwindFunction(node: Node): FunctionLike | undefined {
  const ancestor = node.getFirstAncestor((candidate) =>
    [
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.FunctionExpression,
      SyntaxKind.ArrowFunction,
      SyntaxKind.MethodDeclaration,
    ].includes(candidate.getKind()),
  );
  return ancestor as FunctionLike | undefined;
}

/**
 * Any explicit sign / finiteness / schema check that mentions this name counts as a guard.
 * Conservative on purpose: a missed guard is a finding, a recognised one is not.
 */
function hasNumericGuard(fn: FunctionLike, name: string): boolean {
  for (const comparison of fn.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = comparison.getOperatorToken().getKind();
    const isComparison = [
      SyntaxKind.GreaterThanToken,
      SyntaxKind.GreaterThanEqualsToken,
      SyntaxKind.LessThanToken,
      SyntaxKind.LessThanEqualsToken,
      SyntaxKind.EqualsEqualsToken,
      SyntaxKind.EqualsEqualsEqualsToken,
      SyntaxKind.ExclamationEqualsToken,
      SyntaxKind.ExclamationEqualsEqualsToken,
    ].includes(operator);
    if (!isComparison) continue;
    if (!readsName(comparison.getLeft(), name) && !readsName(comparison.getRight(), name)) continue;
    if (isZeroLiteral(comparison.getLeft()) || isZeroLiteral(comparison.getRight())) return true;
  }

  for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const text = call.getText();
    if (!readsName(call, name)) continue;
    const callee = call.getExpression().getText();
    if (/^(Number\.(isFinite|isInteger|isSafeInteger|isNaN)|isFinite|isNaN)$/.test(callee))
      return true;
    if (/^(assert|require|validate|check|ensure|guard|verify|invariant|reject)/i.test(callee))
      return true;
    if (/\.(positive|nonnegative|nonNegative|int|finite|safeInteger|min|max)\(/.test(text))
      return true;
  }

  return false;
}

function isZeroLiteral(node: Node): boolean {
  const unwrapped = unwrap(node);
  return Node.isNumericLiteral(unwrapped) && Number(unwrapped.getLiteralText()) === 0;
}

function toFinding(
  node: Node,
  rule: Rule,
  context: ScenarioContext,
  severity: Severity,
  evidence: string,
): Finding {
  const { line, column } = positionOf(node);
  return {
    scenario: 'overflow_amount',
    rule: rule.id,
    severity: adjustSeverity(severity, context.sensitivity),
    title: rule.title,
    file: context.relativePath,
    line,
    column,
    snippet: snippetOf(node),
    evidence,
    risk: rule.risk,
    fix: rule.fix,
  };
}

function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.line}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}

export const overflowAmountScenario: Scenario = {
  id: 'overflow_amount',
  title: 'Negative / overflow amount',
  description:
    'Simulates negative, non-finite and out-of-range amounts reaching money code, including literals that already lose precision.',
  run(context: ScenarioContext): Finding[] {
    return analyzeOverflowAmount(context);
  },
};
