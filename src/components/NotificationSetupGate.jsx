import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { enablePush, getPushStatus, pushSupported } from '../lib/push'
import { readSession, writeSession } from '../lib/sessionState'

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME

/*
 * NOTIFICATION SETUP — required (2026-10-02).
 *
 * Jasur wants to close the Telegram homework groups, but in October
 * 2026 only 18 of 250 students had phone notifications on and 2 had
 * connected the bot — the website had no way to reach the rest. Every
 * student now has to turn on at least ONE of:
 *   1. notifications on this phone/computer (web push), or
 *   2. the Telegram bot (homework, reminders, results arrive as bot
 *      messages — not from the teacher's personal account).
 * Either one counts on every device: a student who turned on push on
 * their phone isn't stopped again on a laptop.
 *
 * Renders nothing while checking or once set up; calls onReady().
 */
function isIos() {
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document)
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export default function NotificationSetupGate({ profile, onReady, onSignOut }) {
  const okKey = `ielts:${profile.id}:notifyOk`
  const [status, setStatus] = useState(() => (readSession(okKey, false) ? 'ready' : 'checking'))
  const [pushState, setPushState] = useState('checking') // unsupported | denied | not-subscribed | subscribed
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [telegramWaiting, setTelegramWaiting] = useState(false)
  const pollRef = useRef(null)

  const markReady = () => {
    writeSession(okKey, true)
    setStatus('ready')
    onReady?.()
  }

  const check = async () => {
    const [{ count: pushCount }, { data: tg }] = await Promise.all([
      supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
      supabase.from('telegram_links').select('id').eq('user_id', profile.id).maybeSingle(),
    ])
    return (pushCount || 0) > 0 || Boolean(tg)
  }

  useEffect(() => {
    if (status === 'ready') {
      onReady?.()
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        const ok = await check()
        if (cancelled) return
        if (ok) markReady()
        else setStatus('needed')
      } catch {
        // Never lock a student out because the check itself failed.
        if (!cancelled) markReady()
      }
      getPushStatus().then((s) => !cancelled && setPushState(s)).catch(() => {})
    })()
    return () => {
      cancelled = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  const turnOnPush = async () => {
    setBusy('push')
    setError('')
    try {
      await enablePush(profile.id)
      markReady()
    } catch (err) {
      setError(err?.message || 'Could not turn on notifications.')
      getPushStatus().then(setPushState).catch(() => {})
    } finally {
      setBusy('')
    }
  }

  const connectTelegram = async () => {
    setError('')
    // Open the tab synchronously (inside the click) so it isn't blocked
    // as a pop-up — same reason as in AccountSettingsModal.
    const tab = window.open('', '_blank')
    setBusy('telegram')
    try {
      const token = crypto.randomUUID()
      const { error: tokenError } = await supabase
        .from('telegram_link_tokens')
        .insert({ token, user_id: profile.id })
      if (tokenError) throw tokenError
      const url = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`
      if (tab) tab.location.href = url
      else window.location.href = url
      setTelegramWaiting(true)

      const deadline = Date.now() + 3 * 60 * 1000
      const poll = async () => {
        if (Date.now() > deadline) return
        const { data } = await supabase.from('telegram_links').select('id').eq('user_id', profile.id).maybeSingle()
        if (data) {
          markReady()
          return
        }
        pollRef.current = setTimeout(poll, 3000)
      }
      pollRef.current = setTimeout(poll, 3000)
    } catch (err) {
      if (tab && !tab.closed) tab.close()
      setError(err?.message || 'Could not open Telegram.')
    } finally {
      setBusy('')
    }
  }

  if (status !== 'needed') return null

  const ios = isIos()
  const iosNeedsInstall = ios && !isStandalone() && !pushSupported()

  return (
    <div className="fixed inset-0 z-[9990] overflow-y-auto bg-ink text-paper">
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center gap-5 px-5 py-10">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-brass">One-time setup</p>
          <h1 className="mt-2 font-display text-3xl leading-tight">Turn on homework notifications</h1>
          <p className="mt-3 text-sm leading-6 text-paper-dim">
            Homework, deadline reminders and your results now come from this website — not from
            Telegram groups. Turn on <b className="text-paper">one</b> of the two options below so you
            never miss anything. It takes 20 seconds.
          </p>
        </div>

        {/* OPTION 1 — push */}
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brass/15 text-xl">🔔</span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg">Notifications on this {ios || /Android/i.test(navigator.userAgent) ? 'phone' : 'device'}</p>
              <p className="mt-1 text-sm text-mist">Pop-up alerts, like any other app.</p>

              {pushState === 'denied' ? (
                <p className="mt-3 rounded-lg border border-coral/40 bg-coral/10 px-3 py-2 text-sm text-coral">
                  Notifications are blocked for this site. Allow them in your browser&apos;s site settings
                  (tap the 🔒 next to the address), then reload — or use Telegram below.
                </p>
              ) : iosNeedsInstall ? (
                <p className="mt-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper-dim">
                  On iPhone: tap <b className="text-paper">Share</b> → <b className="text-paper">Add to Home Screen</b>,
                  open the website from the new icon, then tap “Turn on” there. Or simply use Telegram below.
                </p>
              ) : pushState === 'unsupported' ? (
                <p className="mt-3 text-sm text-mist">This browser can&apos;t show notifications — use Telegram below.</p>
              ) : (
                <button
                  type="button"
                  onClick={turnOnPush}
                  disabled={Boolean(busy)}
                  className="focus-ring mt-3 rounded-full bg-gradient-to-br from-brass to-brass-dim px-5 py-2.5 text-sm font-semibold text-onbrass shadow disabled:opacity-50"
                >
                  {busy === 'push' ? 'Turning on…' : 'Turn on'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* OPTION 2 — Telegram bot */}
        {TELEGRAM_BOT_USERNAME && (
          <div className="rounded-2xl border border-line bg-panel p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan/15 text-xl">✈️</span>
              <div className="min-w-0 flex-1">
                <p className="font-display text-lg">Telegram bot</p>
                <p className="mt-1 text-sm text-mist">
                  Messages come from the website&apos;s bot (@{TELEGRAM_BOT_USERNAME}), not from your teacher&apos;s
                  personal account. In Telegram, tap <b className="text-paper">Start</b> and share your contact.
                </p>
                <button
                  type="button"
                  onClick={connectTelegram}
                  disabled={busy === 'telegram'}
                  className="focus-ring mt-3 rounded-full border border-cyan/50 bg-cyan/10 px-5 py-2.5 text-sm font-semibold text-cyan disabled:opacity-50"
                >
                  {busy === 'telegram' ? 'Opening Telegram…' : telegramWaiting ? 'Open Telegram again' : 'Connect Telegram'}
                </button>
                {telegramWaiting && (
                  <p className="mt-2 text-xs text-mist">
                    Waiting for you to press Start in Telegram… this page continues by itself.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-coral">{error}</p>}

        <button type="button" onClick={onSignOut} className="focus-ring self-center text-xs text-mist underline hover:text-paper">
          Not your account? Log out
        </button>
      </div>
    </div>
  )
}
