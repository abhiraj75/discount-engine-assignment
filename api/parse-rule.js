/**
 * POST /api/parse-rule  { text, brands?, platforms? }
 *
 * Server-side so the Gemini API key never reaches the browser. Returns the
 * model's structured guess as-is; the client validates it before use.
 * Models are tried in order: Gemini often answers 503 under load.
 */

const MODELS = (process.env.GEMINI_MODEL || 'gemini-3.5-flash,gemini-2.5-flash,gemini-3.5-flash-lite').split(',')
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
  required: ['status', 'reason', 'scope', 'appliesTo', 'type', 'value', 'stackable', 'minCartValue'],
}

const instructions = (brands, platforms) => `
You convert one plain-English discount description into a structured rule for an Indian e-commerce checkout.

Fields:
- scope: "brand" (all products of one brand), "platform" (everything sold on one marketplace), or "cart" (the whole cart total).
- appliesTo: the brand or platform name. If it clearly matches a name in the known lists below, use that exact spelling; a name that isn't listed is still valid, keep it as written. null for cart rules.
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
- it describes more than one rule, a condition this engine can't express (a minimum cart value on a brand or platform offer, dates, categories, quantities, per-customer limits), or isn't a discount.
Never guess a number that isn't in the text.
`.trim()

const nameList = (list) =>
  Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.length <= 60).slice(0, 50) : []

export async function parseRule(body, apiKey) {
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return [400, { error: 'Describe the discount rule first.' }]
  if (text.length > MAX_INPUT) return [400, { error: `Keep the description under ${MAX_INPUT} characters.` }]
  if (!apiKey) return [500, { error: 'Rule parsing is not configured on this server (GEMINI_API_KEY is missing).' }]

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: instructions(nameList(body.brands), nameList(body.platforms)) }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  })

  for (const model of MODELS) {
    let res
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(8000),
        body: request,
      })
    } catch {
      console.error(`Gemini ${model}: timed out or unreachable`)
      continue
    }

    if (!res.ok) {
      console.error(`Gemini ${model}: HTTP ${res.status}`, await res.text())
      if (res.status === 404 || res.status === 429 || res.status >= 500) continue
      return [502, { error: `The language model rejected the request (HTTP ${res.status}).` }]
    }

    const data = await res.json()
    const output = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
    try {
      return [200, JSON.parse(output)]
    } catch {
      console.error(`Gemini ${model}: reply was not JSON`, output)
    }
  }

  return [502, { error: 'The language model is busy right now. Try again in a minute.' }]
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const [status, json] = await parseRule(req.body, process.env.GEMINI_API_KEY)
  res.status(status).json(json)
}
