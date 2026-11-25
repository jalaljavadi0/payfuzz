import {
  Node,
  SyntaxKind,
  type FunctionDeclaration,
  type FunctionExpression,
  type ArrowFunction,
  type MethodDeclaration,
} from 'ts-morph';
import { isMonetaryIdentifier } from '../detectors/patterns';
import { unwrap } from './ast';

/** Every function-shaped node PayFuzz inspects. */
export type FunctionLike =
  FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration;

const FUNCTION_LIKE_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.FunctionExpression,
  SyntaxKind.ArrowFunction,
  SyntaxKind.MethodDeclaration,
]);

export function isFunctionLikeNode(node: Node): boolean {
  return FUNCTION_LIKE_KINDS.has(node.getKind());
}

/** The name of a money-holding identifier or property, if this expression is one. */
export function monetaryNameOf(node: Node): string | undefined {
  const target = unwrap(node);
  if (Node.isIdentifier(target)) {
    return isMonetaryIdentifier(target.getText()) ? target.getText() : undefined;
  }
  if (Node.isPropertyAccessExpression(target)) {
    const name = target.getName();
    return isMonetaryIdentifier(name) ? name : undefined;
  }
  return undefined;
}

/** Does this expression mention the given identifier or property name anywhere? */
export function readsName(node: Node, name: string): boolean {
  const unwrapped = unwrap(node);
  if (Node.isIdentifier(unwrapped) && unwrapped.getText() === name) return true;
  if (Node.isPropertyAccessExpression(unwrapped) && unwrapped.getName() === name) return true;

  let found = false;
  node.forEachDescendant((descendant, traversal) => {
    if (found) return;
    if (Node.isIdentifier(descendant) && descendant.getText() === name) {
      found = true;
      traversal.stop();
    } else if (Node.isPropertyAccessExpression(descendant) && descendant.getName() === name) {
      found = true;
      traversal.stop();
    }
  });
  return found;
}

export function enclosingFunction(node: Node): FunctionLike | undefined {
  const ancestor = node.getFirstAncestor((candidate) => isFunctionLikeNode(candidate));
  return ancestor as FunctionLike | undefined;
}

/** A function that suspends can be interleaved with another request — that is the race window. */
export function functionHasAwait(fn: FunctionLike): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.AwaitExpression).length > 0;
}

export function isAsyncContext(node: Node): boolean {
  const fn = enclosingFunction(node);
  return fn !== undefined && functionHasAwait(fn);
}

/**
 * Targets that are not a local accumulator: an object property (`account.balance`) or a file-level
 * variable. `let total = 0; total += price` inside one function is not a race by itself, so a local
 * declaration must never satisfy this check.
 */
export function isSharedTarget(node: Node): boolean {
  const target = unwrap(node);
  if (Node.isPropertyAccessExpression(target)) return true;
  if (!Node.isIdentifier(target)) return false;

  const name = target.getText();
  return target
    .getSourceFile()
    .getVariableDeclarations()
    .some(
      (declaration) =>
        declaration.getName() === name && enclosingFunction(declaration) === undefined,
    );
}
