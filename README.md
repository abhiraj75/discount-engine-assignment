# Opptra Discount Engine

A checkout pricing engine. For each cart item it picks the offer that saves the customer the most, stacks any stackable offers on top, applies cart-level offers to the total, and explains the result in plain language.

**Live:** _URL added after deploy_

## Run locally

1. `npm install`
2. `cp .env.example .env` and set `GEMINI_API_KEY` (only needed for plain-English rules)
3. `npm run dev` and open http://localhost:5173

Run the tests with `npm test`.

## How to use

1. Upload `sample-data/rules.csv`.
2. Upload a cart: `sample-data/cart.csv` or `sample-data/cart.pdf`. Prices update on every change; there is no Calculate button.
3. Type a rule in plain English (or click an example), check the parsed fields, then confirm or discard it.

`sample-data/cart-malformed.pdf` shows how bad rows are handled.

## Expected results (sample data)

| Item | Base | Applied | Final |
|---|---|---|---|
| ITEM-01 | Rs.1,299 | RULE-01 wins (Rs.195 > Rs.150) | Rs.1,104 |
| ITEM-02 | Rs.849 | RULE-02 + RULE-03 stacked | Rs.629 |
| ITEM-03 | Rs.599 | RULE-01 | Rs.509 |
| ITEM-04 | Rs.2,499 | No offers | Rs.2,499 |
| ITEM-05 | Rs.449 | RULE-01 | Rs.382 |
| ITEM-06 | Rs.899 | RULE-03 | Rs.809 |
| Cart | Rs.5,932 | RULE-04: 10% off, Rs.593 saved | **Rs.5,339** |

## Structure

```
api/parse-rule.js       Serverless function that calls Gemini (keeps the API key off the client)
src/engine/
  discountEngine.js     Pure pricing logic: item offers, stacking, cart offer
  validate.js           The single check every input passes before reaching the engine
src/inputs/
  csvParser.js          CSV  → rules / cart items
  pdfCart.js            PDF  → cart items
  nlRule.js             Text → rule (via /api/parse-rule)
src/components/         UI
test/engine.test.js     node:test suite
```

Each input adapter returns `{ data, errors }` and goes through `validate.js`. To add another input mode, add a file in `src/inputs/`; the engine stays the same. The only engine change for these tasks was adding the `cart` scope.

## Decisions and tradeoffs

**A small backend for the LLM.** The brief says to add a server only if PDF parsing needs one. I disagree for the LLM call: an API key in a static bundle is public. `api/parse-rule.js` is a single Vercel function, and PDF parsing still runs in the browser. During `npm run dev`, the same handler is mounted as Vite middleware.

**LLM output is never trusted.** Gemini must answer in a fixed JSON schema. Its answer is then checked by `validateRule`, the same validator the CSV path uses. Only after that does the user see a confirmation card. Invalid output (e.g. 150% off) and vague input ("Give a discount for big orders") both show a "need a bit more detail" message saying what's missing; neither crashes. The model is told never to invent numbers and to return `unresolvable` instead.

**I kept the confirmation step.** A misread rule changes every price in the cart, so one click to confirm is worth it. The card also warns when a brand or platform matches nothing in the current cart, which catches typos.

**"More than Rs.5,000" is treated as "Rs.5,000 or more".** The engine's condition is `≥`, as the brief specifies. The confirmation card says "applies when the cart total after item discounts is Rs.5,000 or more" so the merchant sees exactly what they are approving.

**Cart offers.** The threshold is checked against the sum of item final prices, and the discount applies to that sum. If the cart is just below the threshold, there is no offer row. Instead, a nudge appears: "Add Rs.1 more to get 10% off your cart". When several cart offers qualify, they follow the same rule as items: the biggest non-stackable saving wins, and stackable offers apply on top.

**The PDF parser is deterministic, not LLM-based.** A price shouldn't depend on how a model reads a document. Each word is assigned to a column by its x-position under the header row. This handles drawn tables and also monospaced text, where a long value like "Nordic Basics" leaves only one space before the next column, so splitting on whitespace would fail. Header order doesn't matter, and item IDs (`ITEM-01`…) are generated because the PDF has none.

**Malformed rows are skipped and listed with the reason** (e.g. `Row 7 ("Table Lamp … Rs.abc"): base price must be a positive number — skipped`); the valid rows still load. If a file has no valid rows at all, the current cart is kept, for CSV and PDF alike. A scanned PDF with no text layer gets a clear message, since OCR is out of scope.

**Fixes to the base engine:**
- A flat discount larger than the price is capped at the price; before, the final price could go negative.
- The reasoning text now says why one offer beat another ("best deal: saves Rs.195 vs Rs.150 with the brand offer").
- An item with no offers says which brand and platform had none ("No offers available for LivSpace Pro on Noon").

**Rounding.** Each discount is rounded to the nearest rupee as it is applied, which matches the expected table (Rs.593.2 → Rs.593).

**Known limits:**
- `/api/parse-rule` has no rate limiting. Input is capped at 300 characters.
- In a PDF, a cell that wraps onto a second line is reported as a bad row.
- Uploading a new rules CSV replaces any rules added in plain English.
- The model defaults to `gemini-flash-latest`; set `GEMINI_MODEL` to pin a specific one.

## Input formats

**rules.csv**: `rule_id, scope (brand|platform|cart), applies_to, type (percentage|flat), value, stackable, min_cart_value`. `min_cart_value` applies to cart rules only; leave `applies_to` empty for those.

**cart.csv**: `item_id, product, brand, platform, base_price`

**cart.pdf**: a table with the columns Product, Brand, Platform and Base Price. Prices can be written like `Rs.1,299`.
