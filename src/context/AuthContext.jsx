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

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isRecoveringPassword, setIsRecoveringPassword] =
    useState(
      window.location.pathname === '/reset-password'
    )

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error(error)
    }

    setProfile(data || null)
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
         * Normal authentication events.
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
  }) => {
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
        username: username
          .trim()
          .toLowerCase(),
        role,
        status:
          role === 'teacher'
            ? 'pending'
            : 'pending',
        contact_email:
          contactEmail?.trim() || null,
      })

    if (profileError) {
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