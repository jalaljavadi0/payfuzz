import { describe, expect, it } from 'vitest';
import { Node } from 'ts-morph';
import { positionOf, snippetOf, unwrap } from '../../src/utils/ast';
import { createProject, parseSource } from '../../src/utils/parse';

function parse(code: string) {
  return parseSource(createProject(), 'src/payments/sample.ts', code);
}

describe('positionOf', () => {
  it('reports a 1-based line and column', () => {
    const file = parse('const a = 1;\n  const total = price + fee;');
    const expression = file.getVariableDeclarationOrThrow('total').getInitializerOrThrow();

    expect(positionOf(expression)).toEqual({ line: 2, column: 17 });
  });
});

describe('snippetOf', () => {
  it('collapses whitespace and truncates long snippets', () => {
    const file = parse('const total =\n  price +\n  fee;');
    const expression = file.getVariableDeclarationOrThrow('total').getInitializerOrThrow();

    expect(snippetOf(expression)).toBe('price + fee');

    const longFile = parse(`const total = ${'field + '.repeat(30)}0;`);
    const longExpression = longFile.getVariableDeclarationOrThrow('total').getInitializerOrThrow();

    const snippet = snippetOf(longExpression, 40);
    expect(snippet).toHaveLength(40);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('unwrap', () => {
  it('strips wrappers that do not change the value', () => {
    const file = parse(
      [
        'declare const x: number;',
        'const parenthesized = ((1));',
        'const negated = -1;',
        'const asserted = x as number;',
        'const nonNull = x!;',
        'const satisfied = x satisfies number;',
      ].join('\n'),
    );

    const initializer = (name: string) =>
      file.getVariableDeclarationOrThrow(name).getInitializerOrThrow();

    expect(unwrap(initializer('parenthesized')).getText()).toBe('1');
    expect(unwrap(initializer('negated')).getText()).toBe('1');
    expect(unwrap(initializer('asserted')).getText()).toBe('x');
    expect(unwrap(initializer('nonNull')).getText()).toBe('x');
    expect(unwrap(initializer('satisfied')).getText()).toBe('x');
  });

  it('returns a plain node untouched', () => {
    const file = parse('const total = price + fee;');
    const expression = file.getVariableDeclarationOrThrow('total').getInitializerOrThrow();

    expect(Node.isBinaryExpression(unwrap(expression))).toBe(true);
  });
});
