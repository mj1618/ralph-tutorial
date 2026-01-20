import { describe, expect, it } from 'vitest'
import { getCellKey } from './cellKey'
import { calculateDisplayCells } from './formulas'

describe('calculateDisplayCells', () => {
  it('evaluates basic arithmetic formulas', () => {
    const cells = new Map<string, string>([
      [getCellKey(0, 0), '2'],
      [getCellKey(1, 0), '3'],
      [getCellKey(2, 0), '=A1+A2'],
      [getCellKey(3, 0), '=A2*2'],
    ])

    const display = calculateDisplayCells(cells)

    expect(display.get(getCellKey(2, 0))).toBe('5')
    expect(display.get(getCellKey(3, 0))).toBe('6')
  })

  it('handles functions with ranges', () => {
    const cells = new Map<string, string>([
      [getCellKey(0, 0), '4'],
      [getCellKey(1, 0), '6'],
      [getCellKey(2, 0), '10'],
      [getCellKey(0, 1), '=SUM(A1:A3)'],
      [getCellKey(1, 1), '=AVERAGE(A1:A3)'],
      [getCellKey(2, 1), '=COUNT(A1:A3)'],
    ])

    const display = calculateDisplayCells(cells)

    expect(display.get(getCellKey(0, 1))).toBe('20')
    expect(display.get(getCellKey(1, 1))).toBe('6.666666666666667')
    expect(display.get(getCellKey(2, 1))).toBe('3')
  })

  it('recalculates dependent formulas and flags cycles', () => {
    const cells = new Map<string, string>([
      [getCellKey(0, 0), '1'],
      [getCellKey(0, 1), '=A1+1'],
      [getCellKey(0, 2), '=B1+1'],
      [getCellKey(1, 0), '=B2'],
      [getCellKey(1, 1), '=A2'],
    ])

    const display = calculateDisplayCells(cells)

    expect(display.get(getCellKey(0, 1))).toBe('2')
    expect(display.get(getCellKey(0, 2))).toBe('3')
    expect(display.get(getCellKey(1, 0))).toBe('#CYCLE')
    expect(display.get(getCellKey(1, 1))).toBe('#CYCLE')
  })
})
