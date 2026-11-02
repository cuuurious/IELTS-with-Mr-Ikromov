import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { safeFileName } from '../../lib/storageKey'
import { guessMimeType } from '../../lib/mime'
import { SkillIcon } from '../SkillArt'
import MaterialPicker from '../MaterialPicker'
import { TASK_KINDS, taskTitle } from '../../lib/homeworkTasks'

/*
 * "Tasks done in the site" for Post / Edit homework (2026-11-02).
 * Add a Reading or Listening test from the homework bank, one of the
 * group's word lists, an HTML workshop from the Materials Library, or a
 * shadowing clip. Students do them inside the site and are marked
 * straight away.
 *
 * Props: groupId, tasks ([{ id?, kind, exam_id, wordlist_id, html_url, title, shadowing_clip_id }]), onChange(tasks)
 */
const ADDABLE = ['reading', 'listening', 'wordlist', 'html', 'shadowing']

export default function HomeworkTasksEditor({ groupId, tasks, onChange }) {
  const [adding, setAdding] = useState(null) // kind
  const [bank, setBank] = useState([])
  const [wordlists, setWordlists] = useState([])
  const [clips, setClips] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newClip, setNewClip] = useState(null) // { title, transcript, file }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('mock_exams').select('id, title, module, created_at').eq('bank', 'homework').order('created_at', { ascending: false }),
      // In a course plan (no group yet) every word list can be picked; it is
      // given to the group when the lesson's homework is posted.
      groupId
        ? supabase.from('wordlists').select('id, title, created_at').eq('group_id', groupId).order('created_at', { ascending: false })
        : supabase.from('wordlists').select('id, title, created_at').order('created_at', { ascending: false }),
      supabase.from('shadowing_clips').select('id, title, created_at').order('created_at', { ascending: false }),
    ]).then(([b, w, c]) => {
      if (cancelled) return
      setBank(b.data || [])
      setWordlists(w.data || [])
      setClips(c.data || [])
    })
    return () => {
      cancelled = true
    }
  }, [groupId])

  const add = (task) => {
    onChange([...tasks, task])
    setAdding(null)
  }
  const remove = (i) => onChange(tasks.filter((_, j) => j !== i))
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= tasks.length) return
    const next = [...tasks]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  const saveClip = async () => {
    if (!newClip?.title?.trim() || !newClip?.file || !newClip?.transcript?.trim()) {
      setError('Give the clip a title, an audio file and the words.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data: auth } = await supabase.auth.getUser()
      const path = `${auth.user.id}/shadowing/${Date.now()}-${safeFileName(newClip.file.name)}`
      const { error: upErr } = await supabase.storage
        .from('homework-files')
        .upload(path, newClip.file, { contentType: guessMimeType(newClip.file.name, newClip.file.type) })
      if (upErr) throw upErr
      const url = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      const { data, error: insErr } = await supabase
        .from('shadowing_clips')
        .insert({ title: newClip.title.trim(), audio_url: url, transcript: newClip.transcript.trim() })
        .select('id, title, created_at')
        .single()
      if (insErr) throw insErr
      setClips((prev) => [data, ...prev])
      setNewClip(null)
      add({ kind: 'shadowing', shadowing_clip_id: data.id, title: data.title })
    } catch (err) {
      setError(err?.message || 'Could not save the clip.')
    } finally {
      setBusy(false)
    }
  }

  const options =
    adding === 'reading' || adding === 'listening'
      ? bank.filter((e) => e.module === adding).map((e) => ({ id: e.id, title: e.title, task: { kind: adding, exam_id: e.id, title: e.title } }))
      : adding === 'wordlist'
        ? wordlists.map((w) => ({ id: w.id, title: w.title, task: { kind: 'wordlist', wordlist_id: w.id, title: w.title } }))
        : adding === 'shadowing'
          ? clips.map((c) => ({ id: c.id, title: c.title, task: { kind: 'shadowing', shadowing_clip_id: c.id, title: c.title } }))
          : []

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel-2 p-4">
      <div>
        <p className="font-brand text-[16px] font-semibold text-paper">Tasks done in the site</p>
        <p className="text-xs font-semibold text-mist">Marked straight away. The first try counts; students can retake.</p>
      </div>

      {tasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {tasks.map((t, i) => {
            const meta = TASK_KINDS[t.kind] || TASK_KINDS.reading
            return (
              <li key={t.id || `${t.kind}-${i}`} className="flex items-center gap-3 rounded-[14px] border border-line bg-panel px-3 py-2.5">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.tint} ${meta.text}`} aria-hidden="true">
                  <SkillIcon skill={meta.skill} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-paper">{taskTitle(t)}</p>
                  <p className={`text-xs font-extrabold ${meta.text}`}>{meta.label}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-mist hover:bg-panel-2 disabled:opacity-30">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === tasks.length - 1} aria-label="Move down" className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-mist hover:bg-panel-2 disabled:opacity-30">↓</button>
                  <button type="button" onClick={() => remove(i)} aria-label="Remove" className="focus-ring grid h-8 w-8 place-items-center rounded-lg text-coral hover:bg-urgent-tint">×</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {ADDABLE.map((k) => {
          const meta = TASK_KINDS[k]
          const on = adding === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => {
                setError('')
                setNewClip(null)
                if (k === 'html') {
                  setAdding(null)
                  setPickerOpen(true)
                  return
                }
                setAdding(on ? null : k)
              }}
              className={`focus-ring flex flex-col items-center gap-1.5 rounded-[14px] px-2 py-3 text-center transition ${meta.tint} ${meta.text} ${on ? 'ring-2 ring-current' : 'hover:brightness-95'}`}
            >
              <SkillIcon skill={meta.skill} className="h-5 w-5" />
              <span className="text-[12px] font-extrabold leading-tight">+ {meta.label}</span>
            </button>
          )
        })}
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-panel p-3">
          {options.length === 0 && adding !== 'shadowing' && (
            <p className="text-sm font-semibold text-mist">
              {adding === 'wordlist'
                ? 'This group has no word lists yet.'
                : `No ${adding} tests in the homework bank yet — make one in Mock Center → Content → Homework bank.`}
            </p>
          )}
          {options.length > 0 && (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              {options.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => add(o.task)} className="focus-ring flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold text-paper hover:bg-panel-2">
                    <span className="truncate">{o.title}</span>
                    <span className="shrink-0 text-xs font-extrabold text-brass">Add</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {adding === 'shadowing' &&
            (newClip ? (
              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <input
                  value={newClip.title}
                  onChange={(e) => setNewClip({ ...newClip, title: e.target.value })}
                  placeholder="Clip title (e.g. Cambridge 18 Test 2 Part 1)"
                  className="focus-ring rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm"
                />
                <input type="file" accept="audio/*" onChange={(e) => setNewClip({ ...newClip, file: e.target.files?.[0] || null })} className="text-sm" />
                <textarea
                  value={newClip.transcript}
                  onChange={(e) => setNewClip({ ...newClip, transcript: e.target.value })}
                  rows={5}
                  placeholder={'One sentence per line. Add times to play lines one by one:\n[0:03] Good morning, how can I help you?\n[0:07] I would like to book a room.'}
                  className="focus-ring rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={saveClip} disabled={busy} className="focus-ring h-10 rounded-[14px] bg-speaking px-4 text-sm font-extrabold text-white disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save clip and add'}
                  </button>
                  <button type="button" onClick={() => setNewClip(null)} className="focus-ring h-10 rounded-[14px] px-3 text-sm font-bold text-mist">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setNewClip({ title: '', transcript: '', file: null })} className="focus-ring h-10 self-start rounded-[14px] border border-line px-3.5 text-sm font-extrabold text-speaking hover:bg-speaking-tint">
                + New shadowing clip
              </button>
            ))}
        </div>
      )}

      {error && <p className="text-sm font-bold text-coral">{error}</p>}

      <MaterialPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(picked) => {
          setPickerOpen(false)
          const html = (picked || []).filter((m) => /\.html?$/i.test(m.file_name || m.name || m.url || '') || /html/.test(m.mime_type || ''))
          if (!html.length) {
            setError('Pick an HTML workshop file (.html).')
            return
          }
          onChange([
            ...tasks,
            ...html.map((m) => ({ kind: 'html', html_url: m.url, title: (m.title || m.file_name || m.name || 'Workshop').replace(/\.html?$/i, '') })),
          ])
        }}
      />
    </div>
  )
}
