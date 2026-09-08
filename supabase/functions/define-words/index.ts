// supabase/functions/define-words/index.ts

import {
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2"


/*
 * ============================================================
 * DEFINE WORDS
 * ============================================================
 *
 * Simple architecture:
 *
 * Browser
 *    ↓
 * Supabase Edge Function
 *    ↓
 * OpenAI
 *    ↓
 * Structured results
 *    ↓
 * Browser
 *
 * No dictionary APIs.
 * No translation APIs.
 * No per-word external requests.
 *
 * One batch = one OpenAI request.
 * ============================================================
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
 * CONFIGURATION
 * ============================================================
 */


const OPENAI_URL =
  "https://api.openai.com/v1/responses"


const TEXT_MODEL =
  Deno.env.get("OPENAI_TEXT_MODEL") ||
  "gpt-5.6-terra"


const MAX_WORDS = 250


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */


function cleanWord(
  value: unknown
): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
}


function sleep(
  milliseconds: number
) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, milliseconds)
  )
}


/*
 * ============================================================
 * RESPONSE EXTRACTION
 * ============================================================
 */


function extractOutputText(
  payload: any
): string {

  if (
    typeof payload?.output_text ===
      "string" &&
    payload.output_text.trim()
  ) {
    return payload.output_text.trim()
  }

  const output =
    Array.isArray(payload?.output)
      ? payload.output
      : []

  for (const item of output) {

    if (
      item?.type === "message" &&
      Array.isArray(item.content)
    ) {

      for (
        const part of item.content
      ) {

        if (
          part?.type === "output_text" &&
          typeof part?.text === "string"
        ) {
          return part.text.trim()
        }

      }

    }

  }

  throw new Error(
    "OpenAI returned no readable text."
  )
}


/*
 * ============================================================
 * STRICT RESULT VALIDATION
 * ============================================================
 */


type VocabularyResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
}


function validateResults(
  results: unknown,
  requestedWords: string[]
): VocabularyResult[] {

  if (!Array.isArray(results)) {
    throw new Error(
      "OpenAI did not return a valid results array."
    )
  }

  const byWord = new Map<
    string,
    VocabularyResult
  >()

  for (const item of results) {

    const word =
      cleanWord(item?.word)

    const definition =
      cleanWord(item?.definition)

    const example =
      cleanWord(item?.example_sentence)

    const translation =
      cleanWord(
        item?.uzbek_translation
      )

    if (
      !word ||
      !definition ||
      !example ||
      !translation
    ) {
      continue
    }

    byWord.set(
      word.toLowerCase(),
      {
        word,
        definition,
        example_sentence: example,
        uzbek_translation:
          translation,
      }
    )

  }


  /*
   * Preserve the exact order and spelling
   * submitted by the teacher.
   */

  const finalResults =
    requestedWords.map(
      (originalWord) => {

        const generated =
          byWord.get(
            originalWord.toLowerCase()
          )

        if (!generated) {
          return null
        }

        return {
          ...generated,
          word: originalWord,
        }

      }
    )


  const missing =
    requestedWords.filter(
      (_, index) =>
        !finalResults[index]
    )


  if (missing.length) {

    throw new Error(
      `OpenAI did not return complete information for: ${missing
        .slice(0, 10)
        .join(", ")}`
    )

  }


  return finalResults.filter(
    Boolean
  ) as VocabularyResult[]
}


/*
 * ============================================================
 * OPENAI REQUEST
 * ============================================================
 */


function buildPrompt(
  words: string[]
) {

  return `
You create high-quality IELTS vocabulary cards for Uzbek-speaking English learners.

Generate information for EVERY item in the list below.

CRITICAL RULES:

1. Treat each submitted line as one complete vocabulary item.

2. NEVER split multi-word expressions.

For example:
- "take into account" must be defined as the complete phrase.
- "play a crucial role" must remain the complete phrase.
- "in the long run" must remain the complete phrase.

3. Preserve the exact original spelling of every submitted item.

4. Give a clear, accurate English definition suitable for IELTS students.

5. Write one natural example sentence using the exact word or phrase.

6. Provide a natural Uzbek translation.

7. Use Uzbek, NOT Russian.

8. Do not invent meanings.

9. Do not explain individual words inside a phrase when the full phrase has its own meaning.

10. Return EVERY submitted item exactly once.

Return ONLY valid JSON.

Required format:

{
  "results": [
    {
      "word": "exact original item",
      "definition": "clear English definition",
      "example_sentence": "natural example sentence",
      "uzbek_translation": "natural Uzbek translation"
    }
  ]
}

VOCABULARY ITEMS:

${words
  .map(
    (word, index) =>
      `${index + 1}. ${word}`
  )
  .join("\n")}
`

}


/*
 * ============================================================
 * OPENAI CALL WITH RETRY
 * ============================================================
 */


