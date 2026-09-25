import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

/*
 * mock-content-import — "Import from file" on the Reading/Listening
 * content editor. Teacher uploads a PDF, Word doc, or photo of a real
 * question paper to the "mock-content-uploads" storage bucket
 * (migration_43), this function reads it with OpenAI and hands back a
 * structured draft: a section/part title, the passage or transcript
 * text if present, and a question list (type, prompt, choices,
 * correct answer where an answer key is actually visible in the
 * document). The caller (TeacherMockCenter.jsx) drops that straight
 * into the SAME editable question builder used for manual entry —
 * nothing is written to the database here. The teacher reviews,
 * fixes anything wrong, fills in any answer the AI left blank, then
 * presses the normal Save button. This mirrors the two-step
 * "extract, then review-and-save" design from mock-test-site-
 * concept.md, just reusing the existing form as the review screen
 * instead of a separate one.
 *
 * Sibling to ai-grading — same project, same OPENAI_API_KEY secret,
 * same Responses API. Nothing new to configure beyond deploying this
 * function:
 *   npx supabase functions deploy mock-content-import
 *
 * Deliberately conservative about correct answers: the model is told
 * to only fill correct_answer when an answer key is genuinely present
 * in the uploaded document, and to leave it "" otherwise. Grading
 * later is an exact text match, so a guessed-and-wrong answer would
 * silently mis-grade every student — leaving it blank instead forces
 * the teacher to see it (the question builder already marks a part
 * "Incomplete" and blocks Save until every answer is filled in), which
 * is the safe failure mode here.
 */

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-5.6-terra'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text) {
    return payload.output_text
  }

  const items = Array.isArray(payload?.output) ? payload.output : []

  for (const item of items) {
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') {
          return part.text
        }
      }
    }
  }

  throw new Error('The AI did not return any text.')
}

function parseJsonLoose(text) {
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

async function callOpenAiResponses(apiKey, body) {
  const res = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(
      json?.error?.message || `OpenAI request failed (${res.status}).`
    )
  }

  return json
}

const MOCK_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    section_title: {
      type: 'string',
      description:
        'A short title for this part/passage if one is printed on the page (e.g. "Part 1", "Passage 2 — Coral Reefs"). Empty string if none is visible.',
    },
    passage_text: {
      type: 'string',
      description:
        'The full reading passage or listening transcript/script text, verbatim, if the document actually contains it. Empty string if the document is questions only (no passage/transcript printed).',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order_index: { type: 'integer' },
          type: {
            type: 'string',
            enum: ['multiple_choice', 'true_false_ng', 'short_answer'],
          },
          prompt: { type: 'string' },
          choices: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Only for multiple_choice — the full list of choices, in order. Empty array for every other type.',
          },
          correct_answer: {
            type: 'string',
            description:
              'Only fill this in when an answer key is genuinely printed in the document. Otherwise leave it as an empty string so the teacher fills it in.',
          },
        },
        required: ['order_index', 'type', 'prompt', 'choices', 'correct_answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['section_title', 'passage_text', 'questions'],
  additionalProperties: false,
}

function buildPrompt(module) {
  const moduleLabel = module === 'reading' ? 'Reading' : 'Listening'

  return [
    `You are helping an IELTS teacher import a real ${moduleLabel} question paper into a mock-test builder.`,
    '',
    'Read the attached document (it may be a typed document, a scanned page, or a photo — some may be low quality; do your best) and extract its content into the structure requested.',
    '',
    'Every question you find must be mapped to exactly ONE of these three types, since that is all the builder supports today:',
    '- multiple_choice — the question lists lettered/numbered answer choices to pick from. Extract every choice, in order, into "choices".',
    '- true_false_ng — the question asks whether a statement is True, False, or Not Given (or Yes/No/Not Given — treat the same way).',
    '- short_answer — anything else: sentence/note/form/table completion (the blank the student fills in), matching headings, matching information, diagram/map labelling, or a plain short-answer question. The student will type the missing word(s) into a text box, so "prompt" should make clear exactly what they need to type (include the surrounding sentence with a blank, or the heading/label being matched, so the question stands on its own without needing to see the original page layout).',
    '',
    'Number the questions in "order_index" starting at 0, in the order they appear in the document.',
    '',
    'CRITICAL — correct answers: only put a value in "correct_answer" when this document actually shows an answer key (a separate answer list, an underlined/marked correct choice, or similar). Do NOT guess or infer an answer from general knowledge — grading later is an exact text match, so a wrong guess would silently mark every student wrong. If there is no visible answer key for a question, leave "correct_answer" as an empty string and leave it for the teacher to fill in. For true_false_ng, when you do have a real answer key, write it as exactly "True", "False", or "Not Given".',
    '',
    'If the document includes the reading passage or the listening transcript/script text, put the complete text (verbatim) in "passage_text". If it is a questions-only page, leave "passage_text" as an empty string.',
    '',
    'Return nothing except the structured extraction — no commentary.',
  ].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return jsonResponse({ error: 'Missing authorization' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      throw new Error('Supabase server environment variables are missing.')
    }

    if (!openaiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set for this function. It should already be set from the ai-grading function — if not, run: npx supabase secrets set OPENAI_API_KEY=sk-...'
      )
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const {
      data: { user: caller },
      error: callerAuthError,
    } = await userClient.auth.getUser()

    if (callerAuthError || !caller) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileError) throw callerProfileError

    if (callerProfile?.role !== 'teacher') {
      return jsonResponse(
        { error: 'Only teachers can import mock test content.' },
        403
      )
    }

    const payload = await req.json().catch(() => ({}))
    const storagePath = payload?.storagePath
    const mimeType = payload?.mimeType || ''
    const module = payload?.module === 'reading' ? 'reading' : 'listening'

    if (!storagePath) {
      return jsonResponse({ error: 'storagePath is required.' }, 400)
    }

    // Short-lived signed URL — the bucket is private, and OpenAI needs
    // to fetch the file itself rather than have bytes pushed to it.
    const { data: signedData, error: signError } = await admin.storage
      .from('mock-content-uploads')
      .createSignedUrl(storagePath, 300)

    if (signError || !signedData?.signedUrl) {
      throw signError || new Error('Could not create a signed URL for that file.')
    }

    const promptText = buildPrompt(module)

    const content = [{ type: 'input_text', text: promptText }]

    if (mimeType.startsWith('image/')) {
      content.push({
        type: 'input_image',
        image_url: signedData.signedUrl,
        detail: 'high',
      })
    } else {
      content.push({
        type: 'input_file',
        file_url: signedData.signedUrl,
      })
    }

    const extraction = await callOpenAiResponses(openaiKey, {
      model: TEXT_MODEL,
      input: [{ role: 'user', content }],
      text: {
        format: {
          type: 'json_schema',
          name: 'mock_content_import',
          strict: true,
          schema: MOCK_IMPORT_SCHEMA,
        },
      },
    })

    const result = parseJsonLoose(extractOutputText(extraction))

    return jsonResponse({ ok: true, result })
  } catch (err) {
    console.error('mock-content-import error:', err)
    return jsonResponse({ error: err?.message || 'Unexpected error.' }, 500)
  }
})
