import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

/*
 * ai-grading — one function, two actions.
 *
 *   action: "extract_criteria"
 *     Teacher-only. Reads a rubric PDF the teacher just uploaded to the
 *     "grading-criteria" storage bucket, asks OpenAI to pull the actual
 *     criteria text out of it, and saves that text (skill: "writing" or
 *     "speaking") so every future evaluation can quote it directly.
 *
 *   action: "evaluate"
 *     Grades one submission — either by reading the essay photos
 *     (writing) or by transcribing the three speaking recordings and
 *     grading the transcript (speaking) — strictly against whichever
 *     criteria text is on file for that skill, and writes the result
 *     onto the submissions row (ai_status / ai_result / ai_error).
 *     Callable by the student who owns the submission (this is what
 *     happens automatically right after they submit) or by the
 *     teacher (a manual "Re-run AI" button).
 *
 * Deploy with: npx supabase functions deploy ai-grading
 * Needs one secret this project doesn't already have:
 *   npx supabase secrets set OPENAI_API_KEY=sk-...
 * (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
 * already provided automatically to every Edge Function.)
 */

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'

// OpenAI renames/replaces its models every so often. Rather than
// hard-code a name that might stop working in a year, both are read
// from optional secrets first, falling back to what's current as of
// this being written (gpt-5.6-terra for text+vision grading and
// reading the criteria PDF; gpt-transcribe for speech-to-text). If
// OpenAI ever retires one of these, there's no need to edit this file
// or redeploy — just set the secret to whatever the new model is
// called:
//   npx supabase secrets set OPENAI_TEXT_MODEL=<new model name>
//   npx supabase secrets set OPENAI_TRANSCRIBE_MODEL=<new model name>
const TEXT_MODEL = Deno.env.get('OPENAI_TEXT_MODEL') || 'gpt-5.6-terra'
const TRANSCRIBE_MODEL =
  Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-transcribe'

// Every evaluation — writing or speaking — comes back in this same
// shape, whatever criterion names the teacher's own rubric happens to
// use, so both chat components can render it identically.
const EVALUATION_SCHEMA = {
  type: 'object',
  properties: {
    overall_band: { type: 'number' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          band: { type: 'number' },
          comment: { type: 'string' },
        },
        required: ['name', 'band', 'comment'],
        additionalProperties: false,
      },
    },
    strengths: { type: 'array', items: { type: 'string' } },
    improvements: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'overall_band',
    'criteria',
    'strengths',
    'improvements',
    'summary',
  ],
  additionalProperties: false,
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

// The Responses API sometimes hands back a convenience `output_text`
// field, and always hands back the full `output` array — walk both so
// this doesn't break if OpenAI stops sending the convenience field.
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

// Structured Outputs (strict json_schema) should already guarantee
// clean JSON, but this is a safety net in case the model ever wraps
// it in a code fence or adds stray text around it.
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

async function transcribeAudio(apiKey, url, label) {
  const audioRes = await fetch(url)

  if (!audioRes.ok) {
    throw new Error(`Could not download the ${label} recording.`)
  }

  const blob = await audioRes.blob()

  const form = new FormData()
  form.append('file', blob, `${label}.webm`)
  form.append('model', TRANSCRIBE_MODEL)

  const res = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  })

  const json = await res.json()

  if (!res.ok) {
    throw new Error(
      json?.error?.message || `Transcribing ${label} failed (${res.status}).`
    )
  }

  return json?.text || ''
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return btoa(binary)
}

function buildWritingPrompt(criteriaText, comment) {
  return [
    "You are an experienced IELTS examiner grading a student's written submission.",
    '',
    "Grade STRICTLY according to the grading criteria below — it may be the standard IELTS Writing band descriptors, or the teacher's own custom rubric. Follow whatever criteria and scoring scale it describes, and use its own criterion names in your answer.",
    '',
    '=== GRADING CRITERIA ===',
    criteriaText,
    '=== END OF GRADING CRITERIA ===',
    '',
    "The attached images are photos or screenshots of the student's actual essay, in reading order. Some may be handwritten — read carefully and do your best with unclear handwriting rather than refusing to grade.",
    comment ? `\nThe student added this note for their teacher: "${comment}"` : '',
    '',
    'Give specific, constructive feedback a real examiner would write — reference actual sentences or issues where useful, not generic advice.',
  ]
    .filter(Boolean)
    .join('\n')
}

