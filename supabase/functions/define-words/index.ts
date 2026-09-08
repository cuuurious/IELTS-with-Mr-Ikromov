// supabase/functions/define-words/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

/*
 * ============================================================
 * DEFINE WORDS EDGE FUNCTION
 * ============================================================
 *
 * FLOW:
 *
 * 1. Every submitted item is checked against Merriam-Webster.
 *
 * 2. If Merriam-Webster finds the item:
 *    - use its definition
 *    - use its example sentence when available
 *    - do NOT send that item to AI
 *
 * 3. If Merriam-Webster cannot find the item:
 *    - it is likely a phrase/collocation/multi-word expression
 *    - send ONLY that item to OpenAI
 *
 * 4. Uzbek translations are fetched independently.
 *
 * This keeps dictionary words dictionary-based and reserves AI for
 * phrases/collocations that do not exist as standalone MW headwords.
 *
 * Deploy:
 * npx supabase functions deploy define-words
 */

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
 * ============================================================
 * HTML ENTITY CLEANING
 * ============================================================
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

  result = result.replace(
    /&#(\d+);/g,
    (_, decimal) => {
      try {
        return String.fromCodePoint(
          Number(decimal)
        )
      } catch {
        return ""
      }
    }
  )

  result = result.replace(
    /&#x([0-9a-f]+);/gi,
    (_, hexadecimal) => {
      try {
        return String.fromCodePoint(
          parseInt(
            hexadecimal,
            16
          )
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

  if (
    /&(?:#\d+|#x[0-9a-f]+|amp|quot|apos|nbsp|lt|gt);/i.test(
      cleaned
    )
  ) {
    cleaned =
      decodeHtmlEntities(cleaned)
  }

  cleaned = cleaned
    .replace(/\s+/g, " ")
    .trim()

  if (!cleaned) {
    return null
  }

  if (
    /no translation found|invalid|must be less|quota|error/i.test(
      cleaned
    )
  ) {
    return null
  }

  return cleaned
}

/*
 * ============================================================
 * MERRIAM-WEBSTER TEXT CLEANING
 * ============================================================
 */

function cleanMwText(value: unknown) {
  let text = String(value || "")

  text = text.replace(
    /\{(it|b|wi|inf|sup|gloss|qword|parahw|phrase)\}(.*?)\{\/\1\}/g,
    "$2"
  )

  text = text.replace(
    /\{(?:sx|a_link|d_link|i_link|et_link|mat|dxt)\|([^|}]*)[^}]*\}/g,
    "$1"
  )

  text = text.replace(
    /\{bc\}/g,
    ": "
  )

  text = text
    .replace(/\{ldquo\}/g, "“")
    .replace(/\{rdquo\}/g, "”")

  text = text.replace(
    /\{\/?[a-z_]+[^}]*\}/gi,
    ""
  )

  return text
    .replace(/\s+/g, " ")
    .replace(/^[:;\s]+/, "")
    .trim()
}

/*
 * ============================================================
 * MERRIAM-WEBSTER EXAMPLE EXTRACTION
 * ============================================================
 */

function extractFirstExample(
  node: unknown
): string | null {
  if (!node || typeof node !== "object") {
    return null
  }

  if (Array.isArray(node)) {
    if (
      node[0] === "vis" &&
      Array.isArray(node[1])
    ) {
      for (
        const illustration of node[1]
      ) {
        const text = cleanMwText(
          (illustration as any)?.t
        )

        if (text) {
          return text
        }
      }
    }

    for (const item of node) {
      const found =
        extractFirstExample(item)

      if (found) {
        return found
      }
    }

    return null
  }

  for (
    const value of Object.values(
      node as Record<string, unknown>
    )
  ) {
    const found =
      extractFirstExample(value)

    if (found) {
      return found
    }
  }

  return null
}

