// supabase/functions/define-words/index.ts

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Definitions/example sentences come from Merriam-Webster's Learner's
// Dictionary first (fetchMwEntry below) — it's the authoritative,
// human-written source, so it's always tried first and always wins
// when it has an entry. But a lot of collocations/phrases ("trial and
// error", "unsettling experience") simply aren't their own headword
// there. For anything MW/MyMemory couldn't fill in, this now makes
// ONE batched call to OpenAI (reusing the same OPENAI_API_KEY secret
// the ai-grading function already needs — nothing new to configure if
// that's already set up) asking it to write the missing
// definition/example/translation itself. See generateWithAi() below.
//
// Deploy with: npx supabase functions deploy define-words

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

/*
 * Strip Merriam-Webster's internal markup tokens out of definition
 * text (their API returns strings like "{bc}to make {it}less{/it}
 * severe" instead of plain text). This only needs to handle what
 * actually shows up in `shortdef` — the short, already-simplified
 * definitions this function uses — not the full formatting language
 * MW uses in the long-form `def`/`sseq` structure.
 */
function cleanMwText(value: unknown) {
  let text = String(value || "")

  // Paired tokens: keep the text inside them.
  text = text.replace(
    /\{(it|b|wi|inf|sup|gloss|qword|parahw|phrase)\}(.*?)\{\/\1\}/g,
    "$2"
  )

  // {sx|word||} / {a_link|word} / {d_link|text|...} -- cross-references
  // and links. Keep just the display word/text (first piece).
  text = text.replace(
    /\{(?:sx|a_link|d_link|i_link|et_link|mat|dxt)\|([^|}]*)[^}]*\}/g,
    "$1"
  )

  // {bc} is a "bold colon" used to separate sense groups.
  text = text.replace(/\{bc\}/g, ": ")

  text = text
    .replace(/\{ldquo\}/g, "“")
    .replace(/\{rdquo\}/g, "”")

  // Anything else ({dx}, {sxn}, closing tags that slipped through, etc.)
  // -- just drop it, it's formatting metadata, not content.
  text = text.replace(/\{\/?[a-z_]+[^}]*\}/gi, "")

  return text
    .replace(/\s+/g, " ")
    .replace(/^[:;\s]+/, "")
    .trim()
}

/*
 * Merriam-Webster's entries nest example sentences ("verbal
 * illustrations") deep inside their sense structure, under a "vis"
 * array wherever it happens to occur -- rather than model that whole
 * nested shape, just walk the entry looking for any ["vis", [...]]
 * pair and use its first example. {wi}...{/wi} inside the example
 * (marking where the headword itself appears) gets unwrapped to plain
 * text by cleanMwText, same as everything else.
 */
function extractFirstExample(node: unknown): string | null {
  if (!node || typeof node !== "object") {
    return null
  }

  if (Array.isArray(node)) {
    if (node[0] === "vis" && Array.isArray(node[1])) {
      for (const illustration of node[1]) {
        const text = cleanMwText(
          (illustration as any)?.t
        )

        if (text) {
          return text
        }
      }
    }

    for (const child of node) {
      const found = extractFirstExample(child)

      if (found) {
        return found
      }
    }

    return null
  }

  for (const key of Object.keys(node as object)) {
    const found = extractFirstExample(
      (node as Record<string, unknown>)[key]
    )

    if (found) {
      return found
    }
  }

  return null
}

/*
 * Merriam-Webster Learner's Dictionary API.
 *
 * https://www.dictionaryapi.com/products/api-learners-dictionary
 *
 * A real, non-technical-friendly gotcha this has to handle: when there
 * is no exact entry for what was queried, MW does NOT return an error
 * or an empty array -- it returns HTTP 200 with an array of plain
 * spelling-suggestion STRINGS instead of definition objects. A lot of
 * collocations (e.g. "take into account") aren't their own headword --
 * they're nested inside a related word's entry -- so this shows up a
 * lot for multi-word phrases specifically. Treat that case the same as
 * "no definition found" rather than showing a suggestion as if it were
 * a definition.
 */
