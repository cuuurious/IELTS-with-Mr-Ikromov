// netlify/functions/define-words.mjs
//
// Translation-only vocabulary generation.
//
// Input:
// {
//   words: ["abandon", "take into account", ...]
// }
//
// Output:
// {
//   results: [
//     {
//       word,
//       definition: "",
//       uzbek_translation,
//       example_sentence: ""
//     }
//   ]
// }
//
// The definition/example fields are kept empty for compatibility
// with the existing database schema and older wordlists.

import { createClient } from '@supabase/supabase-js'

const JSON_HEADERS = {
  'Content-Type': 'application/json',
}

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: JSON_HEADERS,
    }
  )
}

function cleanWord(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/*
 * Decode HTML entities returned by translation services.
 *
 * Examples:
 *
 * &#39;   -> '
 * &#x27;   -> '
 * &amp;    -> &
 * &quot;   -> "
 * &lt;     -> <
 * &gt;     -> >
 * &nbsp;   -> space
 */
function decodeHtmlEntities(value) {
  if (!value) return ''

  let result = String(value)

  const namedEntities = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&#x27;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&ndash;': '–',
    '&mdash;': '—',
    '&hellip;': '…',
  }

  Object.entries(
    namedEntities
  ).forEach(
    ([entity, replacement]) => {
      result = result.replace(
        new RegExp(
          entity.replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
          ),
          'gi'
        ),
        replacement
      )
    }
  )

  /*
   * Decimal numeric entities:
   * &#39;
   * &#160;
   */
  result = result.replace(
    /&#(\d+);/g,
    (_, decimal) => {
      const codePoint =
        Number(decimal)

      try {
        return String.fromCodePoint(
          codePoint
        )
      } catch {
        return ''
      }
    }
  )

  /*
   * Hexadecimal numeric entities:
   * &#x27;
   * &#x2019;
   */
  result = result.replace(
    /&#x([0-9a-f]+);/gi,
    (_, hexadecimal) => {
      const codePoint =
        parseInt(
          hexadecimal,
          16
        )

      try {
        return String.fromCodePoint(
          codePoint
        )
      } catch {
        return ''
      }
    }
  )

  return result
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanTranslation(value) {
  if (!value) return null

  let cleaned =
    decodeHtmlEntities(value)

  /*
   * Some APIs can return escaped entities more than once.
   * Decode a second time if necessary.
   */
  if (
    /&(?:#\d+|#x[0-9a-f]+|amp|quot|apos|nbsp|lt|gt);/i.test(
      cleaned
    )
  ) {
    cleaned =
      decodeHtmlEntities(cleaned)
  }

  cleaned = cleaned
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return null
  }

  /*
   * MyMemory can return the original English word when
   * it cannot find a translation.
   */
  return cleaned
}

async function fetchTranslation(word) {
  try {
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        word
      )}&langpair=en|uz`

    const resp =
      await fetch(url)

    /*
     * Handle rate limits / server failures gracefully.
     */
    if (!resp.ok) {
      console.error(
        `MyMemory returned ${resp.status} for "${word}"`
      )

      return null
    }

    const text =
      await resp.text()

    if (!text.trim()) {
      console.error(
        `MyMemory returned an empty response for "${word}"`
      )

      return null
    }

    let data

    try {
      data =
        JSON.parse(text)
    } catch (error) {
      console.error(
        `MyMemory returned invalid JSON for "${word}":`,
        text.slice(0, 500)
      )

      return null
    }

    const translated =
      data?.responseData
        ?.translatedText

    if (!translated) {
      return null
    }

    const cleaned =
      cleanTranslation(
        translated
      )

    if (!cleaned) {
      return null
    }

    /*
     * Ignore obvious failure messages.
     */
    if (
      /no translation found|invalid|must be less|quota|error/i.test(
        cleaned
      )
    ) {
      return null
    }

    /*
     * MyMemory sometimes returns the English input unchanged.
     */
    if (
      cleaned.toLowerCase() ===
      word.toLowerCase()
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

/*
 * Limit simultaneous requests.
 *
 * Five at a time is deliberately conservative because
 * MyMemory is a free public translation API.
 */
async function mapWithConcurrency(
  items,
  limit,
  fn
) {
  const results =
    new Array(items.length)

  let next = 0

  async function worker() {
    while (true) {
      const index = next++

      if (
        index >=
        items.length
      ) {
        break
      }

      try {
        results[index] =
          await fn(
            items[index],
            index
          )
      } catch (error) {
        console.error(
          `Worker failed for item ${index}:`,
          error
        )

        results[index] =
          null
      }
    }
  }

  const workerCount =
    Math.min(
      limit,
      items.length
    )

  const workers =
    Array.from(
      {
        length:
          workerCount,
      },
      () => worker()
    )

  await Promise.all(
    workers
  )

  return results
}

async function enrichWord(
  word
) {
  const translation =
    await fetchTranslation(
      word
    )

  return {
    word,

    /*
     * Kept empty intentionally.
     * The new generator only needs translations.
     */
    definition: '',

    uzbek_translation:
      translation ||
      'Translation not found — please review this item manually.',

    /*
     * Kept empty intentionally.
     */
    example_sentence: '',
  }
}

export default async function handler(
  req
) {
  if (
    req.method !== 'POST'
  ) {
    return json(
      {
        error:
          'Method not allowed',
      },
      405
    )
  }

  const supabaseUrl =
    process.env
      .VITE_SUPABASE_URL

  const supabaseAnonKey =
    process.env
      .VITE_SUPABASE_ANON_KEY

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

    words =
      Array.isArray(
        body?.words
      )
        ? body.words
            .map(cleanWord)
            .filter(Boolean)
        : []
  } catch (error) {
    return json(
      {
        error:
          'Invalid request body.',
      },
      400
    )
  }

  /*
   * Remove duplicates while preserving
   * the teacher's original order.
   */
  const seen =
    new Set()

  words =
    words.filter(
      (word) => {
        const key =
          word.toLowerCase()

        if (
          seen.has(key)
        ) {
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

  /*
   * New maximum:
   * 250 words/collocations.
   */
  if (
    words.length > 250
  ) {
    return json(
      {
        error:
          'Please send 250 words or fewer at a time.',
      },
      400
    )
  }

  /*
   * Translation only.
   *
   * No DictionaryAPI.
   * No Wiktionary.
   * No Datamuse.
   *
   * This makes the generator much faster and avoids
   * unnecessary external requests.
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