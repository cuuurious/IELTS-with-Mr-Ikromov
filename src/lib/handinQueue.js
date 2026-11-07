import { supabase } from './supabaseClient'

/*
 * HAND-IN QUEUE (2026-11-07). If the internet drops when a student
 * presses "Hand in", the hand-in is kept on this device and sent as soon
 * as the connection is back (on reconnect, every minute, and the next
 * time the site opens). Nothing is lost on a bad connection.
 */
const KEY = 'ielts:handin-queue'

export const isNetworkError = (err) =>
  (typeof navigator !== 'undefined' && navigator.onLine === false) ||
  /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|timed out|err_|connection|\b5\d\d\b/i.test(String(err?.message || err || ''))

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-30)))
  } catch {
    /* storage full or blocked */
  }
}

export function queueHandIn(args) {
  const list = read().filter((x) => x.args?.p_task_id !== args.p_task_id)
  list.push({ args, at: Date.now(), tries: 0 })
  write(list)
}

export const pendingHandIns = () => read()

let running = false
export async function flushHandIns() {
  if (running) return 0
  running = true
  let sent = 0
  try {
    const { data } = await supabase.auth.getSession()
    if (!data?.session) return 0
    for (const item of read()) {
      const { error } = await supabase.rpc('submit_homework_score', item.args)
      const rest = read().filter((x) => x.args?.p_task_id !== item.args?.p_task_id)
      if (!error) {
        write(rest)
        sent++
        continue
      }
      if (isNetworkError(error)) break
      // A real refusal (task deleted, …): try a few more times, then drop it.
      item.tries = (item.tries || 0) + 1
      write(item.tries >= 5 || Date.now() - item.at > 14 * 86400000 ? rest : [...rest, item])
    }
  } finally {
    running = false
  }
  if (sent && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ielts:handins-sent', { detail: { sent } }))
  return sent
}

let started = false
export function startHandInSync() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('online', () => flushHandIns())
  setInterval(() => read().length && flushHandIns(), 60000)
  setTimeout(() => read().length && flushHandIns(), 4000)
}

// A hand-in for this task just went through: the copy waiting here is not needed.
export function dropQueued(taskId) {
  write(read().filter((x) => x.args?.p_task_id !== taskId))
}
