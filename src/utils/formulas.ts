import { getCellKey } from './cellKey'

type FormulaValue = number | string | null

type TokenType =
  | 'number'
  | 'identifier'
  | 'cell'
  | 'operator'
  | 'paren'
  | 'comma'
  | 'colon'
  | 'eof'

type Token = {
  type: TokenType
  value: string
}

type FormulaNode =
  | { type: 'number'; value: number }
  | { type: 'cell'; ref: string }
  | { type: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { type: 'unary'; op: '+' | '-'; operand: FormulaNode }
  | { type: 'function'; name: string; args: FormulaNode[] }
  | { type: 'range'; start: string; end: string }

type ParseResult = {
  ok: boolean
  ast?: FormulaNode
}

type CellCoords = {
  row: number
  col: number
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/

function isNumericValue(value: FormulaValue) {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  return NUMBER_RE.test(value.trim())
}

function toNumber(value: FormulaValue) {
  if (typeof value === 'number') return value
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  if (!NUMBER_RE.test(trimmed)) return 0
  return Number.parseFloat(trimmed)
}

function formatValue(value: FormulaValue) {
  if (value === null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '#ERROR'
  return value
}

function isAlpha(char: string) {
  return /[a-zA-Z]/.test(char)
}

function isDigit(char: string) {
  return /[0-9]/.test(char)
}

function tokenize(input: string) {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const char = input[i]
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i += 1
      continue
    }
    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'operator', value: char })
      i += 1
      continue
    }
    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char })
      i += 1
      continue
    }
    if (char === ',') {
      tokens.push({ type: 'comma', value: char })
      i += 1
      continue
    }
    if (char === ':') {
      tokens.push({ type: 'colon', value: char })
      i += 1
      continue
    }
    if (isDigit(char) || (char === '.' && isDigit(input[i + 1] ?? ''))) {
      let value = char
      i += 1
      while (i < input.length && (isDigit(input[i]) || input[i] === '.')) {
        value += input[i]
        i += 1
      }
      tokens.push({ type: 'number', value })
      continue
    }
    if (isAlpha(char)) {
      let letters = char
      i += 1
      while (i < input.length && isAlpha(input[i])) {
        letters += input[i]
        i += 1
      }
      let digits = ''
      while (i < input.length && isDigit(input[i])) {
        digits += input[i]
        i += 1
      }
      if (digits.length > 0) {
        tokens.push({ type: 'cell', value: `${letters}${digits}` })
      } else {
        tokens.push({ type: 'identifier', value: letters })
      }
      continue
    }
    i += 1
  }

  tokens.push({ type: 'eof', value: '' })
  return tokens
}

class Parser {
  private tokens: Token[]
  private index: number

  constructor(tokens: Token[]) {
    this.tokens = tokens
    this.index = 0
  }

  parseFormula(): ParseResult {
    if (this.peek().type === 'eof') return { ok: false }
    const ast = this.parseExpression()
    if (!ast || this.peek().type !== 'eof') return { ok: false }
    return { ok: true, ast }
  }

  parseExpression(): FormulaNode | null {
    let node: FormulaNode | null = this.parseTerm()
    while (this.matchOperator('+', '-')) {
      const op = this.previous().value as '+' | '-'
      const right = this.parseTerm()
      if (!node || !right) return null
      node = { type: 'binary', op, left: node, right }
    }
    return node
  }

  parseTerm(): FormulaNode | null {
    let node: FormulaNode | null = this.parseUnary()
    while (this.matchOperator('*', '/')) {
      const op = this.previous().value as '*' | '/'
      const right = this.parseUnary()
      if (!node || !right) return null
      node = { type: 'binary', op, left: node, right }
    }
    return node
  }

  parseUnary(): FormulaNode | null {
    if (this.matchOperator('+', '-')) {
      const op = this.previous().value as '+' | '-'
      const operand = this.parseUnary()
      if (!operand) return null
      return { type: 'unary', op, operand }
    }
    return this.parsePrimary()
  }

