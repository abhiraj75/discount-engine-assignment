import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csvParser.js'
import { processCart, cartTotal, applyCartOffer, applyDiscounts } from '../src/engine/discountEngine.js'
import { validateRule } from '../src/engine/validate.js'
import { rowsToCartItems, textToWords } from '../src/inputs/pdfCart.js'

const rules = parseRulesCSV(readFileSync(new URL('../sample-data/rules.csv', import.meta.url), 'utf8'))
const cart = parseCartCSV(readFileSync(new URL('../sample-data/cart.csv', import.meta.url), 'utf8'))

test('sample data parses cleanly', () => {
  assert.deepEqual(rules.errors, [])
  assert.deepEqual(cart.errors, [])
  assert.equal(rules.data.length, 4)
})

test('item prices match the expected results table', () => {
  const results = processCart(cart.data, rules.data)
  assert.deepEqual(results.map((r) => r.finalPrice), [1104, 629, 509, 2499, 382, 809])
  assert.deepEqual(results[0].skippedRules, ['RULE-02'])
  assert.deepEqual(results[1].appliedRules, ['RULE-02', 'RULE-03'])
  assert.match(results[3].reasoning, /No offers available/)
})

test('cart offer applies at the threshold and not just below it', () => {
  const subtotal = cartTotal(processCart(cart.data, rules.data))
  const offer = applyCartOffer(subtotal, rules.data)
  assert.equal(subtotal, 5932)
  assert.equal(offer.discount, 593)
  assert.equal(offer.total, 5339)
  assert.equal(offer.reasoning, 'Cart offer: 10% off — Rs.593 saved')

  assert.equal(applyCartOffer(4000, rules.data).discount, 400)
  const below = applyCartOffer(3999, rules.data)
  assert.equal(below.discount, 0)
  assert.equal(below.reasoning, '')
  assert.equal(below.nudge, 'Add Rs.1 more to get 10% off your cart')
})

test('a flat discount larger than the price stops at zero', () => {
  const item = { itemId: 'X', product: 'Coaster', brand: 'Natura Casa', platform: 'Noon', basePrice: 99 }
  const result = applyDiscounts(item, rules.data)
  assert.equal(result.finalPrice, 0)
  assert.equal(result.totalDiscount, 99)
})

test('validateRule rejects malformed rules', () => {
  const ok = { ruleId: 'R', scope: 'brand', appliesTo: 'Natura Casa', type: 'percentage', value: 20, stackable: true }
  assert.ok(validateRule(ok).rule)
  assert.match(validateRule({ ...ok, scope: 'category' }).error, /scope/)
  assert.match(validateRule({ ...ok, value: null }).error, /value/)
  assert.match(validateRule({ ...ok, value: 150 }).error, /100%/)
  assert.match(validateRule({ ...ok, appliesTo: '' }).error, /brand name/)
  assert.match(validateRule({ ...ok, stackable: 'maybe' }).error, /stackable/)
  assert.match(validateRule({ ...ok, minCartValue: 2000 }).error, /only cart rules/)
  assert.equal(validateRule({ ...ok, scope: 'cart', minCartValue: 'Rs.5,000' }).rule.minCartValue, 5000)
})

const PDF_TEXT = `Order #OP-9921  |  Date: 15 Jan 2025

Product          Brand         Platform      Base Price
──────────────────────────────────────────────────────────
Cushion Cover    Natura Casa   Amazon India  Rs.1,299
Bed Sheet Set    Natura Casa   Flipkart      Rs.849
Wall Shelf       LivSpace Pro  Amazon India  Rs.599
Ceramic Vase     LivSpace Pro  Noon          Rs.2,499
Cutting Board    Nordic Basics Amazon India  Rs.449
Desk Organiser   Nordic Basics Flipkart      Rs.899`

test('PDF table rows become the same cart as cart.csv', () => {
  const { data, errors } = rowsToCartItems(PDF_TEXT.split('\n').map(textToWords))
  assert.deepEqual(errors, [])
  assert.deepEqual(data, cart.data)
})

test('malformed PDF rows are skipped and reported, the rest still load', () => {
  const text = PDF_TEXT + `
Table Lamp       Nordic Basics Amazon India  Rs.abc
Floor Rug        Natura Casa                 Rs.999
Total                                        Rs.6,695`
  const { data, errors } = rowsToCartItems(text.split('\n').map(textToWords))
  assert.equal(data.length, 6)
  assert.equal(errors.length, 3)
  assert.match(errors[0], /Row 7 .*base price/)
  assert.match(errors[1], /Row 8 .*missing platform/)
  assert.match(errors[2], /Row 9 .*missing brand, platform/)
})

test('a PDF without the expected header is rejected', () => {
  const { data, errors } = rowsToCartItems(['Invoice', 'Cushion Cover 1299'].map(textToWords))
  assert.equal(data.length, 0)
  assert.match(errors[0], /No cart table found/)
})
