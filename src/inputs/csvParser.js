/**
 * csvParser.js
 *
 * Converts raw CSV text into the typed objects the discount engine expects.
 * papaparse handles the CSV syntax; validate.js decides what a valid row is.
 *
 * Expected rules.csv columns:
 *   rule_id, scope, applies_to, type, value, stackable, min_cart_value (cart rules only)
 *
 * Expected cart.csv columns:
 *   item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { validateRule, validateCartItem } from '../engine/validate.js'

function parseRows(csvText, toRaw, validate) {
  const { data: rows, errors: parseErrors } = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseErrors.length > 0) {
    return { data: [], errors: parseErrors.map((e) => `Row ${e.row + 2}: ${e.message}`) }
  }

  const data = []
  const errors = []
  rows.forEach((row, i) => {
    const result = validate(toRaw(row))
    if (result.error) errors.push(`Row ${i + 2}: ${result.error}`)
    else data.push(result.rule ?? result.item)
  })
  return { data, errors }
}

/**
 * Returns { data: DiscountRule[], errors: string[] }.
 */
export function parseRulesCSV(csvText) {
  return parseRows(
    csvText,
    (row) => ({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    }),
    validateRule,
  )
}

/**
 * Returns { data: CartItem[], errors: string[] }.
 */
export function parseCartCSV(csvText) {
  return parseRows(
    csvText,
    (row) => ({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    }),
    validateCartItem,
  )
}
