import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../src');
/** Generated shadcn/ui primitives carry no app copy. */
const IGNORED_DIRS = [path.join(SRC, 'components', 'ui')];
const TEXT_ATTRIBUTES = new Set(['aria-label', 'title', 'placeholder', 'alt', 'label']);
/** Letters in any script; symbols, numbers and punctuation ("·", "-", "#", "%") are fine. */
const HAS_WORDS = /\p{L}{2,}/u;
/** `a && 'x'` renders 'x'; `a === 'x'` doesn't. */
const RENDERING_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function sourceFiles(dir: string): string[] {
  if (IGNORED_DIRS.includes(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [full] : [];
  });
}

/** JSX text and user-facing attribute strings that contain words, as `file:line "text"`. */
export function findHardcodedStrings(file: string, code = readFileSync(file, 'utf8')): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const report = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    found.push(`${path.relative(SRC, file)}:${line} "${text.trim()}"`);
  };

  /** Strings an expression can render directly: literals, template text, both sides of ?:, && and ??. */
  const checkRendered = (expr: ts.Expression) => {
    if (ts.isStringLiteralLike(expr)) {
      if (HAS_WORDS.test(expr.text)) report(expr, expr.text);
    } else if (ts.isTemplateExpression(expr)) {
      const text = [expr.head.text, ...expr.templateSpans.map((span) => span.literal.text)].join(
        ' ',
      );
      if (HAS_WORDS.test(text)) report(expr, text);
    } else if (ts.isConditionalExpression(expr)) {
      checkRendered(expr.whenTrue);
      checkRendered(expr.whenFalse);
    } else if (ts.isBinaryExpression(expr) && RENDERING_OPERATORS.has(expr.operatorToken.kind)) {
      checkRendered(expr.left);
      checkRendered(expr.right);
    } else if (ts.isParenthesizedExpression(expr)) {
      checkRendered(expr.expression);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && HAS_WORDS.test(node.text)) report(node, node.text);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      checkRendered(node.expression);
    }
    if (
      ts.isJsxAttribute(node) &&
      TEXT_ATTRIBUTES.has(node.name.getText(source)) &&
      node.initializer
    ) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer
        : ts.isJsxExpression(node.initializer) &&
            node.initializer.expression &&
            ts.isStringLiteralLike(node.initializer.expression)
          ? node.initializer.expression
          : null;
      if (value && HAS_WORDS.test(value.text)) report(node, value.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('no hardcoded UI strings', () => {
  it('detects JSX text and text attributes', () => {
    const code = [
      `export const A = () => <div title="Hello" aria-label={'World'} className="flex">Save {x} · <b>{t('ok')}</b></div>;`,
      "export const B = () => <p>{ok ? t(`a.${k}`) : 'Failed'}{`${n} miles`}{n && '-'}</p>;",
    ].join('\n');
    expect(findHardcodedStrings(path.join(SRC, 'x.tsx'), code)).toEqual([
      'x.tsx:1 "Hello"',
      'x.tsx:1 "World"',
      'x.tsx:1 "Save"',
      'x.tsx:2 "Failed"',
      'x.tsx:2 "miles"',
    ]);
  });

  it('all copy in components goes through i18n', () => {
    expect(sourceFiles(SRC).flatMap((file) => findHardcodedStrings(file))).toEqual([]);
  });
});