  parsePrimary(): FormulaNode | null {
    if (this.match('number')) {
      return { type: 'number', value: Number.parseFloat(this.previous().value) }
    }
    if (this.match('cell')) {
      return { type: 'cell', ref: this.previous().value }
    }
    if (this.match('identifier')) {
      const name = this.previous().value
      if (!this.matchParen('(')) return null
      const args: FormulaNode[] = []
      if (!this.checkParen(')')) {
        do {
          const arg = this.parseArgument()
          if (!arg) return null
          args.push(arg)
        } while (this.match('comma'))
      }
      if (!this.matchParen(')')) return null
      return { type: 'function', name, args }
    }
    if (this.matchParen('(')) {
      const expr = this.parseExpression()
      if (!expr || !this.matchParen(')')) return null
      return expr
    }
    return null
  }

  parseArgument(): FormulaNode | null {
    if (this.peek().type === 'cell' && this.peekNext().type === 'colon') {
      const start = this.advance().value
      this.advance()
      if (!this.match('cell')) return null
      const end = this.previous().value
      return { type: 'range', start, end }
    }
    return this.parseExpression()
  }

  match(...types: TokenType[]) {
    for (const type of types) {
      if (this.check(type)) {
        this.advance()
        return true
      }
    }
    return false
  }

  matchOperator(...ops: Array<'+' | '-' | '*' | '/'>) {
    if (this.peek().type !== 'operator') return false
    if (!ops.includes(this.peek().value as '+' | '-' | '*' | '/')) return false
    this.advance()
    return true
  }

  matchParen(value: '(' | ')') {
    if (this.peek().type !== 'paren') return false
    if (this.peek().value !== value) return false
    this.advance()
    return true
  }

  check(type: TokenType) {
    return this.peek().type === type
  }

  checkParen(value: '(' | ')') {
    return this.peek().type === 'paren' && this.peek().value === value
  }

  advance() {
    if (!this.isAtEnd()) this.index += 1
    return this.previous()
  }

  isAtEnd() {
    return this.peek().type === 'eof'
  }

  peek() {
    return this.tokens[this.index]
  }

  peekNext() {
    return this.tokens[this.index + 1] ?? this.tokens[this.index]
  }

  previous() {
    return this.tokens[this.index - 1]
  }
}

function parseCellRef(ref: string): CellCoords | null {
  const match = /^([a-zA-Z]+)([0-9]+)$/.exec(ref)
  if (!match) return null
  const [, colLabel, rowText] = match
  let col = 0
  const upper = colLabel.toUpperCase()
  for (let i = 0; i < upper.length; i += 1) {
    col = col * 26 + (upper.charCodeAt(i) - 64)
  }
  col -= 1
  const row = Number.parseInt(rowText, 10) - 1
  if (!Number.isFinite(row) || row < 0 || col < 0) return null
  return { row, col }
}

function expandRange(start: string, end: string) {
  const startCell = parseCellRef(start)
  const endCell = parseCellRef(end)
  if (!startCell || !endCell) return []
  const rowStart = Math.min(startCell.row, endCell.row)
  const rowEnd = Math.max(startCell.row, endCell.row)
  const colStart = Math.min(startCell.col, endCell.col)
  const colEnd = Math.max(startCell.col, endCell.col)
  const keys: string[] = []
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let col = colStart; col <= colEnd; col += 1) {
      keys.push(getCellKey(row, col))
    }
  }
  return keys
}

function collectDependencies(node: FormulaNode, deps: Set<string>) {
  if (node.type === 'cell') {
    const coords = parseCellRef(node.ref)
    if (coords) deps.add(getCellKey(coords.row, coords.col))
    return
  }
  if (node.type === 'range') {
    for (const key of expandRange(node.start, node.end)) {
      deps.add(key)
    }
    return
  }
  if (node.type === 'binary') {
    collectDependencies(node.left, deps)
    collectDependencies(node.right, deps)
    return
  }
  if (node.type === 'unary') {
    collectDependencies(node.operand, deps)
    return
  }
  if (node.type === 'function') {
    for (const arg of node.args) {
      collectDependencies(arg, deps)
    }
  }
}

