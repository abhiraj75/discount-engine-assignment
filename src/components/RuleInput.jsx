/**
 * RuleInput.jsx
 *
 * Text field → parsed rule → confirm / discard. Only confirmed rules are
 * passed to onAdd.
 */

import { useState } from 'react'
import { parseRuleText } from '../inputs/nlRule.js'
import { formatRs } from '../engine/discountEngine.js'
import ErrorBanner from './ErrorBanner.jsx'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
  'Give a discount for big orders',
]

const S = {
  row:     { display: 'flex', gap: '0.5rem' },
  input:   { flex: 1, padding: '0.55rem 0.7rem', fontSize: 13, border: '1px solid #CECECE', borderRadius: 4, fontFamily: 'inherit' },
  btn:     { background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4, padding: '0.55rem 1.2rem', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.04em' },
  ghost:   { background: '#fff', color: '#131A48', border: '1px solid #CECECE', borderRadius: 4, padding: '0.5rem 1.1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  examples:{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' },
  chip:    { background: '#f3f4f8', border: '1px solid #e1e3ec', borderRadius: 20, padding: '2px 10px', fontSize: 11, color: '#131A48', cursor: 'pointer' },
  card:    { marginTop: '0.8rem', border: '1px solid #131A48', borderRadius: 6, padding: '0.8rem 1rem', background: '#f8f9fd' },
  fields:  { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.25rem 1rem', fontSize: 13, color: '#131A48', margin: '0.5rem 0' },
  label:   { color: '#666' },
  note:    { fontSize: 12, color: '#555', marginTop: '0.3rem' },
  warn:    { fontSize: 12, color: '#b34000', marginTop: '0.3rem' },
  unclear: { marginTop: '0.6rem', background: '#fff8e6', border: '1px solid #f0c36d', borderLeft: '3px solid #e09b00', borderRadius: 4, padding: '0.6rem 0.9rem', fontSize: 12, color: '#5a3d00' },
}

function ruleFields(rule) {
  const fields = [
    ['Scope', rule.scope.charAt(0).toUpperCase() + rule.scope.slice(1)],
    ['Applies to', rule.appliesTo],
    ['Type', rule.type === 'percentage' ? 'Percentage' : 'Flat'],
    ['Value', rule.type === 'percentage' ? `${rule.value}%` : formatRs(rule.value)],
    ['Stackable', rule.stackable ? 'Yes' : 'No'],
  ]
  if (rule.scope === 'cart') fields.push(['Min cart value', rule.minCartValue > 0 ? formatRs(rule.minCartValue) : 'No minimum'])
  return fields
}

export default function RuleInput({ rules, cartItems, onAdd }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState(null)
  const [problem, setProblem] = useState(null)

  async function handleParse(e) {
    e.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setDraft(null)
    setProblem(null)
    const result = await parseRuleText(text, { rules, cartItems })
    setBusy(false)
    if (result.rule) setDraft(result.rule)
    else setProblem(result)
  }

  function handleConfirm() {
    onAdd(draft)
    setDraft(null)
    setText('')
  }

  const matchesCart =
    !draft || draft.scope === 'cart' || cartItems.length === 0 ||
    cartItems.some((i) => i[draft.scope].toLowerCase() === draft.appliesTo.toLowerCase())

  return (
    <div>
      <form style={S.row} onSubmit={handleParse}>
        <input
          style={S.input}
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "15% off all Flipkart items"'
          aria-label="Describe a discount rule"
        />
        <button type="submit" style={{ ...S.btn, opacity: busy || !text.trim() ? 0.6 : 1 }} disabled={busy || !text.trim()}>
          {busy ? 'Reading…' : 'Parse rule'}
        </button>
      </form>
      <div style={S.examples}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" style={S.chip} onClick={() => setText(ex)}>{ex}</button>
        ))}
      </div>

      {problem?.unclear && (
        <div style={S.unclear}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Need a bit more detail</div>
          {problem.error} Try something like "10% off Natura Casa" or "Rs.200 off carts above Rs.3,000".
        </div>
      )}
      {problem && !problem.unclear && <ErrorBanner errors={[problem.error]} />}

      {draft && (
        <div style={S.card}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>Add this rule as {draft.ruleId}?</div>
          <div style={S.fields}>
            {ruleFields(draft).map(([label, value]) => (
              <div key={label} style={{ display: 'contents' }}>
                <span style={S.label}>{label}</span>
                <span style={{ fontWeight: 600 }}>{value}</span>
              </div>
            ))}
          </div>
          {draft.scope === 'cart' && (
            <div style={S.note}>
              {draft.minCartValue > 0
                ? `Applies when the cart total after item discounts is ${formatRs(draft.minCartValue)} or more.`
                : 'Applies to every cart, after item discounts.'}
            </div>
          )}
          {!matchesCart && (
            <div style={S.warn}>
              No item in the current cart is from {draft.scope} "{draft.appliesTo}", so this rule won't change any price yet.
            </div>
          )}
          <div style={{ ...S.row, marginTop: '0.7rem' }}>
            <button type="button" style={S.btn} onClick={handleConfirm}>Confirm &amp; apply</button>
            <button type="button" style={S.ghost} onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
