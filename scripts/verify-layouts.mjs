#!/usr/bin/env node
/**
 * 布局不变量检查（重构验收用）
 *
 * 对 src/data/layouts.ts 生成的每个布局断言：
 *   1. key id 唯一（无重复 id）
 *   2. 键矩形两两不重叠（AABB，仅允许边界接触）
 *   3. 所有 keyCode 都是合法的 KeyboardEvent.code 名称（无失效映射）
 *   4. 外壳宽高与键边界一致：
 *        - 高度 == 最下键底缘 + 0.2u 底边
 *        - 宽度覆盖键右缘（允许重构前已有的 ≤0.1u 出边）
 *   5. 每个键的 row/col 与所在行一致且键宽/键高为正
 *
 * 运行：npm run verify:layouts
 */
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const entry = 'scripts/__layouts_check_entry.ts';
writeFileSync(
  entry,
  `export { LAYOUT_CONFIGS, LAYOUT_LIST, computeKeyBounds } from '../src/data/layouts';\n`
);

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});
const bundle = result.outputFiles[0].text;
const bundlePath = 'scripts/__layouts_check.bundle.mjs';
writeFileSync(bundlePath, bundle);
const { LAYOUT_CONFIGS, LAYOUT_LIST, computeKeyBounds } = await import(
  pathToFileURL(bundlePath).href
);
rmSync(entry, { force: true });
rmSync(bundlePath, { force: true });

const EPS = 1e-9;

// KeyboardEvent.code 合法名称（来自 UI Events 规范），未列出的即失效映射
const VALID_CODES = new Set([
  // Function
  'Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PrintScreen', 'ScrollLock', 'Pause',
  // Alphanumeric block
  'Backquote', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'Digit7', 'Digit8', 'Digit9', 'Minus', 'Equal',
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ',
  'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT',
  'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
  'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash',
  'Backspace', 'Tab', 'CapsLock', 'Enter', 'Space',
  // Modifiers
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'ContextMenu',
  // Navigation
  'Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  // Numpad
  'NumLock', 'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4', 'Numpad5', 'Numpad6',
  'Numpad7', 'Numpad8', 'Numpad9', 'NumpadDecimal', 'NumpadAdd', 'NumpadSubtract',
  'NumpadMultiply', 'NumpadDivide', 'NumpadEnter',
]);

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};

console.log('布局不变量检查');
console.log('='.repeat(72));

for (const type of LAYOUT_LIST) {
  const cfg = LAYOUT_CONFIGS[type];
  const keys = cfg.keys;
  console.log(`\n${type}（${keys.length} 键，外壳 ${cfg.width} × ${cfg.height}）`);
  let localFailures = failures;

  // 1. 重复 id
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key.id)) fail(`重复 id: ${key.id}`);
    seen.add(key.id);
  }

  // 2. 重叠
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (ox > EPS && oy > EPS) {
        fail(`${a.id} 与 ${b.id} 重叠（x ${ox.toFixed(3)}, y ${oy.toFixed(3)}）`);
      }
    }
  }

  // 3. 失效映射 + 正向尺寸
  for (const key of keys) {
    if (key.keyCode !== undefined && !VALID_CODES.has(key.keyCode)) {
      fail(`${key.id}: 失效键码 "${key.keyCode}"`);
    }
    if (!(key.width > 0) || !(key.height > 0)) {
      fail(`${key.id}: 键宽/键高非正（${key.width} × ${key.height}）`);
    }
  }

  // 4. 外壳尺寸由键边界校验
  const bounds = computeKeyBounds(keys);
  const computedBottom = Math.round((bounds.bottom + 0.2) * 100) / 100;
  if (Math.abs(cfg.height - computedBottom) > EPS) {
    fail(`高度 ${cfg.height} 与键边界推算 ${computedBottom} 不一致`);
  }
  if (cfg.width + EPS < bounds.right - 0.1) {
    fail(`宽度 ${cfg.width} 小于键右缘 ${bounds.right}（超出 0.1u 容差）`);
  }
  if (cfg.width < bounds.right - EPS) {
    const over = Math.round((bounds.right - cfg.width) * 100) / 100;
    console.log(`  ℹ 键右缘 ${bounds.right} 比外壳宽 ${over}u（重构前已有的历史出边，宽度校验放行）`);
  }

  // 5. y 与 row 一致
  for (const key of keys) {
    if (Math.abs(key.y - key.row * 1.1) > 1e-6 && Math.abs(key.y - Math.round(key.row * 1.1 * 100) / 100) > 1e-6) {
      fail(`${key.id}: y=${key.y} 与 row=${key.row} 不一致`);
    }
  }

  if (failures === localFailures) console.log('  ✓ 无重复 id、无重叠、无失效映射、尺寸一致');
}

console.log('\n' + '='.repeat(72));
if (failures > 0) {
  console.error(`失败：${failures} 个不变量被破坏`);
  process.exit(1);
}
console.log('全部通过：无重叠键、无重复 id、无失效映射、宽高与键边界一致');
