import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/inputs/csvParser.js'
import { processCart, cartTotal, applyCartOffer, applyDiscounts } from '../src/engine/discountEngine.js'
import { validateRule } from '../src/engine/validate.js'

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