/*
 * ============================================================
 * MERRIAM-WEBSTER LOOKUP
 * ============================================================
 *
 * IMPORTANT:
 *
 * found = true
 * means MW genuinely found a dictionary entry.
 *
 * found = false
 * means this should be eligible for AI fallback.
 *
 * We deliberately distinguish this from simply having a missing
 * example sentence. A real MW word should NOT go to AI merely because
 * MW did not include an example.
 */

type MwResult = {
  found: boolean
  definition: string
  example_sentence: string
}

async function fetchMwEntry(
  word: string,
  apiKey: string
): Promise<MwResult> {
  const empty: MwResult = {
    found: false,
    definition: "",
    example_sentence: "",
  }

  try {
    const url =
      `https://www.dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(
        word
      )}?key=${apiKey}`

    const response =
      await fetch(url)

    if (!response.ok) {
      console.error(
        `Merriam-Webster returned ${response.status} for "${word}"`
      )

      return empty
    }

    let data: any

    try {
      data = await response.json()
    } catch {
      console.error(
        `Invalid JSON from Merriam-Webster for "${word}"`
      )

      return empty
    }

    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {
      return empty
    }

    /*
     * MW returns an array of strings when it has no dictionary entry
     * and is only suggesting similar spellings.
     *
     * Example:
     *
     * ["take into consideration", "take into account"]
     *
     * That is NOT a successful definition lookup.
     */
    if (
      typeof data[0] === "string"
    ) {
      return empty
    }

    const normalizedWord =
      word.toLowerCase()

    const bestEntry =
      data.find((entry: any) => {
        const id = String(
          entry?.meta?.id || ""
        )
          .toLowerCase()
          .split(":")[0]

        return id === normalizedWord
      }) || data[0]

    if (
      !bestEntry ||
      typeof bestEntry !== "object"
    ) {
      return empty
    }

    const shortdefs =
      Array.isArray(
        bestEntry?.shortdef
      )
        ? bestEntry.shortdef
        : []

    const cleanedDefinitions =
      shortdefs
        .slice(0, 2)
        .map((sense: string) =>
          cleanMwText(sense)
        )
        .filter(Boolean)

    const example =
      extractFirstExample(bestEntry)

    /*
     * Even if MW has an entry but shortdef happens to be empty,
     * it still counts as FOUND.
     *
     * We do not want to send real dictionary entries to AI.
     */
    return {
      found: true,
      definition:
        cleanedDefinitions.length
          ? cleanedDefinitions.join("; ")
          : "",
      example_sentence:
        example || "",
    }
  } catch (error) {
    console.error(
      `Definition lookup failed for "${word}":`,
      error
    )

    return empty
  }
}

/*
 * ============================================================
 * UZBEK TRANSLATION
 * ============================================================
 */

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
      return null
    }

    let data: any

    try {
      data = JSON.parse(text)
    } catch {
      console.error(
        `Invalid JSON from MyMemory for "${word}"`
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
     * Sometimes the translation service simply returns the original
     * English phrase.
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
 * ============================================================
 * OPENAI FALLBACK
 * ============================================================
 *
 * AI IS ONLY USED FOR ITEMS THAT MERRIAM-WEBSTER DID NOT FIND.
 */

const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses"

/*
 * IMPORTANT:
 *
 * This model name must exist in your OpenAI API project.
 *
 * You can change it through the Supabase secret:
 *
 * OPENAI_TEXT_MODEL
 *
 * If no override exists, this default is used.
 */
const TEXT_MODEL =
  Deno.env.get(
    "OPENAI_TEXT_MODEL"
  ) || "gpt-5.6-luna"

const WORD_ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: {
            type: "string",
          },
          definition: {
            type: "string",
          },
          example_sentence: {
            type: "string",
          },
          uzbek_translation: {
            type: "string",
          },
        },
        required: [
          "word",
          "definition",
          "example_sentence",
          "uzbek_translation",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["words"],
  additionalProperties: false,
}

function extractOutputText(
  payload: any
): string {
  if (
    typeof payload?.output_text ===
      "string" &&
    payload.output_text
  ) {
    return payload.output_text
  }

  const items =
    Array.isArray(payload?.output)
      ? payload.output
      : []

  for (const item of items) {
    if (
      item?.type === "message" &&
      Array.isArray(item.content)
    ) {
      for (
        const part of item.content
      ) {
        if (
          part?.type ===
            "output_text" &&
          typeof part.text === "string"
        ) {
          return part.text
        }
      }
    }
  }

  throw new Error(
    "The AI did not return any text."
  )
}

function parseJsonLoose(
  text: string
): any {
  try {
    return JSON.parse(text)
  } catch {
    // continue
  }

  const match =
    text.match(/\{[\s\S]*\}/)

  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      // continue
    }
  }

  throw new Error(
    "Could not read the AI response as JSON."
  )
}

