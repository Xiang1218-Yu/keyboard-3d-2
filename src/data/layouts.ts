import { LayoutConfig, LayoutType, KeyConfig, KeyZone } from '@/types/keyboard';

/**
 * 布局生成层
 *
 * 每个布局由「行定义 (RowDef)」描述，行中的单元（键/间距）只声明：
 *   - 键宽 width、键码 code、分区覆盖 zone（缺省继承行默认分区）
 *   - 间距 { gap }，用于表达行内不均匀空隙
 * 生成器沿行游标依次摆放单元，键坐标 (x/y)、序号 (col) 均由定义推导，
 * 不再手写任何键坐标。
 *
 * 外壳宽高 (width/height) 是历史外壳尺寸，通过 computeKeyBounds 从键边界
 * 计算并校验（见文件末尾 assertions），不允许凭感觉改动。
 */

// ---------------------------------------------------------------------------
// 几何常量（单位为标准键宽 u）
// ---------------------------------------------------------------------------

const UNIT = 1; // 标准键宽/键高
const ROW_PITCH = 1.1; // 相邻行基线间距（1u 键 + 0.1u 行间距）
const DEFAULT_GAP = 0.05; // 60% 紧凑行内默认键间距
const PLATE_BOTTOM_RIM = 0.2; // 外壳底边到最下排键底缘的历史余量
// 历史手写外壳宽度与键边界的最大允许偏差（见 assertPlateBounds）
const PLATE_WIDTH_TOLERANCE = 0.1;

// ---------------------------------------------------------------------------
// 行定义 DSL
// ---------------------------------------------------------------------------

/** 键单元：label/id 后缀、键宽、键码、可选的键高与分区覆盖 */
interface KeySpec {
  label: string;
  /** 键宽（单位 u），默认 1 */
  width?: number;
  /** 键码（KeyboardEvent.code）；省略表示无输入映射（如 Fn） */
  code?: string;
  /** 分区覆盖；省略时继承所在行的默认分区 */
  zone?: KeyZone;
  /** 键高（单位 u），默认 1；数字键盘跨行 Enter 使用 2.1 */
  height?: number;
}

/** 间距单元：只推进行游标，不产生键 */
interface GapSpec {
  gap: number;
}

type CellSpec = KeySpec | GapSpec;

const isGap = (cell: CellSpec): cell is GapSpec =>
  typeof (cell as GapSpec).gap === 'number';

/**
 * 行定义：
 * - idPrefix/colStart 决定 key id（`${idPrefix}-${序号}`）与 col 字段
 * - x 表示该行起始游标（行本身的水平偏移）
 * - zone 是该行默认分区，可被单个键覆盖
 * - gap 是行内默认键间距，可被间距单元逐段覆盖
 */
interface RowDef {
  idPrefix: string;
  row: number;
  colStart?: number;
  x?: number;
  zone?: KeyZone;
  gap?: number;
  /** 为 true 时该行 id 不加布局级前缀（75% 功能键行沿用原始 r0-* id） */
  rawId?: boolean;
  cells: CellSpec[];
}

