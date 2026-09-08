// supabase/functions/define-words/index.ts

import {
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2"

/*
 * ============================================================
 * DEFINE WORDS EDGE FUNCTION
 * ============================================================
 *
 * FLOW:
 *
 * 1. Every word/phrase is checked against Merriam-Webster.
 *
 * 2. Every word/phrase is independently checked for an Uzbek
 *    translation through MyMemory.
 *
 * 3. AI fills ONLY missing information:
 *
 *    - If MW cannot find the exact item:
 *        AI provides definition + example sentence.
 *
 *    - If translation service fails:
 *        AI provides Uzbek translation.
 *
 * These two decisions are intentionally independent.
 *
 * This prevents:
 *
 * - normal words losing translations just because MW found them
 * - phrases receiving unrelated dictionary definitions
 * - unnecessary AI calls when all information already exists
 *
 * Deploy:
 *
 * npx supabase functions deploy define-words
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
  "Content-Type":
    "application/json",
}


/*
 * ============================================================
 * RESPONSE HELPER
 * ============================================================
 */

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


/*
 * ============================================================
 * BASIC CLEANING
 * ============================================================
 */

function cleanWord(
  value: unknown
) {
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

  const entities: Record<
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
    const [
      entity,
      replacement,
    ] of Object.entries(entities)
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

  /*
   * Reject obvious API error messages that occasionally appear
   * as "translations".
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


/*
 * ============================================================
 * MERRIAM-WEBSTER TEXT CLEANING
 * ============================================================
 */

function cleanMwText(
  value: unknown
) {
  let text =
    String(value || "")

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
  if (
    !node ||
    typeof node !== "object"
  ) {
    return null
  }

  if (Array.isArray(node)) {
    /*
     * MW visual illustration structure.
     */
    if (
      node[0] === "vis" &&
      Array.isArray(node[1])
    ) {
      for (
        const illustration of node[1]
      ) {
        const text =
          cleanMwText(
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
      data =
        await response.json()
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
     * MW returns an array of strings when it only has spelling
     * suggestions rather than a real dictionary entry.
     */
    if (
      typeof data[0] === "string"
    ) {
      return empty
    }

    const normalizedWord =
      word
        .toLowerCase()
        .trim()

    /*
     * CRITICAL FIX:
     *
     * We only accept an EXACT dictionary headword match.
     *
     * Example:
     *
     * Searching:
     * "take into account"
     *
     * must NOT accidentally use the definition of:
     * "account"
     *
     * If there is no exact MW entry, AI handles the phrase.
     */

    const bestEntry =
      data.find(
        (entry: any) => {

          const id =
            String(
              entry?.meta?.id || ""
            )
              .toLowerCase()
              .split(":")[0]
              .trim()

          return (
            id === normalizedWord
          )
        }
      )

    if (
      !bestEntry ||
      typeof bestEntry !== "object"
    ) {
      return empty
    }

    const shortdefs =
      Array.isArray(
        bestEntry.shortdef
      )
        ? bestEntry.shortdef
        : []

    const cleanedDefinitions =
      shortdefs
        .slice(0, 2)
        .map(
          (sense: string) =>
            cleanMwText(sense)
        )
        .filter(Boolean)

    const example =
      extractFirstExample(
        bestEntry
      )

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
): Promise<string | null> {

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
      data =
        JSON.parse(text)
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
     * MyMemory sometimes simply returns the original English input.
     * That does not count as a translation.
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
 * OPENAI
 * ============================================================
 */

const OPENAI_RESPONSES_URL =
  "https://api.openai.com/v1/responses"


const TEXT_MODEL =
  Deno.env.get(
    "OPENAI_TEXT_MODEL"
  ) || "gpt-5.6-terra"


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

        additionalProperties:
          false,

      },

    },

  },

  required: [
    "words",
  ],

  additionalProperties:
    false,
}


/*
 * ============================================================
 * OPENAI RESPONSE HELPERS
 * ============================================================
 */

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
    Array.isArray(
      payload?.output
    )
      ? payload.output
      : []

  for (
    const item of items
  ) {

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
    // Continue below.
  }

  const match =
    text.match(
      /\{[\s\S]*\}/
    )

  if (match) {

    try {
      return JSON.parse(
        match[0]
      )
    } catch {
      // Continue below.
    }

  }

  throw new Error(
    "Could not read the AI response as JSON."
  )
}


/*
 * ============================================================
 * AI REQUEST
 * ============================================================
 */

type AiRequestItem = {
  word: string
  needDefinition: boolean
  needExample: boolean
  needTranslation: boolean
}


function buildEnrichmentPrompt(
  items: AiRequestItem[]
) {

  return [

    "You are helping build IELTS vocabulary flashcards for Uzbek-speaking students.",

    "",

    "For every item, return accurate information in the required JSON format.",

    "",

    "Important rules:",

    "1. A definition must explain the exact word or phrase.",

    "2. For multi-word expressions, idioms, and collocations, define the complete phrase, not one individual word inside it.",

    "3. Example sentences must sound natural and use the exact word or phrase.",

    "4. Uzbek translations should be natural modern Uzbek.",

    "5. Never translate into Russian.",

    "6. Never invent a financial, technical, or unrelated meaning.",

    "7. Preserve the exact original spelling of every submitted item.",

    "",

    "The following items need AI assistance:",

    "",

    ...items.map(
      (item, index) => [

        `${index + 1}. ${item.word}`,

        `Needs definition: ${
          item.needDefinition
            ? "YES"
            : "NO"
        }`,

        `Needs example sentence: ${
          item.needExample
            ? "YES"
            : "NO"
        }`,

        `Needs Uzbek translation: ${
          item.needTranslation
            ? "YES"
            : "NO"
        }`,

      ].join("\n")
    ),

  ].join("\n\n")
}


type AiResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
}


async function generateWithAi(
  items: AiRequestItem[],
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

        body:
          JSON.stringify({

            model:
              TEXT_MODEL,

            input: [
              {
                role: "user",

                content: [
                  {
                    type: "input_text",

                    text:
                      buildEnrichmentPrompt(
                        items
                      ),
                  },
                ],
              },
            ],

            text: {

              format: {

                type:
                  "json_schema",

                name:
                  "word_enrichment",

                strict:
                  true,

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
): Promise<T[]> {

  const results =
    new Array<T>(
      items.length
    )

  let next = 0


  async function worker() {

    while (true) {

      const index =
        next++

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


/*
 * ============================================================
 * WORD PROCESSING
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

  /*
   * Dictionary lookup and translation lookup happen simultaneously.
   */

  const [
    translation,
    mwEntry,
  ] =
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
     * CORS
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
     * ENVIRONMENT
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
     * AUTHENTICATION
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
     * REQUEST BODY
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
     * CLEAN WORDS
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
     * REMOVE DUPLICATES
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
     * MERRIAM-WEBSTER KEY
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
     * FIRST PASS
     *
     * Every item goes through:
     *
     * - Merriam-Webster
     * - MyMemory
     */

    const rawResults =
      await mapWithConcurrency(
        words,
        5,
        (
          word: string
        ) =>
          enrichWord(
            word,
            mwApiKey
          )
      )


    /*
     * SECOND PASS
     *
     * Determine exactly which information is missing.
     *
     * IMPORTANT:
     *
     * AI is now needed when EITHER:
     *
     * 1. MW could not find the item
     *
     * OR
     *
     * 2. Translation service failed
     *
     * These are independent.
     */

    const itemsNeedingAi =
      rawResults
        .map(
          (
            result,
            index
          ) => {

            if (!result) {
              return null
            }


            const needDefinition =
              !result.mw_found ||
              !result.definition.trim()


            const needExample =
              !result.mw_found ||
              !result.example_sentence.trim()


            const needTranslation =
              result.uzbek_translation ===
              UNTRANSLATED_PLACEHOLDER


            if (
              !needDefinition &&
              !needExample &&
              !needTranslation
            ) {
              return null
            }


            return {

              index,

              result,

              aiRequest: {

                word:
                  result.word,

                needDefinition,

                needExample,

                needTranslation,

              },

            }

          }
        )
        .filter(Boolean) as Array<{
          index: number
          result: WordResult
          aiRequest: AiRequestItem
        }>


    /*
     * OPENAI KEY
     */

    const openaiKey =
      Deno.env.get(
        "OPENAI_API_KEY"
      ) || null


    if (
      itemsNeedingAi.length &&
      !openaiKey
    ) {

      console.error(
        "OPENAI_API_KEY is not configured, so missing information cannot be generated."
      )

    }


    /*
     * AI FALLBACK
     */

    if (
      itemsNeedingAi.length &&
      openaiKey
    ) {

      try {

        console.log(
          "Sending items with missing information to AI:",
          itemsNeedingAi.length
        )


        const aiResults =
          await generateWithAi(
            itemsNeedingAi.map(
              item =>
                item.aiRequest
            ),
            openaiKey
          )


        const aiByWord =
          new Map(
            aiResults.map(
              item => [

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
          const item of itemsNeedingAi
        ) {

          const {
            result,
            index,
            aiRequest,
          } = item


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
           * Only replace fields that actually needed AI.
           *
           * This is important.
           *
           * A good Merriam-Webster definition must never be
           * replaced just because AI was needed for translation.
           */

          rawResults[index] = {

            ...rawResults[index],


            definition:

              aiRequest.needDefinition &&
              aiItem.definition?.trim()

                ? aiItem.definition.trim()

                : rawResults[index]
                    .definition,


            example_sentence:

              aiRequest.needExample &&
              aiItem.example_sentence?.trim()

                ? aiItem
                    .example_sentence
                    .trim()

                : rawResults[index]
                    .example_sentence,


            uzbek_translation:

              aiRequest.needTranslation &&
              aiItem.uzbek_translation?.trim()

                ? aiItem
                    .uzbek_translation
                    .trim()

                : rawResults[index]
                    .uzbek_translation,

          }

        }

      } catch (error) {

        /*
         * AI failure should never destroy successful
         * dictionary or translation results.
         */

        console.error(
          "AI fallback failed:",
          error
        )

      }

    }


    /*
     * REMOVE INTERNAL FLAG
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