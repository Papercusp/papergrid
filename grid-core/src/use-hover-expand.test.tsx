/**
 * @vitest-environment jsdom
 *
 * Tests for useHoverExpand — the hover/focus-to-expand row state with open/close
 * debounce, panel-gap cancellation, and Escape-to-close.
 * Run with: npx vitest run libs/generic/papergrid/grid-core/src/use-hover-expand.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHoverExpand } from './use-hover-expand';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHoverExpand', () => {
  it('opens immediately on rowEnter (openDelay 0) and tracks hoveredId', () => {
    const { result } = renderHook(() => useHoverExpand());
    act(() => result.current.rowEnter('r1'));
    expect(result.current.hoveredId).toBe('r1');
    expect(result.current.expandedId).toBe('r1');
  });

  it('closes after the debounce on rowLeave', () => {
    const { result } = renderHook(() => useHoverExpand({ closeDelayMs: 180 }));
    act(() => result.current.rowEnter('r1'));
    act(() => result.current.rowLeave());
    expect(result.current.expandedId).toBe('r1'); // still open during the debounce
    act(() => vi.advanceTimersByTime(180));
    expect(result.current.expandedId).toBeNull();
    expect(result.current.hoveredId).toBeNull();
  });

  it('panelEnter cancels a pending close (cross the row→panel gap without flicker)', () => {
    const { result } = renderHook(() => useHoverExpand({ closeDelayMs: 180 }));
    act(() => result.current.rowEnter('r1'));
    act(() => result.current.rowLeave()); // schedules a close
    act(() => result.current.panelEnter()); // cancels it
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.expandedId).toBe('r1');
  });

  it('honors openDelayMs before opening', () => {
    const { result } = renderHook(() => useHoverExpand({ openDelayMs: 100 }));
    act(() => result.current.rowEnter('r1'));
    expect(result.current.expandedId).toBeNull(); // not yet
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.expandedId).toBe('r1');
  });

  it('openNow / closeNow act immediately', () => {
    const { result } = renderHook(() => useHoverExpand());
    act(() => result.current.openNow('x'));
    expect(result.current.expandedId).toBe('x');
    act(() => result.current.closeNow());
    expect(result.current.expandedId).toBeNull();
  });

  it('rowFocus opens immediately; rowBlur schedules a close', () => {
    const { result } = renderHook(() => useHoverExpand({ closeDelayMs: 50 }));
    act(() => result.current.rowFocus('r1'));
    expect(result.current.expandedId).toBe('r1');
    act(() => result.current.rowBlur());
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.expandedId).toBeNull();
  });

  it('Escape closes when escapeCloses (default on)', () => {
    const { result } = renderHook(() => useHoverExpand());
    act(() => result.current.openNow('r1'));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.expandedId).toBeNull();
  });

  it('Escape is ignored when escapeCloses is false', () => {
    const { result } = renderHook(() => useHoverExpand({ escapeCloses: false }));
    act(() => result.current.openNow('r1'));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(result.current.expandedId).toBe('r1');
  });
});
