// Layout invariant checker.
//
// Loads src/data/layouts.ts through esbuild (no emit, in-memory) and verifies:
//   1. full deep-equality against scripts/layouts.golden.json when present
//      (ids, labels, keyCodes, x/y/width/height, row/col, zone, array order,
//       declared width/height, names/descriptions)
//   2. no duplicate key ids inside a layout
//   3. no two key rectangles overlap
//   4. every keyCode is a valid KeyboardEvent.code and unique per layout
//      (duplicate codes would shadow input mappings)
//   5. declared width/height match key bounds + per-layout padding
//
// Usage:
//   node scripts/check-layouts.mjs --golden   # (re)write golden snapshot
//   node scripts/check-layouts.mjs            # verify
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const goldenPath = resolve(root, 'scripts/layouts.golden.json');

async function loadLayouts() {
  const result = await build({
    entryPoints: [resolve(root, 'src/data/layouts.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    alias: { '@': resolve(root, 'src') },
  });
  const code = result.outputFiles[0].text;
  const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  return import(dataUrl);
}

// Valid KeyboardEvent.code values per the UI Events specification
// (https://www.w3.org/TR/uievents-code/).
const VALID_CODES = new Set([
  // Alphanumeric section
  'Backquote', 'Backslash', 'BracketLeft', 'BracketRight', 'Comma', 'Digit0',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8',
  'Digit9', 'Equal', 'IntlBackslash', 'IntlRo', 'IntlYen', 'KeyA', 'KeyB',
  'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ', 'KeyK',
  'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT',
  'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ', 'Minus', 'Period', 'Quote',
  'Semicolon', 'Slash',
  // Functional and modifier keys
  'Backspace', 'AltLeft', 'AltRight', 'CapsLock', 'ContextMenu', 'ControlLeft',
  'ControlRight', 'Enter', 'MetaLeft', 'MetaRight', 'ShiftLeft', 'ShiftRight',
  'Space', 'Tab',
  // Function and navigation
  'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10',
  'F11', 'F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20',
  'F21', 'F22', 'F23', 'F24',
  'PrintScreen', 'ScrollLock', 'Pause',
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  // Numpad
  'NumLock', 'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
  'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadComma', 'NumpadDecimal', 'NumpadDivide',
  'NumpadEnter', 'NumpadEqual', 'NumpadMultiply', 'NumpadSubtract',
]);

const VALID_ZONES = new Set([
  'alphanumeric', 'function', 'navigation', 'numpad', 'modifiers', 'spacebar',
]);

// Duplicate keyCodes that existed before the generator refactor and must be
// preserved exactly (input mapping uses first-match). The 75% layout appends a
// function row above the inherited 65% keys; its Esc/Del deliberately shadow the
// Esc/Del living in the 60%-derived block. Any *new* duplicate fails the check.
const KNOWN_DUPLICATE_CODES = {
  '75%': [
    { code: 'Escape', ids: ['r0-0', '75-r0-0'] },
    { code: 'Delete', ids: ['r0-13', '75-r1-65-0'] },
  ],
};

const EPS = 1e-9;

// Expected padding between the last key boundary and the declared case size.
// Heights always reserve 0.2 units below the last row. Widths are exact except
// 60% whose keys historically extend 0.1 beyond the declared 15.6 width — kept
// as an explicit negative padding so existing geometry is preserved byte-for-byte.
const EXPECTED_PADDING = {
  '60%':  { right: -0.1, bottom: 0.2 },
  '65%':  { right: 0.05, bottom: 0.2 },
  '75%':  { right: 0.0,  bottom: 0.2 },
  'TKL':  { right: 0.0,  bottom: 0.2 },
  'Full': { right: 0.05, bottom: 0.2 },
};

function snapshot(configs, list) {
  return JSON.stringify(
    { list, configs },
    (_k, v) => (typeof v === 'number' ? Number(v.toFixed(10)) : v),
    2
  );
}

const { LAYOUT_CONFIGS, LAYOUT_LIST } = await loadLayouts();
const types = Object.keys(LAYOUT_CONFIGS);

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
};

if (process.argv.includes('--golden')) {
  writeFileSync(goldenPath, snapshot(LAYOUT_CONFIGS, LAYOUT_LIST));
  console.log(`golden snapshot written to ${goldenPath}`);
  process.exit(0);
}

console.log('Layout inventory:');
for (const type of LAYOUT_LIST) {
  const c = LAYOUT_CONFIGS[type];
  const bounds = c.keys.reduce(
    (b, k) => ({
      minX: Math.min(b.minX, k.x),
      minY: Math.min(b.minY, k.y),
      maxX: Math.max(b.maxX, k.x + k.width),
      maxY: Math.max(b.maxY, k.y + k.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  console.log(
    `  ${type.padEnd(5)} keys=${String(c.keys.length).padStart(3)}  ` +
    `width=${c.width}  height=${c.height}  ` +
    `bounds=[${bounds.minX},${bounds.minY}]..[${bounds.maxX},${bounds.maxY}]`
  );
}

console.log('\nStructural checks:');

check('LAYOUT_LIST matches exported config keys', () => {
  assert.deepEqual([...LAYOUT_LIST], types);
});

for (const type of LAYOUT_LIST) {
  const cfg = LAYOUT_CONFIGS[type];

  check(`${type}: no duplicate key ids`, () => {
    const seen = new Map();
    const dupes = [];
    for (const k of cfg.keys) {
      if (seen.has(k.id)) dupes.push(`${k.id} (index ${seen.get(k.id)} and ${cfg.keys.indexOf(k)})`);
      seen.set(k.id, cfg.keys.indexOf(k));
    }
    assert.equal(dupes.length, 0, `duplicate ids: ${dupes.join(', ')}`);
  });

  check(`${type}: no overlapping key rectangles`, () => {
    const hits = [];
    for (let i = 0; i < cfg.keys.length; i++) {
      for (let j = i + 1; j < cfg.keys.length; j++) {
        const a = cfg.keys[i];
        const b = cfg.keys[j];
        const overlapX = a.x + EPS < b.x + b.width && b.x + EPS < a.x + a.width;
        const overlapY = a.y + EPS < b.y + b.height && b.y + EPS < a.y + a.height;
        if (overlapX && overlapY) {
          hits.push(`${a.id} [${a.x},${a.y} ${a.width}x${a.height}] <-> ${b.id} [${b.x},${b.y} ${b.width}x${b.height}]`);
        }
      }
    }
    assert.equal(hits.length, 0, `overlaps:\n    ${hits.join('\n    ')}`);
  });

  check(`${type}: all keyCodes valid; no new duplicate codes (input mapping)`, () => {
    const problems = [];
    const codeToIds = new Map();
    for (const k of cfg.keys) {
      if (k.keyCode === undefined) continue;
      if (!VALID_CODES.has(k.keyCode)) problems.push(`${k.id}: unknown code "${k.keyCode}"`);
      if (!codeToIds.has(k.keyCode)) codeToIds.set(k.keyCode, []);
      codeToIds.get(k.keyCode).push(k.id);
    }
    const found = [];
    for (const [code, ids] of codeToIds) {
      if (ids.length > 1) found.push({ code, ids });
    }
    const expected = KNOWN_DUPLICATE_CODES[type] ?? [];
    const key = (g) => `${g.code}:${g.ids.join(',')}`;
    const foundSet = new Set(found.map(key));
    const expectedSet = new Set(expected.map(key));
    for (const g of found) if (!expectedSet.has(key(g))) problems.push(`new duplicate code "${g.code}" on ${g.ids.join(' and ')}`);
    for (const g of expected) if (!foundSet.has(key(g))) problems.push(`preserved duplicate code "${g.code}" on ${g.ids.join(' and ')} disappeared`);
    assert.equal(problems.length, 0, problems.join('; '));
  });

  check(`${type}: every zone is a known KeyZone`, () => {
    const bad = cfg.keys.filter((k) => !VALID_ZONES.has(k.zone)).map((k) => `${k.id}:${k.zone}`);
    assert.equal(bad.length, 0, bad.join(', '));
  });

  check(`${type}: width/height follow from key bounds + padding`, () => {
    const maxX = Math.max(...cfg.keys.map((k) => k.x + k.width));
    const maxY = Math.max(...cfg.keys.map((k) => k.y + k.height));
    const minX = Math.min(...cfg.keys.map((k) => k.x));
    const minY = Math.min(...cfg.keys.map((k) => k.y));
    const pad = EXPECTED_PADDING[type];
    assert.ok(Math.abs(minX) < EPS, `minX expected 0, got ${minX}`);
    assert.ok(Math.abs(minY) < EPS, `minY expected 0, got ${minY}`);
    assert.ok(
      Math.abs(cfg.width - (maxX + pad.right)) < EPS,
      `width ${cfg.width} != maxX ${maxX} + right padding ${pad.right} = ${maxX + pad.right}`
    );
    assert.ok(
      Math.abs(cfg.height - (maxY + pad.bottom)) < EPS,
      `height ${cfg.height} != maxY ${maxY} + bottom padding ${pad.bottom} = ${maxY + pad.bottom}`
    );
  });
}

if (existsSync(goldenPath)) {
  console.log('\nGolden snapshot diff:');
  check('layouts identical to golden baseline (ids, codes, geometry, zones, order)', () => {
    const expected = readFileSync(goldenPath, 'utf8');
    const actual = snapshot(LAYOUT_CONFIGS, LAYOUT_LIST);
    if (actual !== expected) {
      const a = JSON.parse(actual);
      const e = JSON.parse(expected);
      const diffs = [];
      for (const type of LAYOUT_LIST) {
        const ca = a.configs[type];
        const ce = e.configs[type];
        for (const field of ['name', 'description', 'width', 'height']) {
          if (JSON.stringify(ca[field]) !== JSON.stringify(ce[field])) {
            diffs.push(`${type}.${field}: ${JSON.stringify(ce[field])} -> ${JSON.stringify(ca[field])}`);
          }
        }
        if (ca.keys.length !== ce.keys.length) {
          diffs.push(`${type}: key count ${ce.keys.length} -> ${ca.keys.length}`);
        } else {
          ca.keys.forEach((k, i) => {
            const old = ce.keys[i];
            for (const field of ['id', 'label', 'x', 'y', 'width', 'height', 'row', 'col', 'zone', 'keyCode']) {
              if (JSON.stringify(k[field]) !== JSON.stringify(old[field])) {
                diffs.push(`${type} keys[${i}] (${old.id}): ${field} ${JSON.stringify(old[field])} -> ${JSON.stringify(k[field])}`);
              }
            }
          });
        }
      }
      throw new Error(diffs.length ? diffs.join('\n      ') : 'snapshot differs (run with --golden to inspect)');
    }
  });
} else {
  console.log('\n(no golden snapshot found; run with --golden to create one)');
}

console.log('');
if (failures.length) {
  console.error(`FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('ALL LAYOUT CHECKS PASSED');
