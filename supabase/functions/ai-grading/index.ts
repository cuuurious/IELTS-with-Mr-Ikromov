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

// OpenAI's transcription endpoint works out the audio codec mostly
// from the filename it's given in the multipart upload — so telling
// it every recording is "<label>.webm" (which the code used to do,
// unconditionally) breaks the moment the real file isn't webm: an
// .m4a from an iPhone's Voice Memos upload, an .mp3/.wav/.ogg upload,
// or even a live browser recording on a browser that doesn't actually
// produce webm. OpenAI sees bytes that don't match the claimed
// format and rejects them as "corrupted or unsupported" — which is
// exactly the error students were hitting. These two helpers work out
// the real extension instead of assuming one.
function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\.([a-zA-Z0-9]+)$/)
    return match ? match[1].toLowerCase() : null
  } catch {
    return null
  }
}

function extensionFromContentType(contentType) {
  if (!contentType) return null

  const base = contentType.split(';')[0].trim().toLowerCase()

  const map = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/wave': 'wav',
    'audio/vnd.wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/oga': 'oga',
    'audio/opus': 'opus',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/amr': 'amr',
    'audio/3gpp': '3gp',
    'audio/aac': 'aac',
    'audio/x-aac': 'aac',
  }

  return map[base] || null
}

async function transcribeAudio(apiKey, url, label) {
  const audioRes = await fetch(url)

  if (!audioRes.ok) {
    throw new Error(`Could not download the ${label} recording.`)
  }

  const blob = await audioRes.blob()

  // Try the storage URL's own extension first (uploaded files keep
  // their real name — .m4a, .mp3, .wav, .ogg — and recordings are
  // always saved as .webm), then the response's content-type, then
  // the blob's own reported type, and only fall back to .webm if none
  // of those say otherwise.
  const extension =
    extensionFromUrl(url) ||
    extensionFromContentType(audioRes.headers.get('content-type')) ||
    extensionFromContentType(blob.type) ||
    'webm'

  const form = new FormData()
  form.append('file', blob, `${label}.${extension}`)
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

// Left unguided, the model tends to form one holistic impression of
// the submission and then paste that same number into every criterion
// — which is exactly what the descriptive comments in this app were
// NOT doing (they clearly differ per criterion) while the numbers all
// came back "7". This block is shared by both prompts to force the
// scoring itself, not just the prose, to actually reflect that.
const SCORING_DISCIPLINE = [
  'Score every criterion independently. Evaluate and decide the band for each criterion using ONLY the evidence relevant to that specific criterion, one at a time — do not decide a single overall impression first and then copy it into every criterion.',
  "It is normal, and expected, for a real submission to be stronger in some criteria than others. If after honestly scoring each criterion on its own they all happen to land on the exact same number, that's fine — but treat identical scores across the board as a signal to double-check you actually evaluated each one separately rather than defaulted to a gut feeling.",
  'Use the full scale the criteria describe, including any fractional/half-band scores it allows, not just whole numbers — do not round to the nearest whole or "safe middle" value out of caution.',
  "overall_band should be a genuine aggregate of the individual criterion bands you actually gave (following the rubric's own method for combining them if it states one; otherwise average the criteria and round the way the exam type normally does) — it should not be an independently-guessed number that the criteria are then forced to match.",
].join(' ')

function buildWritingPrompt(criteriaText, comment, files = []) {
  const submissionNote =
    files.length > 0
      ? "The student's essay is attached below — either as photos/screenshots (read in order, some may be handwritten; do your best with unclear handwriting rather than refusing to grade) or as an uploaded document file (e.g. Word, PDF, or text). Read whichever form is present."
      : "The attached images are photos or screenshots of the student's actual essay, in reading order. Some may be handwritten — read carefully and do your best with unclear handwriting rather than refusing to grade."

  return [
    "You are an experienced IELTS examiner grading a student's written submission.",
    '',
    "Grade STRICTLY according to the grading criteria below — it may be the standard IELTS Writing band descriptors, or the teacher's own custom rubric. Follow whatever criteria and scoring scale it describes, and use its own criterion names in your answer.",
    '',
    '=== GRADING CRITERIA ===',
    criteriaText,
    '=== END OF GRADING CRITERIA ===',
    '',
    submissionNote,
    comment ? `\nThe student added this note for their teacher: "${comment}"` : '',
    '',
    'Give specific, constructive feedback a real examiner would write — reference actual sentences or issues where useful, not generic advice.',
    '',
    SCORING_DISCIPLINE,
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
    '',
    SCORING_DISCIPLINE,
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
          const files = (submission.submission_files || []).filter(
            (f) => f?.url
          )

          if (!images.length && !files.length) {
            throw new Error(
              'No essay photos or files were submitted to evaluate.'
            )
          }

          const promptText = buildWritingPrompt(
            criteriaText,
            submission.comment,
            files
          )

          const content = [
            { type: 'input_text', text: promptText },
            ...images.map((url) => ({
              type: 'input_image',
              image_url: url,
              detail: 'high',
            })),
            // A student can submit the essay as an uploaded document
            // (docx, pdf, txt, ...) instead of, or alongside, photos.
            // OpenAI fetches the file itself from this public Supabase
            // Storage URL and extracts its text — no need to download
            // or base64-encode it ourselves.
            ...files.map((f) => ({
              type: 'input_file',
              file_url: f.url,
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
