import { describe, expect, it } from 'vitest'
import { getCellKey } from './cellKey'
import { csvToCells } from './csv'

describe('csvToCells', () => {
  it('detects tab-delimited data', () => {
    const cells = csvToCells('A\tB\n1\t2', 10, 10)

    expect(cells.get(getCellKey(0, 0))).toBe('A')
    expect(cells.get(getCellKey(0, 1))).toBe('B')
    expect(cells.get(getCellKey(1, 0))).toBe('1')
    expect(cells.get(getCellKey(1, 1))).toBe('2')
  })

  it('handles semicolons with quoted fields', () => {
    const cells = csvToCells('Name;Note\n"Ralph";"a; b"', 10, 10)

    expect(cells.get(getCellKey(0, 0))).toBe('Name')
    expect(cells.get(getCellKey(0, 1))).toBe('Note')
    expect(cells.get(getCellKey(1, 0))).toBe('Ralph')
    expect(cells.get(getCellKey(1, 1))).toBe('a; b')
  })
})
