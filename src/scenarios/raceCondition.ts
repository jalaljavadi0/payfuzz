import {
  Node,
  SyntaxKind,
  type BinaryExpression,
  type CallExpression,
  type IfStatement,
  type SourceFile,
} from 'ts-morph';
import { isMonetaryIdentifier } from '../detectors/patterns';
import type { Finding, Scenario, ScenarioContext, Severity } from '../types';
import { positionOf, snippetOf, unwrap } from '../utils/ast';
import { compareFindings } from '../utils/findings';
import {
  enclosingFunction,
  functionHasAwait,
  isAsyncContext,
  isSharedTarget,
  monetaryNameOf,
  readsName,
  type FunctionLike,
} from '../utils/money';
import { adjustSeverity } from '../utils/severity';

/**
 * Race condition.
 *
 * Two concurrent transactions on one balance. PayFuzz does not run the code and does not need a
 * database: it looks for the three shapes that make the interleaving possible — a read-modify-write
 * on shared state, a check whose result is used after an await, and a value read before an await
 * that is written back afterwards.
 */

interface Rule {
  id: string;
  title: string;
  baseSeverity: Severity;
  risk: string;
  fix: string;
}

const READ_MODIFY_WRITE: Rule = {
  id: 'PF-RACE-001',
  title: 'Read-modify-write on a shared balance',
  baseSeverity: 'medium',
  risk: 'Two concurrent requests can read the same balance, each compute a new total from that same value, and both write it back. The later write silently erases the earlier one: a withdrawal never leaves the balance (free money) or a deposit disappears from the ledger.',
  fix: 'Let the database do the arithmetic atomically: `UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1`, then act on the affected-row count. Alternatively hold a row lock for the whole read-modify-write (`SELECT … FOR UPDATE`) or use an optimistic `version` column.',
};

const CHECK_THEN_ACT: Rule = {
  id: 'PF-RACE-002',
  title: 'Check-then-act on a balance (TOCTOU)',
  baseSeverity: 'high',
  risk: 'The guard reads a balance, then the function awaits a write. Between the check and the write another request can spend the same funds: both pass `balance >= amount`, both charge, and the account ends up negative — or the same invoice is paid twice.',
  fix: 'Make the check part of the write: a conditional atomic update, a unique constraint or idempotency key on the charge, or one transaction that holds the row lock from the read to the commit.',
};

const STALE_READ: Rule = {
  id: 'PF-RACE-003',
  title: 'Balance read before an await, written back after it',
  baseSeverity: 'high',
  risk: 'A balance is read, the function awaits something else, and the old value is then written back. Any concurrent transaction in that gap is lost, so the ledger records a balance that was never true and reconciliation drifts away from the payment provider.',
  fix: 'Re-read the balance inside the transaction that writes it, or make the write conditional (`WHERE balance = $old`) and retry when zero rows change. Idempotency keys keep a retry from charging twice.',
};

const ARITHMETIC_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.PlusToken,
  SyntaxKind.MinusToken,
  SyntaxKind.AsteriskToken,
  SyntaxKind.SlashToken,
]);

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
]);

const COMPARISON_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.GreaterThanToken,
  SyntaxKind.GreaterThanEqualsToken,
  SyntaxKind.LessThanToken,
  SyntaxKind.LessThanEqualsToken,
]);

/** Calls that move money or persist state — the "act" half of check-then-act. */
const WRITE_CALL = /(update|save|write|set|put|patch|charge|capture|transfer|credit|debit|increment|decrement|refund|withdraw|deposit|payout|create|settle)/i;

export function analyzeRaceConditions(context: ScenarioContext): Finding[] {
  const findings = [
    ...findReadModifyWrites(context),
    ...findCheckThenAct(context),
    ...findStaleReads(context),
  ];
  return dedupe(findings).sort(compareFindings);
}

function findReadModifyWrites(context: ScenarioContext): Finding[] {
  return dedupe([...findDirectReadModifyWrites(context), ...findIndirectReadModifyWrites(context)]);
}

/** `account.balance -= amount` — the write goes straight into the shared field. */
function findDirectReadModifyWrites(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const expression of sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const operator = expression.getOperatorToken().getKind();
    if (!ASSIGNMENT_OPERATORS.has(operator)) continue;

    const target = expression.getLeft();
    if (monetaryNameOf(target) === undefined || !isSharedTarget(target)) continue;

    const readsOwnValue =
      operator === SyntaxKind.PlusEqualsToken ||
      operator === SyntaxKind.MinusEqualsToken ||
      (containsArithmetic(expression.getRight()) &&
        readsName(expression.getRight(), monetaryNameOf(target) as string));

    if (!readsOwnValue) continue;

    findings.push(
      toFinding(
        expression,
        READ_MODIFY_WRITE,
        context,
        isAsyncContext(expression) ? 'high' : READ_MODIFY_WRITE.baseSeverity,
        'two concurrent reads of `100` both compute `100 - 30 = 70` and both write `70`, so one withdrawal of 30 vanishes',
      ),
    );
  }

  return findings;
}

