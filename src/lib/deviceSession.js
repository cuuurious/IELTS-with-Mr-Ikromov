import { useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'

/*
 * ONE PHONE + ONE COMPUTER (2026-11-06, migration_109; since 2026-11-09,
 * migration_120). A student's account can be open on one phone and one
 * computer at the same time. Signing in on a second phone (or a second
 * computer) takes that place, and the old one is signed out within a minute.
 * Teachers and examiners are not limited (the server only checks students).
 */

const KEY = 'ielts:device-id'
const KICKED = 'ielts:kicked'

export function deviceId() {
  try {
    let id = window.localStorage.getItem(KEY)
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 60)
      window.localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    // Private window: one id for this tab.
    window.__ieltsDeviceId = window.__ieltsDeviceId || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`
    return window.__ieltsDeviceId
  }
}

// "Android phone · Chrome", "Windows laptop · Edge"…
export function deviceLabel() {
  const ua = navigator.userAgent || ''
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet') : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux computer' : 'Device'
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Yandex' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${os} · ${br}`
}

// Call right after a successful sign-in on this device.
export async function claimThisDevice() {
  try {
    window.localStorage.removeItem(KICKED)
  } catch {
    /* ignore */
  }
  try {
    await supabase.rpc('claim_device', { p_device_id: deviceId(), p_label: deviceLabel() })
  } catch {
    /* before migration_109: nothing to do */
  }
}

// The message on the sign-in screen after being signed out here.
export function takeKickedMessage() {
  try {
    const v = window.localStorage.getItem(KICKED)
    if (v) window.localStorage.removeItem(KICKED)
    return v || ''
  } catch {
    return ''
  }
}

// Students only: check every minute (and when the tab comes back) that this
// is still the account's device; if not, sign out here.
export function useDeviceGuard(profile, signOut) {
  const isStudent = profile?.role === 'student'
  const outRef = useRef(signOut)
  outRef.current = signOut
  useEffect(() => {
    if (!isStudent) return undefined
    let stopped = false
    const check = async () => {
      if (stopped || document.visibilityState === 'hidden') return
      const { data, error } = await supabase.rpc('check_device', { p_device_id: deviceId(), p_label: deviceLabel() })
      if (stopped || error || typeof data !== 'string' || !data.startsWith('other:')) return
      stopped = true
      const by = data.slice(6)
      try {
        window.localStorage.setItem(
          KICKED,
          by === 'Mr Ikromov signed you out'
            ? 'Mr Ikromov signed your account out on all devices. Sign in again.'
            : `Your account was opened on another ${/^(iPhone|iPad|Android)/.test(by) ? 'phone' : 'computer'} (${by}), so you were signed out here. One account is for one student — if this wasn’t you, sign in and tell Mr Ikromov.`
        )
      } catch {
        /* ignore */
      }
      try {
        await (outRef.current ? outRef.current() : supabase.auth.signOut({ scope: 'local' }))
      } finally {
        window.location.assign('/login')
      }
    }
    check()
    const t = setInterval(check, 60000)
    const onVis = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isStudent])
}
