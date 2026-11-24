/**
 * App.jsx
 *
 * Top-level component. Holds rules and cart items in state; results are
 * derived from them on every render, so any input change re-runs the engine.
 * Input adapters (src/inputs) turn files/text into rules or cart items.
 */

import { useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import { parseRulesCSV, parseCartCSV } from './inputs/csvParser.js'
import { parseCartPdf } from './inputs/pdfCart.js'
import { processCart, cartTotal, applyCartOffer, formatRs } from './engine/discountEngine.js'

// ── Column definitions ───────────────────────────────────────────

const capitalise = (v) => v.charAt(0).toUpperCase() + v.slice(1)
const nowrap = (v) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span>

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID',    render: nowrap },
  { key: 'scope',     label: 'Scope',      render: capitalise },
  { key: 'appliesTo', label: 'Applies To' },
  { key: 'type',      label: 'Type',       render: capitalise },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `${formatRs(v)} off`,
  },
  {
    key: 'minCartValue',
    label: 'Condition',
    render: (v, row) => row.scope === 'cart' && v > 0 ? `Cart total ≥ ${formatRs(v)}` : '—',
  },
  { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item',       render: nowrap },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: formatRs },
]

function itemStatus(row) {
  if (row.skippedRules.length > 0) return ['Max discount', '#1e5c2c', '#e3f4e7']
  if (row.appliedRules.length > 1) return ['Stacked', '#1a3a8a', '#e6ecfb']
  if (row.appliedRules.length === 1) return ['Discount applied', '#1e5c2c', '#e3f4e7']
  return ['No offer', '#666', '#eee']
}

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item',       render: nowrap },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price',  render: formatRs },
  { key: 'finalPrice',label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        {formatRs(v)}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{formatRs(v)}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v, row) => (
      <span style={{ color: row.totalDiscount > 0 ? '#131A48' : '#888', fontStyle: row.totalDiscount > 0 ? 'normal' : 'italic' }}>
        {v}
      </span>
    ),
  },
  {
    key: 'appliedRules',
    label: 'Status',
    render: (_, row) => {
      const [label, color, bg] = itemStatus(row)
      return <span style={{ ...S.tag(color, bg), whiteSpace: 'nowrap' }}>{label}</span>
    },
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 960, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  hint:    { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: '1.2rem' },
  summary: { marginTop: '0.75rem', borderTop: '2px solid #131A48', paddingTop: '0.5rem' },
  summaryRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: '1rem', padding: '0.35rem 0', fontSize: 13, color: '#131A48',
  },
  offerRow: { background: '#fffbea', margin: '0 -0.5rem', padding: '0.45rem 0.5rem', borderRadius: 4 },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48' },
  nudge:   { fontSize: 12, color: '#b34000', marginTop: '0.4rem', textAlign: 'right' },
  tag: (color, bg) => ({
    display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px',
    borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]           = useState([])
  const [rulesErrors, setRulesErr]  = useState([])
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems]   = useState([])
  const [cartErrors, setCartErrors] = useState([])
  const [cartFileName, setCartFileName]   = useState('')

  const results = cartItems.length > 0 ? processCart(cartItems, rules) : null
  const cart = results && applyCartOffer(cartTotal(results), rules)

  // ── Handlers ──

  async function handleRulesLoad(file) {
    const { data, errors } = parseRulesCSV(await file.text())
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(file.name)
  }

  async function handleCartLoad(file) {
    const isPdf = file.name.toLowerCase().endsWith('.pdf')
    const { data, errors } = isPdf ? await parseCartPdf(file) : parseCartCSV(await file.text())
    if (data.length === 0) {
      const kept = cartItems.length > 0 ? ' Your current cart was kept.' : ''
      setCartErrors([...errors, `No valid items found in ${file.name}.${kept}`])
      return
    }
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(file.name)
  }

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Rules upload */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Discount Rules</div>
          <FileUploader
            label="rules.csv"
            description="Upload your discount rules CSV"
            onLoad={handleRulesLoad}
            hasData={rules.length > 0}
            fileName={rulesFileName}
          />
          <ErrorBanner errors={rulesErrors} />
          {rules.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
              </div>
              <DataTable columns={RULES_COLUMNS} rows={rules} />
            </div>
          )}
        </div>

        {/* Cart upload */}
        <div style={S.section}>
          <div style={S.sectionTitle}>Cart Items</div>
          <FileUploader
            label="cart.csv or cart.pdf"
            description="Upload your cart as CSV or PDF"
            accept=".csv,.pdf"
            onLoad={handleCartLoad}
            hasData={cartItems.length > 0}
            fileName={cartFileName}
          />
          <ErrorBanner errors={cartErrors} />
          {cartItems.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
              </div>
              <DataTable columns={CART_COLUMNS} rows={cartItems} />
            </div>
          )}
        </div>

        {/* Results */}
        {results ? (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />
            <div style={S.summary}>
              {cart.discount > 0 && (
                <>
                  <div style={S.summaryRow}>
                    <span>Cart total before offer</span>
                    <span>{formatRs(cart.subtotal)}</span>
                  </div>
                  <div style={{ ...S.summaryRow, ...S.offerRow }}>
                    <span style={{ fontWeight: 600 }}>{cart.reasoning}</span>
                    <span style={{ fontWeight: 700, color: '#1e5c2c' }}>−{formatRs(cart.discount)}</span>
                  </div>
                </>
              )}
              <div style={S.summaryRow}>
                <span style={S.totalLabel}>{cart.discount > 0 ? 'Final Cart Total' : 'Cart Total'}</span>
                <span style={S.totalValue}>{formatRs(cart.total)}</span>
              </div>
              {cart.nudge && <div style={S.nudge}>{cart.nudge}</div>}
            </div>
          </div>
        ) : (
          <div style={S.hint}>Upload a cart to see final prices</div>
        )}

      </div>
    </div>
  )
}