function evaluateNode(
  node: FormulaNode,
  getCellValue: (key: string) => FormulaValue,
): FormulaValue | FormulaValue[] {
  if (node.type === 'number') return node.value
  if (node.type === 'cell') {
    const coords = parseCellRef(node.ref)
    if (!coords) return null
    return getCellValue(getCellKey(coords.row, coords.col))
  }
  if (node.type === 'range') {
    return expandRange(node.start, node.end).map((key) => getCellValue(key))
  }
  if (node.type === 'unary') {
    const value = evaluateNode(node.operand, getCellValue)
    const numeric = toNumber(Array.isArray(value) ? value[0] ?? 0 : value)
    return node.op === '-' ? -numeric : numeric
  }
  if (node.type === 'binary') {
    const left = evaluateNode(node.left, getCellValue)
    const right = evaluateNode(node.right, getCellValue)
    const leftNum = toNumber(Array.isArray(left) ? left[0] ?? 0 : left)
    const rightNum = toNumber(Array.isArray(right) ? right[0] ?? 0 : right)
    switch (node.op) {
      case '+':
        return leftNum + rightNum
      case '-':
        return leftNum - rightNum
      case '*':
        return leftNum * rightNum
      case '/':
        if (rightNum === 0) return '#DIV/0!'
        return leftNum / rightNum
    }
  }
  if (node.type === 'function') {
    const name = node.name.toUpperCase()
    const rawArgs = node.args.flatMap((arg) => {
      const value = evaluateNode(arg, getCellValue)
      return Array.isArray(value) ? value : [value]
    })
    const numbers = rawArgs.filter((value) => isNumericValue(value)).map((value) => toNumber(value))
    switch (name) {
      case 'SUM':
        return numbers.reduce((total, value) => total + value, 0)
      case 'AVERAGE':
        return numbers.length === 0
          ? 0
          : numbers.reduce((total, value) => total + value, 0) / numbers.length
      case 'MIN':
        return numbers.length === 0 ? 0 : Math.min(...numbers)
      case 'MAX':
        return numbers.length === 0 ? 0 : Math.max(...numbers)
      case 'COUNT':
        return numbers.length
      default:
        return '#ERROR'
    }
  }
  return '#ERROR'
}

export function calculateDisplayCells(cells: Map<string, string>) {
  const display = new Map<string, string>()
  const formulas = new Map<string, FormulaNode>()
  const formulaErrors = new Set<string>()
  const dependencies = new Map<string, Set<string>>()

  for (const [key, value] of cells.entries()) {
    if (!value.startsWith('=')) {
      display.set(key, value)
      continue
    }
    const tokens = tokenize(value.slice(1))
    const parser = new Parser(tokens)
    const result = parser.parseFormula()
    if (!result.ok || !result.ast) {
      formulaErrors.add(key)
      continue
    }
    formulas.set(key, result.ast)
    const deps = new Set<string>()
    collectDependencies(result.ast, deps)
    dependencies.set(key, deps)
  }

  const adjacency = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()
  for (const key of formulas.keys()) {
    adjacency.set(key, new Set())
    indegree.set(key, 0)
  }

  for (const [cell, deps] of dependencies.entries()) {
    for (const dep of deps) {
      if (!formulas.has(dep)) continue
      adjacency.get(dep)?.add(cell)
      indegree.set(cell, (indegree.get(cell) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [key, count] of indegree.entries()) {
    if (count === 0) queue.push(key)
  }

  const ordered: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) break
    ordered.push(current)
    for (const next of adjacency.get(current) ?? []) {
      const nextCount = (indegree.get(next) ?? 0) - 1
      indegree.set(next, nextCount)
      if (nextCount === 0) queue.push(next)
    }
  }

  const computed = new Map<string, FormulaValue>()
  const getCellValue = (key: string) => {
    if (computed.has(key)) return computed.get(key) ?? null
    if (display.has(key)) return display.get(key) ?? null
    return cells.get(key) ?? null
  }

  for (const key of ordered) {
    if (formulaErrors.has(key)) {
      computed.set(key, '#ERROR')
      continue
    }
    const ast = formulas.get(key)
    if (!ast) {
      computed.set(key, '#ERROR')
      continue
    }
    computed.set(key, evaluateNode(ast, getCellValue) as FormulaValue)
  }

  for (const [key] of formulas.entries()) {
    if (!computed.has(key)) {
      computed.set(key, '#CYCLE')
    }
  }

  for (const [key, value] of computed.entries()) {
    display.set(key, formatValue(value))
  }

  for (const key of formulaErrors) {
    if (!display.has(key)) {
      display.set(key, '#ERROR')
    }
  }

  return display
}
