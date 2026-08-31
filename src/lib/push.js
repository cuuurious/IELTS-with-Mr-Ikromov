import { supabase } from './supabaseClient'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat(
    (4 - (base64String.length % 4)) % 4
  )

  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  const rawData = atob(base64)

  return Uint8Array.from(
    [...rawData].map((char) => char.charCodeAt(0))
  )
}

/*
 * Browser capability check only.
 *
 * Do NOT use the existence of a service-worker registration
 * here because the service worker is created when push is enabled.
 */
export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    !!VAPID_PUBLIC_KEY
  )
}

/*
 * Returns:
 *
 * unsupported
 * denied
 * granted
 * not-subscribed
 * subscribed
 */
export async function getPushStatus() {
  if (!pushSupported()) {
    return 'unsupported'
  }

  if (Notification.permission === 'denied') {
    return 'denied'
  }

  /*
   * The service worker may not exist yet.
   * That is NORMAL before the user enables notifications.
   */
  const registration =
    await navigator.serviceWorker.getRegistration('/sw.js')

  if (!registration) {
    return Notification.permission === 'granted'
      ? 'not-subscribed'
      : 'not-subscribed'
  }

  const subscription =
    await registration.pushManager.getSubscription()

  return subscription
    ? 'subscribed'
    : 'not-subscribed'
}

/*
 * Enable push notifications.
 *
 * 1. Check browser capability.
 * 2. Ask for permission.
 * 3. Register /sw.js.
 * 4. Create/reuse PushSubscription.
 * 5. Save subscription in Supabase.
 */
export async function enablePush(userId) {
  if (!userId) {
    throw new Error('No user account was provided.')
  }

  if (!pushSupported()) {
    throw new Error(
      'Push notifications are not supported on this browser/device.'
    )
  }

  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      'Push notification configuration is missing.'
    )
  }

  const permission =
    await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(
      'Notification permission was not granted.'
    )
  }

  /*
   * Register the service worker explicitly.
   */
  const registration =
    await navigator.serviceWorker.register('/sw.js', {
      scope: '/',
    })

  /*
   * Wait until the service worker is active.
   */
  await navigator.serviceWorker.ready

  /*
   * Reuse an existing subscription when possible.
   */
  let subscription =
    await registration.pushManager.getSubscription()

  /*
   * Otherwise create a new subscription.
   */
  if (!subscription) {
    subscription =
      await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          urlBase64ToUint8Array(
            VAPID_PUBLIC_KEY
          ),
      })
  }

  const json = subscription.toJSON()

  if (
    !json.endpoint ||
    !json.keys?.p256dh ||
    !json.keys?.auth
  ) {
    throw new Error(
      'The browser returned an invalid push subscription.'
    )
  }

  /*
   * Save the subscription in Supabase.
   */
  const { error } =
    await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        },
        {
          onConflict: 'endpoint',
        }
      )

  if (error) {
    console.error(
      'Failed to save push subscription:',
      error
    )

    throw new Error(
      `Could not save push subscription: ${error.message}`
    )
  }

  return true
}

/*
 * Disable push notifications for the current browser.
 */
export async function disablePush() {
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return false
  }

  const registration =
    await navigator.serviceWorker.getRegistration('/sw.js')

  if (!registration) {
    return false
  }

  const subscription =
    await registration.pushManager.getSubscription()

  if (!subscription) {
    return false
  }

  /*
   * Remove the subscription from Supabase first.
   */
  const { error } =
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', subscription.endpoint)

  if (error) {
    throw new Error(
      `Could not remove push subscription: ${error.message}`
    )
  }

  /*
   * Then unsubscribe the browser.
   */
  const unsubscribed =
    await subscription.unsubscribe()

  return unsubscribed
}