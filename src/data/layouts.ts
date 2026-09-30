import { LayoutConfig, LayoutType, KeyConfig, KeyZone } from '@/types/keyboard';

/* ==========================================================================
 * 布局生成层
 *
 * 每个布局由「行定义」描述：
 *   - keys  行内按键：标签、键码（输入映射）、键宽/高
 *   - zone  行默认分区，单个按键可用自身 zone 覆盖（分区覆盖）
 *   - gap   行内默认间距，单个按键可用自身 gap 覆盖（该键之后的完整间距）
 *   - startX / colBase / id  行起点、逻辑列号基数、id 前缀
 *
 * x 坐标由间距游标顺序计算，y 坐标由行号 × 行高计算，不再手写绝对坐标。
 * 布局的整体宽高由全部按键边界 + 显式留白（padding）导出。
 *
 * 65%/Full 通过「整行复用 + 追加行」组合，75% 通过 include 偏移并加 id
 * 前缀组合；生成结果与历史手写坐标逐键一致（见 scripts/check-layouts.mjs
 * 的 golden 快照校验）。
 * ========================================================================== */

const KEY_UNIT = 1; // 基准键宽 / 键高
const ROW_PITCH = 1.1; // 相邻行的垂直步进（1u 键 + 0.1 行间距）
const BOTTOM_PADDING = 0.2; // 最后一行下方保留的外壳空间
const EPS_DIGITS = 10; // 坐标归一化小数位，消除浮点累加误差

const round = (n: number): number => {
  const f = 10 ** EPS_DIGITS;
  return Math.round(n * f) / f;
};

// 分区简写
const Z_ALPHA = 'alphanumeric';
const Z_FUNC = 'function';
const Z_NAV = 'navigation';
const Z_NUM = 'numpad';
const Z_MOD = 'modifiers';
const Z_SPACE = 'spacebar';

interface KeyToken {
  label: string;
  /** KeyboardEvent.code，留空（如 Fn）则不参与键盘输入映射 */
  code?: string;
  /** 键宽（u），默认 1u */
  w?: number;
  /** 键高（u），默认 1u；数字键盘的纵向 Enter 为 2.1u */
  h?: number;
  /** 覆盖所在行的默认分区 */
  zone?: KeyZone;
  /** 该键之后的完整间距；给出则覆盖行默认 gap，不给则沿用行默认 */
  gap?: number;
}

interface RowDef {
  /** id 前缀，按键 id 形如 `${id}-${行内序号}` */
  id: string;
  /** 逻辑行号，决定 y = row × ROW_PITCH 以及 KeyConfig.row */
  row: number;
  keys: KeyToken[];
  /** 行内默认分区 */
  zone?: KeyZone;
  /** 行内默认间距（键与键之间），默认 0.05u */
  gap?: number;
  /** 行起始 x，默认 0；独立成块的行（导航列 / 数字键盘）指定起点 */
  startX?: number;
  /** 逻辑列号基数，KeyConfig.col = colBase + 行内序号，默认 0 */
  colBase?: number;
}

interface IncludeDef {
  def: LayoutDef;
  rowOffset?: number;
  yOffset?: number;
  idPrefix?: string;
}

interface LayoutDef {
  type: LayoutType;
  name: string;
  description: string;
  rows?: RowDef[];
  include?: IncludeDef[];
  /** 右边界到外壳宽度的留白；60% 历史上按键超出标称宽度 0.1u，显式保留 */
  paddingRight?: number;
}

/** 紧凑按键定义：K(标签, 键码, 键宽, 分区覆盖, 后置间距) */
const K = (
  label: string,
  code?: string,
  w?: number,
  zone?: KeyZone,
  gap?: number
): KeyToken => ({ label, code, w, zone, gap });

const buildRow = (row: RowDef): KeyConfig[] => {
  const defaultGap = row.gap ?? 0.05;
  let cursor = row.startX ?? 0;
  const colBase = row.colBase ?? 0;

  return row.keys.map((token, i) => {
    const width = token.w ?? KEY_UNIT;
    const height = token.h ?? KEY_UNIT;
    const key: KeyConfig = {
      id: `${row.id}-${i}`,
      label: token.label,
      x: round(cursor),
      y: round(row.row * ROW_PITCH),
      width,
      height,
      row: row.row,
      col: colBase + i,
      zone: token.zone ?? row.zone ?? Z_ALPHA,
    };
    if (token.code !== undefined) {
      key.keyCode = token.code;
    }
    cursor += width + (token.gap ?? defaultGap);
    return key;
  });
};

