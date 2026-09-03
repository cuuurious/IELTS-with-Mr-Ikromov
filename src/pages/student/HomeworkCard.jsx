import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { guessMimeType } from '../../lib/mime'
import {
  buildAccept,
  matchesSubmissionType,
  extensionOf,
} from '../../lib/submissionTypes'
import AudioRecorder from '../../components/AudioRecorder'
import StampBadge, {
  getSubmissionStatus,
  isLateSubmission,
} from '../../components/StampBadge'
import AiFeedbackCard from '../../components/AiFeedbackCard'

// Fire-and-forget: asks the ai-grading Edge Function to evaluate a
// just-submitted homework. Silently does nothing if the homework
// doesn't have AI grading turned on — the function itself checks that
// too, but skipping the network call here avoids the wasted request
// on every ordinary homework.
const requestAiEvaluation = (submissionId, homework) => {
  if (!homework?.ai_eval_enabled || !submissionId) return

  supabase.functions
    .invoke('ai-grading', {
      body: { action: 'evaluate', submissionId },
    })
    .catch((err) => {
      console.error('AI evaluation request failed:', err)
    })
}

// Resubmitting an AI-graded task re-runs the (paid) AI evaluation and
// throws away the previous feedback. Rather than let a stray click —
// or an accidental wrong file, like the one that started this — burn
// another AI request silently, this asks the student to actually look
// at what they're about to send before it goes out. Only shown on a
// RESUBMIT (the first submission never asks, so normal homework flow
// stays exactly as fast as before).
const confirmAiResubmission = ({ images = [], files = [], speaking = false }) => {
  const what = speaking
    ? 'your three speaking recordings'
    : [
        images.length
          ? `${images.length} photo${images.length === 1 ? '' : 's'}`
          : null,
        files.length
          ? files
              .map((f) => f?.name || 'a file')
              .join(', ')
          : null,
      ]
        .filter(Boolean)
        .join(' and ') || 'your files'

  return window.confirm(
    `You already submitted this — resubmitting will send ${what} to AI grading again and replace your current feedback.\n\nDouble check this is the right, final version before continuing. Submit again?`
  )
}

const PARTS = [
  {
    key: 'audio_part1_url',
    label: 'Speaking — Part 1',
  },
  {
    key: 'audio_part2_url',
    label: 'Speaking — Part 2',
  },
  {
    key: 'audio_part3_url',
    label: 'Speaking — Part 3',
  },
]

