/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:       string       — e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string       — e.g. "Natura Casa", "Amazon India"; "Entire cart" for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable:    boolean
 *   minCartValue: number       — cart rules only; applies when cart subtotal >= this
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 *
 * CartOfferResult {
 *   subtotal:     number    — sum of item final prices
 *   discount:     number
 *   total:        number    — what the customer pays
 *   appliedRules: string[]
 *   reasoning:    string    — e.g. "Cart offer: 10% off — Rs.593 saved"; empty if none applied
 *   nudge:        string | null — e.g. "Add Rs.68 more to get 10% off your cart"
 * }
 */

export const formatRs = (n) => `Rs.${n.toLocaleString('en-IN')}`

/**
 * Returns true if the rule applies to this cart item.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => s.trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 * Never exceeds the price, so a flat discount can't push a price below zero.
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.min(price, Math.round(price * rule.value / 100))
  }
  if (rule.type === 'flat') {
    return Math.min(price, rule.value)
  }
  return 0
}

const SCOPE_LABELS = { brand: 'Brand', platform: 'Platform', cart: 'Cart' }

function offerText(rule) {
  return rule.type === 'percentage' ? `${rule.value}% off` : `${formatRs(rule.value)} off`
}

/**
 * Builds the customer-facing reasoning string for an applied rule.
 */
function ruleToReasoning(rule) {
  return `${SCOPE_LABELS[rule.scope] ?? 'Special'} offer: ${offerText(rule)}`
}

/**
 * Shared selection logic for items and the cart:
 *   1. Among non-stackable rules, pick the one giving the largest saving on `price`.
 *   2. Apply it, then apply every stackable rule on top of the running price.
 */
function applyRuleSet(price, rules) {
  const ranked = rules
    .filter((r) => !r.stackable)
    .map((rule) => ({ rule, amount: calculateDiscountAmount(price, rule) }))
    .sort((a, b) => b.amount - a.amount)
  const [winner, ...skipped] = ranked

  const toApply = [winner?.rule, ...rules.filter((r) => r.stackable)].filter(Boolean)
  const steps = []
  for (const rule of toApply) {
    const amount = calculateDiscountAmount(price, rule)
    price -= amount
    steps.push({ rule, amount })
  }
  return { price, steps, skipped }
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 */
export function applyDiscounts(item, rules) {
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))
  const { price, steps, skipped } = applyRuleSet(item.basePrice, matchingRules)
  const finalPrice = Math.round(price)

  const reasoningParts = steps.map(({ rule }) => ruleToReasoning(rule))
  if (skipped.length > 0) {
    const [best, runnerUp] = [steps[0], skipped[0]]
    reasoningParts[0] +=
      ` (best deal: saves ${formatRs(best.amount)} vs ${formatRs(runnerUp.amount)}` +
      ` with the ${SCOPE_LABELS[runnerUp.rule.scope].toLowerCase()} offer)`
  }

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: steps.map(({ rule }) => rule.ruleId),
    skippedRules: skipped.map(({ rule }) => rule.ruleId),
    reasoning:
      steps.length > 0
        ? reasoningParts.join(' + ')
        : `No offers available for ${item.brand} on ${item.platform}`,
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all results.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-scope rules to the subtotal of item final prices.
 * Called after processCart, so item-level discounts are already in the subtotal.
 * Returns a CartOfferResult.
 */
export function applyCartOffer(subtotal, rules) {
  const cartRules = rules.filter((r) => r.scope === 'cart')
  const eligible = cartRules.filter((r) => subtotal >= r.minCartValue)
  const { price, steps } = applyRuleSet(subtotal, eligible)
  const total = Math.round(price)

  const nextRule = cartRules
    .filter((r) => subtotal < r.minCartValue)
    .sort((a, b) => a.minCartValue - b.minCartValue)[0]

  return {
    subtotal,
    discount: subtotal - total,
    total,
    appliedRules: steps.map(({ rule }) => rule.ruleId),
    reasoning: steps
      .map(({ rule, amount }) => `${ruleToReasoning(rule)} — ${formatRs(amount)} saved`)
      .join(' + '),
    nudge: nextRule
      ? `Add ${formatRs(nextRule.minCartValue - subtotal)} more to get ${offerText(nextRule)} your cart`
      : null,
  }
}