const buildLayout = (def: LayoutDef): LayoutConfig => {
  const keys: KeyConfig[] = [];

  for (const row of def.rows ?? []) {
    keys.push(...buildRow(row));
  }

  for (const inc of def.include ?? []) {
    const rowOffset = inc.rowOffset ?? 0;
    const yOffset = inc.yOffset ?? 0;
    const idPrefix = inc.idPrefix ?? '';
    for (const k of buildLayout(inc.def).keys) {
      keys.push({
        ...k,
        id: `${idPrefix}${k.id}`,
        row: k.row + rowOffset,
        y: round(k.y + yOffset),
      });
    }
  }

  const maxX = Math.max(...keys.map((k) => k.x + k.width));
  const maxY = Math.max(...keys.map((k) => k.y + k.height));

  return {
    type: def.type,
    name: def.name,
    description: def.description,
    keys,
    width: round(maxX + (def.paddingRight ?? 0)),
    height: round(maxY + BOTTOM_PADDING),
  };
};

/* ==========================================================================
 * 60%：基础块（r0–r4），后续 65%/75%/TKL/Full 的行都在此基础上复用
 * ========================================================================== */

const ROW_60_R0: RowDef = {
  id: 'r0',
  row: 0,
  zone: Z_ALPHA,
  keys: [
    K('Esc', 'Escape', 1, Z_FUNC, 0.25),
    K('1', 'Digit1'), K('2', 'Digit2'), K('3', 'Digit3'), K('4', 'Digit4'),
    K('5', 'Digit5'), K('6', 'Digit6'), K('7', 'Digit7'), K('8', 'Digit8'),
    K('9', 'Digit9'), K('0', 'Digit0'), K('-', 'Minus'), K('=', 'Equal'),
    K('Back', 'Backspace', 1.75, Z_MOD),
  ],
};

const ROW_60_R1: RowDef = {
  id: 'r1',
  row: 1,
  zone: Z_ALPHA,
  keys: [
    K('Tab', 'Tab', 1.5, Z_MOD, 0.1),
    K('Q', 'KeyQ'), K('W', 'KeyW'), K('E', 'KeyE'), K('R', 'KeyR'),
    K('T', 'KeyT'), K('Y', 'KeyY'), K('U', 'KeyU'), K('I', 'KeyI'),
    K('O', 'KeyO'), K('P', 'KeyP'),
    K('[', 'BracketLeft'), K(']', 'BracketRight'),
    K('\\', 'Backslash', 1.4),
  ],
};

const ROW_60_R2: RowDef = {
  id: 'r2',
  row: 2,
  zone: Z_ALPHA,
  keys: [
    K('Caps', 'CapsLock', 1.75, Z_MOD, 0.1),
    K('A', 'KeyA'), K('S', 'KeyS'), K('D', 'KeyD'), K('F', 'KeyF'),
    K('G', 'KeyG'), K('H', 'KeyH'), K('J', 'KeyJ'), K('K', 'KeyK'),
    K('L', 'KeyL'), K(';', 'Semicolon'), K("'", 'Quote'),
    K('Enter', 'Enter', 2.2, Z_MOD),
  ],
};

const ROW_60_R3: RowDef = {
  id: 'r3',
  row: 3,
  zone: Z_ALPHA,
  keys: [
    K('Shift', 'ShiftLeft', 2.25, Z_MOD, 0.1),
    K('Z', 'KeyZ'), K('X', 'KeyX'), K('C', 'KeyC'), K('V', 'KeyV'),
    K('B', 'KeyB'), K('N', 'KeyN'), K('M', 'KeyM'),
    K(',', 'Comma'), K('.', 'Period'), K('/', 'Slash'),
    K('Shift', 'ShiftRight', 2.75, Z_MOD),
  ],
};

