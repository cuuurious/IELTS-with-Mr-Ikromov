import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * Where the teacher uploads the grading rubric the AI evaluates
 * submissions against — one PDF for Writing, one for Speaking. Each
 * homework then has its own "Evaluate submissions with AI" checkbox
 * (in PostHomeworkForm / EditHomeworkModal) that decides whether that
 * assignment actually gets graded by it.
 */

const SKILLS = [
  {
    key: 'writing',
    label: 'Writing',
    hint: 'Used for any homework that is NOT a speaking task — the AI reads the essay photos students upload.',
  },
  {
    key: 'speaking',
    label: 'Speaking',
    hint: 'Used for homework with "Include speaking Part 1 / 2 / 3" turned on — the AI transcribes and grades the three recordings.',
  },
]

export default function AiGradingSettings({ teacherId }) {
  const [criteria, setCriteria] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')

    const { data, error: loadError } = await supabase
      .from('grading_criteria')
      .select('*')

    if (loadError) {
      setError(loadError.message)
      setLoading(false)
      return
    }

    const map = {}
    ;(data || []).forEach((row) => {
      map[row.skill] = row
    })

    setCriteria(map)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h2 className="font-display text-2xl">AI Grading</h2>
        <p className="text-mist text-sm mt-1">
          Upload your grading rubric as a PDF for each skill. When you
          turn on "Evaluate submissions with AI" on a homework, students
          get a band score and feedback automatically, right when they
          submit — scored strictly against the rubric you upload here.
        </p>
      </div>

      {error && <p className="text-coral text-sm">{error}</p>}

      {loading ? (
        <p className="text-mist text-sm">Loading…</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {SKILLS.map((skill) => (
            <CriteriaCard
              key={skill.key}
              skill={skill}
              row={criteria[skill.key]}
              teacherId={teacherId}
              onSaved={(row) =>
                setCriteria((prev) => ({ ...prev, [skill.key]: row }))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CriteriaCard({ skill, row, teacherId, onSaved }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const fileInputRef = useRef(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''

    if (!file) return

    if (file.type !== 'application/pdf') {
      setError('Please upload a PDF file. (In Word or Google Docs, use "Save as / Export as PDF".)')
      return
    }

    setUploading(true)
    setError('')

    try {
      const path = `${skill.key}/${teacherId}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('grading-criteria')
        .upload(path, file, {
          upsert: false,
          contentType: 'application/pdf',
        })

      if (uploadError) throw uploadError

      const { data, error: fnError } = await supabase.functions.invoke(
        'ai-grading',
        {
          body: {
            action: 'extract_criteria',
            skill: skill.key,
            storagePath: path,
            fileName: file.name,
          },
        }
      )

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      onSaved({
        skill: skill.key,
        file_name: file.name,
        file_path: path,
        criteria_text: data.criteria_text,
        updated_at: new Date().toISOString(),
      })
    } catch (err) {
      console.error('Criteria upload failed:', err)
      setError(
        err?.message ||
          'Could not read that PDF. Please try again, or try a different file.'
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="ticket rounded-lg p-4 flex flex-col gap-3">
      <div>
        <div className="font-display text-lg">{skill.label}</div>
        <p className="text-xs text-mist mt-1">{skill.hint}</p>
      </div>

      {row?.file_name ? (
        <div className="rounded-md border border-line bg-panel-2 px-3 py-2.5">
          <div className="text-sm text-paper truncate">
            📎 {row.file_name}
          </div>

          <div className="text-[10px] text-mist font-mono mt-1">
            Saved{' '}
            {row.updated_at
              ? new Date(row.updated_at).toLocaleString()
              : ''}
          </div>

          {row.criteria_text && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="focus-ring text-xs text-brass hover:underline mt-2"
            >
              {showPreview ? 'Hide extracted text' : 'Preview extracted text'}
            </button>
          )}

          {showPreview && row.criteria_text && (
            <p className="text-xs text-mist whitespace-pre-wrap mt-2 max-h-48 overflow-y-auto border-t border-line pt-2">
              {row.criteria_text}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-mist">
          No {skill.label.toLowerCase()} criteria uploaded yet.
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFile}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="focus-ring w-fit text-sm px-3 py-2 rounded-md bg-brass text-onbrass font-medium disabled:opacity-50"
      >
        {uploading
          ? 'Reading PDF…'
          : row?.file_name
          ? 'Replace PDF'
          : 'Upload PDF'}
      </button>

      {error && <p className="text-coral text-xs">{error}</p>}
    </div>
  )
}