export default function HomeworkCard({
  homework,
  submission,
  studentId,
  onChange,
}) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [comment, setComment] = useState(
    submission?.comment || ''
  )
  const [savingComment, setSavingComment] = useState(false)

  const [speakingParts, setSpeakingParts] = useState({
    audio_part1_url:
      submission?.audio_part1_url || null,
    audio_part2_url:
      submission?.audio_part2_url || null,
    audio_part3_url:
      submission?.audio_part3_url || null,
  })

  const fileInputRef = useRef(null)

  const allowedTypes =
    homework.allowed_submission_types?.length
      ? homework.allowed_submission_types
      : ['image']

  const minFiles =
    homework.min_submission_files ?? 1

  const maxFiles =
    homework.max_submission_files ?? 10

  const existingImages =
    submission?.screenshot_urls || []

  const existingFiles =
    submission?.submission_files || []

  const existingCount =
    existingImages.length +
    existingFiles.length

  // saveFiles() below reads from this ref instead of the
  // existingImages/existingFiles variables above. Those are fine for
  // rendering, but a paste-triggered save reads them from inside a
  // window 'paste' listener set up by a useEffect that doesn't
  // re-subscribe on every render — so without this ref, a second
  // paste (even a sequential one, right after the first upload
  // finishes) could still compute its "existing files" list from a
  // stale, pre-upload snapshot and silently drop the first file when
  // it overwrites the row. The ref is always current: it's kept in
  // sync with the submission prop, and also updated immediately after
  // this component's own successful saves, so every save always
  // builds on the real latest list.
  const submissionRef = useRef(submission)

  useEffect(() => {
    submissionRef.current = submission
  }, [submission])

  // Serializes calls to saveFiles so a paste that arrives while an
  // earlier upload is still saving queues up behind it instead of
  // racing it — both would otherwise read the same "existing files"
  // snapshot and the second upsert would overwrite the first.
  const saveQueueRef = useRef(Promise.resolve())

  const status = getSubmissionStatus(
    submission,
    homework.due_date
  )

  const submittedLate = isLateSubmission(
    submission,
    homework.due_date
  )


  useEffect(() => {
    setSpeakingParts({
      audio_part1_url:
        submission?.audio_part1_url || null,
      audio_part2_url:
        submission?.audio_part2_url || null,
      audio_part3_url:
        submission?.audio_part3_url || null,
    })

    if (
      submission &&
      typeof submission.comment === 'string'
    ) {
      setComment(submission.comment)
    }
  }, [
    submission?.id,
    submission?.audio_part1_url,
    submission?.audio_part2_url,
    submission?.audio_part3_url,
    submission?.comment,
  ])

  /*
   * ============================================================
   * NORMAL TASK STATUS
   * ============================================================
   */

  const taskAlreadySubmitted =
    !homework.enable_speaking &&
    submission?.status === 'done' &&
    Boolean(submission?.submitted_at)

  /*
   * ============================================================
   * SPEAKING STATUS
   * ============================================================
   */

  const speakingAlreadySubmitted =
    homework.enable_speaking &&
    submission?.status === 'done' &&
    Boolean(submission?.submitted_at)

  /*
   * ============================================================
   * UPSERT SUBMISSION
   * ============================================================
   */

  const upsertSubmission = async (patch) => {
    const { data, error } = await supabase
      .from('submissions')
      .upsert(
        {
          id: submission?.id,
          homework_id: homework.id,
          student_id: studentId,
          group_id: homework.group_id,
          ...patch,
        },
        {
          onConflict:
            'homework_id,student_id',
        }
      )
      .select()
      .single()

    if (error) {
      throw error
    }

    onChange(data)

    setSpeakingParts((previous) => ({
      ...previous,
      audio_part1_url:
        data?.audio_part1_url || null,
      audio_part2_url:
        data?.audio_part2_url || null,
      audio_part3_url:
        data?.audio_part3_url || null,
    }))

    return data
  }

  /*
   * ============================================================
   * MARK HOMEWORK AS COMPLETED
   * ============================================================
   *
   * IMPORTANT:
   *
   * The leaderboard uses homework_completions for completed
   * homework in group leaderboards.
   *
   * Submitting a homework therefore needs to create a
   * homework_completions row as well as the submissions row.
   *
   * We deliberately check first so we don't create duplicate
   * completion records.
   * ============================================================
   */

  const markHomeworkCompleted =
    async () => {
      const {
        data: existing,
        error: lookupError,
      } = await supabase
        .from('homework_completions')
        .select(
          'student_id, homework_id, completed_at'
        )
        .eq(
          'student_id',
          studentId
        )
        .eq(
          'homework_id',
          homework.id
        )
        .limit(1)

      if (lookupError) {
        throw lookupError
      }

      if (
        existing &&
        existing.length > 0
      ) {
        return existing[0]
      }

      const {
        data,
        error: completionError,
      } = await supabase
        .from('homework_completions')
        .insert({
          student_id: studentId,
          homework_id: homework.id,
          completed_at:
            new Date().toISOString(),
        })
        .select()
        .single()

      if (completionError) {
        throw completionError
      }

      return data
    }

  /*
   * ============================================================
   * STORAGE UPLOAD
   * ============================================================
   *
   * The student's original filename is NEVER used as the
   * Supabase Storage object key.
   * ============================================================
   */

  const uploadFile = async (
    file,
    originalName
  ) => {
    if (!file) {
      throw new Error(
        'No file was selected.'
      )
    }

    const name =
      typeof originalName === 'string' &&
      originalName.trim()
        ? originalName.trim()
        : file.name || 'file'

    const rawExtension =
      name.includes('.')
        ? name
            .split('.')
            .pop()
            .toLowerCase()
        : ''

    const extension =
      /^[a-z0-9]{1,10}$/.test(
        rawExtension
      )
        ? rawExtension
        : ''

    let uniqueId

    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID ===
        'function'
    ) {
      uniqueId = crypto.randomUUID()
    } else {
      uniqueId =
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 12)}`
    }

    const safeFileName =
      extension
        ? `${uniqueId}.${extension}`
        : uniqueId

    const path =
      `${studentId}/${homework.id}/${safeFileName}`

    console.log(
      'Uploading homework file:',
      {
        originalName: name,
        storagePath: path,
        mimeType: file.type,
        size: file.size,
      }
    )

    const {
      error: uploadError,
    } = await supabase.storage
      .from('submissions')
      .upload(
        path,
        file,
        {
          upsert: false,
          contentType:
            guessMimeType(
              name,
              file.type || ''
            ),
        }
      )

    if (uploadError) {
      console.error(
        'Homework Storage upload failed:',
        {
          error: uploadError,
          message:
            uploadError.message,
          path,
          originalName: name,
          fileType: file.type,
          fileSize: file.size,
        }
      )

      throw new Error(
        uploadError.message ||
          'Failed to upload file.'
      )
    }

    const {
      data: publicUrlData,
    } = supabase.storage
      .from('submissions')
      .getPublicUrl(path)

    if (
      !publicUrlData?.publicUrl
    ) {
      throw new Error(
        'File uploaded, but the file URL could not be created.'
      )
    }

    return publicUrlData.publicUrl
  }

  /*
   * ============================================================
   * NORMAL FILE VALIDATION
   * ============================================================
   */

  // Note: the max-file-count check used to live here, but it read
  // existingCount from render scope, which could be stale by the time
  // a queued save actually runs. That check now happens in
  // runSaveFiles right before this is called, using the always-current
  // submissionRef — this function only checks file type.
  const validateFiles = (files) => {
    for (const file of files) {
      if (
        !allowedTypes.some(
          (type) =>
            matchesSubmissionType(
              file,
              type
            )
        )
      ) {
        throw new Error(
          `${file.name} is not an allowed file type for this homework.`
        )
      }
    }
  }

  /*
   * ============================================================
   * SAVE NORMAL FILES
   * ============================================================
   */

  const runSaveFiles = async (files) => {
    if (!files.length) {
      return
    }

    // Read the "existing so far" lists from the ref (always current)
    // rather than the existingImages/existingFiles closure variables,
    // so this reflects any save that finished just ahead of this one
    // in the queue — including one triggered by a stale paste-handler
    // closure from an earlier render.
    const baseImages =
      submissionRef.current?.screenshot_urls || []

    const baseFiles =
      submissionRef.current?.submission_files || []

    if (
      baseImages.length +
        baseFiles.length +
        files.length >
      maxFiles
    ) {
      throw new Error(
        `This homework allows a maximum of ${maxFiles} file${
          maxFiles === 1
            ? ''
            : 's'
        }.`
      )
    }

    validateFiles(files)

    setUploading(true)
    setError('')

    try {
      const newImages = []
      const newFiles = []

      for (const file of files) {
        const url =
          await uploadFile(
            file,
            file.name
          )

        const extension =
          extensionOf(
            file.name
          )

        const isImage =
          file.type.startsWith(
            'image/'
          ) ||
          [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
          ].includes(
            extension
          )

        if (isImage) {
          newImages.push(url)
        } else {
          newFiles.push({
            url,
            name: file.name,
            type:
              file.type ||
              extension,
          })
        }
      }

      /*
       * Uploading does NOT submit the homework.
       *
       * Student must explicitly click Submit Task.
       */
      const saved = await upsertSubmission({
        screenshot_urls: [
          ...baseImages,
          ...newImages,
        ],
        submission_files: [
          ...baseFiles,
          ...newFiles,
        ],
        status: 'pending',
        submitted_at:
          submissionRef.current?.submitted_at ||
          null,
      })

      // Update immediately so the next queued save (or the very next
      // paste, if it arrives before this component re-renders with
      // the new submission prop) builds on this save's result instead
      // of an outdated one.
      submissionRef.current = saved
    } catch (err) {
      console.error(
        'Homework file save error:',
        err
      )

      setError(
        err?.message ||
          'Failed to upload homework files.'
      )
    } finally {
      setUploading(false)
    }
  }

  const saveFiles = (files) => {
    // Chain onto the queue regardless of whether the previous save
    // succeeded or failed, so one failed upload doesn't permanently
    // jam the queue for later pastes/uploads.
    const next = saveQueueRef.current.then(
      () => runSaveFiles(files),
      () => runSaveFiles(files)
    )

    saveQueueRef.current = next.catch(() => {})

    return next
  }

  /*
   * ============================================================
   * NORMAL FILE INPUT
   * ============================================================
   */

  const handleFiles = async (e) => {
    const files = Array.from(
      e.target.files || []
    )

    e.target.value = ''

    await saveFiles(files)
  }

  /*
   * ============================================================
   * PASTE IMAGES
   * ============================================================
   */

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const onPaste = (e) => {
      const images =
        Array.from(
          e.clipboardData?.items || []
        )
          .filter(
            (item) =>
              item.kind === 'file' &&
              item.type.startsWith(
                'image/'
              )
          )
          .map((item) =>
            item.getAsFile()
          )
          .filter(Boolean)

      if (images.length) {
        e.preventDefault()
        saveFiles(images)
      }
    }

    window.addEventListener(
      'paste',
      onPaste
    )

    return () => {
      window.removeEventListener(
        'paste',
        onPaste
      )
    }
  }, [
    open,
    existingCount,
    maxFiles,
    minFiles,
    allowedTypes,
    submission?.id,
  ])

  /*
   * ============================================================
   * NORMAL TASK SUBMIT
   * ============================================================
   */

  const handleTaskSubmit =
    async () => {
      setError('')

      if (
        existingCount <
        minFiles
      ) {
        setError(
          `Please upload at least ${minFiles} file${
            minFiles === 1
              ? ''
              : 's'
          } before submitting.`
        )
        return
      }

      if (
        homework?.ai_eval_enabled &&
        taskAlreadySubmitted &&
        !confirmAiResubmission({
          images: existingImages,
          files: existingFiles,
        })
      ) {
        return
      }

      setUploading(true)

      try {
        /*
         * First save the actual submission.
         */
        const saved = await upsertSubmission({
          status: 'done',
          submitted_at:
            new Date().toISOString(),
        })

        /*
         * Then record the homework completion.
         *
         * This is what the group leaderboard uses.
         */
        await markHomeworkCompleted()

        requestAiEvaluation(saved?.id, homework)
      } catch (err) {
        console.error(
          'Homework submission error:',
          err
        )

        setError(
          err?.message ||
            'Failed to submit homework.'
        )
      } finally {
        setUploading(false)
      }
    }

  /*
   * ============================================================
   * SPEAKING RECORDING
   * ============================================================
   */

  const handleAudio = async (
    blob,
    fieldKey,
    fileName
  ) => {
    setUploading(true)
    setError('')

    try {
      const url =
        await uploadFile(
          blob,
          `${fileName}.webm`
        )

      setSpeakingParts(
        (previous) => ({
          ...previous,
          [fieldKey]: url,
        })
      )

      await upsertSubmission({
        [fieldKey]: url,
        status: 'pending',
        submitted_at: null,
      })
    } catch (err) {
      console.error(
        'Speaking recording upload error:',
        err
      )

      setError(
        err?.message ||
          'Failed to save speaking recording.'
      )
    } finally {
      setUploading(false)
    }
  }

  /*
   * ============================================================
   * SPEAKING MP3 / WAV UPLOAD
   * ============================================================
   */

  const handleAudioUpload =
    async (
      file,
      fieldKey,
      fileName
    ) => {
      if (
        !matchesSubmissionType(
          file,
          'mp3'
        ) &&
        !matchesSubmissionType(
          file,
          'wav'
        ) &&
        !matchesSubmissionType(
          file,
          'other'
        )
      ) {
        setError(
          'Please upload an MP3 or WAV file.'
        )
        return
      }

      setUploading(true)
      setError('')

      try {
        const url =
          await uploadFile(
            file,
            file.name ||
              `${fileName}.mp3`
          )

        setSpeakingParts(
          (previous) => ({
            ...previous,
            [fieldKey]: url,
          })
        )

        await upsertSubmission({
          [fieldKey]: url,
          status: 'pending',
          submitted_at: null,
        })
      } catch (err) {
        console.error(
          'Speaking MP3/WAV upload error:',
          err
        )

        setError(
          err?.message ||
            'Failed to upload speaking audio.'
        )
      } finally {
        setUploading(false)
      }
    }

  /*
   * ============================================================
   * DELETE SPEAKING PART
   * ============================================================
   */

  const handleAudioDelete =
    async (fieldKey) => {
      setError('')

      try {
        setSpeakingParts(
          (previous) => ({
            ...previous,
            [fieldKey]: null,
          })
        )

        await upsertSubmission({
          [fieldKey]: null,
          status: 'pending',
          submitted_at: null,
        })
      } catch (err) {
        console.error(
          'Speaking part delete error:',
          err
        )

        setError(
          err?.message ||
            'Failed to delete speaking part.'
        )
      }
    }

  /*
   * ============================================================
   * SPEAKING SUBMIT
   * ============================================================
   */

  const handleSpeakingSubmit =
    async () => {
      setError('')

      const allPartsReady =
        Boolean(
          speakingParts.audio_part1_url
        ) &&
        Boolean(
          speakingParts.audio_part2_url
        ) &&
        Boolean(
          speakingParts.audio_part3_url
        )

      if (!allPartsReady) {
        setError(
          'Please record or upload all three speaking parts before submitting.'
        )
        return
      }

      if (
        homework?.ai_eval_enabled &&
        speakingAlreadySubmitted &&
        !confirmAiResubmission({ speaking: true })
      ) {
        return
      }

      setUploading(true)

      try {
        /*
         * First save the Speaking submission as DONE.
         */
        const saved = await upsertSubmission({
          audio_part1_url:
            speakingParts.audio_part1_url,
          audio_part2_url:
            speakingParts.audio_part2_url,
          audio_part3_url:
            speakingParts.audio_part3_url,
          status: 'done',
          submitted_at:
            new Date().toISOString(),
        })

        /*
         * Then create the completion record.
         *
         * This fixes the leaderboard counting issue.
         */
        await markHomeworkCompleted()

        requestAiEvaluation(saved?.id, homework)
      } catch (err) {
        console.error(
          'Speaking task submission error:',
          err
        )

        setError(
          err?.message ||
            'Failed to submit speaking task.'
        )
      } finally {
        setUploading(false)
      }
    }

  /*
   * ============================================================
   * DELETE SCREENSHOT
   * ============================================================
   */

  const handleScreenshotDelete =
    async (urlToRemove) => {
      setError('')

      try {
        const remaining =
          existingImages.filter(
            (url) =>
              url !==
              urlToRemove
          )

        await upsertSubmission({
          screenshot_urls:
            remaining,
          status: 'pending',
          submitted_at:
            submission?.submitted_at ||
            null,
        })
      } catch (err) {
        setError(
          err?.message ||
            'Failed to delete image.'
        )
      }
    }

  /*
   * ============================================================
   * DELETE NORMAL FILE
   * ============================================================
   */

  const handleFileDelete =
    async (fileToRemove) => {
      setError('')

      try {
        const remaining =
          existingFiles.filter(
            (file) =>
              file.url !==
              fileToRemove.url
          )

        await upsertSubmission({
          submission_files:
            remaining,
          status: 'pending',
          submitted_at:
            submission?.submitted_at ||
            null,
        })
      } catch (err) {
        setError(
          err?.message ||
            'Failed to delete file.'
        )
      }
    }

  /*
   * ============================================================
   * SAVE COMMENT
   * ============================================================
   */

  const saveComment =
    async () => {
      setSavingComment(true)
      setError('')

      try {
        await upsertSubmission({
          comment,
        })
      } catch (err) {
        setError(
          err?.message ||
            'Failed to save comment.'
        )
      } finally {
        setSavingComment(false)
      }
    }

  const dueLabel =
    homework.due_date
      ? new Date(
          homework.due_date
        ).toLocaleString(
          [],
          {
            dateStyle:
              'medium',
            timeStyle:
              'short',
          }
        )
      : null

  const accept =
    buildAccept(
      allowedTypes
    )

  const allSpeakingPartsRecorded =
    Boolean(
      speakingParts.audio_part1_url
    ) &&
    Boolean(
      speakingParts.audio_part2_url
    ) &&
    Boolean(
      speakingParts.audio_part3_url
    )

  return (
    <div className="ticket rounded-lg overflow-hidden">

      {/* =====================================================
          HOMEWORK HEADER
      ===================================================== */}

      <button
        type="button"
        onClick={() =>
          setOpen((o) => !o)
        }
        className="focus-ring w-full flex items-center justify-between gap-4 p-4 text-left"
      >
        <div>
          <div className="font-display text-lg">
            {homework.title}
          </div>

          <div className="text-mist text-xs font-mono mt-1 flex flex-wrap gap-x-3">
            <span>
              posted{' '}
              {new Date(
                homework.created_at
              ).toLocaleDateString()}
            </span>

            {dueLabel && (
              <span
                className={
                  status ===
                  'overdue'
                    ? 'text-coral'
                    : ''
                }
              >
                due {dueLabel}
              </span>
            )}
          </div>
        </div>

        <StampBadge
          status={status}
        />
      </button>

      {open && (
        <div className="border-t border-line p-4 flex flex-col gap-4">

          {/* DESCRIPTION */}

          {homework.description && (
            <p className="text-sm text-paper-dim whitespace-pre-wrap">
              {homework.description}
            </p>
          )}

          {/* TEACHER ATTACHMENT */}

          {homework.attachment_url && (
            <a
              href={
                homework.attachment_url
              }
              target="_blank"
              rel="noreferrer"
              className="text-brass text-sm hover:underline w-fit"
            >
              📎{' '}
              {homework.attachment_name ||
                'Download attachment'}
            </a>
          )}

          {/* =================================================
              NORMAL FILES
          ================================================= */}

          <div className="rounded-lg border border-line bg-panel-2 p-3">

            <div className="flex flex-wrap justify-between gap-2">

              <div>
                <label className="text-xs uppercase tracking-wide text-mist font-mono">
                  Your files / pictures
                </label>

                <p className="text-xs text-mist mt-1">
                  {minFiles ===
                  0
                    ? 'Optional'
                    : `Minimum ${minFiles}`}{' '}
                  · Maximum{' '}
                  {maxFiles} ·{' '}
                  {existingCount}/
                  {maxFiles}{' '}
                  uploaded
                </p>
              </div>

              <span className="text-xs text-brass font-mono">
                {allowedTypes.join(
                  ', '
                )}
              </span>
            </div>

            <input
              ref={
                fileInputRef
              }
              type="file"
              accept={
                accept
              }
              multiple
              onChange={
                handleFiles
              }
              className="focus-ring block mt-3 text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-brass file:text-onbrass file:font-medium file:cursor-pointer"
              disabled={
                uploading ||
                existingCount >=
                  maxFiles
              }
            />

            <p className="text-xs text-mist mt-2">
              You can also
              copy an image
              and paste it here
              (Ctrl/Cmd + V).
            </p>

            {/* IMAGES */}

            {existingImages.length >
              0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {existingImages.map(
                  (
                    url,
                    i
                  ) => (
                    <div
                      key={url}
                      className="relative group"
                    >
                      <a
                        href={
                          url
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={
                            url
                          }
                          alt={`submission ${
                            i +
                            1
                          }`}
                          className="w-20 h-20 object-cover rounded-md border border-line"
                        />
                      </a>

                      <button
                        type="button"
                        onClick={() =>
                          handleScreenshotDelete(
                            url
                          )
                        }
                        className="focus-ring absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-coral text-paper text-xs disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
            )}

            {/* OTHER FILES */}

            {existingFiles.length >
              0 && (
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {existingFiles.map(
                  (
                    file
                  ) => (
                    <div
                      key={
                        file.url
                      }
                      className="flex items-center gap-2 bg-panel border border-line rounded-md px-3 py-2"
                    >
                      <a
                        href={
                          file.url
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brass hover:underline truncate"
                      >
                        📎{' '}
                        {
                          file.name
                        }
                      </a>

                      <button
                        type="button"
                        onClick={() =>
                          handleFileDelete(
                            file
                          )
                        }
                        className="focus-ring ml-auto text-coral disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* =================================================
              NORMAL TASK SUBMIT
          ================================================= */}

          {!homework.enable_speaking && (
            <div className="rounded-lg border border-line bg-panel-2 p-4">

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                <div>
                  <div className="font-medium text-paper">
                    Homework submission
                  </div>

                  <p className="text-xs text-mist mt-1">
                    {taskAlreadySubmitted
                      ? submittedLate
                        ? 'Submitted after the deadline. Your teacher can see this was late. You can still make changes and click Update Submission to save them.'
                        : 'Submitted to your teacher. You can still make changes and click Update Submission to save them.'
                      : minFiles >
                        0
                      ? `Upload at least ${minFiles} file${
                          minFiles ===
                          1
                            ? ''
                            : 's'
                        }, then click Submit Task.`
                      : 'Complete your work, then click Submit Task.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={
                    handleTaskSubmit
                  }
                  disabled={
                    uploading ||
                    existingCount <
                      minFiles
                  }
                  className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {taskAlreadySubmitted
                    ? 'Update Submission'
                    : existingCount <
                      minFiles
                    ? `Upload ${
                        minFiles -
                        existingCount
                      } more`
                    : 'Submit Task'}
                </button>

              </div>

              <div className="mt-3 text-xs">

                {taskAlreadySubmitted ? (
                  submittedLate ? (
                    <span className="text-amber">
                      ⏰ Submitted late. You
                      can still edit and
                      resubmit.
                    </span>
                  ) : (
                    <span className="text-brass">
                      ✓ Submitted to your
                      teacher. You can still
                      edit and resubmit.
                    </span>
                  )
                ) : existingCount >=
                  minFiles ? (
                  <span className="text-brass">
                    ✓ Your work is ready.
                    Click Submit Task
                    when you are finished.
                  </span>
                ) : (
                  <span className="text-mist">
                    Upload the required
                    files before submitting.
                  </span>
                )}

              </div>

            </div>
          )}

          {/* =================================================
              SPEAKING
          ================================================= */}

          {homework.enable_speaking && (
            <div className="flex flex-col gap-4">

              <div className="grid sm:grid-cols-3 gap-3">

                {PARTS.map(
                  (
                    p,
                    idx
                  ) => (
                    <AudioRecorder
                      key={
                        p.key
                      }
                      label={
                        p.label
                      }
                      existingUrl={
                        speakingParts[
                          p.key
                        ]
                      }
                      uploading={
                        uploading
                      }
                      onSaved={(
                        blob
                      ) =>
                        handleAudio(
                          blob,
                          p.key,
                          `part${
                            idx +
                            1
                          }`
                        )
                      }
                      onUpload={(
                        file
                      ) =>
                        handleAudioUpload(
                          file,
                          p.key,
                          `part${
                            idx +
                            1
                          }`
                        )
                      }
                      onDelete={() =>
                        handleAudioDelete(
                          p.key
                        )
                      }
                    />
                  )
                )}

              </div>

              {/* SPEAKING SUBMIT */}

              <div className="rounded-lg border border-line bg-panel-2 p-4">

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                  <div>
                    <div className="font-medium text-paper">
                      Speaking submission
                    </div>

                    <p className="text-xs text-mist mt-1">
                      Complete all three parts,
                      then click Submit Speaking
                      Task.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={
                      handleSpeakingSubmit
                    }
                    disabled={
                      !allSpeakingPartsRecorded ||
                      uploading
                    }
                    className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {speakingAlreadySubmitted
                      ? 'Update Speaking Submission'
                      : allSpeakingPartsRecorded
                      ? 'Submit Speaking Task'
                      : 'Complete All 3 Parts'}
                  </button>

                </div>

                <div className="mt-3 text-xs">

                  {speakingAlreadySubmitted ? (
                    submittedLate ? (
                      <span className="text-amber">
                        ⏰ Submitted late. You
                        can still edit and
                        resubmit.
                      </span>
                    ) : (
                      <span className="text-brass">
                        ✓ Submitted to your
                        teacher. You can still
                        edit and resubmit.
                      </span>
                    )
                  ) : allSpeakingPartsRecorded ? (
                    <span className="text-brass">
                      ✓ All three parts are
                      ready. Click Submit
                      Speaking Task.
                    </span>
                  ) : (
                    <span className="text-mist">
                      Complete Parts 1, 2,
                      and 3 before submitting.
                    </span>
                  )}

                </div>

              </div>

            </div>
          )}

          {/* =================================================
              AI EVALUATION
          ================================================= */}

          <AiFeedbackCard submission={submission} />

          {/* =================================================
              COMMENT
          ================================================= */}

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Comment for your teacher
              (optional)
            </label>

            <textarea
              value={
                comment
              }
              onChange={(e) =>
                setComment(
                  e.target.value
                )
              }
              onBlur={
                saveComment
              }
              rows={3}
              placeholder="Anything you want to mention about this homework..."
              className="focus-ring w-full mt-2 bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
              disabled={
                uploading
              }
            />

            {savingComment && (
              <p className="text-mist text-xs font-mono mt-1">
                saving...
              </p>
            )}
          </div>

          {/* ERROR */}

          {error && (
            <p className="text-coral text-sm">
              {error}
            </p>
          )}

        </div>
      )}
    </div>
  )
}