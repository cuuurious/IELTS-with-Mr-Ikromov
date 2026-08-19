// supabase/functions/define-words/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Content-Type": "application/json",
}

function json(
  data: unknown,
  status = 200
) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: corsHeaders,
    }
  )
}

function cleanWord(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}

/*
 * Decode HTML entities returned by translation services.
 *
 * Examples:
 * &#39;  -> '
 * &#x27;  -> '
 * &amp;   -> &
 * &quot;  -> "
 * &lt;    -> <
 * &gt;    -> >
 * &nbsp;  -> space
 */
function decodeHtmlEntities(
  value: string
) {
  let result = String(value || "")

  const namedEntities: Record<
    string,
    string
  > = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&#x27;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&ndash;": "–",
    "&mdash;": "—",
    "&hellip;": "…",
  }

  for (
    const [entity, replacement]
    of Object.entries(namedEntities)
  ) {
    result = result.replace(
      new RegExp(
        entity.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        ),
        "gi"
      ),
      replacement
    )
  }

  /*
   * Decimal entities:
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
        return ""
      }
    }
  )

  /*
   * Hexadecimal entities:
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
        return ""
      }
    }
  )

  return result
    .replace(/\s+/g, " ")
    .trim()
}

function cleanTranslation(
  value: unknown
) {
  if (!value) {
    return null
  }

  let cleaned =
    decodeHtmlEntities(
      String(value)
    )

  /*
   * Some APIs can escape entities more than once.
   */
  if (
    /&(?:#\d+|#x[0-9a-f]+|amp|quot|apos|nbsp|lt|gt);/i.test(
      cleaned
    )
  ) {
    cleaned =
      decodeHtmlEntities(
        cleaned
      )
  }

  cleaned = cleaned
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) {
    return null
  }

  /*
   * Ignore obvious translation-service errors.
   */
  if (
    /no translation found|invalid|must be less|quota|error/i.test(
      cleaned
    )
  ) {
    return null
  }

  return cleaned
}

async function fetchTranslation(
  word: string
) {
  try {
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        word
      )}&langpair=en|uz`

    const response =
      await fetch(url)

    if (!response.ok) {
      console.error(
        `MyMemory returned ${response.status} for "${word}"`
      )

      return null
    }

    const text =
      await response.text()

    if (!text.trim()) {
      console.error(
        `MyMemory returned an empty response for "${word}"`
      )

      return null
    }

    let data: any

    try {
      data = JSON.parse(text)
    } catch {
      console.error(
        `Invalid JSON from MyMemory for "${word}":`,
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
     * If MyMemory simply returned the English input,
     * treat that as a failed translation.
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
 * Process several words concurrently,
 * while keeping the number of simultaneous
 * external API requests under control.
 */
async function mapWithConcurrency<T>(
  items: string[],
  limit: number,
  fn: (item: string) => Promise<T>
) {
  const results =
    new Array<T>(items.length)

  let next = 0

  async function worker() {
    while (true) {
      const index = next++

      if (
        index >= items.length
      ) {
        break
      }

      try {
        results[index] =
          await fn(
            items[index]
          )
      } catch (error) {
        console.error(
          `Failed to process "${items[index]}":`,
          error
        )

        results[index] =
          null as T
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
  word: string
) {
  const translation =
    await fetchTranslation(
      word
    )

  return {
    word,

    /*
     * Definitions are intentionally empty.
     * The generator is translation-only.
     */
    definition: "",

    uzbek_translation:
      translation ||
      "Translation not found — please review this item manually.",

    /*
     * Examples are intentionally empty.
     */
    example_sentence: "",
  }
}

Deno.serve(
  async (req) => {
    /*
     * Browser CORS preflight.
     */
    if (
      req.method === "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          headers:
            corsHeaders,
          status: 200,
        }
      )
    }

    if (
      req.method !== "POST"
    ) {
      return json(
        {
          error:
            "Method not allowed",
        },
        405
      )
    }

    /*
     * Supabase Edge Function environment.
     */
    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL"
      )

    const supabaseAnonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      )

    if (
      !supabaseUrl ||
      !supabaseAnonKey
    ) {
      return json(
        {
          error:
            "Supabase environment variables are missing.",
        },
        500
      )
    }

    /*
     * Require an authenticated Supabase user.
     */
    const authHeader =
      req.headers.get(
        "Authorization"
      ) || ""

    const token =
      authHeader.replace(
        /^Bearer\s+/i,
        ""
      )

    if (!token) {
      return json(
        {
          error:
            "Missing authentication token.",
        },
        401
      )
    }

    const supabase =
      createClient(
        supabaseUrl,
        supabaseAnonKey,
        {
          global: {
            headers: {
              Authorization:
                `Bearer ${token}`,
            },
          },
        }
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
            "Invalid or expired session.",
        },
        401
      )
    }

    /*
     * Read request body.
     */
    let body: any

    try {
      body =
        await req.json()
    } catch {
      return json(
        {
          error:
            "Invalid request body.",
        },
        400
      )
    }

    /*
     * Extract and clean words.
     */
    let words =
      Array.isArray(
        body?.words
      )
        ? body.words
            .map(cleanWord)
            .filter(Boolean)
        : []

    /*
     * Remove duplicates while preserving
     * the teacher's original order.
     */
    const seen =
      new Set<string>()

    words =
      words.filter(
        (word: string) => {
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
            "No words provided.",
        },
        400
      )
    }

    /*
     * Maximum 250 words/collocations.
     */
    if (
      words.length > 250
    ) {
      return json(
        {
          error:
            "Please send 250 words or fewer at a time.",
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
)