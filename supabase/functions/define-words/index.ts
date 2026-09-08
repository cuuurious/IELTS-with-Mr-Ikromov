// supabase/functions/define-words/index.ts

import {
  createClient,
} from "https://esm.sh/@supabase/supabase-js@2"


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
 * TYPES
 * ============================================================
 */

type VocabularyResult = {
  word: string
  definition: string
  example_sentence: string
  uzbek_translation: string
}


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function cleanWord(
  value: unknown
): string {
  return String(value || "")

    // Remove bullet characters.
    .replace(
      /^[•●▪▫◦‣⁃]+[\s]*/,
      ""
    )

    // Remove common list numbering.
    // Examples:
    // 1. word
    // 1) word
    // (1) word
    .replace(
      /^\(?\d+\)?[.)\-:]\s*/,
      ""
    )

    // Normalize spaces.
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
    "OpenAI returned no readable text."
  )

}


/*
 * ============================================================
 * RESULT VALIDATION
 * ============================================================
 *
 * This deliberately does NOT fail the entire
 * generation if OpenAI misses one item.
 *
 * Previously:
 *
 * 60 requested
 * 59 generated correctly
 * 1 mismatch
 * ↓
 * Entire request failed
 *
 * Now valid results are returned.
 * Missing items are logged only.
 * ============================================================
 */

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
      String(
        item?.definition || ""
      ).trim()

    const example =
      String(
        item?.example_sentence || ""
      ).trim()

    const translation =
      String(
        item?.uzbek_translation || ""
      ).trim()


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


  const finalResults: VocabularyResult[] =
    []


  const missingWords: string[] =
    []


  /*
   * Match results using cleaned versions.
   *
   * This prevents:
   *
   * "• access"
   *
   * from failing to match:
   *
   * "access"
   */

  for (
    const originalWord of requestedWords
  ) {

    const cleanedOriginal =
      cleanWord(originalWord)


    const generated =
      byWord.get(
        cleanedOriginal.toLowerCase()
      )


    if (generated) {

      finalResults.push({
        ...generated,

        // Preserve the teacher's cleaned
        // original vocabulary item.
        word: cleanedOriginal,
      })

    } else {

      missingWords.push(
        cleanedOriginal
      )

    }

  }


  /*
   * Log missing items but do NOT destroy
   * all successfully generated results.
   */

  if (missingWords.length) {

    console.warn(
      "OpenAI did not return complete information for:",
      missingWords
    )

  }


  /*
   * Only fail if literally nothing usable
   * was generated.
   */

  if (!finalResults.length) {

    throw new Error(
      "OpenAI did not return usable vocabulary results."
    )

  }


  return finalResults

}


/*
 * ============================================================
 * PROMPT
 * ============================================================
 */

function buildPrompt(
  words: string[]
) {

  return `
You create high-quality IELTS vocabulary cards for Uzbek-speaking English learners.

Generate information for EVERY vocabulary item below.

IMPORTANT RULES:

1. Treat every submitted item as one complete vocabulary item.

2. NEVER split multi-word expressions.

Examples:

"take into account"
must be treated as one complete phrase.

"play a crucial role"
must remain one complete phrase.

"in the long run"
must remain one complete phrase.

3. Use the exact vocabulary item provided.

4. Give a clear, accurate English definition suitable for IELTS learners.

5. Write one natural example sentence that correctly uses the exact word or phrase.

6. Provide a natural Uzbek translation.

7. Use Uzbek only, NOT Russian.

8. Do not invent meanings.

9. Do not define individual words separately when a complete phrase has its own meaning.

10. Return every submitted item exactly once.

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
 * OPENAI REQUEST
 * ============================================================
 */

async function callOpenAI(
  apiKey: string,
  words: string[]
): Promise<VocabularyResult[]> {

  const prompt =
    buildPrompt(words)


  /*
   * Retry only actual temporary API/network
   * failures.
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

              model:
                TEXT_MODEL,


              input: [
                {
                  role: "user",

                  content: [
                    {
                      type:
                        "input_text",

                      text:
                        prompt,
                    },
                  ],
                },
              ],


              text: {
                format: {
                  type:
                    "json_schema",

                  name:
                    "vocabulary_results",

                  strict:
                    true,

                  schema: {

                    type:
                      "object",

                    properties: {

                      results: {

                        type:
                          "array",

                        items: {

                          type:
                            "object",

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


      if (responseText.trim()) {

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
          ? error.message.toLowerCase()
          : String(error).toLowerCase()


      const retryable =
        message.includes("abort") ||
        message.includes("network") ||
        message.includes("fetch") ||
        message.includes("timeout")


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


  throw (
    lastError ||
    new Error(
      "OpenAI generation failed."
    )
  )

}


/*
 * ============================================================
 * MAIN EDGE FUNCTION
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
          headers:
            corsHeaders,
        }
      )

    }


    /*
     * METHOD CHECK
     */

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
       * ENVIRONMENT
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
       * AUTHENTICATION
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
       * REMOVE DUPLICATES
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
       * GENERATE
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