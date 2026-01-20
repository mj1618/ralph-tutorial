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
