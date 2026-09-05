import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':
    'POST, OPTIONS',
}

/*
 * Deletes a whole group, permanently:
 *   - a student who is ONLY a member of this group (no other group)
 *     has their ENTIRE account deleted (all submissions, chats,
 *     everywhere)
 *   - a student who ALSO belongs to at least one other group KEEPS
 *     their account — they're just removed from this group, along
 *     with this group's homeworks/submissions/completions (their
 *     other group's data is untouched)
 *   - every homework posted to the group, its submissions, and its
 *     uploaded files
 *   - every group chat message and its attachments
 *   - the group itself
 *
 * Word lists assigned to the group are NOT deleted. If a word list's
 * primary group is this group, it is reassigned to another group it
 * is already linked to (so it keeps working there). If a word list
 * is ONLY linked to this group, the whole operation is refused up
 * front (before anything is deleted) so the teacher can reassign or
 * delete that word list first.
 */

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')

    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: 'Missing authorization',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const supabaseUrl =
      Deno.env.get('SUPABASE_URL')

    const serviceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'Supabase server environment variables are missing'
      )
    }

    /*
     * Client representing the logged-in teacher.
     */
    const userClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      {
        global: {
          headers: {
            Authorization: authHeader,
          },
        },
      }
    )

    const {
      data: {
        user: teacher,
      },
      error: teacherAuthError,
    } = await userClient.auth.getUser()

    if (teacherAuthError || !teacher) {
      return new Response(
        JSON.stringify({
          error: 'Unauthorized',
        }),
        {
          status: 401,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    /*
     * Server-side admin client.
     * NEVER expose this key to React/browser code.
     */
    const admin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    /*
     * Verify that the caller is actually a teacher.
     */
    const {
      data: teacherProfile,
      error: teacherProfileError,
    } = await admin
      .from('profiles')
      .select('id, role, status')
      .eq('id', teacher.id)
      .maybeSingle()

    if (teacherProfileError) {
      throw teacherProfileError
    }

    if (
      !teacherProfile ||
      teacherProfile.role !== 'teacher'
    ) {
      return new Response(
        JSON.stringify({
          error: 'Only teachers can delete groups.',
        }),
        {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const body = await req.json()
    const groupId = body?.groupId

    if (
      !groupId ||
      typeof groupId !== 'string'
    ) {
      return new Response(
        JSON.stringify({
          error: 'groupId is required',
        }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    /*
     * Confirm the group exists before doing anything destructive.
     */
    const {
      data: group,
      error: groupError,
    } = await admin
      .from('groups')
      .select('id, name')
      .eq('id', groupId)
      .maybeSingle()

    if (groupError) {
      throw groupError
    }

    if (!group) {
      return new Response(
        JSON.stringify({
          error: 'Group was not found.',
        }),
        {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    /*
     * ------------------------------------------------------------
     * WORD LISTS — never deleted, only reassigned or blocked
     * ------------------------------------------------------------
     *
     * A word list has a primary `group_id` (its owning group) and
     * may additionally be linked to other groups through the
     * `wordlist_groups` table. Deleting the group would otherwise
     * cascade-delete any word list whose primary group is this one
     * — even if it's still actively linked to other groups.
     *
     * So first: for every word list primarily owned by this group,
     * try to hand ownership to another group it's already linked
     * to. If a word list has no other group, refuse the whole
     * deletion up front rather than losing it or guessing.
     */
    const {
      data: ownedWordlists,
      error: ownedWordlistsError,
    } = await admin
      .from('wordlists')
      .select('id, title')
      .eq('group_id', groupId)

    if (ownedWordlistsError) {
      throw ownedWordlistsError
    }

    const reassignments: {
      wordlistId: string
      newGroupId: string
    }[] = []

    const blockedWordlists: string[] = []

    for (const wordlist of ownedWordlists || []) {
      const {
        data: links,
        error: linksError,
      } = await admin
        .from('wordlist_groups')
        .select('group_id')
        .eq('wordlist_id', wordlist.id)

      if (linksError) {
        throw linksError
      }

      const alternateGroupId = (links || [])
        .map((link) => link.group_id)
        .find((id) => id !== groupId)

      if (alternateGroupId) {
        reassignments.push({
          wordlistId: wordlist.id,
          newGroupId: alternateGroupId,
        })
      } else {
        blockedWordlists.push(
          wordlist.title || 'Untitled word list'
        )
      }
    }

    if (blockedWordlists.length > 0) {
      return new Response(
        JSON.stringify({
          error:
            `Can't delete this group yet — these word lists only exist here and would be lost: ${blockedWordlists.join(
              ', '
            )}. Reassign them to another group or delete them from Word Lists first, then try again.`,
        }),
        {
          status: 409,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    for (const reassignment of reassignments) {
      const {
        error: reassignError,
      } = await admin
        .from('wordlists')
        .update({
          group_id: reassignment.newGroupId,
        })
        .eq('id', reassignment.wordlistId)

      if (reassignError) {
        throw reassignError
      }
    }

    /*
     * ------------------------------------------------------------
     * COLLECT STORAGE FILES
     * ------------------------------------------------------------
     */

    const storagePathFromUrl = (
      url: string | null | undefined,
      bucket: string
    ): string | null => {
      if (!url) return null

      const marker =
        `/storage/v1/object/public/${bucket}/`

      const index = url.indexOf(marker)

      if (index === -1) return null

      return decodeURIComponent(
        url.slice(index + marker.length)
      )
    }

    /*
     * Submission files (screenshots / uploads / audio) for every
     * submission in this group.
     */
    const {
      data: submissions,
      error: submissionsError,
    } = await admin
      .from('submissions')
      .select(
        'screenshot_urls, submission_files, audio_part1_url, audio_part2_url, audio_part3_url'
      )
      .eq('group_id', groupId)

    if (submissionsError) {
      throw submissionsError
    }

    const submissionPaths: string[] = []

    for (const submission of submissions || []) {
      for (const url of submission.screenshot_urls || []) {
        const path = storagePathFromUrl(url, 'submissions')
        if (path) submissionPaths.push(path)
      }

      for (
        const file of submission.submission_files || []
      ) {
        const path = storagePathFromUrl(
          file?.url,
          'submissions'
        )
        if (path) submissionPaths.push(path)
      }

      for (const url of [
        submission.audio_part1_url,
        submission.audio_part2_url,
        submission.audio_part3_url,
      ]) {
        const path = storagePathFromUrl(url, 'submissions')
        if (path) submissionPaths.push(path)
      }
    }

    /*
     * Teacher attachments on every homework in this group.
     */
    const {
      data: homeworks,
      error: homeworksError,
    } = await admin
      .from('homeworks')
      .select('attachment_url')
      .eq('group_id', groupId)

    if (homeworksError) {
      throw homeworksError
    }

    const homeworkFilePaths: string[] = []

    for (const homework of homeworks || []) {
      const path = storagePathFromUrl(
        homework.attachment_url,
        'homework-files'
      )
      if (path) homeworkFilePaths.push(path)
    }

    /*
     * Media attachments on every group chat message.
     */
    const {
      data: groupMessages,
      error: groupMessagesError,
    } = await admin
      .from('group_messages')
      .select('media_url')
      .eq('group_id', groupId)

    if (groupMessagesError) {
      throw groupMessagesError
    }

    const groupChatPaths: string[] = []

    for (const message of groupMessages || []) {
      const path = storagePathFromUrl(
        message.media_url,
        'group-chat'
      )
      if (path) groupChatPaths.push(path)
    }

    /*
     * ------------------------------------------------------------
     * REMOVE STORAGE FILES
     * ------------------------------------------------------------
     */

    const uniqueSubmissionPaths = [
      ...new Set(submissionPaths),
    ]

    if (uniqueSubmissionPaths.length > 0) {
      const {
        error: submissionStorageError,
      } = await admin.storage
        .from('submissions')
        .remove(uniqueSubmissionPaths)

      if (submissionStorageError) {
        throw submissionStorageError
      }
    }

    const uniqueHomeworkFilePaths = [
      ...new Set(homeworkFilePaths),
    ]

    if (uniqueHomeworkFilePaths.length > 0) {
      const {
        error: homeworkStorageError,
      } = await admin.storage
        .from('homework-files')
        .remove(uniqueHomeworkFilePaths)

      if (homeworkStorageError) {
        throw homeworkStorageError
      }
    }

    const uniqueGroupChatPaths = [
      ...new Set(groupChatPaths),
    ]

    if (uniqueGroupChatPaths.length > 0) {
      const {
        error: groupChatStorageError,
      } = await admin.storage
        .from('group-chat')
        .remove(uniqueGroupChatPaths)

      if (groupChatStorageError) {
        throw groupChatStorageError
      }
    }

    /*
     * ------------------------------------------------------------
     * FIGURE OUT WHICH STUDENTS ACTUALLY LOSE THEIR ACCOUNT
     * ------------------------------------------------------------
     *
     * A student who is ALSO a member of some other group must keep
     * their account — they just lose this group (and this group's
     * homeworks/submissions/completions, which cascade away below
     * when the group itself is deleted). Only a student whose ONLY
     * group is this one gets their whole account deleted.
     */

    const {
      data: members,
      error: membersError,
    } = await admin
      .from('group_members')
      .select('student_id')
      .eq('group_id', groupId)

    if (membersError) {
      throw membersError
    }

    const studentIds = [
      ...new Set(
        (members || []).map(
          (member) => member.student_id
        )
      ),
    ]

    let studentIdsWithOtherGroups = new Set<string>()

    if (studentIds.length > 0) {
      const {
        data: otherMemberships,
        error: otherMembershipsError,
      } = await admin
        .from('group_members')
        .select('student_id')
        .in('student_id', studentIds)
        .neq('group_id', groupId)

      if (otherMembershipsError) {
        throw otherMembershipsError
      }

      studentIdsWithOtherGroups = new Set(
        (otherMemberships || []).map(
          (membership) => membership.student_id
        )
      )
    }

    const studentIdsToDelete = studentIds.filter(
      (id) => !studentIdsWithOtherGroups.has(id)
    )

    const keptStudentCount =
      studentIds.length - studentIdsToDelete.length

    /*
     * ------------------------------------------------------------
     * DELETE ONLY THE STUDENTS WHO HAVE NO OTHER GROUP
     * ------------------------------------------------------------
     *
     * Deleting each of these students' auth accounts cascades to
     * their profile, this membership, submissions, word list
     * attempts, and chat messages. Students who belong to another
     * group are left alone here — their account, their other
     * group, and their other group's data are untouched.
     */

    const deletedStudentIds: string[] = []
    const failedStudentIds: string[] = []

    for (const studentId of studentIdsToDelete) {
      const {
        error: deleteAuthError,
      } = await admin.auth.admin.deleteUser(
        studentId
      )

      if (deleteAuthError) {
        console.error(
          'Failed to delete student during group deletion:',
          studentId,
          deleteAuthError
        )
        failedStudentIds.push(studentId)
      } else {
        deletedStudentIds.push(studentId)
      }
    }

    if (failedStudentIds.length > 0) {
      return new Response(
        JSON.stringify({
          error:
            `Deleted ${deletedStudentIds.length} of ${studentIdsToDelete.length} student accounts that only belonged to this group, but ${failedStudentIds.length} could not be deleted. The group was NOT deleted so nothing is left half-broken — please try again.`,
        }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        }
      )
    }

    /*
     * ------------------------------------------------------------
     * DELETE THE GROUP
     * ------------------------------------------------------------
     *
     * This cascades to: group_members (removing the membership of
     * any kept student, without touching their account), group_
     * messages, group_message_actions, homeworks (which cascades
     * further to their submissions and completions), submissions,
     * and wordlist_groups for this group. Word lists themselves
     * were already protected above.
     */
    const {
      error: deleteGroupError,
    } = await admin
      .from('groups')
      .delete()
      .eq('id', groupId)

    if (deleteGroupError) {
      throw deleteGroupError
    }

    const messageParts = [
      `Group "${group.name}" was permanently deleted.`,
    ]

    if (deletedStudentIds.length > 0) {
      messageParts.push(
        `${deletedStudentIds.length} student account${
          deletedStudentIds.length === 1 ? '' : 's'
        } were also deleted (they had no other group).`
      )
    }

    if (keptStudentCount > 0) {
      messageParts.push(
        `${keptStudentCount} student${
          keptStudentCount === 1 ? '' : 's'
        } kept their account (still in another group) and were just removed from this group.`
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: messageParts.join(' '),
        groupId,
        deletedStudentCount: deletedStudentIds.length,
        keptStudentCount,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  } catch (error) {
  console.error(
    'delete-group error:',
    error
  )

  const errorMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null
        ? (
            (error as {
              message?: string
              details?: string
              hint?: string
              code?: string
            }).message ||
            (error as {
              details?: string
            }).details ||
            JSON.stringify(error)
          )
        : String(error)

  return new Response(
    JSON.stringify({
      error: errorMessage,
      details:
        typeof error === 'object' && error !== null
          ? error
          : null,
    }),
    {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
      },
    }
  )
}