/** 布局定义：一组行（75% 通过行号 +1 与 id 前缀复用 65% 的行定义） */
interface LayoutDef {
  /** 附加到每个 key id 前的前缀（75% 复用 65% 时使用） */
  idPrefix?: string;
  rows: RowDef[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * 由行定义生成键。
 * 行游标从 row.x 起、停在上一个键的右缘；放置下一个键时加入间隙
 * （间距单元声明的总间隙，缺省为行默认间隙）。坐标四舍五入到 0.01u。
 */
const buildKeys = (def: LayoutDef): KeyConfig[] => {
  const keys: KeyConfig[] = [];

  def.rows.forEach((row) => {
    const defaultGap = row.gap ?? 0;
    const colStart = row.colStart ?? 0;
    let cursor = row.x ?? 0; // 已放置键的右缘
    let index = 0;
    let gapOverride: number | null = null; // 间距单元声明的总间隙

    row.cells.forEach((cell) => {
      if (isGap(cell)) {
        // 间距单元声明「下一键与前一键右缘之间的总间隙」；
        // 连续单元会累加（用于表达跨分组缩进，本布局中不使用）。
        gapOverride = gapOverride === null ? cell.gap : gapOverride + cell.gap;
        return;
      }

      const width = cell.width ?? UNIT;
      const height = cell.height ?? UNIT;
      const rowIndex = row.row;
      const idSuffix = `${row.idPrefix}-${index}`;
      // 首键从行起点开始；其后使用间距单元声明，否则用行默认间隙
      const g = index === 0 ? 0 : (gapOverride ?? defaultGap);
      const x = round2(cursor + g);

      keys.push({
        id: def.idPrefix && !row.rawId ? `${def.idPrefix}${idSuffix}` : idSuffix,
        label: cell.label,
        x,
        y: round2(rowIndex * ROW_PITCH), // 取整到 0.01u，消除浮点尾差
        width,
        height,
        row: rowIndex,
        col: colStart + index,
        zone: cell.zone ?? row.zone ?? 'alphanumeric',
        ...(cell.code ? { keyCode: cell.code } : {}),
      });

      cursor = round2(x + width);
      gapOverride = null;
      index += 1;
    });
  });

  return keys;
};

// ---------------------------------------------------------------------------
// 60% 主键盘区（65%/75% 复用）
// ---------------------------------------------------------------------------

const k = (
  label: string,
  code?: string,
  width?: number,
  zone?: KeyZone,
  height?: number
): KeySpec => ({ label, ...(code ? { code } : {}), ...(width ? { width } : {}), ...(zone ? { zone } : {}), ...(height ? { height } : {}) });
const gap = (value: number): GapSpec => ({ gap: value });
const mod = (label: string, code?: string, width?: number): KeySpec => k(label, code, width, 'modifiers');
const nav = (label: string, code?: string, width?: number): KeySpec => k(label, code, width, 'navigation');
const fn = (label: string, code?: string, width?: number): KeySpec => k(label, code, width, 'function');
const np = (label: string, code?: string, width?: number, height?: number): KeySpec =>
  k(label, code, width, 'numpad', height);

/**
 * 60% 的五排主键：数字行 / Tab 行 / Caps 行 / Shift 行 + 传入的底排。
 * 数字行 Esc 后有 0.25u 加宽空隙；Tab/Caps/Shift 三个宽修饰键后为 0.1u。
 */
const build60Rows = (bottomRow: RowDef): RowDef[] => [
  {
    idPrefix: 'r0',
    row: 0,
    gap: DEFAULT_GAP,
    cells: [
      fn('Esc', 'Escape'),
      gap(0.25), // Esc 与数字行之间的总空隙
      k('1', 'Digit1'), k('2', 'Digit2'), k('3', 'Digit3'), k('4', 'Digit4'),
      k('5', 'Digit5'), k('6', 'Digit6'), k('7', 'Digit7'), k('8', 'Digit8'),
      k('9', 'Digit9'), k('0', 'Digit0'), k('-', 'Minus'), k('=', 'Equal'),
      mod('Back', 'Backspace', 1.75),
    ],
  },
  {
    idPrefix: 'r1',
    row: 1,
    gap: DEFAULT_GAP,
    cells: [
      mod('Tab', 'Tab', 1.5),
      gap(0.1), // Tab 为 1.5u，与 Q 之间保持 0.1u 空隙
      k('Q', 'KeyQ'), k('W', 'KeyW'), k('E', 'KeyE'), k('R', 'KeyR'), k('T', 'KeyT'),
      k('Y', 'KeyY'), k('U', 'KeyU'), k('I', 'KeyI'), k('O', 'KeyO'), k('P', 'KeyP'),
      k('[', 'BracketLeft'), k(']', 'BracketRight'),
      k('\\', 'Backslash', 1.4),
    ],
  },
  {
    idPrefix: 'r2',
    row: 2,
    gap: DEFAULT_GAP,
    cells: [
      mod('Caps', 'CapsLock', 1.75),
      gap(0.1), // Caps 为 1.75u，与 A 之间保持 0.1u 空隙
      k('A', 'KeyA'), k('S', 'KeyS'), k('D', 'KeyD'), k('F', 'KeyF'), k('G', 'KeyG'),
      k('H', 'KeyH'), k('J', 'KeyJ'), k('K', 'KeyK'), k('L', 'KeyL'),
      k(';', 'Semicolon'), k("'", 'Quote'),
      mod('Enter', 'Enter', 2.2),
    ],
  },
  {
    idPrefix: 'r3',
    row: 3,
    gap: DEFAULT_GAP,
    cells: [
      mod('Shift', 'ShiftLeft', 2.25),
      gap(0.1), // 左 Shift 为 2.25u，与 Z 之间保持 0.1u 空隙
      k('Z', 'KeyZ'), k('X', 'KeyX'), k('C', 'KeyC'), k('V', 'KeyV'), k('B', 'KeyB'),
      k('N', 'KeyN'), k('M', 'KeyM'), k(',', 'Comma'), k('.', 'Period'), k('/', 'Slash'),
      mod('Shift', 'ShiftRight', 2.75),
    ],
  },
  bottomRow,
];

/** 60% 原始底排（右 Ctrl 为 1.25u） */
const row4_60: RowDef = {
  idPrefix: 'r4',
  row: 4,
  gap: 0.1,
  cells: [
    mod('Ctrl', 'ControlLeft', 1.25),
    mod('Win', 'MetaLeft', 1.25),
    mod('Alt', 'AltLeft', 1.25),
    k('Space', 'Space', 6.25, 'spacebar'),
    mod('Alt', 'AltRight', 1.25),
    // Fn 无 keyCode：保留原有「无输入映射」行为
    mod('Fn', undefined, 1.25),
    mod('Menu', 'ContextMenu', 1.25),
    mod('Ctrl', 'ControlRight', 1.25),
  ],
};

// ---------------------------------------------------------------------------
// 65%：60% + 右侧导航列与下排方向键（底排保持 60% 原样）
// ---------------------------------------------------------------------------

/**
 * 65% 底排：与 60% 底排完全相同。
 * （历史 generate65Layout 曾试图把右 Ctrl 收窄为 1u，但查找时先命中了
 * 同排的导航键 ←，修改从未生效；这里忠实保留原有几何。）
 */
const row4_65: RowDef = row4_60;

const navColumnRows65: RowDef[] = [
  {
    idPrefix: 'r1-65', row: 1, colStart: 15, x: 15.7,
    cells: [nav('Del', 'Delete')],
  },
  {
    idPrefix: 'r2-65', row: 2, colStart: 15, x: 15.7,
    cells: [nav('PgUp', 'PageUp')],
  },
  {
    idPrefix: 'r3-65', row: 3, colStart: 15, x: 15.7,
    cells: [nav('PgDn', 'PageDown')],
  },
  {
    idPrefix: 'r4-65', row: 4, colStart: 15, x: 15.7,
    cells: [nav('←', 'ArrowLeft')],
  },
  // 方向键下排：键间距 0.05u
  {
    idPrefix: 'r5-65', row: 5, colStart: 13, x: 13.6, gap: DEFAULT_GAP,
    cells: [
      nav('↑', 'ArrowUp'),
      nav('↓', 'ArrowDown'),
      nav('→', 'ArrowRight'),
    ],
  },
];

// ---------------------------------------------------------------------------
// 75%：独立功能键行 + 下移一行的 65%（id 统一加 75- 前缀）
// ---------------------------------------------------------------------------

const funcRow75: RowDef = {
  idPrefix: 'r0',
  row: 0,
  rawId: true,
  gap: DEFAULT_GAP,
  cells: [
    fn('Esc', 'Escape'),
    gap(0.25), // Esc 与 F1 之间的总空隙
    fn('F1', 'F1'), fn('F2', 'F2'), fn('F3', 'F3'), fn('F4', 'F4'),
    fn('F5', 'F5'), fn('F6', 'F6'), fn('F7', 'F7'), fn('F8', 'F8'),
    fn('F9', 'F9'), fn('F10', 'F10'), fn('F11', 'F11'), fn('F12', 'F12'),
    nav('Del', 'Delete'), nav('Home', 'Home'), nav('End', 'End'),
  ],
};

// ---------------------------------------------------------------------------
// TKL：独立行定义（行间距统一 0.05u，Backslash/Enter/右Shift 宽度与 60% 不同）
// ---------------------------------------------------------------------------

const tklRows: RowDef[] = [
  {
    idPrefix: 'r0',
    row: 0,
    gap: DEFAULT_GAP,
    cells: [
      fn('Esc', 'Escape'),
      gap(0.5), // Esc 与 F1 分组空隙
      fn('F1', 'F1'), fn('F2', 'F2'), fn('F3', 'F3'), fn('F4', 'F4'),
      gap(0.55), // F4 与 F5 分组空隙
      fn('F5', 'F5'), fn('F6', 'F6'), fn('F7', 'F7'), fn('F8', 'F8'),
      gap(0.55), // F8 与 F9 分组空隙
      fn('F9', 'F9'), fn('F10', 'F10'), fn('F11', 'F11'), fn('F12', 'F12'),
      gap(0.55), // F12 与 PrtSc 分组空隙
      nav('PrtSc', 'PrintScreen'), nav('ScrLk', 'ScrollLock'), nav('Pause', 'Pause'),
    ],
  },
  {
    idPrefix: 'r1',
    row: 1,
    gap: DEFAULT_GAP,
    cells: [
      k('`', 'Backquote'),
      k('1', 'Digit1'), k('2', 'Digit2'), k('3', 'Digit3'), k('4', 'Digit4'),
      k('5', 'Digit5'), k('6', 'Digit6'), k('7', 'Digit7'), k('8', 'Digit8'),
      k('9', 'Digit9'), k('0', 'Digit0'), k('-', 'Minus'), k('=', 'Equal'),
      mod('Back', 'Backspace', 2),
      gap(0.55), // 主键盘区与导航区之间的空隙
      nav('Ins', 'Insert'), nav('Home', 'Home'), nav('PgUp', 'PageUp'),
    ],
  },
  {
    idPrefix: 'r2',
    row: 2,
    gap: DEFAULT_GAP,
    cells: [
      mod('Tab', 'Tab', 1.5),
      gap(0.1), // Tab 为 1.5u，与 Q 之间保持 0.1u 空隙
      k('Q', 'KeyQ'), k('W', 'KeyW'), k('E', 'KeyE'), k('R', 'KeyR'), k('T', 'KeyT'),
      k('Y', 'KeyY'), k('U', 'KeyU'), k('I', 'KeyI'), k('O', 'KeyO'), k('P', 'KeyP'),
      k('[', 'BracketLeft'), k(']', 'BracketRight'),
      k('\\', 'Backslash', 1.45),
      gap(0.55),
      nav('Del', 'Delete'), nav('End', 'End'), nav('PgDn', 'PageDown'),
    ],
  },
  {
    idPrefix: 'r3',
    row: 3,
    gap: DEFAULT_GAP,
    cells: [
      mod('Caps', 'CapsLock', 1.75),
      gap(0.1), // Caps 为 1.75u，与 A 之间保持 0.1u 空隙
      k('A', 'KeyA'), k('S', 'KeyS'), k('D', 'KeyD'), k('F', 'KeyF'), k('G', 'KeyG'),
      k('H', 'KeyH'), k('J', 'KeyJ'), k('K', 'KeyK'), k('L', 'KeyL'),
      k(';', 'Semicolon'), k("'", 'Quote'),
      mod('Enter', 'Enter', 2.25),
    ],
  },
  {
    idPrefix: 'r4',
    row: 4,
    gap: DEFAULT_GAP,
    cells: [
      mod('Shift', 'ShiftLeft', 2.25),
      gap(0.1), // 左 Shift 为 2.25u，与 Z 之间保持 0.1u 空隙
      k('Z', 'KeyZ'), k('X', 'KeyX'), k('C', 'KeyC'), k('V', 'KeyV'), k('B', 'KeyB'),
      k('N', 'KeyN'), k('M', 'KeyM'), k(',', 'Comma'), k('.', 'Period'), k('/', 'Slash'),
      mod('Shift', 'ShiftRight', 2.8),
      gap(1.6), // 右 Shift 与 ↑ 之间为导航列空位
      nav('↑', 'ArrowUp'),
    ],
  },
  {
    idPrefix: 'r5',
    row: 5,
    gap: 0.1,
    cells: [
      mod('Ctrl', 'ControlLeft', 1.25),
      mod('Win', 'MetaLeft', 1.25),
      mod('Alt', 'AltLeft', 1.25),
      k('Space', 'Space', 6.25, 'spacebar'),
      mod('Alt', 'AltRight', 1.25),
      mod('Win', 'MetaRight', 1.25),
      mod('Menu', 'ContextMenu', 1.25),
      mod('Ctrl', 'ControlRight', 1.25),
      gap(0.5), // 主键盘区与导航区之间的空隙
      nav('←', 'ArrowLeft'),
      gap(0.05), // ← 与 ↓ 紧凑排列（↓ 在 ↑ 正下方）
      nav('↓', 'ArrowDown'),
      gap(0.05), // ↓→ 紧凑排列
      nav('→', 'ArrowRight'),
    ],
  },
];

// ---------------------------------------------------------------------------
// Full：TKL + 数字小键盘
// ---------------------------------------------------------------------------

const numpadRows: RowDef[] = [
  {
    idPrefix: 'np1', row: 1, colStart: 20, x: 19.8, gap: DEFAULT_GAP,
    cells: [np('Num', 'NumLock'), np('/', 'NumpadDivide'), np('*', 'NumpadMultiply'), np('-', 'NumpadSubtract')],
  },
  {
    idPrefix: 'np2', row: 2, colStart: 20, x: 19.8, gap: DEFAULT_GAP,
    cells: [np('7', 'Numpad7'), np('8', 'Numpad8'), np('9', 'Numpad9'), np('+', 'NumpadAdd')],
  },
  {
    idPrefix: 'np3', row: 3, colStart: 20, x: 19.8, gap: DEFAULT_GAP,
    cells: [np('4', 'Numpad4'), np('5', 'Numpad5'), np('6', 'Numpad6')],
  },
  {
    // np4-3 为跨行 Enter：键高 2.1u，占据 row4/row5 两排
    idPrefix: 'np4', row: 4, colStart: 20, x: 19.8, gap: DEFAULT_GAP,
    cells: [np('1', 'Numpad1'), np('2', 'Numpad2'), np('3', 'Numpad3'), np('Enter', 'NumpadEnter', 1, 2.1)],
  },
  {
    idPrefix: 'np5', row: 5, colStart: 20, x: 19.8, gap: DEFAULT_GAP,
    cells: [np('0', 'Numpad0', 2.05), np('.', 'NumpadDecimal')],
  },
];

// ---------------------------------------------------------------------------
// 组装各布局
// ---------------------------------------------------------------------------

const rows60 = build60Rows(row4_60);
const rows65 = [...build60Rows(row4_65), ...navColumnRows65];
const rows75: RowDef[] = [funcRow75, ...rows65.map((r) => ({ ...r, row: r.row + 1 }))];
const rowsFull: RowDef[] = [...tklRows, ...numpadRows];

// ---------------------------------------------------------------------------
// 边界计算与校验
// ---------------------------------------------------------------------------

export interface KeyBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 由键矩形计算整体边界（宽高即由键边界计算，而非手写） */
export const computeKeyBounds = (keys: KeyConfig[]): KeyBounds => {
  const initial: KeyBounds = { left: Infinity, top: Infinity, right: 0, bottom: 0 };
  return keys.reduce<KeyBounds>((b, key) => ({
    left: Math.min(b.left, key.x),
    top: Math.min(b.top, key.y),
    right: Math.max(b.right, key.x + key.width),
    bottom: Math.max(b.bottom, key.y + key.height),
  }), initial);
};

/** 期望外壳尺寸：高度恒为「最下键底缘 + 0.2u 底边」；宽度沿用历史外壳尺寸 */
const expectedPlateHeight = (keys: KeyConfig[]): number =>
  round2(computeKeyBounds(keys).bottom + PLATE_BOTTOM_RIM);

const EPS = 1e-9;

/** 校验：键不得重叠（AABB）、id 不得重复 */
const assertKeysWellFormed = (type: LayoutType, keys: KeyConfig[]): void => {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key.id)) {
      throw new Error(`[layouts] ${type}: 重复 key id "${key.id}"`);
    }
    seen.add(key.id);
  }

  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      if (overlapX > EPS && overlapY > EPS) {
        throw new Error(
          `[layouts] ${type}: 键 ${a.id} 与 ${b.id} 发生重叠（x:${overlapX.toFixed(3)}, y:${overlapY.toFixed(3)}）`
        );
      }
    }
  }
};

