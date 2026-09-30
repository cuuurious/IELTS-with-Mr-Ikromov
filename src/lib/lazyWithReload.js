import { lazy } from 'react'

/*
 * React.lazy() with one safety net (2026-09-30).
 *
 * Splitting the app into separate downloads means a browser that still
 * has the OLD version open can ask for a piece that no longer exists
 * right after a new version is deployed ("Failed to fetch dynamically
 * imported module"). Instead of showing a broken screen, reload the page
 * once so it picks up the new version. The sessionStorage flag stops it
 * from ever reload-looping if something else is wrong.
 */
const FLAG = 'ielts:chunkReloaded'

export function lazyWithReload(factory) {
  return lazy(async () => {
    try {
      const mod = await factory()
      try {
        window.sessionStorage.removeItem(FLAG)
      } catch {
        // storage unavailable — nothing to clear
      }
      return mod
    } catch (err) {
      let alreadyReloaded = false
      try {
        alreadyReloaded = window.sessionStorage.getItem(FLAG) === '1'
        if (!alreadyReloaded) window.sessionStorage.setItem(FLAG, '1')
      } catch {
        alreadyReloaded = true
      }
      if (!alreadyReloaded) {
        window.location.reload()
        // Never resolves — the page is reloading.
        return new Promise(() => {})
      }
      throw err
    }
  })
}
