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
 * structured draft: one entry per passage (Reading) or part
 * (Listening) it actually found in the document — each with its own
 * title, passage/transcript text if present, and question list (type,
 * prompt, choices, correct answer where an answer key is actually
 * visible in the document). The caller (TeacherMockCenter.jsx) drops
 * that straight into the SAME editable question builder used for
 * manual entry — nothing is written to the database here. The teacher
 * reviews, fixes anything wrong, fills in any answer the AI left
 * blank, then presses the normal Save button. This mirrors the
 * two-step "extract, then review-and-save" design from mock-test-site-
 * concept.md, just reusing the existing form as the review screen
 * instead of a separate one.
 *
 * 2026-09-26 fix: Jasur's teacher uploaded a whole Reading paper (3
 * passages) and only got Passage 1 back. Root cause — this function's
 * schema used to have room for exactly ONE section per call
 * (section_title/passage_text/questions as flat top-level fields), so
 * even when the model could see all 3 passages on the page, there was
 * nowhere in the response shape to put more than one. Fixed by
 * wrapping that same shape in a `sections` ARRAY and telling the model
 * explicitly to return one entry per passage/part it finds — a single
 * page still comes back as a one-item array, so every existing caller
 * needed the same one-line change (read result.sections[0] plus, for a
 * caller that supports it, the rest of the array) rather than a
 * rewrite.
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

// One entry per passage (Reading) or part (Listening) found in the
// document — see the 2026-09-26 comment up top for why this is an
// array now instead of a single flat object.
const IMPORT_SECTION_SCHEMA = {
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
        'The full reading passage or listening transcript/script text, verbatim, if the document actually contains it. Empty string if the document is questions only (no passage/transcript printed). Preserve the original paragraph breaks: separate each paragraph with a blank line (two newline characters), never collapse the whole passage into one continuous block.',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order_index: {
            type: 'integer',
            description:
              'Starts at 0 for EACH section — the first question of Passage 2 is order_index 0 again, not a continuation of Passage 1\'s numbering.',
          },
          type: {
            type: 'string',
            enum: [
              'multiple_choice',
              'multi_select',
              'true_false_ng',
              'yes_no_ng',
              'matching',
              'short_answer',
            ],
          },
          prompt: { type: 'string' },
          choices: {
            type: 'array',
            items: { type: 'string' },
            description:
              'For multiple_choice, multi_select, and matching — the full list of choices (or the bank of options being matched against), in order. Empty array for every other type.',
          },
          correct_answer: {
            type: 'string',
            description:
              'Only fill this in when an answer key is genuinely printed in the document. Otherwise leave it as an empty string so the teacher fills it in. For multi_select, when there IS an answer key, join every correct choice with ", " (comma-space), in the same order those choices appear in "choices" — never in click/answer order.',
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

const MOCK_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      minItems: 1,
      items: IMPORT_SECTION_SCHEMA,
      description:
        'One entry per passage (Reading) or part (Listening) actually present in the document, in the order they appear. A document with just one passage/part on it still comes back as a one-item array.',
    },
  },
  required: ['sections'],
  additionalProperties: false,
}

// "Upload answer key" — a separate, smaller ask than the full content
// import above: after a test is already built (by hand, by import, or
// both), the teacher can upload just the official answer key document
// (an answer sheet, an underlined/marked copy, anything with "1. B, 2.
// TRUE, 3. beach..."-style entries) and this fills in whichever
// questions still have a blank correct_answer, matched purely by
// question number/order — nothing else about the question changes.
const ANSWER_KEY_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          order_index: {
            type: 'integer',
            description:
              'The printed question number, converted to start at 0 (printed "1" -> 0, printed "2" -> 1, and so on).',
          },
          correct_answer: { type: 'string' },
        },
        required: ['order_index', 'correct_answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
}

function buildAnswerKeyPrompt() {
  return [
    'This document is an answer key for an IELTS mock test — a list of question numbers each with its correct answer (for example "1. B", "21. TRUE", "5. beach", or a table/underlined-choice layout that means the same thing).',
    '',
    'Extract every entry you can find as {order_index, correct_answer}. Convert the printed question number to a 0-based index: printed question 1 becomes order_index 0, printed question 2 becomes order_index 1, and so on.',
    '',
    'For a True/False/Not Given answer, write exactly "True", "False", or "Not Given". For a Yes/No/Not Given answer, write exactly "Yes", "No", or "Not Given" — don\'t convert it to True/False. For a single-choice or matching answer, write just the letter or the exact choice text as printed in the key. For a question with more than one correct answer (a "choose two/three" style question), write all of the correct letters or choices joined by ", " (comma-space), in the order they are printed in the key. For anything else, write the answer exactly as printed.',
    '',
    "Only include entries you can actually read from the document — don't guess or fill in a number that isn't there.",
    '',
    'Return nothing except the structured list — no commentary.',
  ].join('\n')
}

