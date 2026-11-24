import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { parseRule } from './api/parse-rule.js'

// Serves /api/parse-rule during `npm run dev`; Vercel serves api/ in production.
const devApi = (env) => ({
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api/parse-rule', async (req, res) => {
      let raw = ''
      for await (const chunk of req) raw += chunk
      let body = {}
      try { body = JSON.parse(raw) } catch {}
      const [status, json] = await parseRule(body, env.GEMINI_API_KEY)
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(json))
    })
  },
})

export default defineConfig(({ mode }) => ({
  plugins: [react(), devApi(loadEnv(mode, process.cwd(), ''))],
}))
