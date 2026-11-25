import { describe, expect, it } from 'vitest';
import { createProject, parseSource } from '../../src/utils/parse';

describe('parse helpers', () => {
  it('parses TypeScript and JavaScript text in memory', () => {
    const project = createProject();
    const file = parseSource(project, 'src/payments/checkout.js', 'export const amount = 10;');

    expect(file.getVariableDeclarationOrThrow('amount').getInitializerOrThrow().getText()).toBe(
      '10',
    );
    expect(project.getSourceFiles()).toHaveLength(1);
  });

  it('overwrites the same path instead of duplicating it', () => {
    const project = createProject();
    parseSource(project, 'src/payments/checkout.ts', 'const a = 1;');
    const file = parseSource(project, 'src/payments/checkout.ts', 'const b = 2;');

    expect(project.getSourceFiles()).toHaveLength(1);
    expect(file.getVariableDeclarationOrThrow('b')).toBeDefined();
  });
});
