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
} from '../../components/StampBadge'

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
  const [savingComment, setSavingComment] =
    useState(false)

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

  const status = getSubmissionStatus(
    submission,
    homework.due_date
  )

  /*
   * A normal task is considered submitted ONLY when
   * the student explicitly presses Submit Task.
   */
  const taskAlreadySubmitted =
    !homework.enable_speaking &&
    submission?.status === 'done' &&
    Boolean(submission?.submitted_at)

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

    if (error) throw error

    onChange(data)

    return data
  }

  const uploadFile = async (
    file,
    name
  ) => {
    const path = `${studentId}/${homework.id}/${name}`

    const { error: upErr } =
      await supabase.storage
        .from('submissions')
        .upload(path, file, {
          upsert: true,
          contentType: guessMimeType(
            name,
            file.type
          ),
        })

    if (upErr) throw upErr

    return supabase.storage
      .from('submissions')
      .getPublicUrl(path)
      .data.publicUrl
  }

  const validateFiles = (files) => {
    if (
      existingCount + files.length >
      maxFiles
    ) {
      throw new Error(
        `This homework allows a maximum of ${maxFiles} file${
          maxFiles === 1 ? '' : 's'
        }.`
      )
    }

    for (const file of files) {
      if (
        !allowedTypes.some((type) =>
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
   * UPLOAD FILES
   *
   * Uploading files NEVER submits the homework.
   */
  const saveFiles = async (files) => {
    if (!files.length) return

    if (taskAlreadySubmitted) {
      setError(
        'This homework has already been submitted.'
      )
      return
    }

    validateFiles(files)

    setUploading(true)
    setError('')

    try {
      const newImages = []
      const newFiles = []

      for (const [
        i,
        file,
      ] of files.entries()) {
        const safeName =
          `${Date.now()}-${i}-${file.name}`

        const url = await uploadFile(
          file,
          safeName
        )

        if (
          file.type.startsWith('image/') ||
          [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'svg',
          ].includes(
            extensionOf(file.name)
          )
        ) {
          newImages.push(url)
        } else {
          newFiles.push({
            url,
            name: file.name,
            type:
              file.type ||
              extensionOf(file.name),
          })
        }
      }

      /*
       * IMPORTANT:
       * Files are saved, but task remains pending.
       */
      await upsertSubmission({
        screenshot_urls: [
          ...existingImages,
          ...newImages,
        ],

        submission_files: [
          ...existingFiles,
          ...newFiles,
        ],

        status: 'pending',
        submitted_at: null,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = async (e) => {
    const files = Array.from(
      e.target.files || []
    )

    e.target.value = ''

    await saveFiles(files)
  }

  useEffect(() => {
    if (!open) return undefined

    const onPaste = (e) => {
      if (taskAlreadySubmitted) return

      const images = Array.from(
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
    taskAlreadySubmitted,
  ])

  /*
   * =========================================================
   * SPEAKING RECORDING
   *
   * Recording does NOT submit the task.
   * =========================================================
   */

  const handleAudio = async (
    blob,
    fieldKey,
    fileName
  ) => {
    setUploading(true)
    setError('')

    try {
      const url = await uploadFile(
        blob,
        `${fileName}.webm`
      )

      await upsertSubmission({
        [fieldKey]: url,
        status: 'pending',
        submitted_at: null,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  /*
   * SPEAKING MP3 / WAV UPLOAD
   */

  const handleAudioUpload = async (
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
      const url = await uploadFile(
        file,
        `${fileName}-${Date.now()}-${file.name}`
      )

      await upsertSubmission({
        [fieldKey]: url,
        status: 'pending',
        submitted_at: null,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  /*
   * DELETE SPEAKING PART
   */

  const handleAudioDelete = async (
    fieldKey
  ) => {
    setError('')

    try {
      await upsertSubmission({
        [fieldKey]: null,
        status: 'pending',
        submitted_at: null,
      })
    } catch (err) {
      setError(err.message)
    }
  }

  /*
   * SUBMIT SPEAKING TASK
   */

  const handleSpeakingSubmit =
    async () => {
      setError('')

      const allPartsRecorded =
        Boolean(
          submission?.audio_part1_url
        ) &&
        Boolean(
          submission?.audio_part2_url
        ) &&
        Boolean(
          submission?.audio_part3_url
        )

      if (!allPartsRecorded) {
        setError(
          'Please record or upload all three speaking parts before submitting.'
        )
        return
      }

      setUploading(true)

      try {
        await upsertSubmission({
          status: 'done',
          submitted_at:
            new Date().toISOString(),
        })
      } catch (err) {
        setError(err.message)
      } finally {
        setUploading(false)
      }
    }

  /*
   * DELETE SCREENSHOT
   */

  const handleScreenshotDelete =
    async (urlToRemove) => {
      setError('')

      try {
        const remaining =
          existingImages.filter(
            (u) => u !== urlToRemove
          )

        await upsertSubmission({
          screenshot_urls: remaining,
          status: 'pending',
          submitted_at: null,
        })
      } catch (err) {
        setError(err.message)
      }
    }

  /*
   * DELETE FILE
   */

  const handleFileDelete =
    async (fileToRemove) => {
      setError('')

      try {
        const remaining =
          existingFiles.filter(
            (f) =>
              f.url !==
              fileToRemove.url
          )

        await upsertSubmission({
          submission_files: remaining,
          status: 'pending',
          submitted_at: null,
        })
      } catch (err) {
        setError(err.message)
      }
    }

  /*
   * =========================================================
   * SUBMIT NORMAL HOMEWORK
   *
   * This is the new explicit Submit button.
   * =========================================================
   */

  const handleTaskSubmit =
    async () => {
      setError('')

      /*
       * If this homework requires files,
       * make sure the minimum is satisfied.
       */
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

      if (taskAlreadySubmitted) {
        return
      }

      setUploading(true)

      try {
        await upsertSubmission({
          status: 'done',
          submitted_at:
            new Date().toISOString(),
        })
      } catch (err) {
        setError(err.message)
      } finally {
        setUploading(false)
      }
    }

  /*
   * SAVE COMMENT
   */

  const saveComment = async () => {
    setSavingComment(true)
    setError('')

    try {
      await upsertSubmission({
        comment,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingComment(false)
    }
  }

  const dueLabel =
    homework.due_date
      ? new Date(
          homework.due_date
        ).toLocaleString([], {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : null

  const accept =
    buildAccept(allowedTypes)

  const allSpeakingPartsRecorded =
    Boolean(
      submission?.audio_part1_url
    ) &&
    Boolean(
      submission?.audio_part2_url
    ) &&
    Boolean(
      submission?.audio_part3_url
    )

  const speakingAlreadySubmitted =
    homework.enable_speaking &&
    submission?.status === 'done' &&
    Boolean(
      submission?.submitted_at
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

        <StampBadge status={status} />
      </button>

      {open && (
        <div className="border-t border-line p-4 flex flex-col gap-4">

          {/* =================================================
              DESCRIPTION
          ================================================= */}

          {homework.description && (
            <p className="text-sm text-paper-dim whitespace-pre-wrap">
              {homework.description}
            </p>
          )}

          {/* =================================================
              TEACHER ATTACHMENT
          ================================================= */}

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
              FILES / PICTURES
          ================================================= */}

          <div className="rounded-lg border border-line bg-panel-2 p-3">

            <div className="flex flex-wrap justify-between gap-2">

              <div>
                <label className="text-xs uppercase tracking-wide text-mist font-mono">
                  Your files / pictures
                </label>

                <p className="text-xs text-mist mt-1">

                  {minFiles === 0
                    ? 'Optional'
                    : `Minimum ${minFiles}`}

                  {' · '}

                  Maximum {maxFiles}

                  {' · '}

                  {existingCount}/
                  {maxFiles} uploaded

                </p>
              </div>

              <span className="text-xs text-brass font-mono">
                {allowedTypes.join(
                  ', '
                )}
              </span>

            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={accept}
              multiple
              onChange={handleFiles}
              className="focus-ring block mt-3 text-sm text-mist file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-brass file:text-onbrass file:font-medium file:cursor-pointer"
              disabled={
                uploading ||
                existingCount >=
                  maxFiles ||
                taskAlreadySubmitted
              }
            />

            <p className="text-xs text-mist mt-2">
              You can also copy an image and paste it here
              (Ctrl/Cmd + V).
            </p>

            {/* Images */}

            {existingImages.length >
              0 && (
              <div className="flex flex-wrap gap-2 mt-3">

                {existingImages.map(
                  (url, i) => (
                    <div
                      key={url}
                      className="relative group"
                    >

                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <img
                          src={url}
                          alt={`submission ${
                            i + 1
                          }`}
                          className="w-20 h-20 object-cover rounded-md border border-line"
                        />
                      </a>

                      <button
                        type="button"
                        disabled={
                          taskAlreadySubmitted
                        }
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

            {/* Other files */}

            {existingFiles.length >
              0 && (
              <div className="mt-3 grid sm:grid-cols-2 gap-2">

                {existingFiles.map(
                  (file) => (
                    <div
                      key={file.url}
                      className="flex items-center gap-2 bg-panel border border-line rounded-md px-3 py-2"
                    >

                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brass hover:underline truncate"
                      >
                        📎 {file.name}
                      </a>

                      <button
                        type="button"
                        disabled={
                          taskAlreadySubmitted
                        }
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
              NORMAL TASK SUBMIT BUTTON
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
                      ? 'Your homework has been submitted to your teacher.'
                      : minFiles > 0
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
                    taskAlreadySubmitted ||
                    existingCount <
                      minFiles
                  }
                  className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {taskAlreadySubmitted
                    ? '✓ Task Submitted'
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
                  <span className="text-brass">
                    ✓ Submitted to your
                    teacher.
                  </span>
                ) : existingCount >=
                  minFiles ? (
                  <span className="text-brass">
                    ✓ Your work is ready.
                    Click Submit Task when
                    you are finished.
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
                  (p, idx) => (
                    <AudioRecorder
                      key={p.key}
                      label={p.label}
                      existingUrl={
                        submission?.[
                          p.key
                        ]
                      }
                      uploading={
                        uploading
                      }

                      onSaved={(blob) =>
                        handleAudio(
                          blob,
                          p.key,
                          `part${
                            idx + 1
                          }`
                        )
                      }

                      onUpload={(file) =>
                        handleAudioUpload(
                          file,
                          p.key,
                          `part${
                            idx + 1
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

              {/* =================================================
                  SPEAKING SUBMIT BUTTON
              ================================================= */}

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
                      uploading ||
                      speakingAlreadySubmitted
                    }
                    className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {speakingAlreadySubmitted
                      ? '✓ Speaking Task Submitted'
                      : allSpeakingPartsRecorded
                        ? 'Submit Speaking Task'
                        : 'Complete All 3 Parts'}
                  </button>

                </div>

                <div className="mt-3 text-xs">

                  {speakingAlreadySubmitted ? (
                    <span className="text-brass">
                      ✓ Your speaking task has
                      been submitted to your
                      teacher.
                    </span>
                  ) : allSpeakingPartsRecorded ? (
                    <span className="text-brass">
                      ✓ All three parts are
                      ready. Click Submit
                      Speaking Task.
                    </span>
                  ) : (
                    <span className="text-mist">
                      Complete Parts 1, 2, and 3
                      before submitting.
                    </span>
                  )}

                </div>

              </div>

            </div>
          )}

          {/* =================================================
              COMMENT
          ================================================= */}

          <div>

            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Comment for your teacher
              (optional)
            </label>

            <textarea
              value={comment}
              onChange={(e) =>
                setComment(e.target.value)
              }
              onBlur={saveComment}
              rows={3}
              placeholder="Anything you want to mention about this homework…"
              className="focus-ring w-full mt-2 bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
            />

            {savingComment && (
              <p className="text-mist text-xs font-mono mt-1">
                saving…
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