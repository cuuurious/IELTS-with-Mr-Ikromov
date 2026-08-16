// netlify/functions/send-push.mjs
//
// Called from the browser (teacher posting/editing homework, chat, etc.)
// right after inserting rows into `notifications`, so the same event also
// reaches students as a real phone/desktop push — even with the site closed.

import { createClient } from '@supabase/supabase-js'
import { sendPushToUsers, adminClient } from './_pushHelper.mjs'

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({ error: 'Server missing Supabase env vars.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Require a logged-in session — any approved user can trigger a push to
  // people they're allowed to notify; we don't re-check group membership
  // here since the caller (notifyGroup) already filtered the recipient list.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing auth token.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const { data: userData, error: userError } = await supabase.auth.getUser(token)
  if (userError || !userData?.user) {
    return new Response(JSON.stringify({ error: 'Invalid session.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { userIds, title, body: message, link } = body
  if (!Array.isArray(userIds) || !userIds.length || !title) {
    return new Response(JSON.stringify({ error: 'userIds and title are required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    await sendPushToUsers({ supabaseAdmin: adminClient(), userIds, title, body: message, link })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
