import { Node } from 'ts-morph';

export interface SourceLocation {
  line: number;
  column: number;
}

/** 1-based location of a node's first token. */
export function positionOf(node: Node): SourceLocation {
  return {
    line: node.getStartLineNumber(),
    column: node.getStart() - node.getStartLinePos() + 1,
  };
}

/** The node's source text on one line, truncated so a report stays readable. */
export function snippetOf(node: Node, maxLength = 160): string {
  const text = node.getText().replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

/** Strip wrappers that do not change the value being compared or summed. */
export function unwrap(node: Node): Node {
  if (Node.isParenthesizedExpression(node)) return unwrap(node.getExpression());
  if (Node.isPrefixUnaryExpression(node)) return unwrap(node.getOperand());
  if (Node.isAsExpression(node)) return unwrap(node.getExpression());
  if (Node.isNonNullExpression(node)) return unwrap(node.getExpression());
  if (Node.isSatisfiesExpression(node)) return unwrap(node.getExpression());
  return node;
}