const ROW_60_R4: RowDef = {
  id: 'r4',
  row: 4,
  zone: Z_MOD,
  gap: 0.1,
  keys: [
    K('Ctrl', 'ControlLeft', 1.25),
    K('Win', 'MetaLeft', 1.25),
    K('Alt', 'AltLeft', 1.25),
    K('Space', 'Space', 6.25, Z_SPACE),
    K('Alt', 'AltRight', 1.25),
    K('Fn', undefined, 1.25),
    K('Menu', 'ContextMenu', 1.25),
    K('Ctrl', 'ControlRight', 1.25),
  ],
};

const ROWS_60: RowDef[] = [
  ROW_60_R0,
  ROW_60_R1,
  ROW_60_R2,
  ROW_60_R3,
  ROW_60_R4,
];

/* ==========================================================================
 * 65%：复用 60% 的全部主键区行；再追加右侧导航列（r1–r4）和底部方向键
 *      行（r5）。
 *
 * 注：历史生成器曾尝试把底行最后一个 Ctrl 收窄到 1u（x=14.7），但该判断
 *    误取了 r4 的最后一个键（追加的 ←），修改从未生效，底行实际与 60%
 *    完全一致（Ctrl 仍为 1.25u@14.45）。此处原样保留该既有行为。
 * ========================================================================== */

const ROW_65_NAV_R1: RowDef = {
  id: 'r1-65',
  row: 1,
  startX: 15.7,
  colBase: 15,
  keys: [K('Del', 'Delete', 1, Z_NAV)],
};

const ROW_65_NAV_R2: RowDef = {
  id: 'r2-65',
  row: 2,
  startX: 15.7,
  colBase: 15,
  keys: [K('PgUp', 'PageUp', 1, Z_NAV)],
};

const ROW_65_NAV_R3: RowDef = {
  id: 'r3-65',
  row: 3,
  startX: 15.7,
  colBase: 15,
  keys: [K('PgDn', 'PageDown', 1, Z_NAV)],
};

const ROW_65_NAV_R4: RowDef = {
  id: 'r4-65',
  row: 4,
  startX: 15.7,
  colBase: 15,
  keys: [K('←', 'ArrowLeft', 1, Z_NAV)],
};

const ROW_65_ARROWS: RowDef = {
  id: 'r5-65',
  row: 5,
  startX: 13.6,
  colBase: 13,
  keys: [
    K('↑', 'ArrowUp', 1, Z_NAV),
    K('↓', 'ArrowDown', 1, Z_NAV),
    K('→', 'ArrowRight', 1, Z_NAV),
  ],
};

const LAYOUT_60: LayoutDef = {
  type: '60%',
  name: '60% 紧凑型',
  description: '最小化设计，仅保留核心按键，适合追求简洁的用户',
  rows: ROWS_60,
  paddingRight: -0.1, // 历史遗留：底行以 15.7 收尾，标称宽度 15.6
};

const LAYOUT_65: LayoutDef = {
  type: '65%',
  name: '65% 紧凑+',
  description: '在60%基础上增加方向键和导航键，平衡便携与功能',
  rows: [
    ...ROWS_60,
    ROW_65_NAV_R1,
    ROW_65_NAV_R2,
    ROW_65_NAV_R3,
    ROW_65_NAV_R4,
    ROW_65_ARROWS,
  ],
  paddingRight: 0.05,
};

/* ==========================================================================
 * 75%：自带功能键行，下方整体复用 65%（行号 / y 下移一行，id 加 75- 前缀）
 * ========================================================================== */

const ROW_75_FUNC: RowDef = {
  id: 'r0',
  row: 0,
  zone: Z_FUNC,
  keys: [
    K('Esc', 'Escape', 1, Z_FUNC, 0.25),
    K('F1', 'F1'), K('F2', 'F2'), K('F3', 'F3'), K('F4', 'F4'),
    K('F5', 'F5'), K('F6', 'F6'), K('F7', 'F7'), K('F8', 'F8'),
    K('F9', 'F9'), K('F10', 'F10'), K('F11', 'F11'), K('F12', 'F12'),
    K('Del', 'Delete', 1, Z_NAV),
    K('Home', 'Home', 1, Z_NAV),
    K('End', 'End', 1, Z_NAV),
  ],
};

