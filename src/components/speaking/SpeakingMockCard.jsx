import { Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { loadSpeakingSets, setLabel } from '../../lib/speaking'
import { lazyWithReload } from '../../lib/lazyWithReload'
import { MicIcon } from './SpeakingFeedback'

const SpeakingTask = lazyWithReload(() => import('./SpeakingTask'))

/*
 * SPEAKING MOCK (2026-11-05, migration_107). A full speaking test with
 * the examiner's voice and an AI band. Speaking practice stays closed
 * outside homework: the student asks Mr Ikromov to unlock a mock, or
 * spends coins on one. Past mocks keep their feedback here.
 */

const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')

export default function SpeakingMockCard({ studentId, balance = null, onBalance, className = '' }) {
  const [mocks, setMocks] = useState(null)
  const [price, setPrice] = useState(50)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [run, setRun] = useState(null) // { mock, setId }

  const load = async () => {
    const [m, s] = await Promise.all([
      supabase.from('speaking_mocks').select('id, status, source, set_id, band, results, created_at, submitted_at').eq('user_id', studentId).order('created_at', { ascending: false }).limit(12),
      supabase.from('coin_settings').select('speaking_mock_price').eq('id', 1).maybeSingle(),
    ])
    if (m.error) {
      // Before migration_107 the table is missing: show nothing.
      setMocks(false)
      return
    }
    setMocks(m.data || [])
    if (s.data?.speaking_mock_price != null) setPrice(s.data.speaking_mock_price)
  }

  useEffect(() => {
    if (studentId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  if (!mocks) return null

  const open = mocks.find((m) => m.status === 'unlocked')
  const waiting = mocks.find((m) => m.status === 'requested')
  const done = mocks.filter((m) => m.status === 'done')
  const short = balance != null && balance < price

  const ask = async () => {
    setBusy('ask')
    setError('')
    const { error: e } = await supabase.rpc('request_speaking_mock')
    setBusy('')
    if (e) setError(e.message)
    else load()
  }
  const buy = async () => {
    setBusy('buy')
    setError('')
    const { data, error: e } = await supabase.rpc('buy_speaking_mock')
    setBusy('')
    setConfirm(false)
    if (e) {
      setError(e.message)
      return
    }
    if (typeof data === 'number') onBalance?.(data)
    load()
  }
  const start = async (mock) => {
    setBusy('start')
    setError('')
    try {
      const sets = (await loadSpeakingSets()).filter((s) => s.content?.part2?.cue && (s.content?.part3?.questions || []).length)
      if (!sets.length) throw new Error('No speaking tests yet. Ask Mr Ikromov.')
      const used = new Set(done.map((m) => m.set_id))
      const fresh = sets.filter((s) => !used.has(s.id))
      const pool = fresh.length ? fresh : sets
      const pick = pool[Math.floor(Math.random() * pool.length)]
      setRun({ mock, setId: pick.id, title: `Speaking mock · ${setLabel(pick)}` })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <section className={`flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-4 sm:p-5 ${className}`}>
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-speaking-tint text-speaking">
          <MicIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-speaking">Speaking mock</p>
          <p className="text-[16px] font-extrabold text-paper">A full speaking test with your band</p>
          <p className="text-[13px] font-semibold text-mist">Parts 1, 2 and 3 with the examiner’s voice, about 12 minutes. The AI gives a band for each criterion and better versions of your answers.</p>
        </div>
      </div>

      {open ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[16px] bg-speaking-tint/60 p-3">
          <p className="min-w-0 flex-1 text-[14px] font-extrabold text-paper">Your speaking mock is open. Find a quiet place and use headphones.</p>
          <button type="button" onClick={() => start(open)} disabled={Boolean(busy)} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
            {busy === 'start' ? 'Opening…' : 'Start the mock'}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {waiting ? (
            <span className="h-11 rounded-[14px] bg-panel-2 px-4 text-[13px] font-extrabold leading-[44px] text-paper-dim">Asked {fmtDay(waiting.created_at)} · waiting for Mr Ikromov</span>
          ) : (
            <button type="button" onClick={ask} disabled={Boolean(busy)} className="focus-ring h-11 rounded-[14px] bg-panel-2 px-4 text-sm font-extrabold text-paper hover:brightness-95 disabled:opacity-50">
              {busy === 'ask' ? 'Asking…' : 'Ask Mr Ikromov to open one'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirm(true)}
            disabled={Boolean(busy) || short}
            title={short ? `You need ${price} coins` : ''}
            className="focus-ring h-11 rounded-[14px] bg-saffron px-4 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50"
          >
            {short ? `${price - balance} more coins to go` : `Open it now · ${price} coins`}
          </button>
        </div>
      )}

      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-panel-2/60 p-3">
          <p className="min-w-0 flex-1 text-[13px] font-bold text-paper">
            Use <b className="text-amber">{price} coins</b> for a speaking mock?{balance != null ? ` You’ll have ${Math.max(0, balance - price)} left.` : ''}
          </p>
          <button type="button" onClick={() => setConfirm(false)} className="focus-ring h-10 rounded-[12px] px-3 text-[13px] font-extrabold text-mist hover:text-paper">Not now</button>
          <button type="button" onClick={buy} disabled={busy === 'buy'} className="focus-ring h-10 rounded-[12px] bg-saffron px-4 text-[13px] font-extrabold text-[#17213a] disabled:opacity-50">
            {busy === 'buy' ? 'Opening…' : 'Yes, open it'}
          </button>
        </div>
      )}

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2.5 text-sm font-bold text-coral">{error}</p>}

      {done.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {done.map((m) => {
            const band = m.results?.teacher?.band ?? m.band
            const ai = m.results?.ai?.status
            return (
              <li key={m.id} className="min-w-0">
                <button type="button" onClick={() => setRun({ mock: m, setId: m.set_id || m.results?.speaking?.setId, title: 'Speaking mock' })} className="focus-ring flex w-full items-center gap-3 rounded-[14px] bg-panel-2/70 px-3 py-2.5 text-left hover:brightness-95">
                  <span className="grid h-10 min-w-[48px] place-items-center rounded-[12px] bg-panel px-2 font-brand text-[16px] font-semibold text-speaking">{band != null ? Number(band).toFixed(1) : '—'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-extrabold text-paper">Mock · {fmtDay(m.submitted_at)}</span>
                    <span className="block truncate text-[12px] font-semibold text-mist">
                      {m.results?.teacher?.band != null ? 'Mr Ikromov’s band' : ai === 'processing' ? 'Marking…' : ai === 'error' ? 'Marking did not finish' : 'AI band · see feedback'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {run &&
        createPortal(
          <Suspense fallback={<div className="fixed inset-0 z-[70] bg-ink/80" />}>
            <SpeakingTask
              task={{ id: null, html_url: `speaking:${run.setId}#full`, title: run.title }}
              studentId={studentId}
              mock={run.mock}
              onClose={() => {
                setRun(null)
                load()
              }}
              onChanged={load}
            />
          </Suspense>,
          document.body
        )}
    </section>
  )
}