async function fetchMwEntry(
  word: string,
  apiKey: string
): Promise<{ definition: string | null; example: string | null }> {
  const empty = { definition: null, example: null }

  try {
    const url =
      `https://www.dictionaryapi.com/api/v3/references/learners/json/${encodeURIComponent(
        word
      )}?key=${apiKey}`

    const response = await fetch(url)

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

    if (!Array.isArray(data) || data.length === 0) {
      return empty
    }

    /*
     * No exact entry -- just spelling suggestions as plain strings.
     */
    if (typeof data[0] === "string") {
      return empty
    }

    /*
     * Ambiguous headwords (e.g. "bear" the verb vs. the noun) can come
     * back as several entries. Prefer the one whose id actually matches
     * what was queried over whatever MW happened to sort first.
     */
    const normalizedWord = word.toLowerCase()

    const bestEntry =
      data.find((entry: any) => {
        const id = String(entry?.meta?.id || "")
          .toLowerCase()
          .split(":")[0]

        return id === normalizedWord
      }) || data[0]

    const shortdefs = Array.isArray(bestEntry?.shortdef)
      ? bestEntry.shortdef
      : []

    /*
     * A word list entry is a flashcard, not a dictionary page -- the
     * first sense or two is plenty, and keeps entries readable.
     */
    const cleaned = shortdefs
      .slice(0, 2)
      .map((sense: string) => cleanMwText(sense))
      .filter(Boolean)

    const example = extractFirstExample(bestEntry)

    return {
      definition: cleaned.length ? cleaned.join("; ") : null,
      example,
    }
  } catch (error) {
    console.error(
      `Definition lookup failed for "${word}":`,
      error
    )

    return empty
  }
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
 * ============================================================
 * AI FALLBACK — for definitions/examples/translations that the
 * dictionary and translation service above couldn't provide.
 * ============================================================
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"

// Same override mechanism as ai-grading's TEXT_MODEL — if OpenAI ever
// retires this model name, set the secret instead of editing code:
//   npx supabase secrets set OPENAI_TEXT_MODEL=<new model name>
const TEXT_MODEL =
  Deno.env.get("OPENAI_TEXT_MODEL") || "gpt-5.6-terra"

const WORD_ENRICHMENT_SCHEMA = {
  type: "object",
  properties: {
    words: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          definition: { type: "string" },
          example_sentence: { type: "string" },
          uzbek_translation: { type: "string" },
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

// The Responses API sometimes hands back a convenience `output_text`
// field, and always hands back the full `output` array — walk both so
// this doesn't break if OpenAI stops sending the convenience field.
// (Same helper as ai-grading/index.ts.)
function extractOutputText(payload: any): string {
  if (
    typeof payload?.output_text === "string" &&
    payload.output_text
  ) {
    return payload.output_text
  }

  const items = Array.isArray(payload?.output)
    ? payload.output
    : []

  for (const item of items) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (
          part?.type === "output_text" &&
          typeof part.text === "string"
        ) {
          return part.text
        }
      }
    }
  }

  throw new Error("The AI did not return any text.")
}

// Structured Outputs (strict json_schema) should already guarantee
// clean JSON — this is just a safety net.
function parseJsonLoose(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    // fall through
  }

  const match = text.match(/\{[\s\S]*\}/)

  if (match) {
    try {
      return JSON.parse(match[0])
    } catch {
      // fall through
    }
  }

  throw new Error("Could not read the AI's response as JSON.")
}

function buildEnrichmentPrompt(words: string[]) {
  return [
    "You are helping build IELTS vocabulary flashcards for Uzbek-speaking students.",
    "",
    'A dictionary lookup already failed for these English words or collocations — most likely because a multi-word phrase like "trial and error" simply isn\'t its own dictionary headword.',
    "",
    "For EACH one below, write:",
    '- "definition": a short, clear English definition in plain learner\'s-dictionary style (one sentence, no jargon, no repeating the headword itself as the first word of the definition).',
    '- "example_sentence": one natural sentence that actually uses the word/collocation, written exactly as given.',
    '- "uzbek_translation": an accurate, natural Uzbek translation (a short phrase, not a full sentence).',
    "",
    "Return ALL of them, in this exact order, with the word spelled exactly as given:",
    ...words.map((word, i) => `${i + 1}. ${word}`),
  ].join("\n")
}

async function generateWithAi(
  words: string[],
  apiKey: string
): Promise<
  Array<{
    word: string
    definition: string
    example_sentence: string
    uzbek_translation: string
  }>
> {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: buildEnrichmentPrompt(words),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "word_enrichment",
          strict: true,
          schema: WORD_ENRICHMENT_SCHEMA,
        },
      },
    }),
  })

  const json = await response.json()

  if (!response.ok) {
    throw new Error(
      json?.error?.message ||
        `OpenAI request failed (${response.status}).`
    )
  }

  const parsed = parseJsonLoose(extractOutputText(json))

  return Array.isArray(parsed?.words) ? parsed.words : []
}

