// supabase/functions/translate-ru/index.ts  (2026-11-07)
//
// Russian under every Uzbek translation. The site sends English words
// (with their meaning and Uzbek, so the right sense is picked); words
// already in public.word_ru come straight back, the rest are translated
// ONCE by the AI (same OPENAI_API_KEY as define-words) and stored, so the
// next student gets them instantly.
//
// Deploy: npx supabase functions deploy translate-ru --project-ref grdfwleehlgoooizyowz

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
}
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: cors })
const MODEL = Deno.env.get("OPENAI_TEXT_MODEL") || "gpt-5.6-terra"

// Same as src/lib/russian.js: "12. bankrupt", "• vandalism " → "bankrupt", "vandalism".
export function keyOf(w: string) {
  return String(w || "")
    .replace(/^\s*(?:\d+\s*[.)]|[•·\-–—*])\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“‘(]+|[\s"'”’).,;:!?]+$/g, "")
    .trim()
    .toLowerCase()
    .slice(0, 120)
}

type Item = { word: string; df?: string; uz?: string }

async function translate(items: Item[], apiKey: string): Promise<Record<string, string>> {
  const prompt = [
    "Translate English IELTS vocabulary into Russian for students in Uzbekistan.",
    "For each item give a short, accurate, natural Russian translation (1–4 words; for a phrase or collocation, the matching Russian phrase).",
    "Use the English meaning and the Uzbek translation to choose the right sense. Verbs in the infinitive, nouns in the nominative.",
    "No transliteration, no explanations, no quotation marks.",
    "",
    ...items.map((x, i) => `${i + 1}. ${x.word}${x.df ? ` — meaning: ${x.df.slice(0, 160)}` : ""}${x.uz ? ` — Uzbek: ${x.uz.slice(0, 80)}` : ""}`),
  ].join("\n")
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
      text: {
        format: {
          type: "json_schema",
          name: "ru",
          strict: true,
          schema: {
            type: "object",
            properties: { items: { type: "array", items: { type: "object", properties: { n: { type: "integer" }, ru: { type: "string" } }, required: ["n", "ru"], additionalProperties: false } } },
            required: ["items"],
            additionalProperties: false,
          },
        },
      },
    }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI ${r.status}`)
  let text = j.output_text || ""
  if (!text && Array.isArray(j.output)) for (const o of j.output) for (const c of o?.content || []) if (typeof c?.text === "string") text += c.text
  const parsed = JSON.parse(text || "{}")
  const out: Record<string, string> = {}
  for (const it of parsed.items || []) {
    const src = items[Number(it.n) - 1]
    const ru = String(it.ru || "").trim().replace(/^["«“]|["»”]$/g, "").slice(0, 200)
    if (src && ru && /[а-яё]/i.test(ru)) out[keyOf(src.word)] = ru
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)
  const url = Deno.env.get("SUPABASE_URL")!
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const apiKey = Deno.env.get("OPENAI_API_KEY") || ""
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "Please sign in." }, 401)
  const user = await createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } }).auth.getUser()
  if (user.error || !user.data?.user) return json({ error: "Please sign in." }, 401)

  let body: { words?: Item[] } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: "Bad request" }, 400)
  }
  const seen = new Set<string>()
  const items = (Array.isArray(body.words) ? body.words : [])
    .map((x) => ({ word: String(x?.word || "").slice(0, 120), df: String(x?.df || "").slice(0, 300), uz: String(x?.uz || "").slice(0, 200) }))
    .filter((x) => {
      const k = keyOf(x.word)
      if (!k || seen.has(k) || !/[a-z]/.test(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 80)
  if (!items.length) return json({ ru: {} })

  const admin = createClient(url, service)
  const keys = items.map((x) => keyOf(x.word))
  const { data: have } = await admin.from("word_ru").select("word, ru").in("word", keys)
  const ru: Record<string, string> = {}
  for (const r of have || []) ru[r.word] = r.ru
  const missing = items.filter((x) => !ru[keyOf(x.word)])
  if (missing.length && apiKey) {
    try {
      for (let i = 0; i < missing.length; i += 40) {
        const got = await translate(missing.slice(i, i + 40), apiKey)
        const rows = Object.entries(got).map(([word, t]) => ({ word, ru: t }))
        if (rows.length) await admin.from("word_ru").upsert(rows, { onConflict: "word", ignoreDuplicates: true })
        Object.assign(ru, got)
      }
    } catch (e) {
      console.error("translate-ru:", e)
    }
  }
  return json({ ru })
})
