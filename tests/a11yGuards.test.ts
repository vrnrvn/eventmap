import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * Source guards for screen-reader regressions (accessibility Phase 4).
 *
 * Parses every .tsx file under app/, screens/ and components/ with the
 * TypeScript compiler and checks JSX structure, so attributes containing
 * `=>` or nested braces don't confuse the scan.
 *
 * Allowlists document known remaining offenders — shrink them, never grow.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app', 'screens', 'components'];

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsxFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((dir) => {
  const full = path.join(repoRoot, dir);
  return fs.existsSync(full) ? listTsxFiles(full) : [];
});

const rel = (file: string) => path.relative(repoRoot, file).split(path.sep).join('/');

// Accessible-by-default touchables: each becomes ONE VoiceOver element on
// iOS, hiding any touchable nested inside it.
const TOUCHABLES = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
]);

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

function tagName(node: JsxNode): string {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName;
  return tag.getText();
}

function attributes(node: JsxNode): ts.JsxAttributes {
  return ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
}

function attr(node: JsxNode, name: string): ts.JsxAttribute | undefined {
  return attributes(node).properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name
  );
}

function hasSpreadCall(node: JsxNode, fn: string): boolean {
  return attributes(node).properties.some(
    (p) => ts.isJsxSpreadAttribute(p) && p.expression.getText().startsWith(`${fn}(`)
  );
}

type Hit = { file: string; line: number; text: string };

function scan(visit: (node: JsxNode, sf: ts.SourceFile, hits: Hit[]) => void): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const walk = (node: ts.Node) => {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) visit(node, sf, hits);
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  return hits;
}

function hitAt(node: ts.Node, sf: ts.SourceFile, text: string): Hit {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  return { file: rel(sf.fileName), line: line + 1, text };
}

const key = (h: Hit) => `${h.file}: ${h.text}`;

it('scans a sane number of source files', () => {
  expect(files.length).toBeGreaterThan(50);
});

describe('nested touchables', () => {
  // Outer touchables whose nested buttons are still unreachable on iOS.
  // Format "file: Outer > Inner". Shrink this list; never grow it.
  const ALLOWLIST = new Set<string>([]);

  it('no touchable is nested inside another accessible touchable', () => {
    const hits = scan((node, sf, out) => {
      const outer = tagName(node);
      if (!TOUCHABLES.has(outer) || !ts.isJsxElement(node)) return;
      // Opted out of being one element, or nested actions are exposed as
      // accessibilityActions (VoiceOver rotor / TalkBack actions menu).
      const accessible = attr(node, 'accessible');
      if (accessible?.initializer?.getText() === '{false}') return;
      if (attr(node, 'accessibilityActions')) return;
      const findInner = (child: ts.Node) => {
        if ((ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) && TOUCHABLES.has(tagName(child))) {
          out.push(hitAt(child, sf, `${outer} > ${tagName(child)}`));
          return; // report the outermost nested touchable only
        }
        ts.forEachChild(child, findInner);
      };
      node.children.forEach(findInner);
    });
    const unexpected = hits.filter((h) => !ALLOWLIST.has(key(h)));
    expect(unexpected.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')).toBe('');
  });
});

describe('modals support the screen-reader escape gesture', () => {
  // Shrink this list; never grow it.
  const ALLOWLIST = new Set<string>([]);

  it('every <Modal> contains an onAccessibilityEscape handler', () => {
    const hits = scan((node, sf, out) => {
      if (tagName(node) !== 'Modal' || !ts.isJsxElement(node)) return;
      let found = false;
      const look = (child: ts.Node) => {
        if (found) return;
        if (
          (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) &&
          attr(child, 'onAccessibilityEscape')
        ) {
          found = true;
          return;
        }
        ts.forEachChild(child, look);
      };
      node.children.forEach(look);
      if (!found) out.push(hitAt(node, sf, 'Modal without onAccessibilityEscape'));
    });
    const unexpected = hits.filter((h) => !ALLOWLIST.has(key(h)));
    expect(unexpected.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')).toBe('');
  });
});

describe('selection is not color-only', () => {
  const SELECTED_STYLE = /styles\.\w*(Selected|Active|On)\b/;
  // Shrink this list; never grow it.
  const ALLOWLIST = new Set<string>([]);

  it('touchables styled as selected/active expose accessibilityState', () => {
    const hits = scan((node, sf, out) => {
      if (!TOUCHABLES.has(tagName(node))) return;
      const style = attr(node, 'style')?.initializer?.getText() ?? '';
      const match = style.match(SELECTED_STYLE);
      if (!match) return;
      if (attr(node, 'accessibilityState') || hasSpreadCall(node, 'choiceA11y') || hasSpreadCall(node, 'a11yState')) return;
      out.push(hitAt(node, sf, `${tagName(node)} ${match[0]}`));
    });
    const unexpected = hits.filter((h) => !ALLOWLIST.has(key(h)));
    expect(unexpected.map((h) => `${h.file}:${h.line}: ${h.text}`).join('\n')).toBe('');
  });
});