function buildEnrichmentPrompt(
  words: string[]
) {
  return [
    "You are creating IELTS vocabulary flashcards for Uzbek-speaking students.",
    "",
    "Merriam-Webster could not find these exact items as dictionary headwords.",
    "They may be collocations, idioms, phrases, or multi-word expressions.",
    "",
    "For EACH item:",
    "",
    "1. Give a short, accurate English definition.",
    "2. Give one natural example sentence using the exact phrase.",
    "3. Give a natural Uzbek translation.",
    "",
    "Do not explain that Merriam-Webster failed.",
    "Do not add extra commentary.",
    "",
    "Return the items in exactly the same order and preserve the exact spelling.",
    "",
    ...words.map(
      (word, index) =>
        `${index + 1}. ${word}`
    ),
  ].join("\n")
}

type AiResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
}

async function generateWithAi(
  words: string[],
  apiKey: string
): Promise<AiResult[]> {
  const response =
    await fetch(
      OPENAI_RESPONSES_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${apiKey}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          model: TEXT_MODEL,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text:
                    buildEnrichmentPrompt(
                      words
                    ),
                },
              ],
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name:
                "word_enrichment",
              strict: true,
              schema:
                WORD_ENRICHMENT_SCHEMA,
            },
          },
        }),
      }
    )

  let responseJson: any

  try {
    responseJson =
      await response.json()
  } catch {
    throw new Error(
      `OpenAI returned an invalid response (${response.status}).`
    )
  }

  if (!response.ok) {
    console.error(
      "OpenAI error response:",
      responseJson
    )

    throw new Error(
      responseJson?.error?.message ||
        `OpenAI request failed (${response.status}).`
    )
  }

  const outputText =
    extractOutputText(
      responseJson
    )

  const parsed =
    parseJsonLoose(
      outputText
    )

  return Array.isArray(
    parsed?.words
  )
    ? parsed.words
    : []
}

/*
 * ============================================================
 * CONCURRENCY HELPER
 * ============================================================
 */

async function mapWithConcurrency<T>(
  items: string[],
  limit: number,
  fn: (
    item: string
  ) => Promise<T>
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

  await Promise.all(workers)

  return results
}

/*
 * ============================================================
 * MAIN WORD PROCESSOR
 * ============================================================
 */

const UNTRANSLATED_PLACEHOLDER =
  "Translation not found — please review this item manually."

type WordResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
  mw_found: boolean
}

async function enrichWord(
  word: string,
  mwApiKey: string | null
): Promise<WordResult> {
  const [translation, mwEntry] =
    await Promise.all([
      fetchTranslation(word),

      mwApiKey
        ? fetchMwEntry(
            word,
            mwApiKey
          )
        : Promise.resolve({
            found: false,
            definition: "",
            example_sentence: "",
          }),
    ])

  return {
    word,

    definition:
      mwEntry.definition,

    example_sentence:
      mwEntry.example_sentence,

    uzbek_translation:
      translation ||
      UNTRANSLATED_PLACEHOLDER,

    /*
     * This internal flag is the key difference from the previous
     * version.
     *
     * Only mw_found === false can trigger AI.
     */
    mw_found:
      mwEntry.found,
  }
}

