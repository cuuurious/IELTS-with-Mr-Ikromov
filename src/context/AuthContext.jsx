import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from 'react'
import { supabase } from '../lib/supabaseClient'

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
    // Registration only ever creates student accounts. Jasur Ikromov is
    // the only teacher on this site, so whatever "role" a caller passes
    // in is ignored here — this is a second layer of protection behind
    // Register.jsx no longer offering a teacher option at all, in case
    // this function is ever called from somewhere else in the future.
    groupIds,
    contactEmail,
    targetBand,
  }) => {
    const normalizedUsername = username
      .trim()
      .toLowerCase()

    // Sign-up now happens as ONE server-side step (see the
    // create-student-account edge function) instead of the separate
    // browser round-trips this used to be (create the login, check
    // the username, check the contact email, insert the profile).
    // That old shape meant a lost connection or a closed tab partway
    // through could strand a real auth account with no profile behind
    // it — permanently blocking that username, since its derived
    // email would already be "registered" with nothing usable behind
    // it. Doing all of it in one request server-side means that can't
    // happen anymore, and it also automatically cleans up any account
    // that got stranded that way before this fix, the next time that
    // username is tried again. The username-taken and
    // email-already-used checks now happen inside that same function
    // too, using the admin client, so they can't be skipped or raced.
    const {
      data,
      error,
    } = await supabase.functions.invoke(
      'create-student-account',
      {
        body: {
          username: normalizedUsername,
          password,
          fullName,
          contactEmail,
          targetBand,
          groupIds,
        },
      }
    )

    if (error) {
      // supabase.functions.invoke() wraps a non-2xx response in a
      // generic error whose real message (the friendly one the
      // function sent back, e.g. "That username is already taken")
      // lives on error.context, not error.message.
      let message = error.message

      try {
        const body = await error.context?.json?.()
        if (body?.error) {
          message = body.error
        }
      } catch {
        // Ignore — fall back to error.message below.
      }

      throw new Error(
        message || 'Sign up failed. Please try again.'
      )
    }

    if (!data?.userId || !data?.email) {
      throw new Error(
        'Sign up did not return a new account. Please try logging in.'
      )
    }

    // The account and profile now both exist server-side — this is
    // exactly the same call the normal login screen makes, just with
    // the credentials the person just chose, so the browser ends up
    // signed in the ordinary way.
    const {
      error: signInError,
    } = await supabase.auth.signInWithPassword({
      email: data.email,
      password,
    })

    if (signInError) {
      throw signInError
    }

    await loadProfile(data.userId)

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
