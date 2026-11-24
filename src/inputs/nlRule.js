/**
 * nlRule.js
 *
 * Plain-English rule → DiscountRule. The LLM only proposes fields; nothing
 * reaches the engine without passing validateRule and a user confirmation.
 * Returns { rule } or { error, unclear } where unclear means "ask the user
 * for more detail" rather than "something broke".
 */

import { validateRule } from '../engine/validate.js'

const unique = (list) => [...new Set(list)]

export function nextRuleId(rules) {
  const max = rules.reduce((m, r) => Math.max(m, Number(r.ruleId.match(/(\d+)$/)?.[1] ?? 0)), 0)
  return `RULE-${String(max + 1).padStart(2, '0')}`
}

export async function parseRuleText(text, { rules, cartItems }) {
  let res
  try {
    res = await fetch('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        brands: unique(cartItems.map((i) => i.brand)),
        platforms: unique(cartItems.map((i) => i.platform)),
      }),
    })
  } catch {
    return { error: 'Could not reach the rule parser. Check your connection and try again.' }
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body.error ?? `The rule parser failed (HTTP ${res.status}).` }

  if (body.status !== 'ok') {
    return { unclear: true, error: body.reason || "That doesn't describe a specific discount." }
  }

  const { rule, error } = validateRule({
    ...body,
    ruleId: nextRuleId(rules),
    stackable: body.stackable ?? false,
  })
  if (error) return { unclear: true, error: `That couldn't be turned into a valid rule: ${error}.` }
  return { rule }
}