async function callOpenAI(
  apiKey: string,
  words: string[]
) {

  const prompt =
    buildPrompt(words)


  /*
   * Two attempts are enough for temporary
   * network / 429 / 5xx failures.
   */

  const maxAttempts = 2

  let lastError: unknown = null


  for (
    let attempt = 1;
    attempt <= maxAttempts;
    attempt++
  ) {

    try {

      const controller =
        new AbortController()


      const timeout =
        setTimeout(
          () => controller.abort(),
          120000
        )


      let response: Response


      try {

        response = await fetch(
          OPENAI_URL,
          {
            method: "POST",

            headers: {
              "Authorization":
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

                      text: prompt,
                    },
                  ],
                },
              ],

              text: {
                format: {
                  type: "json_schema",

                  name:
                    "vocabulary_results",

                  strict: true,

                  schema: {
                    type: "object",

                    properties: {

                      results: {

                        type: "array",

                        items: {

                          type: "object",

                          properties: {

                            word: {
                              type:
                                "string",
                            },

                            definition: {
                              type:
                                "string",
                            },

                            example_sentence: {
                              type:
                                "string",
                            },

                            uzbek_translation: {
                              type:
                                "string",
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
                      "results",
                    ],

                    additionalProperties:
                      false,

                  },

                },

              },

            }),

            signal:
              controller.signal,

          }
        )

      } finally {

        clearTimeout(timeout)

      }


      const responseText =
        await response.text()


      let payload: any = null


      if (
        responseText.trim()
      ) {

        try {

          payload =
            JSON.parse(
              responseText
            )

        } catch {

          throw new Error(
            `OpenAI returned invalid JSON (HTTP ${response.status}).`
          )

        }

      }


      if (!response.ok) {

        const message =
          payload?.error?.message ||
          payload?.message ||
          `OpenAI request failed with HTTP ${response.status}.`


        /*
         * Retry temporary errors only.
         */

        const retryable =
          response.status === 429 ||
          response.status >= 500


        if (
          retryable &&
          attempt < maxAttempts
        ) {

          await sleep(
            1500 * attempt
          )

          continue

        }


        throw new Error(
          message
        )

      }


      const outputText =
        extractOutputText(
          payload
        )


      let parsed: any


      try {

        parsed =
          JSON.parse(
            outputText
          )

      } catch {

        throw new Error(
          "OpenAI returned malformed structured data."
        )

      }


      return validateResults(
        parsed?.results,
        words
      )


    } catch (error) {

      lastError = error


      const message =
        error instanceof Error
          ? error.message
          : String(error)


      const retryable =
        message.includes(
          "abort"
        ) ||
        message.includes(
          "network"
        ) ||
        message.includes(
          "fetch"
        )


      if (
        retryable &&
        attempt < maxAttempts
      ) {

        await sleep(
          1500 * attempt
        )

        continue

      }


      throw error

    }

  }


  throw lastError ||
    new Error(
      "OpenAI generation failed."
    )

}


/*
 * ============================================================
 * MAIN FUNCTION
 * ============================================================
 */


Deno.serve(
  async (req) => {

    if (
      req.method === "OPTIONS"
    ) {

      return new Response(
        "ok",
        {
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
            "Method not allowed.",
        },
        405
      )

    }


    try {

      /*
       * --------------------------------------------------------
       * ENVIRONMENT
       * --------------------------------------------------------
       */


      const supabaseUrl =
        Deno.env.get(
          "SUPABASE_URL"
        )


      const anonKey =
        Deno.env.get(
          "SUPABASE_ANON_KEY"
        )


      const openaiKey =
        Deno.env.get(
          "OPENAI_API_KEY"
        )


      if (
        !supabaseUrl ||
        !anonKey
      ) {

        console.error(
          "Supabase environment variables are missing."
        )

        return json(
          {
            error:
              "Server configuration error.",
          },
          500
        )

      }


      if (!openaiKey) {

        console.error(
          "OPENAI_API_KEY is missing."
        )

        return json(
          {
            error:
              "AI service is not configured.",
          },
          500
        )

      }


      /*
       * --------------------------------------------------------
       * AUTHENTICATION
       * --------------------------------------------------------
       */


      const authHeader =
        req.headers.get(
          "Authorization"
        )


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
      } =
        await supabase.auth.getUser()


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


      /*
       * --------------------------------------------------------
       * REQUEST BODY
       * --------------------------------------------------------
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


      const rawWords =
        Array.isArray(
          body?.words
        )
          ? body.words
          : []


      const words =
        rawWords
          .map(cleanWord)
          .filter(Boolean)


      if (!words.length) {

        return json(
          {
            error:
              "Please provide at least one word or phrase.",
          },
          400
        )

      }


      if (
        words.length >
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
       * Remove exact duplicates while preserving
       * the original order.
       */

      const uniqueWords: string[] =
        []

      const seen =
        new Set<string>()


      for (
        const word of words
      ) {

        const key =
          word.toLowerCase()

        if (!seen.has(key)) {

          seen.add(key)

          uniqueWords.push(word)

        }

      }


      /*
       * --------------------------------------------------------
       * GENERATE
       * --------------------------------------------------------
       */


      console.log(
        `Generating vocabulary for ${uniqueWords.length} items using ${TEXT_MODEL}.`
      )


      const results =
        await callOpenAI(
          openaiKey,
          uniqueWords
        )


      console.log(
        `Vocabulary generation completed successfully for ${results.length} items.`
      )


      return json(
        {
          results,
        }
      )


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
       * Return a meaningful message to the
       * frontend instead of a mysterious
       * non-2xx Supabase error.
       */

      return json(
        {
          error:
            message,
        },
        500
      )

    }

  }
)