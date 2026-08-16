// Shared by send-push.mjs and daily-reminders.mjs. Not a public endpoint
// itself (underscore prefix keeps Netlify from routing to it directly).

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

let configured = false
function ensureConfigured() {
  if (configured) return
  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    throw new Error('Missing VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.')
  }
  webpush.setVapidDetails('mailto:admin@ieltswithmrikromov.netlify.app', publicKey, privateKey)
  configured = true
}

// Sends a push notification to every subscription belonging to each user
// in `userIds`. Uses the Supabase service role client (bypasses RLS) so
// it can read every subscription row. Cleans up subscriptions that have
// expired or been revoked (410/404 responses).
export async function sendPushToUsers({ supabaseAdmin, userIds, title, body, link }) {
  ensureConfigured()
  if (!userIds?.length) return

  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', userIds)

  const payload = JSON.stringify({ title, body, link: link || '/app' })

  await Promise.all(
    (subs || []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', s.id)
        } else {
          console.error('push send failed', err.statusCode, err.body)
        }
      }
    })
  )
}

export function adminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
}
