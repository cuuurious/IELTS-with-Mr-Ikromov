import { supabase } from './supabaseClient'

// Inserts one notification row per approved member of `groupId`.
// Fire-and-forget from the caller's point of view — failures are logged,
// not thrown, so a notification hiccup never blocks the teacher's action.
export async function notifyGroup({ groupId, type, title, body, link = '/app' }) {
  try {
    const { data: members, error } = await supabase
      .from('group_members')
      .select('student_id, profiles!inner(status)')
      .eq('group_id', groupId)
      .eq('profiles.status', 'approved')
    if (error) throw error

    const rows = (members || []).map((m) => ({
      user_id: m.student_id,
      type,
      title,
      body,
      link,
    }))
    if (rows.length) {
      const { error: insErr } = await supabase.from('notifications').insert(rows)
      if (insErr) throw insErr

      // Fire-and-forget real push (phone/desktop notification, works even
      // with the site closed). Failing this should never break the
      // teacher's action, so it's wrapped separately.
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData?.session?.access_token
      if (accessToken) {
        fetch('/.netlify/functions/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ userIds: rows.map((r) => r.user_id), title, body, link }),
        }).catch((err) => console.error('push send failed', err))
      }
    }
  } catch (err) {
    console.error('notifyGroup failed', err)
  }
}
