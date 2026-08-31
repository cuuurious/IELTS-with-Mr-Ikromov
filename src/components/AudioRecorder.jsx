import { useEffect, useRef, useState } from 'react'

export default function AudioRecorder({
  label,
  existingUrl,
  onSaved,
  onUpload,
  onDelete,
  uploading,
}) {
  const [recording, setRecording] =
    useState(false)

  const [paused, setPaused] =
    useState(false)

  const [seconds, setSeconds] =
    useState(0)

  const [previewUrl, setPreviewUrl] =
    useState(null)

  const [error, setError] =
    useState('')

  const [recordingSize, setRecordingSize] =
    useState(0)

  const mediaRecorderRef =
    useRef(null)

  const chunksRef =
    useRef([])

  const timerRef =
    useRef(null)

  const streamRef =
    useRef(null)

  const fileRef =
    useRef(null)

  /*
   * ============================================================
   * CLEANUP
   * ============================================================
   */

  useEffect(() => {
    return () => {
      clearInterval(
        timerRef.current
      )

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        )

      if (previewUrl) {
        URL.revokeObjectURL(
          previewUrl
        )
      }
    }
  }, [previewUrl])

  /*
   * ============================================================
   * START RECORDING
   * ============================================================
   */

  const start = async () => {
    setError('')
    setRecordingSize(0)

    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices
          .getUserMedia
      ) {
        throw new Error(
          'Your browser does not support microphone recording.'
        )
      }

      /*
       * Request microphone.
       */
      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          }
        )

      streamRef.current =
        stream

      /*
       * Prefer Opus/WebM.
       *
       * The fallback is normal WebM.
       */
      let mimeType =
        ''

      if (
        MediaRecorder.isTypeSupported(
          'audio/webm;codecs=opus'
        )
      ) {
        mimeType =
          'audio/webm;codecs=opus'
      } else if (
        MediaRecorder.isTypeSupported(
          'audio/webm'
        )
      ) {
        mimeType =
          'audio/webm'
      }

      const recorder =
        mimeType
          ? new MediaRecorder(
              stream,
              {
                mimeType,
              }
            )
          : new MediaRecorder(
              stream
            )

      mediaRecorderRef.current =
        recorder

      chunksRef.current =
        []

      /*
       * Receive audio data every second.
       *
       * This is important for longer recordings.
       * It prevents the browser from keeping one giant
       * uninterrupted data chunk in memory.
       */
      recorder.ondataavailable =
        (event) => {
          if (
            event.data &&
            event.data.size > 0
          ) {
            chunksRef.current.push(
              event.data
            )

            setRecordingSize(
              (previous) =>
                previous +
                event.data.size
            )
          }
        }

      /*
       * When recording stops, combine all chunks.
       */
      recorder.onstop = async () => {
        try {
          clearInterval(
            timerRef.current
          )

          const finalType =
            recorder.mimeType ||
            mimeType ||
            'audio/webm'

          const blob =
            new Blob(
              chunksRef.current,
              {
                type: finalType,
              }
            )

          if (!blob.size) {
            throw new Error(
              'The recording is empty. Please record again.'
            )
          }

          /*
           * Create local preview.
           */
          const localUrl =
            URL.createObjectURL(
              blob
            )

          setPreviewUrl(
            localUrl
          )

          /*
           * Upload/save through the parent.
           */
          await onSaved(blob)
        } catch (err) {
          console.error(
            'Recording processing error:',
            err
          )

          setError(
            err?.message ||
              'Failed to process the recording.'
          )
        } finally {
          stream
            .getTracks()
            .forEach(
              (track) =>
                track.stop()
            )

          streamRef.current =
            null

          mediaRecorderRef.current =
            null

          chunksRef.current =
            []
        }
      }

      recorder.onerror = (
        event
      ) => {
        console.error(
          'MediaRecorder error:',
          event
        )

        setError(
          'The browser could not continue recording. Please try again.'
        )

        clearInterval(
          timerRef.current
        )

        stream
          .getTracks()
          .forEach(
            (track) =>
              track.stop()
          )

        setRecording(false)
        setPaused(false)
      }

      /*
       * Start recording and request
       * data every 1000 milliseconds.
       */
      recorder.start(1000)

      setRecording(true)
      setPaused(false)
      setSeconds(0)

      clearInterval(
        timerRef.current
      )

      timerRef.current =
        setInterval(() => {
          setSeconds(
            (value) =>
              value + 1
          )
        }, 1000)
    } catch (err) {
      console.error(
        'Microphone recording error:',
        err
      )

      streamRef.current
        ?.getTracks()
        .forEach((track) =>
          track.stop()
        )

      streamRef.current =
        null

      setRecording(false)
      setPaused(false)

      if (
        err?.name ===
        'NotAllowedError'
      ) {
        setError(
          'Microphone access was blocked. Allow microphone access and try again.'
        )
      } else if (
        err?.name ===
        'NotFoundError'
      ) {
        setError(
          'No microphone was found. Please connect a microphone and try again.'
        )
      } else {
        setError(
          err?.message ||
            'Could not start recording.'
        )
      }
    }
  }

  /*
   * ============================================================
   * PAUSE
   * ============================================================
   */

  const pause = () => {
    const recorder =
      mediaRecorderRef.current

    if (
      !recorder ||
      recorder.state !==
        'recording'
    ) {
      return
    }

    recorder.pause()

    clearInterval(
      timerRef.current
    )

    setPaused(true)
  }

  /*
   * ============================================================
   * RESUME
   * ============================================================
   */

  const resume = () => {
    const recorder =
      mediaRecorderRef.current

    if (
      !recorder ||
      recorder.state !==
        'paused'
    ) {
      return
    }

    recorder.resume()

    clearInterval(
      timerRef.current
    )

    timerRef.current =
      setInterval(() => {
        setSeconds(
          (value) =>
            value + 1
        )
      }, 1000)

    setPaused(false)
  }

  /*
   * ============================================================
   * STOP
   * ============================================================
   */

  const stop = () => {
    const recorder =
      mediaRecorderRef.current

    if (
      !recorder ||
      recorder.state ===
        'inactive'
    ) {
      return
    }

    clearInterval(
      timerRef.current
    )

    setRecording(false)
    setPaused(false)

    /*
     * requestData() makes sure the
     * latest audio is delivered before
     * stop().
     */
    try {
      recorder.requestData()
    } catch {
      // Some browsers may not support
      // requestData at this exact moment.
    }

    recorder.stop()
  }

  /*
   * ============================================================
   * DISCARD
   * ============================================================
   */

  const discard = async () => {
    if (previewUrl) {
      URL.revokeObjectURL(
        previewUrl
      )
    }

    setPreviewUrl(null)
    setSeconds(0)
    setRecordingSize(0)
    setError('')

    await onDelete()
  }

  /*
   * ============================================================
   * UPLOAD MP3 / WAV
   * ============================================================
   */

  const handleUpload =
    async (event) => {
      const file =
        event.target.files?.[0]

      event.target.value = ''

      if (!file) {
        return
      }

      const extension =
        file.name
          .toLowerCase()
          .split('.')
          .pop()

      if (
        !['mp3', 'wav'].includes(
          extension
        )
      ) {
        setError(
          'Please choose an MP3 or WAV file.'
        )
        return
      }

      /*
       * Give a useful warning for
       * extremely large uploads.
       *
       * This does NOT impose a recording
       * limit on browser recordings.
       */
      const maxWarningSize =
        100 * 1024 * 1024

      if (
        file.size >
        maxWarningSize
      ) {
        setError(
          'This audio file is very large. Please use a smaller MP3/WAV file if the upload fails.'
        )
        return
      }

      setError('')

      try {
        await onUpload(file)
      } catch (err) {
        console.error(
          'Audio upload error:',
          err
        )

        setError(
          err?.message ||
            'Failed to upload audio.'
        )
      }
    }

  /*
   * ============================================================
   * DISPLAY
   * ============================================================
   */

  const hasTake =
    Boolean(
      existingUrl ||
        previewUrl
    )

  const time =
    `${Math.floor(
      seconds / 60
    )}:${String(
      seconds % 60
    ).padStart(2, '0')}`

  const sizeMb =
    recordingSize
      ? (
          recordingSize /
          1024 /
          1024
        ).toFixed(2)
      : '0.00'

  return (
    <div className="rounded-lg border border-line bg-panel-2 p-3 flex flex-col gap-2">

      <div className="text-sm font-medium">
        {label}
      </div>

      <div className="text-xs text-mist">
        Record directly or upload
        an MP3/WAV.
      </div>

      {/* =====================================================
          START
      ===================================================== */}

      {!recording &&
        !hasTake && (
          <button
            type="button"
            onClick={start}
            disabled={uploading}
            className="focus-ring px-3 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
          >
            🎙 Start recording
          </button>
        )}

      {/* =====================================================
          RECORDING
      ===================================================== */}

      {recording &&
        !paused && (
          <button
            type="button"
            onClick={pause}
            className="focus-ring px-3 py-2 rounded-md border border-brass text-brass"
          >
            Pause · {time}
          </button>
        )}

      {recording &&
        paused && (
          <button
            type="button"
            onClick={resume}
            className="focus-ring px-3 py-2 rounded-md border border-brass text-brass"
          >
            Resume · {time}
          </button>
        )}

      {recording && (
        <button
          type="button"
          onClick={stop}
          className="focus-ring px-3 py-2 rounded-md bg-coral text-paper"
        >
          Stop · {time}
        </button>
      )}

      {/* =====================================================
          PREVIEW
      ===================================================== */}

      {!recording &&
        hasTake && (
          <>
            <audio
              controls
              src={
                previewUrl ||
                existingUrl
              }
              className="w-full"
            />

            {recordingSize >
              0 && (
              <span className="text-xs text-mist font-mono">
                Recorded audio:{' '}
                {sizeMb} MB
              </span>
            )}

            <div className="flex gap-2">

              <button
                type="button"
                onClick={start}
                disabled={
                  uploading
                }
                className="focus-ring px-3 py-2 rounded-md border border-line text-sm disabled:opacity-40"
              >
                Re-record
              </button>

              <button
                type="button"
                onClick={
                  discard
                }
                disabled={
                  uploading
                }
                className="focus-ring px-3 py-2 rounded-md border border-coral text-coral text-sm disabled:opacity-40"
              >
                Delete
              </button>

            </div>
          </>
        )}

      {/* =====================================================
          FILE UPLOAD
      ===================================================== */}

      {!recording && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            onChange={
              handleUpload
            }
            className="hidden"
          />

          <button
            type="button"
            onClick={() =>
              fileRef.current?.click()
            }
            disabled={
              uploading
            }
            className="focus-ring px-3 py-2 rounded-md border border-line text-mist hover:border-brass hover:text-brass text-sm disabled:opacity-40"
          >
            📎 Upload MP3 / WAV
          </button>
        </>
      )}

      {/* =====================================================
          SAVING
      ===================================================== */}

      {uploading && (
        <span className="text-mist text-xs font-mono">
          saving…
        </span>
      )}

      {/* =====================================================
          ERROR
      ===================================================== */}

      {error && (
        <span className="text-coral text-xs">
          {error}
        </span>
      )}

    </div>
  )
}