// The exact fallback string enrichWord() below uses when MyMemory
// couldn't translate something — used to tell "the AI actually
// translated this" apart from "nothing has translated this yet".
const UNTRANSLATED_PLACEHOLDER =
  "Translation not found — please review this item manually."

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
  word: string,
  mwApiKey: string | null
) {
  const [translation, mwEntry] = await Promise.all([
    fetchTranslation(word),
    mwApiKey
      ? fetchMwEntry(word, mwApiKey)
      : Promise.resolve({ definition: null, example: null }),
  ])

  return {
    word,

    /*
     * Merriam-Webster's Learner's Dictionary. Collocations/phrases that
     * aren't their own headword there (a real limitation of using a
     * traditional dictionary for this) simply come back empty here --
     * the AI fallback pass in Deno.serve() below fills in anything
     * still blank after this, when an OpenAI key is configured.
     */
    definition: mwEntry.definition || "",

    uzbek_translation:
      translation || UNTRANSLATED_PLACEHOLDER,

    /*
     * A real example sentence straight from the dictionary entry, when
     * MW has one on file for this sense. Left blank (same graceful
     * fallback as definition) when there isn't one -- filled in by the
     * AI fallback pass below, same as definition.
     */
    example_sentence: mwEntry.example || "",
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
     * Merriam-Webster's free Learner's Dictionary API key. Set with:
     *   npx supabase secrets set MERRIAM_WEBSTER_API_KEY=xxxxx
     *
     * Missing key is not a hard error -- definitions just come back
     * empty (same as before this was added) so translations still work
     * even if this hasn't been configured yet.
     */
    const mwApiKey =
      Deno.env.get("MERRIAM_WEBSTER_API_KEY") || null

    if (!mwApiKey) {
      console.error(
        "MERRIAM_WEBSTER_API_KEY is not set — definitions will be left blank. Run: npx supabase secrets set MERRIAM_WEBSTER_API_KEY=xxxxx"
      )
    }

    const results =
      await mapWithConcurrency(
        words,
        5,
        (word: string) => enrichWord(word, mwApiKey)
      )

    /*
     * --------------------------------------------------------
     * AI FALLBACK
     * --------------------------------------------------------
     * Reuses the OPENAI_API_KEY secret ai-grading already needs — if
     * that's already configured for this project, this needs nothing
     * new. Missing key (or the AI call itself failing) is NOT a hard
     * error: this whole block is best-effort, and a blank field left
     * for the teacher to fill in by hand is exactly what happened
     * before this feature existed, so there's nothing to break.
     */
    const openaiKey =
      Deno.env.get("OPENAI_API_KEY") || null

    if (!openaiKey) {
      console.error(
        "OPENAI_API_KEY is not set — collocations/phrases the dictionary couldn't define will be left blank instead of AI-generated. Run: npx supabase secrets set OPENAI_API_KEY=sk-..."
      )
    } else {
      const needsAi = results
        .map((result, index) => ({ result, index }))
        .filter(
          ({ result }) =>
            result &&
            (!result.definition ||
              !result.example_sentence ||
              result.uzbek_translation ===
                UNTRANSLATED_PLACEHOLDER)
        )

      if (needsAi.length) {
        try {
          const aiWords = needsAi.map(
            ({ result }) => result.word
          )

          const aiResults = await generateWithAi(
            aiWords,
            openaiKey
          )

          const aiByWord = new Map(
            aiResults.map((item) => [
              String(item?.word || "").toLowerCase(),
              item,
            ])
          )

          needsAi.forEach(({ result, index }) => {
            const aiItem = aiByWord.get(
              result.word.toLowerCase()
            )

            if (!aiItem) return

            if (
              !result.definition &&
              aiItem.definition
            ) {
              results[index] = {
                ...results[index],
                definition: aiItem.definition,
              }
            }

            if (
              !result.example_sentence &&
              aiItem.example_sentence
            ) {
              results[index] = {
                ...results[index],
                example_sentence:
                  aiItem.example_sentence,
              }
            }

            if (
              result.uzbek_translation ===
                UNTRANSLATED_PLACEHOLDER &&
              aiItem.uzbek_translation
            ) {
              results[index] = {
                ...results[index],
                uzbek_translation:
                  aiItem.uzbek_translation,
              }
            }
          })
        } catch (error) {
          console.error(
            "AI definition fallback failed — leaving blanks for manual entry:",
            error
          )
        }
      }
    }

    return json({
      results,
    })
  }
)