function findCheckThenAct(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const statement of sourceFile.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const condition = statement.getExpression();
    if (!Node.isBinaryExpression(condition)) continue;
    if (!COMPARISON_OPERATORS.has(condition.getOperatorToken().getKind())) continue;
    if (!comparesMoney(condition)) continue;
    if (!awaitsMoneyWrite(statement)) continue;

    findings.push(
      toFinding(
        condition,
        CHECK_THEN_ACT,
        context,
        CHECK_THEN_ACT.baseSeverity,
        'two requests can pass this guard before either write lands, so the same balance is spent twice',
      ),
    );
  }

  return findings;
}

function findStaleReads(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const declaration of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = declaration.getName();
    if (!Node.isIdentifier(declaration.getNameNode())) continue;

    const initializer = declaration.getInitializer();
    if (initializer === undefined) continue;
    if (monetaryNameOf(declaration.getNameNode()) === undefined) continue;
    const awaitedRead =
      Node.isAwaitExpression(initializer) ||
      initializer.getFirstDescendantByKind(SyntaxKind.AwaitExpression) !== undefined;
    if (!awaitedRead) continue;

    const fn = enclosingFunction(declaration);
    if (fn === undefined || !functionHasAwait(fn)) continue;

    for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getStart() < declaration.getEnd()) continue;
      if (!WRITE_CALL.test(calleeText(call))) continue;
      if (!callReferences(call, name)) continue;
      if (!hasInterveningAwait(fn, declaration.getEnd(), call)) continue;

      findings.push(
        toFinding(
          call,
          STALE_READ,
          context,
          STALE_READ.baseSeverity,
          `\`${name}\` was read before an await and is written back here with a value another request may already have changed`,
        ),
      );
    }
  }

  return findings;
}

interface Derivation {
  name: string;
  node: Node;
  /** The shared balance or amount this local variable was computed from. */
  source: string;
}

const SCOPE_KINDS = [
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
] as const;

/**
 * `const nextBalance = account.balance - amount; await accounts.update({ balance: nextBalance })`.
 *
 * The old shape only looked at assignments to properties and module-level variables, so a balance
 * that was copied into a local, recomputed and written back through a function call slipped
 * through. The local accumulator case must keep working: `let total = 0; total += price` follows no
 * shared read, so it is never treated as a balance.
 */
function findIndirectReadModifyWrites(context: ScenarioContext): Finding[] {
  const { sourceFile } = context;
  const findings: Finding[] = [];

  for (const scope of scopesOf(sourceFile)) {
    const tainted = new Map<string, string>();
    const derivations = new Map<string, Derivation>();

    for (const declaration of scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (!inScope(declaration, scope, sourceFile)) continue;
      const nameNode = declaration.getNameNode();
      if (!Node.isIdentifier(nameNode)) continue;

      const initializer = declaration.getInitializer();
      if (initializer === undefined) continue;

      const name = declaration.getName();
      const source =
        sharedMoneySource(initializer, tainted) ??
        (isMonetaryIdentifier(name) && containsAwait(initializer) ? name : undefined);
      if (source === undefined) continue;

      tainted.set(name, source);
      if (containsArithmetic(initializer)) {
        derivations.set(name, { name, node: declaration, source });
      }
    }

    for (const expression of scope.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      if (!inScope(expression, scope, sourceFile)) continue;

      const operator = expression.getOperatorToken().getKind();
      const isPlainAssignment = operator === SyntaxKind.EqualsToken;
      const isCompoundAssignment =
        operator === SyntaxKind.PlusEqualsToken || operator === SyntaxKind.MinusEqualsToken;
      if (!isPlainAssignment && !isCompoundAssignment) continue;

      const target = unwrap(expression.getLeft());
      if (!Node.isIdentifier(target) || isSharedTarget(target)) continue;

      const name = target.getText();
      const source = isPlainAssignment
        ? sharedMoneySource(expression.getRight(), tainted)
        : tainted.get(name);
      if (source === undefined) continue;

      tainted.set(name, source);
      if (isPlainAssignment && containsArithmetic(expression.getRight())) {
        derivations.set(name, { name, node: expression, source });
      }
    }

    const reported = new Set<string>();
    for (const derivation of derivations.values()) {
      const write = firstWriteBack(scope, derivation, sourceFile);
      if (write === undefined) continue;

      const key = `${String(derivation.node.getStartLineNumber())}:${String(write.getStartLineNumber())}`;
      if (reported.has(key)) continue;
      reported.add(key);

      findings.push(
        toFinding(
          write,
          READ_MODIFY_WRITE,
          context,
          isAsyncContext(write) ? 'high' : READ_MODIFY_WRITE.baseSeverity,
          `\`${derivation.source}\` is read into \`${derivation.name}\` and written back through \`${calleeText(write)}\`: two requests can read the same value and the later write erases the earlier one`,
        ),
      );
    }
  }

  return findings;
}

function scopesOf(sourceFile: SourceFile): Node[] {
  const scopes: Node[] = [sourceFile];
  for (const kind of SCOPE_KINDS) scopes.push(...sourceFile.getDescendantsOfKind(kind));
  return scopes;
}

