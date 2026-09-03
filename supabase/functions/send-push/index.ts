import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

Deno.serve(async (req) => {
  /*
   * ----------------------------------------------------------
   * CORS
   * ----------------------------------------------------------
   */

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed',
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json',
        },
      }
    )
  }

  try {
    /*
     * --------------------------------------------------------
     * ENVIRONMENT
     * --------------------------------------------------------
     */

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL')

    const serviceRoleKey =
      Deno.env.get(
        'SUPABASE_SERVICE_ROLE_KEY'
      )

    const vapidPublicKey =
      Deno.env.get(
        'VAPID_PUBLIC_KEY'
      )

    const vapidPrivateKey =
      Deno.env.get(
        'VAPID_PRIVATE_KEY'
      )

    const vapidSubject =
      Deno.env.get(
        'VAPID_SUBJECT'
      ) ||
      'mailto:admin@example.com'

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !vapidPublicKey ||
      !vapidPrivateKey
    ) {
      throw new Error(
        'Push notification environment variables are not configured.'
      )
    }

    /*
     * --------------------------------------------------------
     * AUTHENTICATE REQUEST
     * --------------------------------------------------------
     */

    const authHeader =
      req.headers.get(
        'Authorization'
      )

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error:
            'Missing authorization header.',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type':
              'application/json',
          },
        }
      )
    }

    /*
     * Verify the access token using Supabase Auth.
     */

    const userResponse =
      await fetch(
        `${supabaseUrl}/auth/v1/user`,
        {
          headers: {
            Authorization:
              authHeader,
            apikey:
              serviceRoleKey,
          },
        }
      )

    if (!userResponse.ok) {
      return new Response(
        JSON.stringify({
          error:
            'Invalid authentication token.',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type':
              'application/json',
          },
        }
      )
    }

    const requestingUser =
      await userResponse.json()

    if (!requestingUser?.id) {
      return new Response(
        JSON.stringify({
          error:
            'Could not identify requesting user.',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type':
              'application/json',
          },
        }
      )
    }

    /*
     * --------------------------------------------------------
     * AUTHORIZE: ONLY TEACHERS MAY SEND PUSH NOTIFICATIONS
     * --------------------------------------------------------
     *
     * IMPORTANT: being logged in is not enough here. Without
     * this check, any authenticated student could call this
     * function directly (bypassing the app's own UI) with an
     * arbitrary list of userIds and an arbitrary title/body/
     * link, and push a notification that looks exactly like an
     * official one to every classmate or the teacher — a real
     * phishing/spam risk, not just a theoretical one.
     */

    const profileResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${requestingUser.id}&select=role`,
        {
          headers: {
            apikey:
              serviceRoleKey,
            Authorization:
              `Bearer ${serviceRoleKey}`,
          },
        }
      )

    if (!profileResponse.ok) {
      throw new Error(
        'Could not verify the requesting user\'s role.'
      )
    }

    const profileRows =
      await profileResponse.json()

    const requestingRole =
      profileRows?.[0]?.role

    if (requestingRole !== 'teacher') {
      return new Response(
        JSON.stringify({
          error:
            'Only teachers can send push notifications.',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type':
              'application/json',
          },
        }
      )
    }

    /*
     * --------------------------------------------------------
     * REQUEST BODY
     * --------------------------------------------------------
     */

    const body = await req.json()

    const userIds =
      Array.isArray(body?.userIds)
        ? body.userIds
        : []

    const title =
      String(
        body?.title ||
          'IELTS with Mr Ikromov'
      )

    const message =
      String(body?.body || '')

    const link =
      String(
        body?.link || '/app'
      )

    if (!userIds.length) {
      return new Response(
        JSON.stringify({
          sent: 0,
          message:
            'No recipient users supplied.',
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type':
              'application/json',
          },
        }
      )
    }

    /*
     * --------------------------------------------------------
     * VAPID
     * --------------------------------------------------------
     */

    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    )

    /*
     * --------------------------------------------------------
     * SUPABASE REST HELPER
     * --------------------------------------------------------
     */

    const supabaseHeaders = {
      apikey: serviceRoleKey,
      Authorization:
        `Bearer ${serviceRoleKey}`,
      'Content-Type':
        'application/json',
    }

    /*
     * --------------------------------------------------------
     * LOAD SUBSCRIPTIONS
     * --------------------------------------------------------
     */

    const uniqueUserIds = [
      ...new Set(
        userIds.filter(
          (id) =>
            typeof id === 'string' &&
            id.length > 0
        )
      ),
    ]

    const query =
      uniqueUserIds
        .map(
          (id) =>
            `"${id}"`
        )
        .join(',')

    const subscriptionsResponse =
      await fetch(
        `${supabaseUrl}/rest/v1/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${query})`,
        {
          headers:
            supabaseHeaders,
        }
      )

    if (
      !subscriptionsResponse.ok
    ) {
      const text =
        await subscriptionsResponse.text()

      throw new Error(
        `Could not load push subscriptions: ${text}`
      )
    }

    const subscriptions =
      await subscriptionsResponse.json()

    /*
     * --------------------------------------------------------
     * SEND
     * --------------------------------------------------------
     */

    let sent = 0
    let failed = 0
    let removed = 0

    const payload =
      JSON.stringify({
        title,
        body: message,
        link,
      })

    for (
      const subscription of
        subscriptions || []
    ) {
      try {
        await webpush.sendNotification(
          {
            endpoint:
              subscription.endpoint,
            keys: {
              p256dh:
                subscription.p256dh,
              auth:
                subscription.auth,
            },
          },
          payload
        )

        sent++
      } catch (error) {
        failed++

        const statusCode =
          error?.statusCode

        /*
         * 404 / 410 means the browser subscription
         * no longer exists.
         *
         * Remove it so future pushes don't keep
         * failing.
         */

        if (
          statusCode === 404 ||
          statusCode === 410
        ) {
          await fetch(
            `${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${subscription.id}`,
            {
              method: 'DELETE',
              headers:
                supabaseHeaders,
            }
          )

          removed++
        }

        console.error(
          'Push delivery failed:',
          {
            subscriptionId:
              subscription.id,
            statusCode,
            error:
              error?.message ||
              String(error),
          }
        )
      }
    }

    /*
     * --------------------------------------------------------
     * RESPONSE
     * --------------------------------------------------------
     */

    return new Response(
      JSON.stringify({
        ok: true,
        requested:
          uniqueUserIds.length,
        subscriptions:
          subscriptions?.length || 0,
        sent,
        failed,
        removed,
        requestedBy:
          requestingUser.id,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json',
        },
      }
    )
  } catch (error) {
    console.error(
      'send-push failed:',
      error
    )

    return new Response(
      JSON.stringify({
        ok: false,
        error:
          error?.message ||
          'Push notification failed.',
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type':
            'application/json',
        },
      }
    )
  }
})