function buildSpeakingPrompt(criteriaText, transcripts, comment) {
  return [
    "You are an experienced IELTS examiner grading a student's spoken submission.",
    '',
    "Grade STRICTLY according to the grading criteria below — it may be the standard IELTS Speaking band descriptors, or the teacher's own custom rubric. Follow whatever criteria and scoring scale it describes, and use its own criterion names in your answer.",
    '',
    '=== GRADING CRITERIA ===',
    criteriaText,
    '=== END OF GRADING CRITERIA ===',
    '',
    "Below are automatic transcripts of the student's recorded answers, Part 1 through 3. Minor transcription errors (misheard words, missing punctuation) are possible — judge fluency, coherence, vocabulary, and grammar from the words used, and do not penalize the student for likely transcription artifacts.",
    '',
    transcripts.join('\n\n'),
    comment ? `\nThe student added this note for their teacher: "${comment}"` : '',
    '',
    'Give specific, constructive feedback a real examiner would write.',
  ]
    .filter(Boolean)
    .join('\n')
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
        'OPENAI_API_KEY is not set for this function. Run: npx supabase secrets set OPENAI_API_KEY=sk-...'
      )
    }

    // Client representing whoever is calling this — used only to find
    // out who they are.
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

    // Server-side admin client. NEVER expose this key to React/browser
    // code — every actual read/write below goes through this so RLS
    // never gets in the way of the AI's own work.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', caller.id)
      .maybeSingle()

    if (callerProfileError) throw callerProfileError

    const callerIsTeacher = callerProfile?.role === 'teacher'

    const payload = await req.json().catch(() => ({}))
    const action = payload?.action

    /*
     * ============================================================
     * EXTRACT CRITERIA
     * ============================================================
     */

    if (action === 'extract_criteria') {
      if (!callerIsTeacher) {
        return jsonResponse(
          { error: 'Only teachers can upload grading criteria.' },
          403
        )
      }

      const skill = payload?.skill
      const storagePath = payload?.storagePath
      const fileName =
        typeof payload?.fileName === 'string' && payload.fileName
          ? payload.fileName
          : 'criteria.pdf'

      if (skill !== 'writing' && skill !== 'speaking') {
        return jsonResponse(
          { error: 'skill must be "writing" or "speaking".' },
          400
        )
      }

      if (!storagePath) {
        return jsonResponse({ error: 'storagePath is required.' }, 400)
      }

      const { data: fileBlob, error: downloadError } = await admin.storage
        .from('grading-criteria')
        .download(storagePath)

      if (downloadError || !fileBlob) {
        throw downloadError || new Error('Could not read the uploaded file.')
      }

      const bytes = new Uint8Array(await fileBlob.arrayBuffer())
      const base64 = bytesToBase64(bytes)

      const extraction = await callOpenAiResponses(openaiKey, {
        model: TEXT_MODEL,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_file',
                filename: fileName,
                file_data: `data:application/pdf;base64,${base64}`,
              },
              {
                type: 'input_text',
                text: 'Extract the complete grading criteria / rubric described in this document, verbatim, as plain text. Preserve every band or level, its full description, all criterion names, and any numeric scale. Do not summarize, shorten, or add commentary — output only the criteria content itself.',
              },
            ],
          },
        ],
      })

      const criteriaText = extractOutputText(extraction).trim()

      if (!criteriaText) {
        throw new Error(
          'The AI could not read any criteria text from that file.'
        )
      }

      const { error: upsertError } = await admin
        .from('grading_criteria')
        .upsert(
          {
            skill,
            file_name: fileName,
            file_path: storagePath,
            criteria_text: criteriaText,
            updated_by: caller.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'skill' }
        )

      if (upsertError) throw upsertError

      return jsonResponse({ criteria_text: criteriaText })
    }

    /*
     * ============================================================
     * EVALUATE
     * ============================================================
     */

    if (action === 'evaluate') {
      const submissionId = payload?.submissionId

      if (!submissionId) {
        return jsonResponse({ error: 'submissionId is required.' }, 400)
      }

      const { data: submission, error: submissionError } = await admin
        .from('submissions')
        .select('*')
        .eq('id', submissionId)
        .maybeSingle()

      if (submissionError) throw submissionError

      if (!submission) {
        return jsonResponse({ error: 'Submission not found.' }, 404)
      }

      const canTrigger =
        callerIsTeacher || submission.student_id === caller.id

      if (!canTrigger) {
        return jsonResponse(
          { error: 'Not allowed to evaluate this submission.' },
          403
        )
      }

      const { data: homework, error: homeworkError } = await admin
        .from('homeworks')
        .select('*')
        .eq('id', submission.homework_id)
        .maybeSingle()

      if (homeworkError) throw homeworkError

      if (!homework) {
        return jsonResponse({ error: 'Homework not found.' }, 404)
      }

      if (!homework.ai_eval_enabled) {
        return jsonResponse({
          skipped: true,
          reason: 'AI grading is not enabled for this homework.',
        })
      }

      const skill = homework.enable_speaking ? 'speaking' : 'writing'

      await admin
        .from('submissions')
        .update({ ai_status: 'processing', ai_error: null })
        .eq('id', submissionId)

      try {
        const { data: criteria, error: criteriaError } = await admin
          .from('grading_criteria')
          .select('criteria_text')
          .eq('skill', skill)
          .maybeSingle()

        if (criteriaError) throw criteriaError

        const criteriaText = criteria?.criteria_text?.trim()

        if (!criteriaText) {
          throw new Error(
            `No ${skill} grading criteria has been uploaded yet. Upload one from the AI Grading tab.`
          )
        }

        let result

        if (skill === 'speaking') {
          const parts = [
            { key: 'audio_part1_url', label: 'Part 1' },
            { key: 'audio_part2_url', label: 'Part 2' },
            { key: 'audio_part3_url', label: 'Part 3' },
          ]

          const transcripts = []

          for (const part of parts) {
            const url = submission[part.key]
            if (!url) continue

            const text = await transcribeAudio(openaiKey, url, part.label)
            transcripts.push(`${part.label}:\n${text || '(no speech detected)'}`)
          }

          if (!transcripts.length) {
            throw new Error(
              'No speaking recordings were submitted to evaluate.'
            )
          }

          const promptText = buildSpeakingPrompt(
            criteriaText,
            transcripts,
            submission.comment
          )

          const evaluation = await callOpenAiResponses(openaiKey, {
            model: TEXT_MODEL,
            input: [
              { role: 'user', content: [{ type: 'input_text', text: promptText }] },
            ],
            text: {
              format: {
                type: 'json_schema',
                name: 'band_evaluation',
                strict: true,
                schema: EVALUATION_SCHEMA,
              },
            },
          })

          result = parseJsonLoose(extractOutputText(evaluation))
        } else {
          const images = submission.screenshot_urls || []

          if (!images.length) {
            throw new Error('No images were submitted to evaluate.')
          }

          const promptText = buildWritingPrompt(
            criteriaText,
            submission.comment
          )

          const content = [
            { type: 'input_text', text: promptText },
            ...images.map((url) => ({
              type: 'input_image',
              image_url: url,
              detail: 'high',
            })),
          ]

          const evaluation = await callOpenAiResponses(openaiKey, {
            model: TEXT_MODEL,
            input: [{ role: 'user', content }],
            text: {
              format: {
                type: 'json_schema',
                name: 'band_evaluation',
                strict: true,
                schema: EVALUATION_SCHEMA,
              },
            },
          })

          result = parseJsonLoose(extractOutputText(evaluation))
        }

        await admin
          .from('submissions')
          .update({
            ai_status: 'done',
            ai_result: result,
            ai_evaluated_at: new Date().toISOString(),
            ai_error: null,
          })
          .eq('id', submissionId)

        return jsonResponse({ ok: true, result })
      } catch (evalError) {
        console.error('AI evaluation failed:', evalError)

        await admin
          .from('submissions')
          .update({
            ai_status: 'error',
            ai_error: evalError?.message || 'AI evaluation failed.',
          })
          .eq('id', submissionId)

        return jsonResponse(
          { error: evalError?.message || 'AI evaluation failed.' },
          500
        )
      }
    }

    return jsonResponse({ error: `Unknown action "${action}".` }, 400)
  } catch (err) {
    console.error('ai-grading error:', err)
    return jsonResponse({ error: err?.message || 'Unexpected error.' }, 500)
  }
})