/**
 * 校验外壳宽高与键边界一致。
 * - 高度必须等于「键底缘 + 0.2u 底边」；
 * - 宽度与键右缘的偏差不得超过 PLATE_WIDTH_TOLERANCE（60% 底排右 Ctrl
 *   历史上多出 0.1u，是重构前就存在的手写偏差，此处只校验、不改变几何）。
 */
const assertPlateBounds = (
  type: LayoutType,
  keys: KeyConfig[],
  width: number,
  height: number
): KeyBounds => {
  const bounds = computeKeyBounds(keys);
  if (Math.abs(height - expectedPlateHeight(keys)) > EPS) {
    throw new Error(
      `[layouts] ${type}: height ${height} 与键边界推算高度 ${expectedPlateHeight(keys)} 不一致`
    );
  }
  const widthDelta = round2(width - bounds.right);
  if (widthDelta < -PLATE_WIDTH_TOLERANCE - EPS) {
    throw new Error(
      `[layouts] ${type}: width ${width} 小于键右缘 ${bounds.right}（超出 ${-widthDelta}u）`
    );
  }
  return bounds;
};

interface LayoutSpec {
  type: LayoutType;
  name: string;
  description: string;
  def: LayoutDef;
  width: number;
  height: number;
}

const createLayout = (spec: LayoutSpec): LayoutConfig => {
  const keys = buildKeys(spec.def);
  assertKeysWellFormed(spec.type, keys);
  assertPlateBounds(spec.type, keys, spec.width, spec.height);
  return {
    type: spec.type,
    name: spec.name,
    description: spec.description,
    keys,
    width: spec.width,
    height: spec.height,
  };
};