function buildPrompt(module) {
  const moduleLabel = module === 'reading' ? 'Reading' : 'Listening'
  const unitWord = module === 'reading' ? 'passage' : 'part'
  const usualCount = module === 'reading' ? '3 passages' : '4 parts'
  const headingExamples =
    module === 'reading'
      ? '"READING PASSAGE 1", "READING PASSAGE 2", "Passage 3"'
      : '"Part 1", "Part 2", "SECTION 3", "Part 4"'

  return [
    `You are helping an IELTS teacher import a real ${moduleLabel} question paper into a mock-test builder.`,
    '',
    'Read the attached document (it may be a typed document, a scanned page, or a photo — some may be low quality; do your best) and extract its content into the structure requested.',
    '',
    `FIRST — figure out how many ${unitWord}s are actually in this document. It might be a single ${unitWord} on its own (one page, or a short excerpt), or it might be the FULL test paper containing every ${unitWord} at once (a complete IELTS ${moduleLabel} paper normally has ${usualCount}). Look for headings like ${headingExamples} or a clear break where one ${unitWord}'s questions end and a new ${unitWord} (with its own text and its own question numbers restarting a new group) begins. Return ONE entry in "sections" for every distinct ${unitWord} you actually find, in the order they appear — never merge two different ${unitWord}s into one entry, and never split one ${unitWord} into two. If the document truly only contains a single ${unitWord}, "sections" should have exactly one entry — don't invent extra empty ones to hit ${usualCount}.`,
    '',
    `For EACH ${unitWord} (each entry in "sections"), extract it the same way:`,
    '',
    'Every question you find must be mapped to exactly ONE of these six types, since that is all the builder supports today:',
    '- multiple_choice — the question lists lettered/numbered answer choices and the student picks exactly ONE. Extract every choice, in order, into "choices".',
    '- multi_select — the question explicitly asks for MORE THAN ONE answer from a list of choices (e.g. "Choose TWO letters", "Choose THREE answers"). Extract every choice, in order, into "choices", same as multiple_choice.',
    '- true_false_ng — the question asks whether a factual statement is True, False, or Not Given.',
    '- yes_no_ng — the question asks whether a statement agrees with the writer\'s claims/views — Yes, No, or Not Given. Do NOT map this to true_false_ng even though the shape looks similar: True/False/Not Given and Yes/No/Not Given are different question types in real IELTS papers and must come back with their own type here.',
    '- matching — the question asks the student to match something (a paragraph, a heading, a name, a piece of information) to ONE option out of a shared bank of options printed once for the whole group (matching headings, matching information, matching names/features, and similar). Put the full bank of options, in order, into "choices" — the same bank is usually reused across several matching questions in the same group.',
    '- short_answer — every kind of gap-filling / completion question, PLUS plain short-answer questions: sentence completion, summary completion, note completion, table completion, flow-chart completion, and diagram/map/plan label completion all belong here — anywhere the student types the missing word(s) into a blank rather than picking from a list. "prompt" should make clear exactly what they need to type (include the surrounding sentence/label with its blank so the question stands on its own without needing to see the original page layout). This type covers every "gap fill" style question in the paper — there is no separate gap-filling type, they all map to short_answer.',
    '',
    `Number the questions in "order_index" starting at 0 WITHIN EACH SECTION — the first question of the second ${unitWord} is order_index 0 again, not a continuation of the first ${unitWord}'s numbering (the builder inserts each ${unitWord}'s questions separately and renumbers them itself).`,
    '',
    'CRITICAL — correct answers: only put a value in "correct_answer" when this document actually shows an answer key (a separate answer list, an underlined/marked correct choice, or similar). Do NOT guess or infer an answer from general knowledge — grading later is an exact text match, so a wrong guess would silently mark every student wrong. If there is no visible answer key for a question, leave "correct_answer" as an empty string and leave it for the teacher to fill in. For true_false_ng, when you do have a real answer key, write it as exactly "True", "False", or "Not Given"; for yes_no_ng write exactly "Yes", "No", or "Not Given". For multi_select, when you do have a real answer key, write every correct choice joined by ", " (comma-space), in the same order those choices are listed in "choices" — never in the order the answer key happens to print them.',
    '',
    'If a section includes the reading passage or the listening transcript/script text, put the complete text (verbatim) in that section\'s "passage_text". If it is a questions-only section, leave "passage_text" as an empty string.',
    '',
    'IMPORTANT — keep the paragraph structure: the source document is written in paragraphs, so "passage_text" must be too. Insert a blank line (two newline characters, i.e. "\\n\\n") between each paragraph exactly where the original paragraph breaks fall. Do not run every paragraph together into one continuous block of text — a passage with 6 paragraphs on the page must come back as 6 paragraphs separated by blank lines, not one long paragraph.',
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
    const mode = payload?.mode === 'answer_key' ? 'answer_key' : 'content'

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

    const promptText = mode === 'answer_key' ? buildAnswerKeyPrompt() : buildPrompt(module)

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
        format:
          mode === 'answer_key'
            ? {
                type: 'json_schema',
                name: 'mock_answer_key_import',
                strict: true,
                schema: ANSWER_KEY_SCHEMA,
              }
            : {
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
