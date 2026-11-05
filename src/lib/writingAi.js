import { supabase } from './supabaseClient'

/*
 * AI marking for the Writing Task 1 / Task 2 practice pages (2026-11-05).
 * The question (and for Task 1 the graphic and the book's sample answer)
 * is read from the page itself and sent with the attempt id; the
 * ai-grading function marks the essay saved on the attempt.
 */

export function isWritingUrl(url) {
  return /\/practice\/writing\//.test(String(url || ''))
}

// What the AI needs to know about the task, read from the page HTML.
export function writingContext(html, url) {
  const s = String(html || '')
  const task = /\/task1\//.test(String(url || '')) || /const CFG = \{"no":/.test(s) ? 'task1' : 'task2'
  const ctx = { task, question: '', taskType: '', sample: '', image: null }
  if (task === 'task1') {
    const m = /const CFG = (\{[\s\S]*?\});\s*\n/.exec(s)
    if (m) {
      try {
        const cfg = JSON.parse(m[1])
        ctx.question = cfg.title || ''
        if (Array.isArray(cfg.model)) ctx.sample = cfg.model.join('\n\n')
      } catch {
        /* keep what we have */
      }
    }
    const kind = /<strong>Task \d+<\/strong> &middot; ([^<]+)<\/p>/.exec(s)
    if (kind) ctx.taskType = kind[1].trim()
    const img = /<div class="chart-container">\s*<img src="(data:image\/[^"]+)"/.exec(s)
    if (img && img[1].length < 1900000) ctx.image = img[1]
  } else {
    const q = /"question":\s*("(?:[^"\\]|\\.)*")/.exec(s)
    const t = /"type":\s*("(?:[^"\\]|\\.)*")/.exec(s)
    try {
      if (q) ctx.question = JSON.parse(q[1])
      if (t) ctx.taskType = JSON.parse(t[1])
    } catch {
      /* keep what we have */
    }
  }
  return ctx
}

// Mark one handed-in attempt. Resolves to { ai } or { error }.
export async function markWriting(attemptId, ctx) {
  try {
    const { data, error } = await supabase.functions.invoke('ai-grading', { body: { action: 'writing_task', attemptId, ...ctx } })
    if (data?.ai) return { ai: data.ai }
    let msg = data?.error || error?.message || 'Marking failed.'
    try {
      const body = await error?.context?.json?.()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    return { error: msg }
  } catch (e) {
    return { error: e?.message || 'Marking failed.' }
  }
}
