import { describe, expect, it } from 'vitest';
import { SyntaxKind } from 'ts-morph';
import {
  enclosingFunction,
  functionHasAwait,
  isAsyncContext,
  isSharedTarget,
  monetaryNameOf,
  readsName,
} from '../../src/utils/money';
import { createProject, parseSource } from '../../src/utils/parse';

const CODE = [
  'const moduleBalance = 0;',
  '',
  'function sync(account: { balance: number }, amount: number) {',
  '  let localTotal = 0;',
  '  localTotal += amount;',
  '  account.balance += amount;',
  '  return localTotal;',
  '}',
  '',
  'async function asyncFn(account: { balance: number }) {',
  '  await save(account.balance);',
  '}',
].join('\n');

function parse() {
  return parseSource(createProject(), 'src/payments/sample.ts', CODE);
}

/** `getVariableDeclarationOrThrow` only looks at the file scope; locals need a search. */
function declarationNamed(file: ReturnType<typeof parse>, name: string) {
  const found = file
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((candidate) => candidate.getName() === name);
  if (found === undefined) throw new Error(`No declaration named ${name}`);
  return found;
}

describe('monetaryNameOf', () => {
  it('recognises money identifiers and properties but not literals', () => {
    const file = parse();
    const property = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0];
    const parameter = file
      .getFunctionOrThrow('sync')
      .getParameters()
      .find((candidate) => candidate.getName() === 'amount');

    expect(property === undefined ? undefined : monetaryNameOf(property)).toBe('balance');
    expect(parameter === undefined ? undefined : monetaryNameOf(parameter.getNameNode())).toBe(
      'amount',
    );
    expect(monetaryNameOf(file.getVariableDeclarationOrThrow('moduleBalance').getNameNode())).toBe(
      'moduleBalance',
    );
    expect(monetaryNameOf(file.getFirstDescendantByKindOrThrow(SyntaxKind.NumericLiteral))).toBe(
      undefined,
    );
  });
});

describe('readsName', () => {
  it('finds an identifier anywhere inside an expression', () => {
    const file = parse();
    const declaration = declarationNamed(file, 'localTotal');

    expect(readsName(declaration.getInitializerOrThrow(), 'localTotal')).toBe(false);
    expect(readsName(file.getFunctionOrThrow('sync').getBodyOrThrow(), 'account')).toBe(true);
  });
});

describe('shared targets', () => {
  it('treats properties and file-level variables as shared but not locals', () => {
    const file = parse();
    const property = file.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)[0];

    expect(property === undefined ? undefined : isSharedTarget(property)).toBe(true);
    expect(isSharedTarget(file.getVariableDeclarationOrThrow('moduleBalance').getNameNode())).toBe(
      true,
    );
    expect(isSharedTarget(declarationNamed(file, 'localTotal').getNameNode())).toBe(false);
  });
});

describe('function context', () => {
  it('finds the enclosing function and whether it suspends', () => {
    const file = parse();
    const sync = file.getFunctionOrThrow('sync');
    const asyncFn = file.getFunctionOrThrow('asyncFn');
    const localTotal = declarationNamed(file, 'localTotal');

    expect(enclosingFunction(localTotal)?.getText()).toContain('function sync');
    expect(functionHasAwait(sync)).toBe(false);
    expect(functionHasAwait(asyncFn)).toBe(true);
    expect(isAsyncContext(localTotal)).toBe(false);
    expect(isAsyncContext(asyncFn.getBodyOrThrow())).toBe(true);
  });
});