const LAYOUT_75: LayoutDef = {
  type: '75%',
  name: '75% 功能型',
  description: '包含完整功能键行，紧凑布局适合小桌面',
  rows: [ROW_75_FUNC],
  include: [{ def: LAYOUT_65, rowOffset: 1, yOffset: ROW_PITCH, idPrefix: '75-' }],
};

/* ==========================================================================
 * TKL：完整功能键行 + 主键区 + 三列导航区（r0–r5）
 * ========================================================================== */

const ROW_TKL_FUNC: RowDef = {
  id: 'r0',
  row: 0,
  zone: Z_FUNC,
  keys: [
    K('Esc', 'Escape', 1, Z_FUNC, 0.5),
    K('F1', 'F1'), K('F2', 'F2'), K('F3', 'F3'), K('F4', 'F4', 1, Z_FUNC, 0.55),
    K('F5', 'F5'), K('F6', 'F6'), K('F7', 'F7'), K('F8', 'F8', 1, Z_FUNC, 0.55),
    K('F9', 'F9'), K('F10', 'F10'), K('F11', 'F11'), K('F12', 'F12', 1, Z_FUNC, 0.55),
    K('PrtSc', 'PrintScreen', 1, Z_NAV),
    K('ScrLk', 'ScrollLock', 1, Z_NAV),
    K('Pause', 'Pause', 1, Z_NAV),
  ],
};

const ROW_TKL_R1: RowDef = {
  id: 'r1',
  row: 1,
  zone: Z_ALPHA,
  keys: [
    K('`', 'Backquote'),
    K('1', 'Digit1'), K('2', 'Digit2'), K('3', 'Digit3'), K('4', 'Digit4'),
    K('5', 'Digit5'), K('6', 'Digit6'), K('7', 'Digit7'), K('8', 'Digit8'),
    K('9', 'Digit9'), K('0', 'Digit0'), K('-', 'Minus'), K('=', 'Equal'),
    K('Back', 'Backspace', 2, Z_MOD, 0.55),
    K('Ins', 'Insert', 1, Z_NAV),
    K('Home', 'Home', 1, Z_NAV),
    K('PgUp', 'PageUp', 1, Z_NAV),
  ],
};

const ROW_TKL_R2: RowDef = {
  id: 'r2',
  row: 2,
  zone: Z_ALPHA,
  keys: [
    K('Tab', 'Tab', 1.5, Z_MOD, 0.1),
    K('Q', 'KeyQ'), K('W', 'KeyW'), K('E', 'KeyE'), K('R', 'KeyR'),
    K('T', 'KeyT'), K('Y', 'KeyY'), K('U', 'KeyU'), K('I', 'KeyI'),
    K('O', 'KeyO'), K('P', 'KeyP'),
    K('[', 'BracketLeft'), K(']', 'BracketRight'),
    K('\\', 'Backslash', 1.45, Z_ALPHA, 0.55),
    K('Del', 'Delete', 1, Z_NAV),
    K('End', 'End', 1, Z_NAV),
    K('PgDn', 'PageDown', 1, Z_NAV),
  ],
};

const ROW_TKL_R3: RowDef = {
  id: 'r3',
  row: 3,
  zone: Z_ALPHA,
  keys: [
    K('Caps', 'CapsLock', 1.75, Z_MOD, 0.1),
    K('A', 'KeyA'), K('S', 'KeyS'), K('D', 'KeyD'), K('F', 'KeyF'),
    K('G', 'KeyG'), K('H', 'KeyH'), K('J', 'KeyJ'), K('K', 'KeyK'),
    K('L', 'KeyL'), K(';', 'Semicolon'), K("'", 'Quote'),
    K('Enter', 'Enter', 2.25, Z_MOD),
  ],
};

const ROW_TKL_R4: RowDef = {
  id: 'r4',
  row: 4,
  zone: Z_ALPHA,
  keys: [
    K('Shift', 'ShiftLeft', 2.25, Z_MOD, 0.1),
    K('Z', 'KeyZ'), K('X', 'KeyX'), K('C', 'KeyC'), K('V', 'KeyV'),
    K('B', 'KeyB'), K('N', 'KeyN'), K('M', 'KeyM'),
    K(',', 'Comma'), K('.', 'Period'), K('/', 'Slash'),
    K('Shift', 'ShiftRight', 2.8, Z_MOD, 1.6),
    K('↑', 'ArrowUp', 1, Z_NAV),
  ],
};

