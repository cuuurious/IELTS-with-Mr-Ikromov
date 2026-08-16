// netlify/functions/define-words.mjs
//
// Called by the teacher's browser when they upload a plain word list.
// Uses two free, keyless public APIs instead of a paid AI model:
//   - dictionaryapi.dev for English definitions + example sentences
//   - MyMemory for Uzbek translations
// Still requires a valid, logged-in Supabase session, so a random visitor
// can't hammer this endpoint anonymously.

import { createClient } from '@supabase/supabase-js'

async function fetchDefinition(word) {
  try {
    const resp = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    )
    if (!resp.ok) return { definition: null, example: null }
    const data = await resp.json()
    const entry = data[0]
    for (const meaning of entry?.meanings || []) {
      for (const def of meaning.definitions || []) {
        if (def.definition) {
          return {
            definition: def.definition,
            example: def.example || null,
          }
        }
      }
    }
    return { definition: null, example: null }
  } catch {
    return { definition: null, example: null }
  }
}

async function fetchTranslation(word) {
  try {
    const resp = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|uz`
    )
    if (!resp.ok) return null
    const data = await resp.json()
    const translated = data?.responseData?.translatedText
    // MyMemory returns the original text back (or an all-caps warning
    // string) when it can't translate — treat those as "no translation".
    if (!translated || translated.toLowerCase() === word.toLowerCase()) return null
    if (/no translation found|invalid|must be less/i.test(translated)) return null
    return translated
  } catch {
    return null
  }
}

// Runs a limited number of async jobs at once instead of all-at-once, to
// stay polite to the free APIs (which are rate-limited per IP).
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(
      JSON.stringify({ error: 'Server is missing required environment variables.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Require a logged-in Supabase session (any approved account) so this
  // endpoint can't be hit anonymously.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing auth token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid session.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let words
  try {
    const body = await req.json()
    words = (body.words || []).map((w) => String(w).trim()).filter(Boolean)
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (!words.length) {
    return new Response(JSON.stringify({ error: 'No words provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (words.length > 40) {
    return new Response(JSON.stringify({ error: 'Please send 40 words or fewer at a time.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = await mapWithConcurrency(words, 5, async (word) => {
    const [{ definition, example }, translation] = await Promise.all([
      fetchDefinition(word),
      fetchTranslation(word),
    ])
    return {
      word,
      definition: definition || '(No dictionary definition found — edit this manually.)',
      uzbek_translation: translation || '(Translation unavailable — edit this manually.)',
      example_sentence: example || `Try to use "${word}" in your own sentence.`,
    }
  })

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
