import { supabase } from './supabaseClient'

/*
 * Creates in-app notifications for approved students
 * and sends real device push notifications through
 * the Supabase Edge Function `send-push`.
 */

/*
 * Returns { ok: true } when students were actually notified (in-app
 * bell at minimum), or { ok: false, reason } when something failed —
 * the caller decides whether/how to tell the teacher. This used to
 * only console.error on failure, which is invisible to a teacher who
 * never opens dev tools: the homework itself would save fine with no
 * hint that nobody was actually told about it.
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

    const rows = (members || []).map(
      (member) => ({
        user_id: member.student_id,
        type,
        title,
        body,
        link,
      })
    )

    if (!rows.length) {
      return { ok: true }
    }

    const {
      error: notificationError,
    } = await supabase
      .from('notifications')
      .insert(rows)

    if (notificationError) {
      throw notificationError
    }

    // The in-app notification rows above are already saved at this
    // point — that's the part students actually see (the bell), and
    // it has fully succeeded no matter what happens next. Everything
    // from here down is ONLY the phone/desktop push step, so it gets
    // its own try/catch: if send-push throws instead of cleanly
    // returning an error (a network hiccup calling the function, a
    // malformed response, anything), that used to fall through to the
    // outer catch below and get reported as "students could not be
    // notified at all" — wrong and needlessly alarming, since they
    // were. A push failure now can never look like a bigger failure
    // than it actually is.
    try {
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

      if (pushError) {
        console.error(
          'Push notification failed:',
          pushError
        )

        return {
          ok: false,
          reason: 'push',
          detail: pushError.message,
        }
      }

      if (pushData?.error) {
        console.error(
          'Push function returned an error:',
          pushData.error
        )

        return {
          ok: false,
          reason: 'push',
          detail: pushData.error,
        }
      }

      return { ok: true }
    } catch (pushCatchError) {
      console.error(
        'Push notification threw:',
        pushCatchError
      )

      return {
        ok: false,
        reason: 'push',
        detail: pushCatchError?.message,
      }
    }
  } catch (error) {
    console.error(
      'notifyGroup failed:',
      error
    )

    // Surface the real reason (an RLS/permissions error, a missing
    // table, etc.) instead of just "something went wrong" — this used
    // to only ever be visible in the browser console, which is no help
    // to a teacher who isn't looking at dev tools.
    return {
      ok: false,
      reason: 'all',
      detail: error?.message,
    }
  }
}