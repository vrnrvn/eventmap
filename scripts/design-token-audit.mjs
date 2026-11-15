#!/usr/bin/env node
// Design-token audit (flow 9 / docs/ISSUES.md "Design tokens").
//
//   node scripts/design-token-audit.mjs            # summary, worst files first
//   node scripts/design-token-audit.mjs --list     # every offending line
//   node scripts/design-token-audit.mjs --file screens/EventDetail.tsx
//
// Spacing and radius literals in StyleSheet blocks are counted and split into
// "on-scale" (the number equals a Spacing / BorderRadius token, so it is a
// mechanical swap) and "off-scale" (needs a judgement call). The cleanup is
// meant to happen screen by screen during the visual sweep, with screenshots
// before and after — a blind codemod would shift layouts — so this exists to
// make the remaining work countable and to stop it growing.
import fs from 'node:fs';
import path from 'node:path';

const SPACING = { 4: 'xs', 8: 'sm', 16: 'md', 24: 'lg', 32: 'xl', 48: 'xxl', 64: 'xxxl' };
const RADIUS = { 6: 'sm', 12: 'md', 18: 'lg', 24: 'xl', 32: 'xxl', 9999: 'round' };
const SPACING_PROPS = /\b(padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|gap|rowGap|columnGap)\s*:\s*(-?\d+(?:\.\d+)?)/g;
const RADIUS_PROPS = /\b(borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius)\s*:\s*(\d+(?:\.\d+)?)/g;

const args = process.argv.slice(2);
const wantList = args.includes('--list');
const onlyFile = args[args.indexOf('--file') + 1];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = onlyFile ? [onlyFile] : ['app', 'screens', 'components'].flatMap((d) => walk(d));
const rows = [];
let totals = { spacingOn: 0, spacingOff: 0, radiusOn: 0, radiusOff: 0 };

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const stat = { file, spacingOn: 0, spacingOff: 0, radiusOn: 0, radiusOff: 0, hits: [] };
  lines.forEach((line, i) => {
    // Skip lines that already reference a token.
    if (/Spacing\.|BorderRadius\./.test(line)) return;
    for (const [re, table, onKey, offKey, kind] of [
      [SPACING_PROPS, SPACING, 'spacingOn', 'spacingOff', 'Spacing'],
      [RADIUS_PROPS, RADIUS, 'radiusOn', 'radiusOff', 'BorderRadius'],
    ]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        const n = Number(m[2]);
        const token = table[Math.abs(n)];
        stat[token ? onKey : offKey] += 1;
        stat.hits.push(`${file}:${i + 1}  ${m[1]}: ${n}` + (token ? `  → ${kind}.${token}` : '  (off-scale)'));
      }
    }
  });
  if (stat.spacingOn + stat.spacingOff + stat.radiusOn + stat.radiusOff > 0) rows.push(stat);
  for (const k of Object.keys(totals)) totals[k] += stat[k];
}

rows.sort((a, b) => (b.spacingOn + b.spacingOff + b.radiusOn + b.radiusOff) - (a.spacingOn + a.spacingOff + a.radiusOn + a.radiusOff));

if (wantList || onlyFile) {
  for (const r of rows) r.hits.forEach((h) => console.log(h));
  console.log('');
}
console.log('file                                               spacing(on/off)  radius(on/off)');
for (const r of rows.slice(0, onlyFile ? rows.length : 15)) {
  console.log(`${r.file.padEnd(50)} ${String(r.spacingOn).padStart(5)}/${String(r.spacingOff).padEnd(5)} ${String(r.radiusOn).padStart(7)}/${String(r.radiusOff).padEnd(5)}`);
}
const total = totals.spacingOn + totals.spacingOff + totals.radiusOn + totals.radiusOff;
console.log(`\n${rows.length} files, ${total} literals: spacing ${totals.spacingOn} on-scale + ${totals.spacingOff} off-scale, radius ${totals.radiusOn} on-scale + ${totals.radiusOff} off-scale.`);
console.log('On-scale literals are a mechanical swap to the token; off-scale ones need a decision.');