/*
 * ============================================================
 * EDGE FUNCTION
 * ============================================================
 */

Deno.serve(
  async (req) => {
    /*
     * CORS preflight
     */
    if (
      req.method === "OPTIONS"
    ) {
      return new Response(
        "ok",
        {
          status: 200,
          headers:
            corsHeaders,
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
     * Supabase environment
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
     * Authentication
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
     * Request body
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
     * Clean submitted words
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
     * Remove duplicates while preserving order
     */
    const seen =
      new Set<string>()

    words =
      words.filter(
        (word: string) => {
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
            "No words provided.",
        },
        400
      )
    }

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
     * Merriam-Webster API key
     */
    const mwApiKey =
      Deno.env.get(
        "MERRIAM_WEBSTER_API_KEY"
      ) || null

    if (!mwApiKey) {
      console.error(
        "MERRIAM_WEBSTER_API_KEY is not configured."
      )
    }

    /*
     * FIRST PASS:
     *
     * Process every item through:
     *
     * - Merriam-Webster
     * - Translation service
     */
    const rawResults =
      await mapWithConcurrency(
        words,
        5,
        (word: string) =>
          enrichWord(
            word,
            mwApiKey
          )
      )

    /*
     * SECOND PASS:
     *
     * ONLY send words that Merriam-Webster could NOT find.
     *
     * This is intentionally NOT based on:
     *
     * !definition
     * !example_sentence
     *
     * because a real MW word might lack one of those fields.
     */
    const itemsNeedingAi =
      rawResults
        .map(
          (result, index) => ({
            result,
            index,
          })
        )
        .filter(
          ({ result }) =>
            result &&
            result.mw_found === false
        )

    const openaiKey =
      Deno.env.get(
        "OPENAI_API_KEY"
      ) || null

    if (
      itemsNeedingAi.length &&
      openaiKey
    ) {
      try {
        const wordsForAi =
          itemsNeedingAi.map(
            ({ result }) =>
              result.word
          )

        console.log(
          "Sending only non-Merriam-Webster items to AI:",
          wordsForAi.length
        )

        const aiResults =
          await generateWithAi(
            wordsForAi,
            openaiKey
          )

        const aiByWord =
          new Map(
            aiResults.map(
              (item) => [
                String(
                  item?.word || ""
                )
                  .trim()
                  .toLowerCase(),
                item,
              ]
            )
          )

        for (
          const {
            result,
            index,
          } of itemsNeedingAi
        ) {
          const aiItem =
            aiByWord.get(
              result.word
                .trim()
                .toLowerCase()
            )

          if (!aiItem) {
            continue
          }

          /*
           * For an item MW could not find, AI becomes the source for
           * definition/example.
           */

          rawResults[index] = {
            ...rawResults[index],

            definition:
              aiItem.definition ||
              rawResults[index]
                .definition,

            example_sentence:
              aiItem.example_sentence ||
              rawResults[index]
                .example_sentence,

            /*
             * Only replace translation if MyMemory failed.
             */
            uzbek_translation:
              rawResults[index]
                .uzbek_translation ===
                UNTRANSLATED_PLACEHOLDER
                  ? (
                      aiItem.uzbek_translation ||
                      rawResults[index]
                        .uzbek_translation
                    )
                  : rawResults[index]
                      .uzbek_translation,
          }
        }
      } catch (error) {
        /*
         * AI failure should not destroy successful dictionary results.
         */
        console.error(
          "AI fallback failed:",
          error
        )
      }
    }

    /*
     * Remove the internal mw_found flag before sending data back to
     * the frontend.
     */
    const results =
      rawResults.map(
        ({
          mw_found,
          ...item
        }) => item
      )

    return json({
      results,
    })
  }
)