/*
 * Loads a practice page's HTML (2026-11-06). A weak or dropped connection
 * ("Failed to fetch") is tried again by itself before the student sees a
 * message. A page that is not on the site (yet) comes back as the site's
 * own start page, so that is reported as "not found" instead of showing
 * the site inside itself.
 *
 * 2026-11-11: some students' internet can't reach the site's own address
 * for minutes at a time. The 3rd and 4th tries load the same page from a
 * second network (jsDelivr, which serves the public GitHub copy of the
 * site) — the same backup the listening audio uses.
 */
const MIRROR = 'https://cdn.jsdelivr.net/gh/cuuurious/ielts-with-mr-ikromov@main/public'
const isNetwork = (err) => /fetch|load failed|network|timed? ?out/i.test(String(err?.message || err))

export async function fetchPage(url) {
  const canMirror = /^\/practice\//.test(url || '')
  for (let attempt = 1; ; attempt += 1) {
    const useMirror = canMirror && attempt >= 3
    try {
      const r = await fetch(useMirror ? MIRROR + url.split('#')[0] : url, { cache: 'no-cache' })
      if (!r.ok) throw Object.assign(new Error('not-ok'), { status: r.status })
      const text = await r.text()
      if (/<div id="root"><\/div>/.test(text) && /\/assets\/index-/.test(text)) {
        throw Object.assign(new Error('missing'), { missing: true })
      }
      return text
    } catch (err) {
      if ((err?.missing || err?.status === 404) && !useMirror) {
        throw new Error('This page is not on the site yet. If it was just added, wait a few minutes and open it again.')
      }
      const lastTry = attempt >= (canMirror ? 4 : 3)
      if (!lastTry && (isNetwork(err) || err?.status >= 500 || useMirror)) {
        await new Promise((res) => setTimeout(res, attempt === 1 ? 1200 : 3000))
        continue
      }
      throw new Error(
        isNetwork(err) || err?.status >= 500 || useMirror
          ? 'The page could not load — the internet connection dropped. Check your connection and press Back, then open it again.'
          : 'This page could not be opened.'
      )
    }
  }
}