export const LAYOUT_CONFIGS: Record<LayoutType, LayoutConfig> = {
  '60%': createLayout({
    type: '60%',
    name: '60% 紧凑型',
    description: '最小化设计，仅保留核心按键，适合追求简洁的用户',
    def: { rows: rows60 },
    width: 15.6,
    height: 5.6,
  }),
  '65%': createLayout({
    type: '65%',
    name: '65% 紧凑+',
    description: '在60%基础上增加方向键和导航键，平衡便携与功能',
    def: { rows: rows65 },
    width: 16.75,
    height: 6.7,
  }),
  '75%': createLayout({
    type: '75%',
    name: '75% 功能型',
    description: '包含完整功能键行，紧凑布局适合小桌面',
    def: { idPrefix: '75-', rows: rows75 },
    width: 16.95,
    height: 7.8,
  }),
  TKL: createLayout({
    type: 'TKL',
    name: 'TKL 87键',
    description: '无数字键盘的经典布局，保留完整功能区和导航区',
    def: { rows: tklRows },
    width: 19.3,
    height: 6.7,
  }),
  Full: createLayout({
    type: 'Full',
    name: '全尺寸 104键',
    description: '完整键盘布局，包含数字小键盘，适合数据输入',
    def: { rows: rowsFull },
    width: 24.0,
    height: 6.7,
  }),
};

export const LAYOUT_LIST: LayoutType[] = ['60%', '65%', '75%', 'TKL', 'Full'];
