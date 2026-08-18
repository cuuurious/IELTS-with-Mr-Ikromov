// netlify/functions/define-words.mjs
//
// Free vocabulary enrichment pipeline:
//
// 1. DictionaryAPI     -> definitions/examples for normal words
// 2. Wiktionary REST   -> definitions/examples for phrases/collocations
// 3. Datamuse          -> additional phrase/definition fallback
// 4. MyMemory          -> English -> Uzbek translation
//
// No paid AI API is required.
//
// The function keeps the same response format expected by
// TeacherWordlists.jsx:
//
// {
//   word,
//   definition,
//   uzbek_translation,
//   example_sentence
// }

import { createClient } from '@supabase/supabase-js'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  })
}

function cleanWord(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isPhrase(word) {
  return word.split(' ').filter(Boolean).length > 1
}

function cleanWiktionaryHtml(value) {
  if (!value) return null

  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanExample(value) {
  if (!value) return null

  return cleanWiktionaryHtml(value)
}

async function fetchDictionaryDefinition(word) {
  try {
    const url =
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(
        word
      )}`

    const resp = await fetch(url)

    if (!resp.ok) {
      return null
    }

    const data = await resp.json()

    const entry = data?.[0]

    if (!entry) {
      return null
    }

    for (const meaning of entry.meanings || []) {
      for (const definition of meaning.definitions || []) {
        if (definition.definition) {
          return {
            definition: definition.definition.trim(),
            example: definition.example || null,
            source: 'dictionaryapi',
            partOfSpeech:
              meaning.partOfSpeech || null,
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error(
      `DictionaryAPI failed for "${word}":`,
      error
    )

    return null
  }
}

async function fetchWiktionaryDefinition(word) {
  try {
    /*
     * Wiktionary REST expects underscores for spaces.
     *
     * Example:
     * take into account
     * ->
     * take_into_account
     */
    const page = word.replace(/\s+/g, '_')

    const url =
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(
        page
      )}`

    const resp = await fetch(url)

    if (!resp.ok) {
      return null
    }

    const data = await resp.json()

    const englishEntries = data?.en || []

    for (const entry of englishEntries) {
      for (const definition of entry.definitions || []) {
        const text = cleanWiktionaryHtml(
          definition.definition
        )

        if (!text) continue

        let example = null

        if (
          definition.examples &&
          definition.examples.length
        ) {
          example = cleanExample(
            definition.examples[0]
          )
        } else if (
          definition.parsedExamples &&
          definition.parsedExamples.length
        ) {
          example = cleanExample(
            definition.parsedExamples[0]?.example
          )
        }

        return {
          definition: text,
          example,
          source: 'wiktionary',
          partOfSpeech:
            entry.partOfSpeech || null,
        }
      }
    }

    return null
  } catch (error) {
    console.error(
      `Wiktionary failed for "${word}":`,
      error
    )

    return null
  }
}

async function fetchDatamuseDefinition(word) {
  try {
    const url =
      `https://api.datamuse.com/words?sp=${encodeURIComponent(
        word
      )}&md=d&max=5`

    const resp = await fetch(url)

    if (!resp.ok) {
      return null
    }

    const data = await resp.json()

    const exact =
      data.find(
        (item) =>
          item.word?.toLowerCase() ===
          word.toLowerCase()
      ) || data[0]

    const rawDefinition =
      exact?.defs?.[0]

    if (!rawDefinition) {
      return null
    }

    /*
     * Datamuse definitions often start with a part-of-speech
     * marker such as:
     *
     * v\tTo consider...
     *
     * Remove that marker.
     */
    const definition =
      rawDefinition
        .replace(
          /^[a-z]+\s*\t/i,
          ''
        )
        .replace(/\s+/g, ' ')
        .trim()

    if (!definition) {
      return null
    }

    return {
      definition,
      example: null,
      source: 'datamuse',
      partOfSpeech: null,
    }
  } catch (error) {
    console.error(
      `Datamuse failed for "${word}":`,
      error
    )

    return null
  }
}

async function fetchTranslation(word) {
  try {
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        word
      )}&langpair=en|uz`

    const resp = await fetch(url)

    if (!resp.ok) {
      return null
    }

    const data = await resp.json()

    const translated =
      data?.responseData?.translatedText

    if (!translated) {
      return null
    }

    const cleaned = translated
      .replace(/\s+/g, ' ')
      .trim()

    if (!cleaned) {
      return null
    }

    /*
     * MyMemory sometimes returns the original text
     * when it cannot translate it.
     */
    if (
      cleaned.toLowerCase() ===
      word.toLowerCase()
    ) {
      return null
    }

    /*
     * Ignore obvious failure messages.
     */
    if (
      /no translation found|invalid|must be less|quota/i.test(
        cleaned
      )
    ) {
      return null
    }

    return cleaned
  } catch (error) {
    console.error(
      `Translation failed for "${word}":`,
      error
    )

    return null
  }
}

async function enrichWord(word) {
  const phrase = isPhrase(word)

  let dictionary = null
  let wiktionary = null
  let datamuse = null

  /*
   * Single words:
   * DictionaryAPI is the best first source.
   */
  if (!phrase) {
    dictionary =
      await fetchDictionaryDefinition(word)

    /*
     * If DictionaryAPI doesn't know the word,
     * try Wiktionary.
     */
    if (!dictionary) {
      wiktionary =
        await fetchWiktionaryDefinition(word)
    }

    /*
     * Final free definition fallback.
     */
    if (!dictionary && !wiktionary) {
      datamuse =
        await fetchDatamuseDefinition(word)
    }
  } else {
    /*
     * Phrases/collocations:
     * DictionaryAPI usually cannot handle them.
     * Start with Wiktionary.
     */
    wiktionary =
      await fetchWiktionaryDefinition(word)

    /*
     * Datamuse sometimes has useful phrase definitions.
     */
    if (!wiktionary) {
      datamuse =
        await fetchDatamuseDefinition(word)
    }

    /*
     * Some phrases may actually exist in DictionaryAPI,
     * so give it a final chance.
     */
    if (!wiktionary && !datamuse) {
      dictionary =
        await fetchDictionaryDefinition(word)
    }
  }

  const result =
    dictionary ||
    wiktionary ||
    datamuse

  /*
   * Translation can be requested independently.
   */
  const translation =
    await fetchTranslation(word)

  const definition =
    result?.definition ||
    'Definition not found — please review this item manually.'

  const example =
    result?.example ||
    `Try to use "${word}" in your own sentence.`

  return {
    word,
    definition,
    uzbek_translation:
      translation ||
      'Translation not found — please review this item manually.',
    example_sentence: example,
    source:
      result?.source || 'manual-review',
    part_of_speech:
      result?.partOfSpeech || null,
  }
}

/*
 * Limit concurrent requests.
 *
 * This is important because each word can make several
 * free API requests.
 */
async function mapWithConcurrency(
  items,
  limit,
  fn
) {
  const results = new Array(items.length)

  let next = 0

  async function worker() {
    while (true) {
      const index = next++

      if (index >= items.length) {
        break
      }

      results[index] =
        await fn(items[index], index)
    }
  }

  const workers = Array.from(
    {
      length: Math.min(
        limit,
        items.length
      ),
    },
    () => worker()
  )

  await Promise.all(workers)

  return results
}

export default async function handler(
  req
) {
  if (req.method !== 'POST') {
    return new Response(
      'Method not allowed',
      {
        status: 405,
      }
    )
  }

  const supabaseUrl =
    process.env.VITE_SUPABASE_URL

  const supabaseAnonKey =
    process.env.VITE_SUPABASE_ANON_KEY

  if (
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    return json(
      {
        error:
          'Server is missing required environment variables.',
      },
      500
    )
  }

  /*
   * Require an authenticated Supabase user.
   */
  const authHeader =
    req.headers.get(
      'authorization'
    ) || ''

  const token =
    authHeader.replace(
      /^Bearer\s+/i,
      ''
    )

  if (!token) {
    return json(
      {
        error:
          'Missing auth token.',
      },
      401
    )
  }

  const supabase =
    createClient(
      supabaseUrl,
      supabaseAnonKey
    )

  const {
    data: userData,
    error: userError,
  } =
    await supabase.auth.getUser(
      token
    )

  if (
    userError ||
    !userData?.user
  ) {
    return json(
      {
        error:
          'Invalid session.',
      },
      401
    )
  }

  let words

  try {
    const body =
      await req.json()

    words = Array.isArray(
      body?.words
    )
      ? body.words
          .map(cleanWord)
          .filter(Boolean)
      : []
  } catch {
    return json(
      {
        error:
          'Invalid request body.',
      },
      400
    )
  }

  /*
   * Remove duplicate words while preserving
   * the teacher's original order.
   */
  const seen =
    new Set()

  words = words.filter(
    (word) => {
      const key =
        word.toLowerCase()

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    }
  )

  if (!words.length) {
    return json(
      {
        error:
          'No words provided.',
      },
      400
    )
  }

  if (words.length > 40) {
    return json(
      {
        error:
          'Please send 40 words or fewer at a time.',
      },
      400
    )
  }

  /*
   * Five words at a time keeps the free public APIs
   * from being hit too aggressively.
   */
  const results =
    await mapWithConcurrency(
      words,
      5,
      enrichWord
    )

  return json({
    results,
  })
}