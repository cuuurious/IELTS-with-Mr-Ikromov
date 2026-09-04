import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import {
  supabase,
  usernameToEmail,
} from '../lib/supabaseClient'
import {
  DEFAULT_TARGET_BAND,
  isValidTargetBand,
} from '../lib/targetBands'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  // Separate from `loading` (which only covers the very first check of
  // "is anyone signed in"). This covers every later profile (re)fetch —
  // on the initial load, when the tab regains focus, when Supabase
  // silently refreshes the token, and so on. Gate() in App.jsx combines
  // the two so it never shows "waiting for approval" while a profile
  // fetch is still in flight — that flash was happening because
  // `profile` briefly reads as null (not-yet-fetched looks identical
  // to genuinely-has-no-profile) while a fetch was still running, and
  // Gate had no way to tell the two apart.
  const [profileLoading, setProfileLoading] = useState(false)
  const [isRecoveringPassword, setIsRecoveringPassword] =
    useState(
      window.location.pathname === '/reset-password'
    )

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }

    setProfileLoading(true)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error(error)
    }

    setProfile(data || null)
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      const {
        data,
        error,
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (error) {
        console.error(
          'Could not get auth session:',
          error
        )

        setSession(null)
        setProfile(null)
        setLoading(false)
        return
      }

      const initialSession = data?.session || null

      setSession(initialSession)

      /*
       * Password recovery has its own route and its own
       * session handling. Do not load the normal profile
       * while the user is on /reset-password.
       */
      const recoveryRoute =
        window.location.pathname === '/reset-password'

      if (recoveryRoute) {
        setIsRecoveringPassword(true)
        setProfile(null)
      } else if (initialSession?.user?.id) {
        await loadProfile(
          initialSession.user.id
        )
      } else {
        setProfile(null)
      }

      if (mounted) {
        setLoading(false)
      }
    }

    initializeAuth()

    const {
      data: sub,
    } = supabase.auth.onAuthStateChange(
      async (event, sess) => {
        if (!mounted) return

        /*
         * Supabase fires PASSWORD_RECOVERY when the
         * user opens a valid password-reset link.
         */
        if (
          event === 'PASSWORD_RECOVERY' ||
          window.location.pathname === '/reset-password'
        ) {
          setIsRecoveringPassword(true)
          setSession(sess)
          setProfile(null)
          setLoading(false)
          return
        }

        /*
         * Normal authentication events. This also fires on the very
         * first load (Supabase re-announces the existing session
         * here too, alongside initializeAuth() above) and again on
         * every silent token refresh — none of those should touch
         * `loading`, since that's reserved for the one-time "have we
         * checked yet at all" gate. `loadProfile` tracks its own busy
         * state via `profileLoading` instead.
         */
        setIsRecoveringPassword(false)
        setSession(sess)

        if (sess?.user?.id) {
          await loadProfile(
            sess.user.id
          )
        } else {
          setProfile(null)
        }
      }
    )

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signUp = async ({
    username,
    password,
    fullName,
    role,
    groupIds,
    contactEmail,
    targetBand,
  }) => {
    const normalizedUsername = username
      .trim()
      .toLowerCase()

    // Check this up front, before creating any auth account. The most
    // common reason the profile insert below used to fail was a
    // duplicate username — catching it here means we never create an
    // orphaned login for it in the first place, and the person gets a
    // clear, specific error instead of a raw database message.
    const {
      data: existingUsername,
      error: usernameCheckError,
    } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .maybeSingle()

    if (usernameCheckError) {
      throw usernameCheckError
    }

    if (existingUsername) {
      throw new Error(
        'That username is already taken. Please choose a different one.'
      )
    }

    const email =
      contactEmail?.trim().toLowerCase() ||
      usernameToEmail(username)

    const {
      data,
      error,
    } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      throw error
    }

    const userId = data.user?.id

    if (!userId) {
      throw new Error(
        'Sign up did not return a user. Please try logging in.'
      )
    }

    const {
      error: profileError,
    } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        full_name: fullName,
        username: normalizedUsername,
        role,
        status:
          role === 'teacher'
            ? 'pending'
            : 'pending',
        contact_email:
          contactEmail?.trim() || null,
        // Target band isn't meaningful for a teacher account. For a
        // student, fall back to the default rather than trusting
        // whatever the form sent — isValidTargetBand also guards
        // against someone bypassing the UI and posting an out-of-
        // range value directly.
        target_band:
          role === 'student'
            ? isValidTargetBand(targetBand)
              ? Number(targetBand)
              : DEFAULT_TARGET_BAND
            : null,
      })

    if (profileError) {
      // The auth account was created above, but the profile row that
      // makes it actually usable failed to save. Left alone, this
      // permanently strands the username (the derived email is now
      // "already registered", but there's no working account behind
      // it). Ask the server to delete the orphaned auth account we
      // just created — using this brand-new account's own session,
      // which is exactly why the sign-up flow keeps it signed in
      // instead of signing out on error — so the username is free
      // again immediately. This is a best-effort cleanup: if it also
      // fails (e.g. no network), we still surface the original error
      // below rather than hiding it.
      try {
        await supabase.functions.invoke(
          'rollback-failed-signup'
        )
      } catch (rollbackError) {
        console.error(
          'Could not roll back the failed sign-up:',
          rollbackError
        )
      }

      await supabase.auth.signOut()

      throw profileError
    }

    if (
      role === 'student' &&
      groupIds?.length
    ) {
      const rows =
        groupIds.map(
          (group_id) => ({
            group_id,
            student_id: userId,
          })
        )

      const {
        error: gmError,
      } = await supabase
        .from('group_members')
        .insert(rows)

      if (gmError) {
        throw gmError
      }
    }

    await loadProfile(userId)

    return data
  }

  const signIn = async ({
    username,
    password,
  }) => {
    const {
      data: emailData,
      error: lookupError,
    } = await supabase.rpc(
      'auth_email_for_username',
      {
        p_username:
          username
            .trim()
            .toLowerCase(),
      }
    )

    if (lookupError) {
      throw lookupError
    }

    const email =
      typeof emailData === 'string'
        ? emailData
        : emailData?.email

    if (!email) {
      throw new Error(
        'Account email not found. Please contact your teacher.'
      )
    }

    const {
      data,
      error,
    } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (error) {
      throw error
    }

    setIsRecoveringPassword(false)

    await loadProfile(
      data.user.id
    )

    return data
  }

  /*
   * Password recovery uses the REAL recovery email.
   *
   * Normal login still uses username.
   * Forgot-password uses the email address directly.
   */
  const sendPasswordReset = async (
    email
  ) => {
    const cleanEmail =
      email?.trim().toLowerCase()

    if (!cleanEmail) {
      throw new Error(
        'Please enter your recovery email.'
      )
    }

    const {
      error,
    } =
      await supabase.auth.resetPasswordForEmail(
        cleanEmail,
        {
          redirectTo:
  'https://ieltswithmrikromov.com/reset-password',
        }
      )

    if (error) {
      throw error
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setIsRecoveringPassword(false)
  }

  const refreshProfile = () =>
    loadProfile(
      session?.user?.id
    )

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        loading,
        profileLoading,
        isRecoveringPassword,
        signUp,
        signIn,
        signOut,
        refreshProfile,
        sendPasswordReset,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () =>
  useContext(AuthContext)
