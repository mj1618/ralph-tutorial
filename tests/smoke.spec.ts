import { expect, test } from '@playwright/test'

test('edit a cell and undo/redo changes', async ({ page }) => {
  await page.goto('/')

  const grid = page.locator('.grid-scroll-container')
  await expect(grid).toBeVisible()

  const bounds = await grid.boundingBox()
  if (!bounds) {
    throw new Error('Grid container is not visible')
  }

  const cellPoint = { x: bounds.x + 10, y: bounds.y + 10 }
  const editor = page.locator('.cell-editor')

  await page.mouse.dblclick(cellPoint.x, cellPoint.y)
  await expect(editor).toHaveCount(1)
  await editor.fill('123')
  await page.mouse.click(cellPoint.x, cellPoint.y)
  await expect(editor).toHaveCount(0)

  await page.mouse.dblclick(cellPoint.x, cellPoint.y)
  await expect(editor).toHaveValue('123')
  await page.mouse.click(cellPoint.x, cellPoint.y)

  await page.mouse.click(cellPoint.x, cellPoint.y)
  const undoShortcut = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z'
  await page.keyboard.press(undoShortcut)

  await page.mouse.dblclick(cellPoint.x, cellPoint.y)
  await expect(editor).toHaveValue('')
  await page.mouse.click(cellPoint.x, cellPoint.y)

  const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y'
  await page.keyboard.press(redoShortcut)
  await page.mouse.dblclick(cellPoint.x, cellPoint.y)
  await expect(editor).toHaveValue('123')
})

test('paste a 3x3 TSV block into grid', async ({ page }) => {
  await page.goto('/')

  const grid = page.locator('.grid-scroll-container')
  await expect(grid).toBeVisible()

  const bounds = await grid.boundingBox()
  if (!bounds) {
    throw new Error('Grid container is not visible')
  }

  const cellWidth = 120
  const cellHeight = 32
  const padding = 10
  const editor = page.locator('.cell-editor')

  const cellPoint = (row: number, col: number) => ({
    x: bounds.x + padding + col * cellWidth,
    y: bounds.y + padding + row * cellHeight,
  })

  const tsv = 'A\tB\tC\n1\t2\t3\nx\ty\tz'
  const start = cellPoint(0, 0)
  await page.mouse.click(start.x, start.y)

  await page.evaluate((payload) => {
    const target = document.querySelector(payload.selector)
    if (!target) {
      throw new Error('Grid container is not available')
    }
    const data = new DataTransfer()
    data.setData('text/plain', payload.tsv)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: data })
    target.dispatchEvent(event)
  }, {
    selector: '.grid-scroll-container',
    tsv,
  })

  const expectCell = async (row: number, col: number, value: string) => {
    const point = cellPoint(row, col)
    await page.mouse.dblclick(point.x, point.y)
    await expect(editor).toHaveValue(value)
    await page.mouse.click(point.x, point.y)
  }

  await expectCell(0, 0, 'A')
  await expectCell(0, 1, 'B')
  await expectCell(0, 2, 'C')
  await expectCell(1, 0, '1')
  await expectCell(1, 1, '2')
  await expectCell(1, 2, '3')
  await expectCell(2, 0, 'x')
  await expectCell(2, 1, 'y')
  await expectCell(2, 2, 'z')
})
