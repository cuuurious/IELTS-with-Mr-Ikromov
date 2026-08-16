import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase env vars. Copy .env.example to .env and fill in your project URL + anon key.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// We authenticate with Supabase's email/password auth, but students and the
// teacher only ever type a "username". This turns a username into a stable,
// fake-but-valid email address for the auth layer.
export const usernameToEmail = (username) =>
  `${username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '')}@users.ielts-mrikromov.app`