function inScope(node: Node, scope: Node, sourceFile: SourceFile): boolean {
  const owner = enclosingFunction(node);
  return scope === sourceFile ? owner === undefined : owner === scope;
}

/** The shared money name this expression reads, following one local copy at a time. */
function sharedMoneySource(node: Node, tainted: ReadonlyMap<string, string>): string | undefined {
  const sourceOf = (candidate: Node): string | undefined => {
    const value = unwrap(candidate);
    if (Node.isIdentifier(value)) {
      const name = value.getText();
      const derived = tainted.get(name);
      if (derived !== undefined) return derived;
      return isMonetaryIdentifier(name) && isSharedTarget(value) ? name : undefined;
    }
    if (Node.isPropertyAccessExpression(value)) {
      const name = value.getName();
      return isMonetaryIdentifier(name) ? name : undefined;
    }
    return undefined;
  };

  const direct = sourceOf(node);
  if (direct !== undefined) return direct;

  let found: string | undefined;
  node.forEachDescendant((descendant, traversal) => {
    if (found !== undefined) {
      traversal.stop();
      return;
    }
    const source = sourceOf(descendant);
    if (source !== undefined) {
      found = source;
      traversal.stop();
    }
  });
  return found;
}

function containsAwait(node: Node): boolean {
  return (
    Node.isAwaitExpression(node) ||
    node.getFirstDescendantByKind(SyntaxKind.AwaitExpression) !== undefined
  );
}

function firstWriteBack(
  scope: Node,
  derivation: Derivation,
  sourceFile: SourceFile,
): CallExpression | undefined {
  return scope.getDescendantsOfKind(SyntaxKind.CallExpression).find((call) => {
    if (!inScope(call, scope, sourceFile)) return false;
    if (call.getStart() <= derivation.node.getEnd()) return false;
    if (!WRITE_CALL.test(calleeText(call))) return false;
    return writesBack(call, derivation.name);
  });
}

/** Does the call put this local value into a monetary field? */
function writesBack(call: CallExpression, name: string): boolean {
  const writesMoneyProperty = call
    .getArguments()
    .some((argument) => hasMonetaryProperty(argument, name));
  if (writesMoneyProperty) return true;

  const calleeName = calleeText(call).replace(/[^A-Za-z0-9_$]/g, '');
  return (
    isMonetaryIdentifier(calleeName) && call.getArguments().some((argument) => readsName(argument, name))
  );
}

function hasMonetaryProperty(node: Node, name: string): boolean {
  for (const property of node.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (!isMonetaryIdentifier(property.getName())) continue;
    const value = property.getInitializer();
    if (value !== undefined && readsName(value, name)) return true;
  }
  for (const shorthand of node.getDescendantsOfKind(SyntaxKind.ShorthandPropertyAssignment)) {
    const key = shorthand.getName();
    if (key === name && isMonetaryIdentifier(key)) return true;
  }
  return false;
}

function containsArithmetic(node: Node): boolean {
  if (Node.isBinaryExpression(node) && ARITHMETIC_OPERATORS.has(node.getOperatorToken().getKind())) {
    return true;
  }
  return node
    .getDescendantsOfKind(SyntaxKind.BinaryExpression)
    .some((inner) => ARITHMETIC_OPERATORS.has(inner.getOperatorToken().getKind()));
}

function comparesMoney(condition: BinaryExpression): boolean {
  return (
    monetaryNameOf(condition.getLeft()) !== undefined ||
    monetaryNameOf(condition.getRight()) !== undefined
  );
}

/** Does the guarded branch await something that writes? */
function awaitsMoneyWrite(statement: IfStatement): boolean {
  const branches = [statement.getThenStatement(), statement.getElseStatement()].filter(
    (branch): branch is NonNullable<typeof branch> => branch !== undefined,
  );

  return branches.some((branch) =>
    branch.getDescendantsOfKind(SyntaxKind.AwaitExpression).some((awaited) => {
      const expression = unwrap(awaited.getExpression());
      return Node.isCallExpression(expression) && WRITE_CALL.test(calleeText(expression));
    }),
  );
}

function hasInterveningAwait(fn: FunctionLike, afterPosition: number, call: CallExpression): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.AwaitExpression).some((awaited) => {
    if (awaited.getStart() <= afterPosition) return false;
    if (awaited.getEnd() > call.getStart()) return false;
    // Waiting for the write itself is not an extra suspension point.
    return unwrap(awaited.getExpression()).getStart() !== call.getStart();
  });
}

function calleeText(call: CallExpression): string {
  return call.getExpression().getText();
}

function callReferences(call: CallExpression, name: string): boolean {
  return call.getArguments().some((argument) => readsName(argument, name));
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
    scenario: 'race_condition',
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

/** One finding per rule per line: nested statements describe the same defect. */
function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.line}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}

export const raceConditionScenario: Scenario = {
  id: 'race_condition',
  title: 'Race condition',
  description:
    'Simulates two concurrent transactions on one balance: read-modify-write, check-then-act, and stale reads across an await.',
  run(context: ScenarioContext): Finding[] {
    return analyzeRaceConditions(context);
  },
};
