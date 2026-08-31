import { supabase } from './supabaseClient'

/*
 * Creates in-app notifications for approved students
 * and sends real device push notifications through
 * the Supabase Edge Function `send-push`.
 *
 */

export async function notifyGroup({
  groupId,
  type,
  title,
  body,
  link = '/app',
}) {
  try {
    const {
      data: members,
      error: membersError,
    } = await supabase
      .from('group_members')
      .select(
        'student_id, profiles!inner(status)'
      )
      .eq('group_id', groupId)
      .eq(
        'profiles.status',
        'approved'
      )

    if (membersError) {
      throw membersError
    }

    const rows = (
      members || []
    ).map((member) => ({
      user_id:
        member.student_id,
      type,
      title,
      body,
      link,
    }))

    if (!rows.length) {
      return
    }

    /*
     * Save the in-app notifications first.
     */
    const {
      error: notificationError,
    } = await supabase
      .from('notifications')
      .insert(rows)

    if (notificationError) {
      throw notificationError
    }

    /*
     * Send real browser/phone push notifications
     * through Supabase Edge Functions.
     */
    const {
      data: pushData,
      error: pushError,
    } = await supabase.functions.invoke(
      'send-push',
      {
        body: {
          userIds: rows.map(
            (row) => row.user_id
          ),
          title,
          body,
          link,
        },
      }
    )

    console.log('=== PUSH DEBUG ===')
    console.log('Push data:', pushData)
    console.log('Push error:', pushError)
    console.log('Recipients:', rows.map((row) => row.user_id))
    console.log('==================') 

    /*
     * Push failure must never break the
     * teacher's original action.
     */
    if (pushError) {
      console.error(
        'Push notification failed:',
        pushError
      )
    }

    console.log('PUSH FUNCTION RESULT:', pushData)

if (pushData?.error) {
  console.error(
    'Push function returned an error:',
    pushData.error
  )
}
  } catch (error) {
    console.error(
      'notifyGroup failed:',
      error
    )
  }
}