const ROW_TKL_R5: RowDef = {
  id: 'r5',
  row: 5,
  zone: Z_MOD,
  gap: 0.1,
  keys: [
    K('Ctrl', 'ControlLeft', 1.25),
    K('Win', 'MetaLeft', 1.25),
    K('Alt', 'AltLeft', 1.25),
    K('Space', 'Space', 6.25, Z_SPACE),
    K('Alt', 'AltRight', 1.25),
    K('Win', 'MetaRight', 1.25),
    K('Menu', 'ContextMenu', 1.25),
    K('Ctrl', 'ControlRight', 1.25, Z_MOD, 0.5),
    K('←', 'ArrowLeft', 1, Z_NAV, 0.05),
    K('↓', 'ArrowDown', 1, Z_NAV, 0.05),
    K('→', 'ArrowRight', 1, Z_NAV),
  ],
};

const LAYOUT_TKL: LayoutDef = {
  type: 'TKL',
  name: 'TKL 87键',
  description: '无数字键盘的经典布局，保留完整功能区和导航区',
  rows: [
    ROW_TKL_FUNC,
    ROW_TKL_R1,
    ROW_TKL_R2,
    ROW_TKL_R3,
    ROW_TKL_R4,
    ROW_TKL_R5,
  ],
};

/* ==========================================================================
 * Full：复用 TKL 全部行，右侧从 x=19.8 追加数字键盘（r1–r5 行号对齐）
 * ========================================================================== */

const ROW_NP_1: RowDef = {
  id: 'np1',
  row: 1,
  startX: 19.8,
  colBase: 20,
  zone: Z_NUM,
  keys: [
    K('Num', 'NumLock'),
    K('/', 'NumpadDivide'),
    K('*', 'NumpadMultiply'),
    K('-', 'NumpadSubtract'),
  ],
};

const ROW_NP_2: RowDef = {
  id: 'np2',
  row: 2,
  startX: 19.8,
  colBase: 20,
  zone: Z_NUM,
  keys: [
    K('7', 'Numpad7'), K('8', 'Numpad8'), K('9', 'Numpad9'),
    K('+', 'NumpadAdd'),
  ],
};

const ROW_NP_3: RowDef = {
  id: 'np3',
  row: 3,
  startX: 19.8,
  colBase: 20,
  zone: Z_NUM,
  keys: [K('4', 'Numpad4'), K('5', 'Numpad5'), K('6', 'Numpad6')],
};

const ROW_NP_4: RowDef = {
  id: 'np4',
  row: 4,
  startX: 19.8,
  colBase: 20,
  zone: Z_NUM,
  keys: [
    K('1', 'Numpad1'), K('2', 'Numpad2'), K('3', 'Numpad3'),
    { label: 'Enter', code: 'NumpadEnter', h: 2.1, zone: Z_NUM },
  ],
};

const ROW_NP_5: RowDef = {
  id: 'np5',
  row: 5,
  startX: 19.8,
  colBase: 20,
  zone: Z_NUM,
  keys: [
    K('0', 'Numpad0', 2.05),
    K('.', 'NumpadDecimal'),
  ],
};

const LAYOUT_FULL: LayoutDef = {
  type: 'Full',
  name: '全尺寸 104键',
  description: '完整键盘布局，包含数字小键盘，适合数据输入',
  rows: [
    ...(LAYOUT_TKL.rows ?? []),
    ROW_NP_1,
    ROW_NP_2,
    ROW_NP_3,
    ROW_NP_4,
    ROW_NP_5,
  ],
  paddingRight: 0.05,
};

export const LAYOUT_CONFIGS: Record<LayoutType, LayoutConfig> = {
  '60%': buildLayout(LAYOUT_60),
  '65%': buildLayout(LAYOUT_65),
  '75%': buildLayout(LAYOUT_75),
  TKL: buildLayout(LAYOUT_TKL),
  Full: buildLayout(LAYOUT_FULL),
};

export const LAYOUT_LIST: LayoutType[] = ['60%', '65%', '75%', 'TKL', 'Full'];
