import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchPage } from '../lib/fetchPage'
import { withHelper } from '../components/homework/HtmlTask'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'

/*
 * ENTRY TEST (2026-11-11) — /entry, no account.
 *
 * 1. Details: the 4-digit code Mr Ikromov gives out (a link can carry it:
 *    /entry?code=1234), name, phone, target band, exam date, how they
 *    heard about the center.
 * 2. Listening Part 2 (10 questions, the recording plays once).
 * 3. Reading Passage 1 of a full test (13 questions, 20 minutes; the
 *    other two passages and the workshops are hidden).
 * 4. Result: estimated band and level. The teacher gets a Telegram
 *    message and sees everything in the "Entry tests" tab.
 *
 * Tests come from pools of 10 (migration_124 picks the least used), so
 * people sitting next to each other get different ones. Progress is kept
 * in this browser, so a reload continues where the person was.
 */

const STORE = 'ielts-entry-test'
const READING_SECONDS = 20 * 60
const RANGE = { listening: [11, 20], reading: [1, 13] }

const HEARD = ['Instagram', 'Telegram', 'A friend or family', 'A current student', 'Google', 'Other']
const TARGETS = ['5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0']

const loadState = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null')
  } catch {
    return null
  }
}
const saveState = (s) => {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s))
    else localStorage.removeItem(STORE)
  } catch {
    /* private mode: the test still works, it just can't survive a reload */
  }
}

// 2026-11-12: Passage 1 (questions 1–13, the easiest passage) is shown,
// its questions are the only ones counted, the workshops are hidden and
// the timer starts at the time left. When the answers are handed in, the
// result is sent to the site straight away and the page's own result
// window (correct answers, "Start again") is never shown.
const readingPatch = (secondsLeft) => `
<style>.ngroup:not([data-i="0"]),.mtab.wk,.nprog,#wsOverlay,#partScores,#bandDisplay,.navpart:not(:nth-of-type(1)),.ai-locate-btn,#testTimer{display:none!important}#submissionModal{visibility:hidden!important}</style>
<script>(function(){
try{for(var i=QS.length-1;i>=0;i--){if(QS[i].part!==1)QS.splice(i,1)}if(typeof ALLQ!=='undefined'){for(var k=ALLQ.length-1;k>=0;k--){if(ALLQ[k]>13)ALLQ.splice(k,1)}}
secondsLeft=${Math.max(0, Math.round(secondsLeft))};showPart(0);renderTimer();updateAll();
var hc=document.querySelector('.header__candidate');if(hc)hc.textContent='Entry test · Reading';document.title='Entry test · Reading';}catch(e){console.error('entry patch',e)}
var orig=showSubmissionModal;
showSubmissionModal=function(){try{orig()}catch(_){}try{var r=evaluate(),ok=0;for(var j=0;j<r.length;j++){if(r[j].ok)ok++}window.reportScore(ok,r.length)}catch(_){}};
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-entry-submit'){try{showSubmissionModal()}catch(_){}}});
})();</script>`

// Listening: no result window with the answers and no "Retake" — the
// result goes to the site straight away and the next part opens.
const listeningPatch = `
<script>(function(){
try{showResults=function(){var d=window._det||[],ok=0,all=0;for(var i=0;i<d.length;i++){if(d[i][3]!==null&&d[i][3]!==undefined){all++;if(d[i][3]===true)ok++}}try{window.reportScore(ok,all)}catch(_){}}}catch(e){console.error('entry patch',e)}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-entry-submit'){try{if(!submitted)doSubmit()}catch(_){}}});
})();</script>`

