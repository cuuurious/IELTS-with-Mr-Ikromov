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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)

      loadProfile(
        data.session?.user?.id
      ).finally(() => {
        setLoading(false)
      })
    })

    const {
      data: sub,
    } = supabase.auth.onAuthStateChange(
      (_event, sess) => {
        setSession(sess)
        loadProfile(sess?.user?.id)
      }
    )

    return () =>
      sub.subscription.unsubscribe()
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
            `${window.location.origin}/reset-password`,
        }
      )

    if (error) {
      throw error
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
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