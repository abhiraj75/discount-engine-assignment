/**
 * POST /api/parse-rule  { text, brands?, platforms? }
 *
 * Server-side so the Gemini API key never reaches the browser. Returns the
 * model's structured guess as-is; the client validates it before use.
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest'
const MAX_INPUT = 300

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['ok', 'unresolvable'] },
    reason: { type: 'STRING', nullable: true },
    scope: { type: 'STRING', enum: ['brand', 'platform', 'cart'], nullable: true },
    appliesTo: { type: 'STRING', nullable: true },
    type: { type: 'STRING', enum: ['percentage', 'flat'], nullable: true },
    value: { type: 'NUMBER', nullable: true },
    stackable: { type: 'BOOLEAN', nullable: true },
    minCartValue: { type: 'NUMBER', nullable: true },
  },
  required: ['status'],
}

const instructions = (brands, platforms) => `
You convert one plain-English discount description into a structured rule for an Indian e-commerce checkout.

Fields:
- scope: "brand" (all products of one brand), "platform" (everything sold on one marketplace), or "cart" (the whole cart total).
- appliesTo: the brand or platform name. Use the exact spelling from the known lists below when it clearly matches. null for cart rules.
- type: "percentage" or "flat" (a rupee amount).
- value: the number only. "20%" -> 20, "Rs.100" / "₹100" / "100 rupees" -> 100.
- stackable: true only if the text says the offer combines/stacks with other offers, otherwise false.
- minCartValue: cart rules only, the minimum cart total in rupees. "more than Rs.5,000" or "above 5k" -> 5000. null otherwise.

Known brands: ${brands.join(', ') || 'none'}
Known platforms: ${platforms.join(', ') || 'none'}

Return status "unresolvable" with a short reason addressed to the user (what detail to add) when:
- no discount amount is given,
- a brand/platform offer doesn't say which brand or platform,
- it implies a threshold ("big orders", "bulk") without a number,
- it describes more than one rule, a condition this engine can't express (dates, categories, quantities, per-customer limits), or isn't a discount.
Never guess a number that isn't in the text.
`.trim()

const nameList = (list) =>
  Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.length <= 60).slice(0, 50) : []

export async function parseRule(body, apiKey) {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return [400, { error: 'Describe the discount rule first.' }]
  if (text.length > MAX_INPUT) return [400, { error: `Keep the description under ${MAX_INPUT} characters.` }]
  if (!apiKey) return [500, { error: 'Rule parsing is not configured on this server (GEMINI_API_KEY is missing).' }]

  let res
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions(nameList(body.brands), nameList(body.platforms)) }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    })
  } catch {
    return [502, { error: 'Could not reach the language model. Try again in a moment.' }]
  }

  if (!res.ok) {
    console.error('Gemini error', res.status, await res.text())
    const busy = res.status === 429 || res.status === 503
    return [502, { error: busy ? 'The language model is busy right now. Try again in a minute.' : `The language model returned an error (${res.status}).` }]
  }

  const data = await res.json()
  const output = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  try {
    return [200, JSON.parse(output)]
  } catch {
    return [502, { error: "The language model's reply wasn't a rule. Try rephrasing." }]
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const [status, json] = await parseRule(req.body, process.env.GEMINI_API_KEY)
  res.status(status).json(json)
}
