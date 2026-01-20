import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { getCellKey } from '../utils/cellKey'
import { cellsToCsv, csvToCells, parseDelimitedText } from '../utils/csv'
import { calculateDisplayCells } from '../utils/formulas'
import { clearWorkbook, loadWorkbook, saveWorkbook } from '../utils/persistence'

type GridCell = {
  row: number
  col: number
}

type GridSelection = {
  anchorRow: number
  anchorCol: number
  focusRow: number
  focusCol: number
}

type HistoryEntry = {
  key: string
  prev: string | null
  next: string | null
}

type HistoryBatch = HistoryEntry[]

type CellFormat = {
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
}

const GRID_CONFIG = {
  rows: 1000,
  cols: 200,
  cellWidth: 120,
  cellHeight: 32,
}

const GRID_STYLES = {
  gridLine: '#e2e8f0',
  selectionFill: 'rgba(37, 99, 235, 0.12)',
  selectionBorder: '#2563eb',
  background: '#ffffff',
}

const TEXT_STYLES = {
  color: '#1e293b',
  fontSize: 14,
  fontFamily: '"Inter", system-ui, sans-serif',
  paddingX: 8,
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getSelectionBounds(selection: GridSelection) {
  const startRow = Math.min(selection.anchorRow, selection.focusRow)
  const endRow = Math.max(selection.anchorRow, selection.focusRow)
  const startCol = Math.min(selection.anchorCol, selection.focusCol)
  const endCol = Math.max(selection.anchorCol, selection.focusCol)
  return { startRow, endRow, startCol, endCol }
}

function getVisibleRange(
  scrollOffset: number,
  viewportSize: number,
  cellSize: number,
  maxIndex: number,
) {
  const start = clamp(Math.floor(scrollOffset / cellSize), 0, maxIndex)
  const end = clamp(Math.ceil((scrollOffset + viewportSize) / cellSize), 0, maxIndex)
  return { start, end }
}

function normalizeFormat(format: CellFormat) {
  const normalized: CellFormat = {
    bold: Boolean(format.bold),
    italic: Boolean(format.italic),
    align: format.align ?? 'left',
  }
  if (!normalized.bold && !normalized.italic && normalized.align === 'left') {
    return null
  }
  return normalized
}

function getCellFont(format: CellFormat | undefined) {
  const weight = format?.bold ? 600 : 400
  const style = format?.italic ? 'italic ' : ''
  return `${style}${weight} ${TEXT_STYLES.fontSize}px ${TEXT_STYLES.fontFamily}`
}

function getCellAlign(format: CellFormat | undefined): CanvasTextAlign {
  return format?.align ?? 'left'
}

export type CanvasGridHandle = {
  resetWorkbook: () => void
  exportCsv: () => void
  importCsvFile: (file: File) => Promise<void>
  toggleBold: () => void
  toggleItalic: () => void
  setAlignment: (align: 'left' | 'center' | 'right') => void
}

const CanvasGrid = forwardRef<CanvasGridHandle>(function CanvasGrid(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<HTMLInputElement | null>(null)
  const selectionRef = useRef<GridSelection>({
    anchorRow: 0,
    anchorCol: 0,
    focusRow: 0,
    focusCol: 0,
  })
  const dragStateRef = useRef<{ active: boolean; pointerId: number | null }>({
    active: false,
    pointerId: null,
  })
  const [cells, setCells] = useState<Map<string, string>>(() => new Map())
  const cellsRef = useRef<Map<string, string>>(new Map())
  const displayRef = useRef<Map<string, string>>(new Map())
  const [formats, setFormats] = useState<Map<string, CellFormat>>(() => new Map())
  const formatsRef = useRef<Map<string, CellFormat>>(new Map())
  const [, setUndoStack] = useState<HistoryBatch[]>([])
  const [, setRedoStack] = useState<HistoryBatch[]>([])
  const frameRef = useRef<number | null>(null)
  const hasLoadedRef = useRef(false)
  const saveTimeoutRef = useRef<number | null>(null)
  const [selection, setSelection] = useState<GridSelection>({
    anchorRow: 0,
    anchorCol: 0,
    focusRow: 0,
    focusCol: 0,
  })
  const [editingCell, setEditingCell] = useState<GridCell | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [scrollState, setScrollState] = useState({ left: 0, top: 0 })

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { clientWidth, clientHeight, scrollLeft, scrollTop } = container
    const dpr = window.devicePixelRatio || 1

    const targetWidth = Math.max(clientWidth, 1)
    const targetHeight = Math.max(clientHeight, 1)
    const scaledWidth = Math.floor(targetWidth * dpr)
    const scaledHeight = Math.floor(targetHeight * dpr)

    if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
      canvas.width = scaledWidth
      canvas.height = scaledHeight
      canvas.style.width = `${targetWidth}px`
      canvas.style.height = `${targetHeight}px`
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, targetWidth, targetHeight)
    ctx.fillStyle = GRID_STYLES.background
    ctx.fillRect(0, 0, targetWidth, targetHeight)

    const visibleCols = getVisibleRange(
      scrollLeft,
      targetWidth,
      GRID_CONFIG.cellWidth,
      GRID_CONFIG.cols - 1,
    )
    const visibleRows = getVisibleRange(
      scrollTop,
      targetHeight,
      GRID_CONFIG.cellHeight,
      GRID_CONFIG.rows - 1,
    )

    const offsetX = -scrollLeft
    const offsetY = -scrollTop

    ctx.beginPath()
    ctx.strokeStyle = GRID_STYLES.gridLine
    ctx.lineWidth = 1

    for (let col = visibleCols.start; col <= visibleCols.end + 1; col += 1) {
      const x = col * GRID_CONFIG.cellWidth + offsetX
      ctx.moveTo(x, offsetY + visibleRows.start * GRID_CONFIG.cellHeight)
      ctx.lineTo(x, offsetY + (visibleRows.end + 1) * GRID_CONFIG.cellHeight)
    }

    for (let row = visibleRows.start; row <= visibleRows.end + 1; row += 1) {
      const y = row * GRID_CONFIG.cellHeight + offsetY
      ctx.moveTo(offsetX + visibleCols.start * GRID_CONFIG.cellWidth, y)
      ctx.lineTo(offsetX + (visibleCols.end + 1) * GRID_CONFIG.cellWidth, y)
    }

    ctx.stroke()

    const activeSelection = selectionRef.current
    const { startRow, endRow, startCol, endCol } = getSelectionBounds(activeSelection)
    const selectionLeft = startCol * GRID_CONFIG.cellWidth + offsetX
    const selectionTop = startRow * GRID_CONFIG.cellHeight + offsetY
    const selectionWidth = (endCol - startCol + 1) * GRID_CONFIG.cellWidth
    const selectionHeight = (endRow - startRow + 1) * GRID_CONFIG.cellHeight
    const selectionRight = selectionLeft + selectionWidth
    const selectionBottom = selectionTop + selectionHeight

    if (
      selectionRight >= 0 &&
      selectionBottom >= 0 &&
      selectionLeft <= targetWidth &&
      selectionTop <= targetHeight
    ) {
      ctx.fillStyle = GRID_STYLES.selectionFill
      ctx.fillRect(selectionLeft, selectionTop, selectionWidth, selectionHeight)
      ctx.strokeStyle = GRID_STYLES.selectionBorder
      ctx.lineWidth = 2
      ctx.strokeRect(selectionLeft, selectionTop, selectionWidth, selectionHeight)
    }

    ctx.font = getCellFont(undefined)
    ctx.fillStyle = TEXT_STYLES.color
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    let lastFont = ctx.font
    let lastAlign: CanvasTextAlign = 'left'

    for (let row = visibleRows.start; row <= visibleRows.end; row += 1) {
      for (let col = visibleCols.start; col <= visibleCols.end; col += 1) {
        const key = getCellKey(row, col)
        const value = displayRef.current.get(key)
        if (!value) continue

        const format = formatsRef.current.get(key)
        const font = getCellFont(format)
        const align = getCellAlign(format)
        if (font !== lastFont) {
          ctx.font = font
          lastFont = font
        }
        if (align !== lastAlign) {
          ctx.textAlign = align
          lastAlign = align
        }

        const cellLeft = col * GRID_CONFIG.cellWidth + offsetX
        const textY = row * GRID_CONFIG.cellHeight + offsetY + GRID_CONFIG.cellHeight / 2
        const textX =
          align === 'center'
            ? cellLeft + GRID_CONFIG.cellWidth / 2
            : align === 'right'
              ? cellLeft + GRID_CONFIG.cellWidth - TEXT_STYLES.paddingX
              : cellLeft + TEXT_STYLES.paddingX
        ctx.fillText(value, textX, textY, GRID_CONFIG.cellWidth - TEXT_STYLES.paddingX * 2)
      }
    }
  }, [])

  const scheduleDraw = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      draw()
    })
  }, [draw])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      setScrollState({ left: container.scrollLeft, top: container.scrollTop })
      scheduleDraw()
    }
    const resizeObserver = new ResizeObserver(() => scheduleDraw())

    container.addEventListener('scroll', handleScroll, { passive: true })
    resizeObserver.observe(container)
    setScrollState({ left: container.scrollLeft, top: container.scrollTop })
    scheduleDraw()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [scheduleDraw])

  useEffect(() => {
    selectionRef.current = selection
    scheduleDraw()
  }, [selection, scheduleDraw])

  useEffect(() => {
    cellsRef.current = cells
    displayRef.current = calculateDisplayCells(cells)
    scheduleDraw()
  }, [cells, scheduleDraw])

  useEffect(() => {
    formatsRef.current = formats
    scheduleDraw()
  }, [formats, scheduleDraw])

  useEffect(() => {
    let isActive = true
    loadWorkbook()
      .then((loaded) => {
        if (!isActive) return
        if (loaded) {
          setCells(loaded)
        }
        setUndoStack([])
        setRedoStack([])
      })
      .catch(() => {})
      .finally(() => {
        if (isActive) {
          hasLoadedRef.current = true
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedRef.current) return () => {}
    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current)
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveWorkbook(cells).catch(() => {})
    }, 400)
    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [cells])

  useEffect(() => {
    if (!editingCell) return
    const handle = window.requestAnimationFrame(() => editorRef.current?.focus())
    return () => window.cancelAnimationFrame(handle)
  }, [editingCell])

  const resetWorkbook = useCallback(() => {
    setCells(new Map())
    setFormats(new Map())
    setUndoStack([])
    setRedoStack([])
    setSelection({ anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 })
    setEditingCell(null)
    setDraftValue('')
    clearWorkbook().catch(() => {})
  }, [])

  const exportCsv = useCallback(() => {
    const csv = cellsToCsv(cellsRef.current)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'ralph-workbook.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [])

  const importCsvFile = useCallback(async (file: File) => {
    const text = await file.text()
    const nextCells = csvToCells(text, GRID_CONFIG.rows, GRID_CONFIG.cols)
    setCells(nextCells)
    setFormats(new Map())
    setUndoStack([])
    setRedoStack([])
    setSelection({ anchorRow: 0, anchorCol: 0, focusRow: 0, focusCol: 0 })
    setEditingCell(null)
    setDraftValue('')
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      resetWorkbook,
      exportCsv,
      importCsvFile,
      toggleBold: () => {
        const { focusRow, focusCol } = selectionRef.current
        const key = getCellKey(focusRow, focusCol)
        setFormats((prev) => {
          const next = new Map(prev)
          const updated = normalizeFormat({
            ...next.get(key),
            bold: !next.get(key)?.bold,
          })
          if (updated) {
            next.set(key, updated)
          } else {
            next.delete(key)
          }
          return next
        })
      },
      toggleItalic: () => {
        const { focusRow, focusCol } = selectionRef.current
        const key = getCellKey(focusRow, focusCol)
        setFormats((prev) => {
          const next = new Map(prev)
          const updated = normalizeFormat({
            ...next.get(key),
            italic: !next.get(key)?.italic,
          })
          if (updated) {
            next.set(key, updated)
          } else {
            next.delete(key)
          }
          return next
        })
      },
      setAlignment: (align) => {
        const { focusRow, focusCol } = selectionRef.current
        const key = getCellKey(focusRow, focusCol)
        setFormats((prev) => {
          const next = new Map(prev)
          const updated = normalizeFormat({
            ...next.get(key),
            align,
          })
          if (updated) {
            next.set(key, updated)
          } else {
            next.delete(key)
          }
          return next
        })
      },
    }),
    [exportCsv, importCsvFile, resetWorkbook],
  )

  const beginEdit = useCallback((cell: GridCell) => {
    const currentValue = cellsRef.current.get(getCellKey(cell.row, cell.col)) ?? ''
    setEditingCell(cell)
    setDraftValue(currentValue)
  }, [])

  const commitEdit = useCallback(() => {
    if (!editingCell) return
    const key = getCellKey(editingCell.row, editingCell.col)
    const prevValue = cellsRef.current.get(key) ?? null
    const nextValue = draftValue === '' ? null : draftValue
    if (prevValue !== nextValue) {
      setCells((prev) => {
        const next = new Map(prev)
        if (nextValue === null) {
          next.delete(key)
        } else {
          next.set(key, nextValue)
        }
        return next
      })
      setUndoStack((prev) => [...prev, [{ key, prev: prevValue, next: nextValue }]])
      setRedoStack([])
    }
    setEditingCell(null)
    scheduleDraw()
  }, [draftValue, editingCell, scheduleDraw])

  const cancelEdit = useCallback(() => {
    setEditingCell(null)
    setDraftValue('')
    scheduleDraw()
  }, [scheduleDraw])

  const pasteText = useCallback(
    (text: string) => {
      const rows = parseDelimitedText(text)
      if (rows.length === 0) return

      const start = selectionRef.current
      const historyEntries: HistoryEntry[] = []

      setCells((prev) => {
        const next = new Map(prev)
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
          const row = start.focusRow + rowIndex
          if (row >= GRID_CONFIG.rows) break
          const values = rows[rowIndex]
          for (let colIndex = 0; colIndex < values.length; colIndex += 1) {
            const col = start.focusCol + colIndex
            if (col >= GRID_CONFIG.cols) break
            const key = getCellKey(row, col)
            const prevValue = next.get(key) ?? null
            const nextValue = values[colIndex] === '' ? null : values[colIndex]
            if (prevValue === nextValue) continue
            if (nextValue === null) {
              next.delete(key)
            } else {
              next.set(key, nextValue)
            }
            historyEntries.push({ key, prev: prevValue, next: nextValue })
          }
        }
        return next
      })

      if (historyEntries.length > 0) {
        setUndoStack((prev) => [...prev, historyEntries])
        setRedoStack([])
      }
    },
    [setCells],
  )

  const handleCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editingCell) return
    const { startRow, endRow, startCol, endCol } = getSelectionBounds(selectionRef.current)
    const isSingleCell = startRow === endRow && startCol === endCol
    let value = ''
    if (isSingleCell) {
      const key = getCellKey(startRow, startCol)
      value = cellsRef.current.get(key) ?? ''
    } else {
      const rows: string[] = []
      for (let row = startRow; row <= endRow; row += 1) {
        const values: string[] = []
        for (let col = startCol; col <= endCol; col += 1) {
          const key = getCellKey(row, col)
          values.push(cellsRef.current.get(key) ?? '')
        }
        rows.push(values.join('\t'))
      }
      value = rows.join('\n')
    }
    event.preventDefault()
    event.clipboardData.setData('text/plain', value)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editingCell) return
    const text = event.clipboardData.getData('text/plain')
    if (text === '') return
    event.preventDefault()
    pasteText(text)
  }

  const applyHistoryBatch = useCallback((batch: HistoryBatch, mode: 'prev' | 'next') => {
    setCells((prev) => {
      const next = new Map(prev)
      for (const entry of batch) {
        const value = entry[mode]
        if (value === null) {
          next.delete(entry.key)
        } else {
          next.set(entry.key, value)
        }
      }
      return next
    })
  }, [])

  const undoLast = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev
      const batch = prev[prev.length - 1]
      applyHistoryBatch(batch, 'prev')
      setRedoStack((redoPrev) => [...redoPrev, batch])
      return prev.slice(0, -1)
    })
  }, [applyHistoryBatch])

  const redoLast = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev
      const batch = prev[prev.length - 1]
      applyHistoryBatch(batch, 'next')
      setUndoStack((undoPrev) => [...undoPrev, batch])
      return prev.slice(0, -1)
    })
  }, [applyHistoryBatch])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left + container.scrollLeft
    const y = event.clientY - rect.top + container.scrollTop

    const col = clamp(Math.floor(x / GRID_CONFIG.cellWidth), 0, GRID_CONFIG.cols - 1)
    const row = clamp(Math.floor(y / GRID_CONFIG.cellHeight), 0, GRID_CONFIG.rows - 1)

    if (editingCell) {
      commitEdit()
    }

    if (event.shiftKey) {
      setSelection((prev) => ({
        anchorRow: prev.anchorRow,
        anchorCol: prev.anchorCol,
        focusRow: row,
        focusCol: col,
      }))
    } else {
      setSelection({ anchorRow: row, anchorCol: col, focusRow: row, focusCol: col })
    }
    dragStateRef.current = { active: true, pointerId: event.pointerId }
    container.setPointerCapture(event.pointerId)
    container.focus()
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || !dragStateRef.current.active) return
    if (dragStateRef.current.pointerId !== event.pointerId) return

    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left + container.scrollLeft
    const y = event.clientY - rect.top + container.scrollTop

    const col = clamp(Math.floor(x / GRID_CONFIG.cellWidth), 0, GRID_CONFIG.cols - 1)
    const row = clamp(Math.floor(y / GRID_CONFIG.cellHeight), 0, GRID_CONFIG.rows - 1)

    setSelection((prev) => ({
      anchorRow: prev.anchorRow,
      anchorCol: prev.anchorCol,
      focusRow: row,
      focusCol: col,
    }))
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || !dragStateRef.current.active) return
    if (dragStateRef.current.pointerId !== event.pointerId) return
    dragStateRef.current = { active: false, pointerId: null }
    container.releasePointerCapture(event.pointerId)
  }

  const handleDoubleClick = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left + container.scrollLeft
    const y = event.clientY - rect.top + container.scrollTop

    const col = clamp(Math.floor(x / GRID_CONFIG.cellWidth), 0, GRID_CONFIG.cols - 1)
    const row = clamp(Math.floor(y / GRID_CONFIG.cellHeight), 0, GRID_CONFIG.rows - 1)

    setSelection({ anchorRow: row, anchorCol: col, focusRow: row, focusCol: col })
    beginEdit({ row, col })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const isMeta = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (isMeta && key === 'z' && !editingCell) {
      event.preventDefault()
      if (event.shiftKey) {
        redoLast()
      } else {
        undoLast()
      }
      return
    }
    if (isMeta && key === 'y' && !editingCell) {
      event.preventDefault()
      redoLast()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (editingCell) {
        commitEdit()
      } else {
        beginEdit({ row: selection.focusRow, col: selection.focusCol })
      }
    }
    if (!editingCell) {
      const move = (rowDelta: number, colDelta: number, extend: boolean) => {
        const current = selectionRef.current
        const nextRow = clamp(current.focusRow + rowDelta, 0, GRID_CONFIG.rows - 1)
        const nextCol = clamp(current.focusCol + colDelta, 0, GRID_CONFIG.cols - 1)
        if (extend) {
          setSelection((prev) => ({
            anchorRow: prev.anchorRow,
            anchorCol: prev.anchorCol,
            focusRow: nextRow,
            focusCol: nextCol,
          }))
        } else {
          setSelection({ anchorRow: nextRow, anchorCol: nextCol, focusRow: nextRow, focusCol: nextCol })
        }
      }
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          move(-1, 0, event.shiftKey)
          return
        case 'ArrowDown':
          event.preventDefault()
          move(1, 0, event.shiftKey)
          return
        case 'ArrowLeft':
          event.preventDefault()
          move(0, -1, event.shiftKey)
          return
        case 'ArrowRight':
          event.preventDefault()
          move(0, 1, event.shiftKey)
          return
        case 'Tab': {
          event.preventDefault()
          const direction = event.shiftKey ? -1 : 1
          move(0, direction, false)
          return
        }
      }
    }
    if (event.key === 'Escape' && editingCell) {
      event.preventDefault()
      cancelEdit()
    }
  }

  const totalWidth = GRID_CONFIG.cols * GRID_CONFIG.cellWidth
  const totalHeight = GRID_CONFIG.rows * GRID_CONFIG.cellHeight
  const selectedKey = getCellKey(selection.focusRow, selection.focusCol)
  const selectedDisplay = displayRef.current.get(selectedKey) ?? ''
  const selectedFormat = formats.get(selectedKey)

  return (
    <div className="grid-shell">
      <div
        className="grid-scroll-container"
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onCopy={handleCopy}
        onPaste={handlePaste}
        tabIndex={0}
        role="presentation"
      >
        <div
          className="grid-scroll-spacer"
          style={{ width: totalWidth, height: totalHeight }}
        />
      </div>
      <canvas className="grid-canvas" ref={canvasRef} />
      <div
        className="grid-selection-meta"
        data-selected-display={selectedDisplay}
        aria-hidden="true"
        style={{ display: 'none' }}
      />
      {editingCell ? (
        <input
          ref={editorRef}
          className="cell-editor"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={commitEdit}
          style={{
            width: GRID_CONFIG.cellWidth,
            height: GRID_CONFIG.cellHeight,
            left: editingCell.col * GRID_CONFIG.cellWidth - scrollState.left,
            top: editingCell.row * GRID_CONFIG.cellHeight - scrollState.top,
            fontWeight: selectedFormat?.bold ? 600 : 400,
            fontStyle: selectedFormat?.italic ? 'italic' : 'normal',
            textAlign: selectedFormat?.align ?? 'left',
          }}
        />
      ) : null}
    </div>
  )
})

export default CanvasGrid