const addPatch = (html, patch) => (/<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${patch}</body>`) : html + patch)

const friendlyError = (message = '') => {
  if (/wrong_code/.test(message)) return 'That code is not right. Ask Mr Ikromov for today’s code.'
  if (/name_needed/.test(message)) return 'Please write your full name.'
  if (/phone_needed/.test(message)) return 'Please write a phone number we can call.'
  if (/too_many/.test(message)) return 'Too many people are starting right now. Please wait a minute and try again.'
  if (/fetch|network|load failed/i.test(message)) return 'The connection dropped. Check your internet and try again.'
  return 'Something went wrong. Please try again.'
}

function bandText(b) {
  return b == null ? '—' : Number(b).toFixed(1)
}

/* ---------------- one test section in a full-screen frame ---------------- */

function SectionFrame({ state, section, onDone }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  const frameRef = useRef(null)
  const doneRef = useRef(false)
  const url = section === 'listening' ? state.listening_url : state.reading_url
  const autosaveKey = `${STORE}:${state.id}:${section}`
  const endsAt = state.readingEndsAt || 0

  useEffect(() => {
    let cancelled = false
    setHtml(null)
    setError('')
    fetchPage(url)
      .then((raw) => {
        if (cancelled) return
        const patch = section === 'reading' ? readingPatch((endsAt - Date.now()) / 1000) : listeningPatch
        setHtml(withHelper(addPatch(raw, patch)))
      })
      .catch((err) => !cancelled && setError(err.message || 'The test could not load.'))
    return () => {
      cancelled = true
    }
    // the page is built once per section; the time left goes in at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, section])

  const save = useCallback(
    async (score, max, qs) => {
      if (doneRef.current) return
      doneRef.current = true
      setSaving(true)
      const [from, to] = RANGE[section]
      const mine = Array.isArray(qs) ? qs.filter((q) => q.n >= from && q.n <= to) : []
      const total = to - from + 1
      const right = mine.length ? mine.filter((q) => q.ok).length : Math.min(score, total)
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { data, error: rpcError } = await supabase.rpc('entry_save', {
          p_id: state.id,
          p_secret: state.secret,
          p_section: section,
          p_score: right,
          p_max: total,
          p_qs: mine,
        })
        if (!rpcError) {
          onDone(data || {})
          return
        }
        if (/not_found/.test(rpcError.message || '')) break
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      }
      doneRef.current = false
      setSaving(false)
      setError('Your answers could not be saved — the connection dropped. Check your internet and press Submit again.')
    },
    [section, state.id, state.secret, onDone]
  )

  useEffect(() => {
    const onMessage = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const d = event.data || {}
      if (d.type === 'ielts-ready') {
        let data = ''
        try {
          data = localStorage.getItem(autosaveKey) || ''
        } catch {
          /* ignore */
        }
        event.source.postMessage({ type: 'ielts-autosave-state', data }, '*')
      } else if (d.type === 'ielts-autosave') {
        try {
          localStorage.setItem(autosaveKey, String(d.data || ''))
        } catch {
          /* ignore */
        }
      } else if (d.type === 'ielts-workshop-score') {
        save(Number(d.score) || 0, Number(d.max) || 0, d.qs)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [autosaveKey, save])

  // Reading: 20 minutes, then the answers are handed in by themselves.
  useEffect(() => {
    if (section !== 'reading') return undefined
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [section])
  const left = section === 'reading' ? Math.max(0, Math.round((endsAt - now) / 1000)) : null
  useEffect(() => {
    if (section === 'reading' && left === 0 && html && !doneRef.current) {
      frameRef.current?.contentWindow?.postMessage({ type: 'ielts-entry-submit' }, '*')
    }
  }, [section, left, html])

  const submitNow = () => frameRef.current?.contentWindow?.postMessage({ type: 'ielts-entry-submit' }, '*')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
        <img src="/mrikromov.jpg" alt="" className="h-8 w-8 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-brand text-[14px] font-semibold text-paper">
            {section === 'listening' ? 'Part 1 of 2 · Listening' : 'Part 2 of 2 · Reading'}
          </p>
          <p className="truncate text-[12px] font-semibold text-mist">
            {section === 'listening'
              ? 'Press play once — the recording is not repeated. Press Submit when it ends.'
              : 'Read the passage and answer questions 1–13.'}
          </p>
        </div>
        {left != null && (
          <span className={`rounded-[12px] px-3 py-1.5 font-brand text-[15px] font-semibold tabular-nums ${left <= 120 ? 'bg-urgent-tint text-urgent' : 'bg-panel-2 text-paper'}`}>
            {String(Math.floor(left / 60)).padStart(2, '0')}:{String(left % 60).padStart(2, '0')}
          </span>
        )}
        <button type="button" onClick={submitNow} disabled={!html || saving} className="focus-ring h-10 rounded-[14px] bg-saffron px-4 text-[14px] font-extrabold text-[#17213a] disabled:opacity-50">
          {saving ? 'Saving…' : 'Submit'}
        </button>
      </div>
      {error && (
        <div className="shrink-0 px-4 py-2">
          <AuthNotice>{error}</AuthNotice>
        </div>
      )}
      {html ? (
        <iframe
          ref={frameRef}
          title={section}
          srcDoc={html}
          sandbox="allow-scripts allow-forms allow-modals"
          allow="autoplay"
          className="min-h-0 w-full flex-1 border-0 bg-white"
        />
      ) : (
        !error && <p className="py-16 text-center text-sm font-semibold text-mist">Loading the test…</p>
      )}
    </div>
  )
}

/* ---------------- the page ---------------- */

export default function EntryTest() {
  const [state, setState] = useState(() => loadState())
  const [form, setForm] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('code') || ''
    return { code: code.replace(/\D/g, '').slice(0, 4), name: '', phone: '+998 ', target: '', examDate: '', heard: '' }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const update = (s) => {
    setState(s)
    saveState(s)
  }

  const start = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('entry_start', {
      p_code: form.code.trim(),
      p_name: form.name,
      p_phone: form.phone,
      p_target: form.target ? Number(form.target) : null,
      p_exam_date: form.examDate || null,
      p_heard: form.heard || null,
      p_user_agent: navigator.userAgent,
    })
    setBusy(false)
    if (rpcError) {
      setError(friendlyError(rpcError.message))
      return
    }
    update({ ...data, name: form.name.trim(), stage: 'intro' })
  }

  const field = (key) => ({ value: form[key], onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })) })
  const firstName = (state?.name || '').split(/\s+/)[0]

  if (state?.stage === 'listening') {
    return <SectionFrame state={state} section="listening" onDone={() => update({ ...state, stage: 'between' })} />
  }
  if (state?.stage === 'reading') {
    return <SectionFrame state={state} section="reading" onDone={(res) => update({ ...state, stage: 'result', result: res })} />
  }

  const shell = (cardTitle, cardSubtitle, children, footer) => (
    <AuthShell
      title="Entry test — find your level."
      subtitle="About 35 minutes: one listening section and one reading passage. No account needed."
      cardTitle={cardTitle}
      cardSubtitle={cardSubtitle}
      footer={footer}
    >
      {children}
    </AuthShell>
  )

  if (state?.stage === 'intro') {
    return shell(
      `Hi ${firstName}!`,
      'Two parts, like the real IELTS exam.',
      <div className="flex flex-col gap-4">
        <ol className="flex flex-col gap-3">
          <li className="rounded-[14px] bg-panel-2 px-4 py-3">
            <p className="text-[15px] font-extrabold text-paper">1 · Listening — about 10 minutes</p>
            <p className="text-[13px] font-semibold leading-snug text-mist">Use headphones if you can. The recording plays once; answer while you listen, then press Submit.</p>
          </li>
          <li className="rounded-[14px] bg-panel-2 px-4 py-3">
            <p className="text-[15px] font-extrabold text-paper">2 · Reading — 20 minutes</p>
            <p className="text-[13px] font-semibold leading-snug text-mist">One passage with 13 questions. When the time is up, your answers are handed in by themselves.</p>
          </li>
        </ol>
        <p className="text-[13px] font-semibold text-mist">Don’t close this page. If it reloads, you continue where you were.</p>
        <button type="button" className={authPrimaryButtonClass} onClick={() => update({ ...state, stage: 'listening' })}>
          Start Listening
        </button>
      </div>
    )
  }

  if (state?.stage === 'between') {
    return shell(
      'Listening done',
      'Next: Reading, 20 minutes.',
      <div className="flex flex-col gap-4">
        <p className="text-[14px] font-semibold leading-relaxed text-paper">Take a breath. The timer starts when you press the button.</p>
        <button
          type="button"
          className={authPrimaryButtonClass}
          onClick={() => update({ ...state, stage: 'reading', readingEndsAt: Date.now() + READING_SECONDS * 1000 })}
        >
          Start Reading
        </button>
      </div>
    )
  }

  if (state?.stage === 'result') {
    const r = state.result || {}
    return shell(
      `Well done, ${firstName}!`,
      'Your entry test result',
      <div className="flex flex-col gap-4">
        <div className="rounded-[20px] bg-panel-2 px-5 py-5 text-center">
          <p className="text-[13px] font-extrabold uppercase tracking-wide text-mist">Estimated band</p>
          <p className="font-brand text-[48px] font-semibold leading-tight text-brass">{bandText(r.band)}</p>
          <p className="text-[16px] font-extrabold text-paper">{r.level || ''}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-[14px] bg-panel-2 px-4 py-3 text-center">
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-listening">Listening</p>
            <p className="font-brand text-[22px] font-semibold text-paper">{bandText(r.listening_band)}</p>
          </div>
          <div className="rounded-[14px] bg-panel-2 px-4 py-3 text-center">
            <p className="text-[12px] font-extrabold uppercase tracking-wide text-reading">Reading</p>
            <p className="font-brand text-[22px] font-semibold text-paper">{bandText(r.reading_band)}</p>
          </div>
        </div>
        <p className="text-[13px] font-semibold leading-relaxed text-mist">
          This is an estimate from two short sections. Mr Ikromov will contact you soon about the right group for you.
        </p>
        <a href="https://t.me/TeamMrIkromov" target="_blank" rel="noopener noreferrer" className={authPrimaryButtonClass}>
          Message Mr Ikromov in Telegram
        </a>
      </div>,
      <button type="button" onClick={() => update(null)} className="focus-ring rounded font-semibold text-paper hover:underline">
        Another person wants to take the test
      </button>
    )
  }

  return shell(
    'Start the entry test',
    'Fill in your details. Mr Ikromov will contact you with your result.',
    <form onSubmit={start} className="flex flex-col gap-4">
      {error && <AuthNotice>{error}</AuthNotice>}
      <AuthField label="Test code" hint="The 4-digit code from Mr Ikromov.">
        <input {...field('code')} inputMode="numeric" maxLength={4} required autoComplete="off" className={`${authInputClass} tracking-[0.4em]`} placeholder="0000" />
      </AuthField>
      <AuthField label="Full name">
        <input {...field('name')} required minLength={2} maxLength={80} autoComplete="name" className={authInputClass} placeholder="First and last name" />
      </AuthField>
      <AuthField label="Phone number">
        <input {...field('phone')} required type="tel" autoComplete="tel" className={authInputClass} placeholder="+998 90 123 45 67" />
      </AuthField>
      <div className="grid grid-cols-2 gap-3">
        <AuthField label="Target band">
          <select {...field('target')} className={authInputClass}>
            <option value="">Not sure</option>
            {TARGETS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </AuthField>
        <AuthField label="Exam date (if booked)">
          <input {...field('examDate')} type="date" className={authInputClass} />
        </AuthField>
      </div>
      <AuthField label="How did you hear about us?">
        <select {...field('heard')} className={authInputClass}>
          <option value="">Choose…</option>
          {HEARD.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
      </AuthField>
      <button type="submit" disabled={busy} className={authPrimaryButtonClass}>
        {busy ? 'Starting…' : 'Continue'}
      </button>
    </form>
  )
}
