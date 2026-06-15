/**
 * grid-theme.test.ts — whole-app-test-coverage-breadth.
 *
 * Covers the pure theme helpers + the live-binding re-theme machinery in
 * grid-theme.ts: badgeStyle / rowBg / stepperCSS pure factories, plus
 * configureGridColors mutating the shared GRID_COLORS in place and rebuilding
 * every `let`-exported derived style binding (ES-module live bindings).
 *
 * Run with:
 *   npx vitest run src/grid-theme.test.ts
 *
 * NOTE: the module holds shared mutable state (GRID_COLORS + the let exports),
 * so we snapshot the original palette in beforeAll and restore it in afterEach
 * via configureGridColors — keeping ordering-independent and leaving no global
 * pollution for the rest of the suite. We read derived bindings through the
 * module namespace (`mod.glideTheme`) so re-theme updates are observed live.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as mod from './grid-theme';
import {
  badgeStyle,
  configureGridColors,
  GRID_COLORS,
  rowBg,
  STEPPER_GLOBAL_CSS,
  STEPPER_PILL_STYLE,
  stepperCSS,
  type GridColors,
} from './grid-theme';

// Snapshot of the brand-neutral default palette, captured before any test
// mutates GRID_COLORS, so afterEach can faithfully restore it.
let ORIGINAL: GridColors;

beforeAll(() => {
  ORIGINAL = { ...GRID_COLORS };
});

afterEach(() => {
  // Restore every key to its captured default and rebuild the derived bindings.
  configureGridColors(ORIGINAL);
});

describe('badgeStyle', () => {
  it('derives background and border from the color with the documented suffixes', () => {
    const s = badgeStyle('#abc');
    expect(s.background).toBe('#abc1f');
    expect(s.border).toBe('1px solid #abc55');
    expect(s.color).toBe('#abc');
  });

  it('carries the fixed pill geometry / typography', () => {
    const s = badgeStyle('#ff0000');
    expect(s.display).toBe('inline-flex');
    expect(s.alignItems).toBe('center');
    expect(s.padding).toBe('3px 10px');
    expect(s.borderRadius).toBe(999);
    expect(s.fontWeight).toBe(600);
    expect(s.fontSize).toBe(10.5);
    expect(s.letterSpacing).toBe('0.04em');
    expect(s.lineHeight).toBe(1.2);
  });

  it('works with named CSS colors too (suffixes are pure concatenation)', () => {
    const s = badgeStyle('tomato');
    expect(s.background).toBe('tomato1f');
    expect(s.border).toBe('1px solid tomato55');
    expect(s.color).toBe('tomato');
  });
});

describe('rowBg', () => {
  it('returns the base bg for even indices and rowAlt for odd ones', () => {
    expect(rowBg(0)).toBe(GRID_COLORS.bg);
    expect(rowBg(2)).toBe(GRID_COLORS.bg);
    expect(rowBg(4)).toBe(GRID_COLORS.bg);
    expect(rowBg(1)).toBe(GRID_COLORS.rowAlt);
    expect(rowBg(3)).toBe(GRID_COLORS.rowAlt);
  });

  it('reads the live palette, not a captured snapshot', () => {
    configureGridColors({ bg: '#abcabc', rowAlt: '#defdef' });
    expect(rowBg(0)).toBe('#abcabc');
    expect(rowBg(1)).toBe('#defdef');
  });
});

describe('stepperCSS', () => {
  it('defaults to the gdg-stepper prefix and equals STEPPER_GLOBAL_CSS', () => {
    expect(stepperCSS()).toBe(STEPPER_GLOBAL_CSS);
    expect(stepperCSS()).toContain('gdg-stepper');
  });

  it('replaces every gdg-stepper occurrence with the supplied prefix', () => {
    const out = stepperCSS('myprefix');
    expect(out).not.toContain('gdg-stepper');
    expect(out).toContain('myprefix-input');
    expect(out).toContain('myprefix-btn');
    // The original constant was sourced with multiple occurrences — make sure
    // the replacement is global, not just the first match.
    const occurrences = (STEPPER_GLOBAL_CSS.match(/gdg-stepper/g) ?? []).length;
    expect(occurrences).toBeGreaterThan(1);
    expect((out.match(/myprefix/g) ?? []).length).toBe(occurrences);
  });

  it('does not mutate STEPPER_GLOBAL_CSS when given a prefix', () => {
    stepperCSS('zzz');
    expect(STEPPER_GLOBAL_CSS).toContain('gdg-stepper');
    expect(STEPPER_GLOBAL_CSS).not.toContain('zzz');
  });
});

describe('configureGridColors — in-place palette mutation', () => {
  it('mutates the live GRID_COLORS object in place and leaves other keys intact', () => {
    const prevHeaderBg = GRID_COLORS.headerBg;
    const prevText = GRID_COLORS.text;

    configureGridColors({ bg: '#000fff' });

    expect(GRID_COLORS.bg).toBe('#000fff');
    // Same object reference (in-place mutation, not a replacement).
    expect(GRID_COLORS).toBe(mod.GRID_COLORS);
    // Unspecified keys are untouched.
    expect(GRID_COLORS.headerBg).toBe(prevHeaderBg);
    expect(GRID_COLORS.text).toBe(prevText);
  });
});

describe('configureGridColors — derived live-binding tracking', () => {
  it('re-themes glideTheme.bgCell to track GRID_COLORS.bg', () => {
    expect(mod.glideTheme.bgCell).toBe(GRID_COLORS.bg);
    configureGridColors({ bg: '#123456' });
    expect(GRID_COLORS.bg).toBe('#123456');
    expect(mod.glideTheme.bgCell).toBe('#123456');
    expect(rowBg(0)).toBe('#123456');
  });

  it('re-themes text-driven bindings (TD_BASE.color, EDIT_INPUT_STYLE.color) to GRID_COLORS.text', () => {
    expect(mod.TD_BASE.color).toBe(GRID_COLORS.text);
    expect(mod.EDIT_INPUT_STYLE.color).toBe(GRID_COLORS.text);

    configureGridColors({ text: '#abcdef' });

    expect(GRID_COLORS.text).toBe('#abcdef');
    expect(mod.TD_BASE.color).toBe('#abcdef');
    expect(mod.EDIT_INPUT_STYLE.color).toBe('#abcdef');
    expect(mod.STEPPER_BTN_STYLE.color).toBe('#abcdef');
  });

  it('rebuilds EVERY let-exported binding so none is left referencing the old palette', () => {
    // Pick a distinctive value per palette key, then assert each derived
    // binding that depends on that key reflects the new value.
    configureGridColors({
      bg: '#aa0001',
      headerBg: '#aa0002',
      rowAlt: '#aa0003',
      rowHover: '#aa0004',
      border: '#aa0005',
      text: '#aa0006',
      muted: '#aa0007',
      editBorder: '#aa0008',
      blue: '#aa0009',
      green: '#aa000a',
    });

    // glideTheme — multiple palette keys.
    expect(mod.glideTheme.bgCell).toBe('#aa0001');
    expect(mod.glideTheme.bgCellMedium).toBe('#aa0003');
    expect(mod.glideTheme.bgHeader).toBe('#aa0002');
    expect(mod.glideTheme.bgHeaderHovered).toBe('#aa0004');
    expect(mod.glideTheme.borderColor).toBe('#aa0005');
    expect(mod.glideTheme.textDark).toBe('#aa0006');
    expect(mod.glideTheme.textHeader).toBe('#aa0007');
    expect(mod.glideTheme.linkColor).toBe('#aa0009');

    // EDIT_INPUT_STYLE — text + editBorder.
    expect(mod.EDIT_INPUT_STYLE.color).toBe('#aa0006');
    expect(mod.EDIT_INPUT_STYLE.border).toBe('1px solid #aa000855');

    // STEPPER_BTN_STYLE — text.
    expect(mod.STEPPER_BTN_STYLE.color).toBe('#aa0006');

    // TD_BASE — text + border.
    expect(mod.TD_BASE.color).toBe('#aa0006');
    expect(mod.TD_BASE.borderBottom).toBe('1px solid #aa0005');

    // TH_BASE — headerBg + muted + border.
    expect(mod.TH_BASE.background).toBe('#aa0002');
    expect(mod.TH_BASE.color).toBe('#aa0007');
    expect(mod.TH_BASE.borderBottom).toBe('1px solid #aa0005');

    // TABLE_WRAPPER_STYLE — border.
    expect(mod.TABLE_WRAPPER_STYLE.border).toBe('1px solid #aa0005');

    // GRID_PANEL_STYLE — border.
    expect(mod.GRID_PANEL_STYLE.border).toBe('1px solid #aa0005');

    // TABLE_STYLE — font only; assert it rebuilt and is well-formed.
    expect(mod.TABLE_STYLE.fontFamily).toBe(GRID_COLORS.font);

    // CHECKBOX_STYLE — green.
    expect(mod.CHECKBOX_STYLE.accentColor).toBe('#aa000a');

    // STEPPER_INPUT_STYLE — font only; rebuilt + well-formed.
    expect(mod.STEPPER_INPUT_STYLE.fontFamily).toBe(GRID_COLORS.font);

    // EXPAND_BTN_STYLE — muted.
    expect(mod.EXPAND_BTN_STYLE.color).toBe('#aa0007');

    // SUB_ROW_STYLE — headerBg + editBorder.
    expect(mod.SUB_ROW_STYLE.background).toBe('#aa0002');
    expect(mod.SUB_ROW_STYLE.borderLeft).toBe('3px solid #aa0008');
  });

  it('does not leak a stale palette across successive re-themes', () => {
    configureGridColors({ bg: '#111111' });
    expect(mod.glideTheme.bgCell).toBe('#111111');
    configureGridColors({ bg: '#222222' });
    expect(mod.glideTheme.bgCell).toBe('#222222');
    expect(rowBg(0)).toBe('#222222');
  });
});

describe('colour-independent constants', () => {
  it('STEPPER_PILL_STYLE is unaffected by configureGridColors', () => {
    const before = { ...STEPPER_PILL_STYLE };
    configureGridColors({ bg: '#000000', text: '#ffffff', border: '#abcdef' });
    expect(STEPPER_PILL_STYLE).toEqual(before);
    expect(STEPPER_PILL_STYLE.borderRadius).toBe(9999);
    expect(STEPPER_PILL_STYLE.background).toBe('rgba(255,255,255,0.04)');
  });

  it('STEPPER_GLOBAL_CSS is unaffected by configureGridColors', () => {
    const before = STEPPER_GLOBAL_CSS;
    configureGridColors({ bg: '#000000' });
    expect(STEPPER_GLOBAL_CSS).toBe(before);
    expect(STEPPER_GLOBAL_CSS).toContain('gdg-stepper');
  });
});
