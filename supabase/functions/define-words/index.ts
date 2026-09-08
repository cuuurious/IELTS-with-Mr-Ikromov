// supabase/functions/define-words/index.ts

import {
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2"

/*
 * DEFINE WORDS
 *
 * Reliable architecture:
 *
 * Browser
 *   -> Supabase Edge Function
 *   -> OpenAI only
 *   -> Browser
 *
 * No dictionary APIs.
 * No translation APIs.
 * No per-word external services.
 *
 * The input is split into small batches so one imperfect model response
 * cannot destroy an entire 60-word list. Missing items are retried
 * automatically and only the missing items are regenerated.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
}

function json(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: corsHeaders,
    }
  )
}

const OPENAI_URL =
  "https://api.openai.com/v1/responses"

const TEXT_MODEL =
  Deno.env.get("OPENAI_TEXT_MODEL") ||
  "gpt-5.6-terra"

const MAX_WORDS = 250

// 25 is deliberately conservative. It is much more reliable than asking
// one response to produce 60–250 complete vocabulary cards at once.
const BATCH_SIZE = 25

const MAX_BATCH_ATTEMPTS = 3
const REQUEST_TIMEOUT_MS = 120000

type VocabularyResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
}

type IndexedVocabularyResult =
  VocabularyResult & {
    index: number
  }

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalize(value: unknown): string {
  return cleanText(value).toLowerCase()
}

function sleep(milliseconds: number) {
  return new Promise(
    (resolve) => setTimeout(resolve, milliseconds)
  )
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []

  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }

  return result
}

function extractOutputText(payload: any): string {
  if (
    typeof payload?.output_text === "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload?.output)
    ? payload.output
    : []

  for (const item of output) {
    if (
      item?.type === "message" &&
      Array.isArray(item?.content)
    ) {
      for (const part of item.content) {
        if (
          part?.type === "output_text" &&
          typeof part?.text === "string" &&
          part.text.trim()
        ) {
          return part.text.trim()
        }
      }
    }
  }

  throw new Error(
    "OpenAI returned no readable output."
  )
}

function buildPrompt(
  items: { index: number; word: string }[]
) {
  return `
You create accurate IELTS vocabulary cards for Uzbek-speaking English learners.

Generate information for EVERY numbered item below.

IMPORTANT RULES:

1. Each numbered item is one complete vocabulary item.

2. NEVER split multi-word expressions into individual words.

Examples:
- "take into account" must be defined as the complete phrase.
- "play a crucial role" must remain the complete phrase.
- "in the long run" must remain the complete phrase.

3. Keep the meaning appropriate to the complete word or phrase.

4. Use a clear, accurate English definition suitable for IELTS students.

5. Write exactly one natural example sentence.

6. Provide a natural Uzbek translation in Uzbek Latin script.
Do NOT use Russian.

7. Do not invent meanings.

8. Return every requested index exactly once.

9. The "word" field must preserve the original item exactly as supplied.

10. Do not add explanations, notes, markdown, or extra fields.

REQUESTED ITEMS:

${items
  .map(
    (item) =>
      `${item.index}. ${item.word}`
  )
  .join("\n")}
`
}

function responseSchema() {
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
            },
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
            "index",
            "word",
            "definition",
            "example_sentence",
            "uzbek_translation",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  }
}

function parseResults(
  rawResults: unknown,
  requested: { index: number; word: string }[]
): Map<number, VocabularyResult> {
  const valid = new Map<number, VocabularyResult>()

  if (!Array.isArray(rawResults)) {
    return valid
  }

  const requestedByIndex = new Map(
    requested.map((item) => [
      item.index,
      item,
    ])
  )

  for (const raw of rawResults) {
    const index = Number(raw?.index)
    const requestedItem =
      requestedByIndex.get(index)

    if (!requestedItem) {
      continue
    }

    const definition =
      cleanText(raw?.definition)

    const example =
      cleanText(raw?.example_sentence)

    const translation =
      cleanText(raw?.uzbek_translation)

    if (
      !definition ||
      !example ||
      !translation
    ) {
      continue
    }

    valid.set(index, {
      // Always preserve the teacher's exact original item.
      word: requestedItem.word,
      definition,
      example_sentence: example,
      uzbek_translation: translation,
    })
  }

  return valid
}

async function requestOpenAI(
  apiKey: string,
  requested: { index: number; word: string }[]
): Promise<Map<number, VocabularyResult>> {
  const controller =
    new AbortController()

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  )

  try {
    const response = await fetch(
      OPENAI_URL,
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
                  text: buildPrompt(requested),
                },
              ],
            },
          ],

          text: {
            format: {
              type: "json_schema",
              name: "vocabulary_results",
              strict: true,
              schema: responseSchema(),
            },
          },
        }),

        signal: controller.signal,
      }
    )

    const responseText =
      await response.text()

    let payload: any = null

    try {
      payload = responseText
        ? JSON.parse(responseText)
        : null
    } catch {
      throw new Error(
        `OpenAI returned invalid JSON (HTTP ${response.status}).`
      )
    }

    if (!response.ok) {
      const message =
        payload?.error?.message ||
        payload?.message ||
        `OpenAI request failed with HTTP ${response.status}.`

      const error = new Error(message)

      ;(error as any).status =
        response.status

      throw error
    }

    // A Responses API request can be technically 200 but still incomplete.
    // Treat it as retryable rather than pretending the whole function failed.
    if (
      payload?.status &&
      payload.status !== "completed"
    ) {
      throw new Error(
        payload?.incomplete_details?.reason ||
        `OpenAI response ended with status: ${payload.status}`
      )
    }

    const outputText =
      extractOutputText(payload)

    let parsed: any

    try {
      parsed = JSON.parse(outputText)
    } catch {
      throw new Error(
        "OpenAI returned malformed structured data."
      )
    }

    return parseResults(
      parsed?.results,
      requested
    )
  } finally {
    clearTimeout(timeout)
  }
}

function isRetryable(error: unknown): boolean {
  const status =
    Number((error as any)?.status || 0)

  if (
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  ) {
    return true
  }

  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase()

  return (
    message.includes("abort") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("incomplete") ||
    message.includes("malformed")
  )
}

/*
 * Generate a batch without ever rejecting successful items just because
 * another item was missing. Missing items are requested again separately.
 */
async function generateBatch(
  apiKey: string,
  batch: { index: number; word: string }[]
): Promise<Map<number, VocabularyResult>> {
  const completed =
    new Map<number, VocabularyResult>()

  let pending = [...batch]
  let lastError: unknown = null

  for (
    let attempt = 1;
    attempt <= MAX_BATCH_ATTEMPTS &&
    pending.length > 0;
    attempt++
  ) {
    try {
      console.log(
        `define-words: attempt ${attempt}, requesting ${pending.length} item(s).`
      )

      const received =
        await requestOpenAI(
          apiKey,
          pending
        )

      for (const [index, result] of received) {
        completed.set(index, result)
      }

      pending = pending.filter(
        (item) => !completed.has(item.index)
      )

      if (pending.length === 0) {
        break
      }

      console.warn(
        `define-words: ${pending.length} item(s) missing after attempt ${attempt}; retrying only those items.`
      )

      if (attempt < MAX_BATCH_ATTEMPTS) {
        await sleep(700 * attempt)
      }
    } catch (error) {
      lastError = error

      console.warn(
        `define-words: attempt ${attempt} failed:`,
        error
      )

      if (
        !isRetryable(error) ||
        attempt === MAX_BATCH_ATTEMPTS
      ) {
        break
      }

      await sleep(1200 * attempt)
    }
  }

  /*
   * Final rescue: individual requests for anything still missing.
   * This is rare, but it prevents one bad item from destroying a
   * whole list.
   */
  const stillMissing =
    batch.filter(
      (item) => !completed.has(item.index)
    )

  for (const item of stillMissing) {
    try {
      const rescued =
        await requestOpenAI(
          apiKey,
          [item]
        )

      const result =
        rescued.get(item.index)

      if (result) {
        completed.set(
          item.index,
          result
        )
      }
    } catch (error) {
      console.error(
        `define-words: final rescue failed for "${item.word}":`,
        error
      )
      lastError = error
    }
  }

  const unresolved =
    batch.filter(
      (item) => !completed.has(item.index)
    )

  if (unresolved.length) {
    const names = unresolved
      .slice(0, 10)
      .map((item) => item.word)
      .join(", ")

    throw new Error(
      `The AI could not complete ${unresolved.length} item(s): ${names}`
    )
  }

  return completed
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(
      "ok",
      { headers: corsHeaders }
    )
  }

  if (req.method !== "POST") {
    return json(
      {
        error: "Method not allowed.",
      },
      405
    )
  }

  try {
    const supabaseUrl =
      Deno.env.get("SUPABASE_URL")

    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY")

    const openaiKey =
      Deno.env.get("OPENAI_API_KEY")

    if (
      !supabaseUrl ||
      !anonKey ||
      !openaiKey
    ) {
      console.error(
        "define-words server configuration is incomplete."
      )

      return json(
        {
          error:
            "The word generation service is not configured correctly.",
        },
        500
      )
    }

    const authHeader =
      req.headers.get("Authorization")

    if (!authHeader) {
      return json(
        {
          error:
            "You must be logged in.",
        },
        401
      )
    }

    const supabase =
      createClient(
        supabaseUrl,
        anonKey,
        {
          global: {
            headers: {
              Authorization:
                authHeader,
            },
          },
        }
      )

    const {
      data: userData,
      error: userError,
    } = await supabase.auth.getUser()

    if (
      userError ||
      !userData?.user
    ) {
      return json(
        {
          error:
            "Your login session has expired. Please log in again.",
        },
        401
      )
    }

    let body: any

    try {
      body = await req.json()
    } catch {
      return json(
        {
          error:
            "Invalid request body.",
        },
        400
      )
    }

    const rawWords =
      Array.isArray(body?.words)
        ? body.words
        : []

    const cleanedWords =
      rawWords
        .map(cleanText)
        .filter(Boolean)

    if (!cleanedWords.length) {
      return json(
        {
          error:
            "Please provide at least one word or phrase.",
        },
        400
      )
    }

    if (
      cleanedWords.length >
      MAX_WORDS
    ) {
      return json(
        {
          error:
            `Please generate ${MAX_WORDS} words or fewer at a time.`,
        },
        400
      )
    }

    /*
     * Remove exact duplicates while preserving order.
     */
    const uniqueWords: string[] = []
    const seen = new Set<string>()

    for (const word of cleanedWords) {
      const key = normalize(word)

      if (!seen.has(key)) {
        seen.add(key)
        uniqueWords.push(word)
      }
    }

    const indexedItems =
      uniqueWords.map(
        (word, index) => ({
          index,
          word,
        })
      )

    const batches =
      chunk(
        indexedItems,
        BATCH_SIZE
      )

    console.log(
      `define-words: generating ${indexedItems.length} item(s) in ${batches.length} batch(es) using ${TEXT_MODEL}.`
    )

    const allResults =
      new Map<number, VocabularyResult>()

    /*
     * Sequential batches are intentional. This keeps cost predictable and
     * avoids rate-limit spikes. Typical 60-word lists become 3 requests.
     */
    for (
      let batchNumber = 0;
      batchNumber < batches.length;
      batchNumber++
    ) {
      const batch =
        batches[batchNumber]

      console.log(
        `define-words: starting batch ${batchNumber + 1}/${batches.length}.`
      )

      const batchResults =
        await generateBatch(
          openaiKey,
          batch
        )

      for (
        const [index, result] of batchResults
      ) {
        allResults.set(index, result)
      }
    }

    const results =
      indexedItems.map(
        (item) =>
          allResults.get(item.index)
      )

    const missing =
      indexedItems.filter(
        (_, index) => !results[index]
      )

    if (missing.length) {
      // This should only be reachable after all retries and rescue attempts.
      console.error(
        "define-words unresolved items:",
        missing
      )

      return json(
        {
          error:
            "Generation could not be completed for every item. Please retry the list.",
          results: results.filter(
            Boolean
          ),
          failed_words: missing.map(
            (item) => item.word
          ),
        },
        200
      )
    }

    console.log(
      `define-words: completed ${results.length} item(s) successfully.`
    )

    return json({
      results,
    })
  } catch (error) {
    console.error(
      "define-words failed:",
      error
    )

    const message =
      error instanceof Error
        ? error.message
        : "Unknown server error."

    /*
     * Genuine server failures still return an error status so they are not
     * silently mistaken for successful generation.
     */
    return json(
      { error: message },
      500
    )
  }
})
