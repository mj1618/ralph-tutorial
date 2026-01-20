import { getCellKey } from './cellKey'

function escapeCsvValue(value: string) {
  if (value === '') return ''
  const needsQuotes = /[",\n\r]/.test(value)
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function cellsToCsv(cells: Map<string, string>) {
  if (cells.size === 0) return ''

  let maxRow = 0
  let maxCol = 0
  for (const key of cells.keys()) {
    const [rowText, colText] = key.split(':')
    const row = Number(rowText)
    const col = Number(colText)
    if (Number.isFinite(row) && Number.isFinite(col)) {
      if (row > maxRow) maxRow = row
      if (col > maxCol) maxCol = col
    }
  }

  const rows: string[] = []
  for (let row = 0; row <= maxRow; row += 1) {
    const values: string[] = []
    for (let col = 0; col <= maxCol; col += 1) {
      const value = cells.get(getCellKey(row, col)) ?? ''
      values.push(escapeCsvValue(value))
    }
    rows.push(values.join(','))
  }

  return rows.join('\n')
}

type CsvParseState = {
  rows: string[][]
  row: string[]
  field: string
  inQuotes: boolean
}

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const

function pickDelimiter(counts: Map<string, number>) {
  let best: string | null = null
  let bestCount = 0
  for (const delimiter of DELIMITER_CANDIDATES) {
    const count = counts.get(delimiter) ?? 0
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return bestCount > 0 ? best : null
}

function detectDelimiter(text: string) {
  let inQuotes = false
  let lineCount = 0
  let counts = new Map<string, number>()

  const resetCounts = () => {
    counts = new Map<string, number>()
    for (const delimiter of DELIMITER_CANDIDATES) {
      counts.set(delimiter, 0)
    }
  }

  resetCounts()

  let i = 0
  while (i < text.length && lineCount < 5) {
    const char = text[i]
    if (char === '"') {
      const nextChar = text[i + 1]
      if (inQuotes && nextChar === '"') {
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (!inQuotes && (char === '\n' || char === '\r')) {
      const best = pickDelimiter(counts)
      if (best) return best
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1
      }
      lineCount += 1
      resetCounts()
    } else if (!inQuotes) {
      if (counts.has(char)) {
        counts.set(char, (counts.get(char) ?? 0) + 1)
      }
    }
    i += 1
  }

  return pickDelimiter(counts) ?? ','
}

function finalizeField(state: CsvParseState) {
  state.row.push(state.field)
  state.field = ''
}

function finalizeRow(state: CsvParseState) {
  finalizeField(state)
  state.rows.push(state.row)
  state.row = []
}

function parseCsv(text: string, delimiter: string) {
  const state: CsvParseState = { rows: [], row: [], field: '', inQuotes: false }

  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (state.inQuotes) {
      if (char === '"') {
        const nextChar = text[i + 1]
        if (nextChar === '"') {
          state.field += '"'
          i += 1
        } else {
          state.inQuotes = false
        }
      } else {
        state.field += char
      }
    } else {
      if (char === '"') {
        state.inQuotes = true
      } else if (char === delimiter) {
        finalizeField(state)
      } else if (char === '\n') {
        finalizeRow(state)
      } else if (char === '\r') {
        const nextChar = text[i + 1]
        if (nextChar === '\n') i += 1
        finalizeRow(state)
      } else {
        state.field += char
      }
    }
    i += 1
  }

  if (state.inQuotes) {
    state.inQuotes = false
  }
  if (state.field.length > 0 || state.row.length > 0) {
    finalizeRow(state)
  }

  return state.rows
}

export function csvToCells(text: string, maxRows: number, maxCols: number) {
  const delimiter = detectDelimiter(text)
  const rows = parseCsv(text, delimiter)
  const cells = new Map<string, string>()

  for (let row = 0; row < rows.length && row < maxRows; row += 1) {
    const rowValues = rows[row]
    for (let col = 0; col < rowValues.length && col < maxCols; col += 1) {
      const value = rowValues[col]
      if (value !== '') {
        cells.set(getCellKey(row, col), value)
      }
    }
  }

  return cells
}
