/**
 * validate.js
 *
 * The single gate every input path (CSV, PDF, natural language) goes through
 * before data reaches the engine. Takes loosely-typed raw objects, returns
 * { rule } / { item } on success or { error } with a readable reason.
 */

const SCOPES = ['brand', 'platform', 'cart']
const TYPES = ['percentage', 'flat']

const text = (v) => (v === undefined || v === null ? '' : String(v).trim())

export function parseAmount(v) {
  const cleaned = text(v).replace(/^(rs\.?|inr|₹)\s*/i, '').replace(/,/g, '')
  return cleaned === '' ? NaN : Math.round(Number(cleaned) * 100) / 100
}

function parseBoolean(v) {
  if (typeof v === 'boolean') return v
  const s = text(v).toLowerCase()
  if (['true', 'yes', '1'].includes(s)) return true
  if (['false', 'no', '0'].includes(s)) return false
  return null
}

export function validateRule(raw) {
  const ruleId = text(raw.ruleId)
  const scope = text(raw.scope).toLowerCase()
  const type = text(raw.type).toLowerCase()
  const appliesTo = text(raw.appliesTo)
  const value = parseAmount(raw.value)
  const stackable = parseBoolean(raw.stackable)
  const hasMin = text(raw.minCartValue) !== ''
  const minCartValue = hasMin ? parseAmount(raw.minCartValue) : 0

  if (!ruleId) return { error: 'rule ID is missing' }
  if (!SCOPES.includes(scope)) return { error: `scope must be brand, platform or cart, got "${text(raw.scope)}"` }
  if (!TYPES.includes(type)) return { error: `type must be percentage or flat, got "${text(raw.type)}"` }
  if (!Number.isFinite(value) || value <= 0) return { error: `value must be a positive number, got "${text(raw.value)}"` }
  if (type === 'percentage' && value > 100) return { error: `a percentage discount can't exceed 100%, got ${value}%` }
  if (stackable === null) return { error: `stackable must be true or false, got "${text(raw.stackable)}"` }
  if (scope !== 'cart' && !appliesTo) return { error: `a ${scope} rule needs the ${scope} name it applies to` }
  if (!Number.isFinite(minCartValue) || minCartValue < 0) {
    return { error: `minimum cart value must be a non-negative number, got "${text(raw.minCartValue)}"` }
  }
  if (scope !== 'cart' && hasMin && minCartValue > 0) return { error: 'only cart rules can have a minimum cart value' }

  const rule = { ruleId, scope, appliesTo: scope === 'cart' ? 'Entire cart' : appliesTo, type, value, stackable }
  if (scope === 'cart') rule.minCartValue = minCartValue
  return { rule }
}

export function validateCartItem(raw) {
  const item = {
    itemId: text(raw.itemId),
    product: text(raw.product),
    brand: text(raw.brand),
    platform: text(raw.platform),
  }
  const missing = Object.keys(item).filter((k) => !item[k])
  if (missing.length > 0) return { error: `missing ${missing.join(', ')}` }

  const basePrice = parseAmount(raw.basePrice)
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return { error: `base price must be a positive number, got "${text(raw.basePrice)}"` }
  }
  return { item: { ...item, basePrice: Math.round(basePrice) } }
}
