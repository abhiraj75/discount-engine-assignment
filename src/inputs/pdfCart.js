/**
 * pdfCart.js
 *
 * Cart PDF → CartItem[]. Expects a table with Product, Brand, Platform and
 * Base Price columns. Words are assigned to a column by their x position
 * relative to the header, which works for both drawn tables and monospaced
 * text where a long value leaves only one space before the next column.
 *
 * Malformed rows are skipped and reported; the rest of the cart still loads.
 */

import { validateCartItem } from '../engine/validate.js'

const HEADERS = {
  product: /^product/i,
  brand: /^brand/i,
  platform: /^platform/i,
  basePrice: /^(base|price)/i,
}

const isHeader = (words) => Object.values(HEADERS).every((re) => words.some((w) => re.test(w.text)))

function wordsOf(str, x, charWidth) {
  return [...str.matchAll(/\S+/g)].map((m) => ({ text: m[0], x: x + m.index * charWidth, charWidth }))
}

// Treats a monospaced line as words positioned by character index.
export const textToWords = (line) => wordsOf(line, 0, 1)

export function rowsToCartItems(rows) {
  const headerIndex = rows.findIndex(isHeader)
  if (headerIndex === -1) {
    return { data: [], errors: ['No cart table found. Expected a header row with Product, Brand, Platform and Base Price columns.'] }
  }
  const columns = Object.entries(HEADERS)
    .map(([key, re]) => ({ key, x: rows[headerIndex].find((w) => re.test(w.text)).x }))
    .sort((a, b) => a.x - b.x)

  const data = []
  const errors = []
  let rowNum = 0
  for (const words of rows.slice(headerIndex + 1)) {
    const line = words.map((w) => w.text).join(' ')
    if (!/[a-z0-9]/i.test(line) || isHeader(words)) continue
    rowNum++

    const cells = Object.fromEntries(columns.map((c) => [c.key, []]))
    for (const w of words) {
      const col = columns.findLast((c) => c.x <= w.x + w.charWidth) ?? columns[0]
      cells[col.key].push(w.text)
    }

    const { item, error } = validateCartItem({
      itemId: `ITEM-${String(data.length + 1).padStart(2, '0')}`,
      ...Object.fromEntries(Object.entries(cells).map(([key, parts]) => [key, parts.join(' ')])),
    })
    if (error) errors.push(`Row ${rowNum} ("${line}"): ${error} — skipped`)
    else data.push(item)
  }

  if (data.length === 0 && errors.length === 0) errors.push('The cart table in this PDF has no item rows.')
  return { data, errors }
}

async function readPdfRows(file) {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise

  const rows = []
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent()
    const pageRows = []
    for (const item of items) {
      if (!item.str?.trim()) continue
      const [, , , , x, y] = item.transform
      let row = pageRows.find((r) => Math.abs(r.y - y) < 2)
      if (!row) pageRows.push((row = { y, words: [] }))
      row.words.push(...wordsOf(item.str, x, item.width / item.str.length))
    }
    pageRows.sort((a, b) => b.y - a.y)
    rows.push(...pageRows.map((r) => r.words.sort((a, b) => a.x - b.x)))
  }
  return rows
}

/**
 * Returns { data: CartItem[], errors: string[] }.
 */
export async function parseCartPdf(file) {
  let rows
  try {
    rows = await readPdfRows(file)
  } catch {
    return { data: [], errors: ["Couldn't open this PDF. Check that it isn't damaged or password-protected."] }
  }
  if (rows.length === 0) {
    return { data: [], errors: ['This PDF has no selectable text (it may be a scanned image), so no items could be read.'] }
  }
  return rowsToCartItems(rows)
}
