import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import PhotoViewer from './PhotoViewer'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import { formatTargetBand } from '../lib/targetBands'
import TargetBandIcon from './TargetBandIcon'
import Icon from './Icon'

// A word list now counts toward a student's homework completion
// percentage, but only once they've actually scored well on it — not
// just opened/attempted it. Matches the "Good job" threshold already
// used elsewhere in this file's categoryFor-style language.
const WORDLIST_PASS_THRESHOLD = 70

export default function Leaderboard({
  groupId,
  highlightStudentId,
  onOpenChat,
}) {
  const { profile } = useAuth()
  const isTeacher = profile?.role === 'teacher'

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [selectedStudent, setSelectedStudent] = useState(null)
  const [viewingPhoto, setViewingPhoto] = useState(false)
  useEffect(() => setViewingPhoto(false), [selectedStudent?.student_id])

  // Whether the currently-shown rows are the last known good result for
  // this group while a fresh copy loads underneath — as opposed to
  // rows === null, which means there is genuinely nothing to show yet.
  const [refreshing, setRefreshing] = useState(false)

  // Every switch between group tabs (or back to "All Students") used to
  // blank the whole list back to "Loading..." and re-run this page's
  // full set of queries from scratch, even for a group just visited a
  // moment ago. This keeps the last computed rows per group so
  // revisiting one is instant — the fresh numbers still load right
  // behind it (see `refreshing` above), they just don't block the view.
  const rowsCacheRef = useRef({})

  // Lets an in-flight fetch recognize that the teacher has since
  // switched to a different group/tab, so a slower, older request can't
  // land after a faster, newer one and overwrite it with stale rows.
  const groupIdRef = useRef(groupId)
  groupIdRef.current = groupId

  const [dailyProgress, setDailyProgress] = useState([])
  const [loadingDaily, setLoadingDaily] = useState(false)
  const [dailyError, setDailyError] = useState('')

  const [manageStudent, setManageStudent] = useState(null)
  const [groups, setGroups] = useState([])
  const [memberGroupIds, setMemberGroupIds] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [savingGroup, setSavingGroup] = useState('')
  const [groupError, setGroupError] = useState('')

  const getDateKey = (value) => {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null

    return `${date.getFullYear()}-${String(
      date.getMonth() + 1
    ).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
  }

  const dateFromKey = (key) => {
    if (!key) return null
    const date = new Date(`${key}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const formatDate = (key) => {
    const date = dateFromKey(key)
    if (!date) return key

    return date.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const calculateStreak = (days, now = new Date()) => {
    if (!days?.length) return 0

    const activeDates = new Set(
      days
        .filter((day) => Number(day.completed) > 0)
        .map((day) => day.date)
    )

    if (!activeDates.size) return 0

    const currentTime = new Date(now)

    const today = new Date(currentTime)
    today.setHours(0, 0, 0, 0)

    const todayKey = getDateKey(today)

    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = getDateKey(yesterday)

    const todayDay = days.find((day) => day.date === todayKey)

    const deadlinePassed = todayDay?.latestDueDate
      ? new Date(todayDay.latestDueDate) <= currentTime
      : false

    let currentDate = null

    if (activeDates.has(todayKey)) {
      currentDate = today
    } else if (activeDates.has(yesterdayKey) && !deadlinePassed) {
      currentDate = yesterday
    } else {
      return 0
    }

    let streak = 0

    while (true) {
      const key = getDateKey(currentDate)
      if (!activeDates.has(key)) break

      streak += 1

      const previous = new Date(currentDate)
      previous.setDate(previous.getDate() - 1)
      currentDate = previous
    }

    return streak
  }

  /*
   * ============================================================
   * SHARED "WHAT DID THIS STUDENT ACTUALLY COMPLETE" LOGIC
   * ============================================================
   *
   * This is the ONE place that decides, from a student's raw
   * homeworks/submissions/completions rows, which homeworks
   * count as completed, which day each belongs to, and whether
   * a completion happened after its deadline.
   *
   * It used to be duplicated (once for the main leaderboard
   * list, sourced from a Supabase RPC that isn't visible here,
   * and once for the "Homework history" popup, computed in the
   * browser) — the two never had to agree, which is why the
   * list and the popup could show different numbers for the
   * exact same student. Every place in this file that needs
   * completed/total/percentage/streak/day-by-day history now
   * calls this same function so they can't drift apart again.
   * ============================================================
   */

  const computeDailyProgress = (
    homeworks,
    submissions,
    completions,
    wordlists = [],
    wordlistAttempts = []
  ) => {
    const submissionByHomework = new Map()

    ;(submissions || []).forEach((submission) => {
      const existing = submissionByHomework.get(
        submission.homework_id
      )

      if (
        !existing ||
        new Date(submission.submitted_at || 0) >
          new Date(existing.submitted_at || 0)
      ) {
        submissionByHomework.set(
          submission.homework_id,
          submission
        )
      }
    })

    const homeworkById = new Map(
      (homeworks || []).map((homework) => [
        homework.id,
        homework,
      ])
    )

    const completionByHomework = new Map()

    ;(completions || []).forEach((completion) => {
      if (!homeworkById.has(completion.homework_id)) return

      const existing = completionByHomework.get(
        completion.homework_id
      )

      if (
        !existing ||
        new Date(completion.completed_at) <
          new Date(existing.completed_at)
      ) {
        completionByHomework.set(
          completion.homework_id,
          completion
        )
      }
    })

    const grouped = {}

    const ensureDay = (dateKey) => {
      if (!dateKey) return null

      if (!grouped[dateKey]) {
        grouped[dateKey] = {
          date: dateKey,
          tasks: [],
          completed: 0,
          total: 0,
          latestDueDate: null,
        }
      }

      return grouped[dateKey]
    }

    let completedCount = 0
    let earliestCompletionTime = null

    ;(homeworks || []).forEach((homework) => {
      const submission = submissionByHomework.get(
        homework.id
      )

      const historicalCompletion =
        completionByHomework.get(homework.id)

      const currentlySubmitted = Boolean(
        submission?.submitted_at ||
          submission?.status === 'done' ||
          submission?.status === 'submitted'
      )

      const completed = Boolean(
        historicalCompletion || currentlySubmitted
      )

      const completedAt =
        historicalCompletion?.completed_at ||
        submission?.submitted_at ||
        null

      const late = Boolean(
        completed &&
          completedAt &&
          homework.due_date &&
          new Date(completedAt).getTime() >
            new Date(homework.due_date).getTime()
      )

      const dateKey = getDateKey(
        completedAt ||
          homework.due_date ||
          homework.created_at
      )

      const day = ensureDay(dateKey)

      if (day) {
        if (homework.due_date) {
          if (
            !day.latestDueDate ||
            new Date(homework.due_date) >
              new Date(day.latestDueDate)
          ) {
            day.latestDueDate = homework.due_date
          }
        }

        day.total += 1

        if (completed) {
          day.completed += 1
        }

        day.tasks.push({
          id: homework.id,
          title: homework.title || 'Homework',
          status: submission?.status || 'not_submitted',
          completed,
          late,
          submittedAt: completedAt,
          dueDate: homework.due_date || null,
          historicallyCompleted: Boolean(
            historicalCompletion
          ),
          currentlySubmitted,
        })
      }

      if (completed) {
        completedCount += 1

        if (completedAt) {
          const time = new Date(completedAt).getTime()

          if (
            !earliestCompletionTime ||
            time < earliestCompletionTime
          ) {
            earliestCompletionTime = time
          }
        }
      }
    })

    /*
     * ==========================================================
     * WORD LISTS — folded into the same completed/total count as
     * homeworks above.
     *
     * A word list has no due date and can be replayed, so "completed"
     * here means a PASSING attempt (>= WORDLIST_PASS_THRESHOLD%), not
     * just any attempt — otherwise a single low-score practice run
     * would count the same as actually knowing the words. It also
     * only looks at attempts made after the list's last
     * completion_reset_at (same "current cycle" rule
     * StudentWordlists.jsx already uses), so a teacher resetting a
     * list for re-practice correctly un-counts the old attempt.
     * ==========================================================
     */

    const attemptsByWordlist = new Map()

    ;(wordlistAttempts || []).forEach((attempt) => {
      if (!attemptsByWordlist.has(attempt.wordlist_id)) {
        attemptsByWordlist.set(attempt.wordlist_id, [])
      }

      attemptsByWordlist.get(attempt.wordlist_id).push(attempt)
    })

    ;(wordlists || []).forEach((wordlist) => {
      const resetAt = wordlist.completion_reset_at
        ? new Date(wordlist.completion_reset_at).getTime()
        : null

      const currentAttempts = (
        attemptsByWordlist.get(wordlist.id) || []
      ).filter(
        (attempt) =>
          !resetAt ||
          new Date(attempt.created_at).getTime() > resetAt
      )

      const passingAttempts = currentAttempts
        .filter(
          (attempt) =>
            Number(attempt.percentage) >= WORDLIST_PASS_THRESHOLD
        )
        .sort(
          (a, b) =>
            new Date(a.created_at) - new Date(b.created_at)
        )

      const completed = passingAttempts.length > 0
      const completedAt = completed
        ? passingAttempts[0].created_at
        : null

      const dateKey = getDateKey(
        completedAt || wordlist.created_at
      )

      const day = ensureDay(dateKey)

      if (day) {
        day.total += 1

        if (completed) {
          day.completed += 1
        }

        day.tasks.push({
          id: `wordlist:${wordlist.id}`,
          title: `Vocabulary: ${wordlist.title || 'Word list'}`,
          status: completed
            ? 'done'
            : currentAttempts.length
            ? 'below_pass'
            : 'not_submitted',
          completed,
          late: false,
          submittedAt: completedAt,
          dueDate: null,
          historicallyCompleted: false,
          currentlySubmitted: completed,
        })
      }

      if (completed) {
        completedCount += 1

        if (completedAt) {
          const time = new Date(completedAt).getTime()

          if (
            !earliestCompletionTime ||
            time < earliestCompletionTime
          ) {
            earliestCompletionTime = time
          }
        }
      }
    })

    Object.values(grouped).forEach((day) => {
      day.tasks.sort((a, b) =>
        a.title.localeCompare(b.title)
      )
    })

    const days = Object.values(grouped)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((day) => ({
        ...day,
        percentage:
          day.total > 0
            ? Math.round(
                (day.completed / day.total) * 100
              )
            : 0,
      }))

    const total =
      (homeworks || []).length + (wordlists || []).length

    const percentage =
      total > 0
        ? Math.round((completedCount / total) * 100)
        : 0

    return {
      days,
      completed: completedCount,
      total,
      percentage,
      earliestCompletionTime,
    }
  }

  const loadLeaderboard = async () => {
    if (!groupId) return

    // Snapshot which group/tab this call is for. If the teacher taps
    // another tab before this round of requests comes back, this call's
    // (now stale) result gets discarded below instead of landing after
    // — and overwriting — the newer tab's rows.
    const requestedGroup = groupId

    setError('')

    try {
      /*
       * ========================================================
       * 1, 2 & 3.5 — ROSTER, HOMEWORKS, WORD LISTS, IN PARALLEL
       * ========================================================
       * None of these three depend on each other's results — the
       * roster, the homeworks in scope, and every word list in the
       * school — so there's no reason to fetch them one after
       * another. (For "All Students", the roster itself is two
       * more independent requests — profiles and memberships —
       * bundled into the same parallel batch below.) This alone
       * turns what used to be several sequential round trips into
       * one, which is exactly why switching between group tabs
       * here felt sluggish.
       * ========================================================
       */

      let homeworkQuery = supabase
        .from('homeworks')
        .select('id, title, due_date, created_at, group_id')

      if (requestedGroup !== 'all') {
        homeworkQuery = homeworkQuery.eq(
          'group_id',
          requestedGroup
        )
      }

      // 2026-10-06: contact_email is a student's login email — only
      // teachers may see it. Students no longer even fetch it for
      // their classmates.
      const profileCols = isTeacher
        ? 'id, full_name, username, contact_email, status, target_band, avatar_url'
        : 'id, full_name, username, status, target_band, avatar_url'

      const rosterQuery =
        requestedGroup === 'all'
          ? Promise.all([
              supabase
                .from('profiles')
                .select(profileCols)
                .eq('role', 'student'),
              supabase
                .from('group_members')
                .select('student_id, group_id'),
            ])
          : supabase
              .from('group_members')
              .select(`student_id, profiles(${profileCols})`)
              .eq('group_id', requestedGroup)

      const wordlistsQuery = supabase
        .from('wordlists')
        .select(
          'id, title, created_at, completion_reset_at, wordlist_groups(group_id)'
        )

      const [rosterResult, homeworksResult, wordlistsResult] =
        await Promise.all([
          rosterQuery,
          homeworkQuery,
          wordlistsQuery,
        ])

      let studentRows = []
      const groupIdsByStudent = new Map()

      if (requestedGroup === 'all') {
        const [
          { data: profilesData, error: profilesError },
          { data: memberRows, error: memberError },
        ] = rosterResult

        if (profilesError) throw profilesError
        if (memberError) throw memberError

        studentRows = (profilesData || []).map((p) => ({
          student_id: p.id,
          full_name: p.full_name,
          username: p.username,
          contact_email: isTeacher ? p.contact_email : null,
          status: p.status,
          target_band: p.target_band,
          avatar_url: p.avatar_url,
        }))

        ;(memberRows || []).forEach((row) => {
          if (!groupIdsByStudent.has(row.student_id)) {
            groupIdsByStudent.set(
              row.student_id,
              new Set()
            )
          }

          groupIdsByStudent
            .get(row.student_id)
            .add(row.group_id)
        })
      } else {
        const { data: memberRows, error: memberError } =
          rosterResult

        if (memberError) throw memberError

        studentRows = (memberRows || [])
          .filter((m) => m.profiles)
          .map((m) => ({
            student_id: m.student_id,
            full_name: m.profiles.full_name,
            username: m.profiles.username,
            contact_email: isTeacher ? m.profiles.contact_email : null,
            status: m.profiles.status,
            target_band: m.profiles.target_band,
            avatar_url: m.profiles.avatar_url,
          }))
      }

      const { data: homeworks, error: homeworksError } =
        homeworksResult

      if (homeworksError) throw homeworksError

      const homeworkIds = (homeworks || []).map(
        (homework) => homework.id
      )

      const { data: wordlistsRaw, error: wordlistsError } =
        wordlistsResult

      if (wordlistsError) throw wordlistsError

      const wordlistGroupIds = (wordlist) =>
        (wordlist.wordlist_groups || []).map(
          (link) => link.group_id
        )

      const wordlists =
        requestedGroup === 'all'
          ? wordlistsRaw || []
          : (wordlistsRaw || []).filter((wordlist) =>
              wordlistGroupIds(wordlist).includes(
                requestedGroup
              )
            )

      const wordlistIds = (
        requestedGroup === 'all'
          ? wordlistsRaw || []
          : wordlists
      ).map((wordlist) => wordlist.id)

      /*
       * ========================================================
       * SUBMISSIONS + COMPLETIONS + WORD LIST ATTEMPTS
       * ========================================================
       * Each of these depends on the IDs fetched just above, but
       * not on one another — another independent trio, so they
       * run together instead of one after another too.
       * ========================================================
       */

      const [subResult, compResult, attemptsResult] =
        await Promise.all([
          homeworkIds.length
            ? supabase
                .from('submissions')
                .select(
                  'student_id, homework_id, status, submitted_at'
                )
                .in('homework_id', homeworkIds)
            : Promise.resolve({ data: [] }),
          homeworkIds.length
            ? supabase
                .from('homework_completions')
                .select(
                  'student_id, homework_id, completed_at'
                )
                .in('homework_id', homeworkIds)
            : Promise.resolve({ data: [] }),
          wordlistIds.length
            ? supabase
                .from('wordlist_attempts')
                .select(
                  'student_id, wordlist_id, percentage, created_at'
                )
                .in('wordlist_id', wordlistIds)
            : Promise.resolve({ data: [] }),
        ])

      if (subResult.error) throw subResult.error
      if (compResult.error) throw compResult.error
      if (attemptsResult.error) throw attemptsResult.error

      const submissions = subResult.data || []
      const completions = compResult.data || []
      const wordlistAttempts = attemptsResult.data || []

      const submissionsByStudent = new Map()

      submissions.forEach((submission) => {
        if (
          !submissionsByStudent.has(submission.student_id)
        ) {
          submissionsByStudent.set(
            submission.student_id,
            []
          )
        }

        submissionsByStudent
          .get(submission.student_id)
          .push(submission)
      })

      const completionsByStudent = new Map()

      completions.forEach((completion) => {
        if (
          !completionsByStudent.has(completion.student_id)
        ) {
          completionsByStudent.set(
            completion.student_id,
            []
          )
        }

        completionsByStudent
          .get(completion.student_id)
          .push(completion)
      })

      const wordlistAttemptsByStudent = new Map()

      wordlistAttempts.forEach((attempt) => {
        if (
          !wordlistAttemptsByStudent.has(attempt.student_id)
        ) {
          wordlistAttemptsByStudent.set(
            attempt.student_id,
            []
          )
        }

        wordlistAttemptsByStudent
          .get(attempt.student_id)
          .push(attempt)
      })

      /*
       * ========================================================
       * 4. COMPUTE EVERY STUDENT'S STATS
       * ========================================================
       * Same computeDailyProgress() function the profile popup
       * uses below, so the list and the popup can never disagree
       * again.
       * ========================================================
       */

      const computedRows = studentRows.map((student) => {
        const relevantHomeworks =
          groupId === 'all'
            ? (homeworks || []).filter((homework) =>
                groupIdsByStudent
                  .get(student.student_id)
                  ?.has(homework.group_id)
              )
            : homeworks || []

        const relevantWordlists =
          groupId === 'all'
            ? (wordlistsRaw || []).filter((wordlist) =>
                wordlistGroupIds(wordlist).some((gid) =>
                  groupIdsByStudent
                    .get(student.student_id)
                    ?.has(gid)
                )
              )
            : wordlists

        const {
          days,
          completed,
          total,
          percentage,
          earliestCompletionTime,
        } = computeDailyProgress(
          relevantHomeworks,
          submissionsByStudent.get(
            student.student_id
          ) || [],
          completionsByStudent.get(
            student.student_id
          ) || [],
          relevantWordlists,
          wordlistAttemptsByStudent.get(
            student.student_id
          ) || []
        )

        return {
          ...student,
          completed,
          total,
          percentage,
          streak: calculateStreak(days),
          _earliestCompletionTime: earliestCompletionTime,
        }
      })

      const sortedRows = [...computedRows].sort((a, b) => {
        if (a.completed !== b.completed) {
          return b.completed - a.completed
        }

        if (a.percentage !== b.percentage) {
          return b.percentage - a.percentage
        }

        const timeA =
          a._earliestCompletionTime ??
          Number.MAX_SAFE_INTEGER

        const timeB =
          b._earliestCompletionTime ??
          Number.MAX_SAFE_INTEGER

        if (timeA !== timeB) {
          return timeA - timeB
        }

        return String(a.full_name || '').localeCompare(
          String(b.full_name || '')
        )
      })

      const finalRows = sortedRows.map((row, index) => ({
        ...row,
        rank: index + 1,
      }))

      // The teacher has since switched to a different group/tab — this
      // response is for a tab that's no longer showing, so it's
      // dropped rather than clobbering whatever that newer tab already
      // loaded (or is still loading).
      if (requestedGroup !== groupIdRef.current) return

      rowsCacheRef.current[requestedGroup] = finalRows
      setRows(finalRows)
      setRefreshing(false)
    } catch (err) {
      console.error('Leaderboard error:', err)

      if (requestedGroup === groupIdRef.current) {
        setError(
          err?.message || 'Failed to load the leaderboard.'
        )
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    if (!groupId) return

    setError('')
    setSelectedStudent(null)
    setDailyProgress([])
    setDailyError('')

    // A tab visited earlier this session shows its last known rows
    // immediately — no blank "Loading..." screen — while a fresh copy
    // loads quietly behind it (see the `refreshing` note above). A
    // tab with no cached rows yet still shows the honest loading state.
    const cached = rowsCacheRef.current[groupId]

    if (cached) {
      setRows(cached)
      setRefreshing(true)
    } else {
      setRows(null)
      setRefreshing(false)
    }

    loadLeaderboard()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  // 2026-10-06: tapping student A then B quickly used to let A's slower
  // response land under B's name. Each call takes a token; only the
  // newest one may write state.
  const dailyRequestRef = useRef(0)

  const loadDailyProgress = async (student) => {
    if (!student?.student_id || !groupId) return null

    const requestId = ++dailyRequestRef.current
    const isStale = () => requestId !== dailyRequestRef.current

    setLoadingDaily(true)
    setDailyError('')
    setDailyProgress([])

    try {
      let homeworkQuery = supabase
        .from('homeworks')
        .select(`
          id,
          title,
          created_at,
          due_date,
          group_id
        `)

      if (groupId !== 'all') {
        homeworkQuery = homeworkQuery.eq('group_id', groupId)
      }

      let submissionQuery = supabase
        .from('submissions')
        .select(`
          id,
          homework_id,
          status,
          submitted_at,
          group_id
        `)
        .eq('student_id', student.student_id)

      if (groupId !== 'all') {
        submissionQuery = submissionQuery.eq(
          'group_id',
          groupId
        )
      }

      // 2026-10-06: these five don't depend on each other — run them in
      // parallel instead of one round trip after another.
      const [
        { data: allHomeworks, error: homeworkError },
        memberResult,
        { data: submissions, error: submissionError },
        { data: historicalCompletions, error: completionError },
        { data: studentWordlistsRaw, error: studentWordlistsError },
      ] = await Promise.all([
        homeworkQuery.order('created_at', { ascending: false }),
        groupId === 'all'
          ? supabase
              .from('group_members')
              .select('group_id')
              .eq('student_id', student.student_id)
          : Promise.resolve({ data: null, error: null }),
        submissionQuery.order('submitted_at', { ascending: false }),
        supabase
          .from('homework_completions')
          .select(`
            homework_id,
            completed_at,
            group_id
          `)
          .eq('student_id', student.student_id),
        /*
         * Same word-list scoping as loadLeaderboard() above, just for
         * this one student.
         */
        supabase
          .from('wordlists')
          .select(
            'id, title, created_at, completion_reset_at, wordlist_groups(group_id)'
          ),
      ])

      if (homeworkError) throw homeworkError
      if (memberResult.error) throw memberResult.error
      if (submissionError) throw submissionError
      if (completionError) throw completionError
      if (studentWordlistsError) throw studentWordlistsError

      let homeworks = allHomeworks || []

      // Also reused below for word lists.
      let studentGroupIds = null

      /*
       * For "all students", only count homeworks from groups
       * this specific student actually belongs to — not every
       * homework that exists across every group.
       */
      if (groupId === 'all') {
        studentGroupIds = new Set(
          (memberResult.data || []).map((row) => row.group_id)
        )

        homeworks = homeworks.filter((homework) =>
          studentGroupIds.has(homework.group_id)
        )
      }

      const wordlists = (studentWordlistsRaw || []).filter(
        (wordlist) => {
          const linkedGroupIds = (
            wordlist.wordlist_groups || []
          ).map((link) => link.group_id)

          return groupId === 'all'
            ? linkedGroupIds.some((gid) =>
                studentGroupIds?.has(gid)
              )
            : linkedGroupIds.includes(groupId)
        }
      )

      const wordlistIds = wordlists.map(
        (wordlist) => wordlist.id
      )

      let wordlistAttempts = []

      if (wordlistIds.length) {
        const {
          data: wordlistAttemptsData,
          error: wordlistAttemptsError,
        } = await supabase
          .from('wordlist_attempts')
          .select('wordlist_id, percentage, created_at')
          .eq('student_id', student.student_id)
          .in('wordlist_id', wordlistIds)

        if (wordlistAttemptsError) throw wordlistAttemptsError
        wordlistAttempts = wordlistAttemptsData || []
      }

      if (isStale()) return null

      const {
        days,
        completed,
        total,
        percentage,
      } = computeDailyProgress(
        homeworks,
        submissions || [],
        historicalCompletions || [],
        wordlists,
        wordlistAttempts
      )

      const streak = calculateStreak(days)

      setDailyProgress(days)

      /*
       * Keep the Rank/Progress/Completed summary box in sync
       * with the "Homework history" list right below it — both
       * now come from the exact same calculation.
       */
      setSelectedStudent((previous) =>
        previous && previous.student_id === student.student_id
          ? {
              ...previous,
              completed,
              total,
              percentage,
            }
          : previous
      )

      return streak
    } catch (err) {
      if (isStale()) return null
      console.error('Daily progress error:', err)

      setDailyError(
        err?.message ||
          'Failed to load daily progress.'
      )

      setDailyProgress([])
      return null
    } finally {
      if (!isStale()) setLoadingDaily(false)
    }
  }

  const selectStudent = async (student) => {
    setSelectedStudent({
      ...student,
      streak: 0,
    })

    const streak = await loadDailyProgress(student)

    if (streak !== null) {
      setSelectedStudent((previous) =>
        previous && previous.student_id === student.student_id
          ? {
              ...previous,
              streak,
            }
          : previous
      )
    }
  }

  const handleChat = (student) => {
    if (!student?.student_id) return

    if (typeof onOpenChat === 'function') {
      onOpenChat(student)
      return
    }

    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: {
          link: `private-chat:${student.student_id}`,
        },
      })
    )
  }

  const openManageGroups = async (student) => {
    if (!isTeacher || !student?.student_id) return

    setManageStudent(student)
    setGroups([])
    setMemberGroupIds([])
    setGroupError('')
    setLoadingGroups(true)

    try {
      const { data: allGroups, error: groupsError } =
        await supabase
          .from('groups')
          .select('id, name, created_at')
          .order('created_at', {
            ascending: true,
          })

      if (groupsError) throw groupsError

      const { data: memberships, error: membershipError } =
        await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', student.student_id)

      if (membershipError) throw membershipError

      setGroups(allGroups || [])
      setMemberGroupIds(
        (memberships || []).map(
          (membership) => membership.group_id
        )
      )
    } catch (err) {
      console.error('Manage groups error:', err)
      setGroupError(
        err?.message || 'Failed to load groups.'
      )
    } finally {
      setLoadingGroups(false)
    }
  }

  const closeManageGroups = () => {
    setManageStudent(null)
    setGroups([])
    setMemberGroupIds([])
    setGroupError('')
    setSavingGroup('')
  }

  const toggleGroupMembership = async (
    group,
    isMember
  ) => {
    if (!manageStudent) return

    setSavingGroup(group.id)
    setGroupError('')

    try {
      if (isMember) {
        const { error: deleteError } = await supabase
          .from('group_members')
          .delete()
          .eq('group_id', group.id)
          .eq('student_id', manageStudent.student_id)

        if (deleteError) throw deleteError

        setMemberGroupIds((previous) =>
          previous.filter((id) => id !== group.id)
        )
      } else {
        const { error: insertError } = await supabase
          .from('group_members')
          .insert({
            group_id: group.id,
            student_id: manageStudent.student_id,
          })

        if (insertError && insertError.code !== '23505') {
          throw insertError
        }

        setMemberGroupIds((previous) =>
          previous.includes(group.id)
            ? previous
            : [...previous, group.id]
        )
      }

      await loadLeaderboard()
    } catch (err) {
      console.error('Group membership error:', err)
      setGroupError(
        err?.message ||
          'Failed to update group membership.'
      )
    } finally {
      setSavingGroup('')
    }
  }

  const closeStudentProfile = () => {
    setSelectedStudent(null)
    setDailyProgress([])
    setDailyError('')
  }

  if (error) {
    return (
      <p className="text-coral text-sm">
        {error}
      </p>
    )
  }

  if (rows === null) {
    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]" aria-busy="true">
        <div className="h-64 animate-pulse rounded-[22px] bg-panel-2" />
        <div className="h-96 animate-pulse rounded-[22px] bg-panel-2" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[22px] border border-dashed border-line bg-panel px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-vocab-tint text-vocab">
          <Icon name="target" className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold text-paper">No students here yet</p>
        <p className="text-xs text-mist">The ranking appears once students join this group.</p>
      </div>
    )
  }

  // Study-room leaderboard (2026-10-06): a podium for the top three,
  // "you" pinned for a student, then a compact ranked list.
  const podium = rows.length >= 3 ? [rows[1], rows[0], rows[2]] : []
  const rest = rows.length >= 3 ? rows.slice(3) : rows
  const me = highlightStudentId ? rows.find((r) => r.student_id === highlightStudentId) : null
  const above = me && me.rank > 1 ? rows.find((r) => r.rank === me.rank - 1) : null
  const pct = (v) => Math.min(100, Math.max(0, Number(v) || 0))
  const MEDAL = {
    1: { ring: 'ring-[#E8B64C]', chip: 'bg-[#E8B64C] text-[#3d2a05]', plinth: 'h-24 bg-vocab-tint', label: '1st' },
    2: { ring: 'ring-[#AEB4C2]', chip: 'bg-[#AEB4C2] text-[#22252c]', plinth: 'h-16 bg-panel-2', label: '2nd' },
    3: { ring: 'ring-[#C98D5B]', chip: 'bg-[#C98D5B] text-[#2e1806]', plinth: 'h-12 bg-writing-tint', label: '3rd' },
  }

  const Avatar = ({ student, size = 'h-11 w-11', ring = '' }) =>
    student.avatar_url ? (
      <img src={student.avatar_url} alt="" className={`${size} shrink-0 rounded-full object-cover ${ring}`} />
    ) : (
      <span className={`${size} flex shrink-0 items-center justify-center rounded-full bg-speaking-tint text-sm font-semibold text-speaking ${ring}`}>
        {(student.full_name || '?')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase())
          .join('')}
      </span>
    )

  const avgPct = rows.length ? Math.round(rows.reduce((sum, r) => sum + pct(r.percentage), 0) / rows.length) : 0
  const allDone = rows.filter((r) => r.total > 0 && r.completed >= r.total).length
  const bestStreak = rows.reduce((best, r) => ((r.streak || 0) > (best?.streak || 0) ? r : best), null)
  const firstName = (r) => (r?.full_name || '').trim().split(/\s+/)[0] || 'them'
  const meLine = (() => {
    if (!me) return ''
    if (me.rank === 1) return 'You are at the top — keep handing work in on time to stay there.'
    if (!above) return ''
    const gap = (above.completed || 0) - (me.completed || 0)
    if (gap > 0) return `${gap} task${gap === 1 ? '' : 's'} behind ${firstName(above)} in #${above.rank}. One more hand-in and you move up.`
    return `Level with ${firstName(above)} on tasks — they handed in earlier. Hand the next one in early to pass.`
  })()

  return (
    <div className="flex flex-col gap-4">
      {refreshing && <div className="-mb-2 text-xs text-mist">Refreshing…</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-24">
          {/* YOUR PLACE (students) */}
          {me && !isTeacher && (
            <div className="wp-pop flex items-center gap-4 rounded-[22px] border border-[#F3D27A] bg-vocab-tint px-5 py-4">
              <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-white/70">
                <span className="text-[10px] font-semibold text-vocab">Place</span>
                <span className="text-xl font-semibold leading-none tabular-nums text-paper">{me.rank}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-paper">
                  {me.completed}/{me.total} tasks · {me.percentage}%
                  {me.streak > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-xs font-semibold text-writing">
                      <Icon name="flame" className="h-3.5 w-3.5" />
                      {me.streak}-day streak
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-paper-dim">{meLine}</p>
              </div>
            </div>
          )}

          {/* PODIUM */}
          {podium.length === 3 && (
            <div className="rounded-[22px] border border-line bg-panel px-5 pb-0 pt-5">
              <div className="mb-4 flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-paper">Top of the {groupId === 'all' ? 'school' : 'group'}</p>
                <p className="text-xs text-mist">Most homework handed in</p>
              </div>
              <div className="mx-auto grid max-w-sm grid-cols-3 items-end gap-2">
                {podium.map((student) => {
                  const m = MEDAL[student.rank] || MEDAL[3]
                  const mine = student.student_id === highlightStudentId
                  return (
                    <button
                      key={student.student_id}
                      type="button"
                      onClick={() => selectStudent(student)}
                      className="wp-pop focus-ring group flex min-w-0 flex-col items-center rounded-t-2xl text-center"
                      style={{ animationDelay: `${student.rank * 70}ms` }}
                    >
                      <div className="relative">
                        <Avatar
                          student={student}
                          size={student.rank === 1 ? 'h-16 w-16' : 'h-12 w-12'}
                          ring={`ring-4 ${m.ring} transition-transform group-hover:scale-105`}
                        />
                        <span className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full px-1.5 py-px text-[10px] font-bold ${m.chip}`}>
                          {m.label}
                        </span>
                      </div>
                      <p className={`mt-3 w-full truncate px-1 text-[13px] font-semibold ${mine ? 'text-vocab' : 'text-paper'}`}>
                        {student.full_name?.split(' ')[0]}
                      </p>
                      <p className="text-[11px] tabular-nums text-mist">
                        {student.completed}/{student.total} · {student.percentage}%
                      </p>
                      <div className={`mt-2 flex w-full items-start justify-center rounded-t-xl pt-1.5 ${m.plinth}`}>
                        {student.streak > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-writing">
                            <Icon name="flame" className="h-3 w-3" />
                            {student.streak}
                          </span>
                        ) : (
                          <span className="text-sm font-bold tabular-nums text-paper/30">{student.rank}</span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* GROUP AT A GLANCE */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl border border-line bg-panel px-3 py-3">
              <p className="text-[11px] text-mist">Average</p>
              <p className="text-lg font-semibold tabular-nums text-paper">{avgPct}%</p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full rounded-full bg-reading" style={{ width: `${avgPct}%` }} />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-3 py-3">
              <p className="text-[11px] text-mist">Everything done</p>
              <p className="text-lg font-semibold tabular-nums text-paper">
                {allDone}
                <span className="text-xs font-normal text-mist"> / {rows.length}</span>
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-panel px-3 py-3">
              <p className="text-[11px] text-mist">Longest streak</p>
              <p className="flex items-center gap-1 text-lg font-semibold tabular-nums text-paper">
                <Icon name="flame" className="h-4 w-4 text-writing" />
                {bestStreak?.streak || 0}
              </p>
              {bestStreak?.streak > 0 && <p className="truncate text-[11px] text-mist">{firstName(bestStreak)}</p>}
            </div>
          </div>
        </div>

        {/* LIST */}
        {rest.length > 0 && (
          <div className="min-w-0 overflow-hidden rounded-[22px] border border-line bg-panel">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <p className="text-sm font-semibold text-paper">{podium.length ? 'Everyone else' : 'Everyone'}</p>
              <p className="text-xs text-mist">
                {rows.length} student{rows.length === 1 ? '' : 's'} · tap one for details
              </p>
            </div>
            <ol>
              {rest.map((student, i) => {
                const mine = student.student_id === highlightStudentId
                const p = pct(student.percentage)
                return (
                  <li key={student.student_id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => selectStudent(student)}
                      className={`wp-pop focus-ring group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors sm:px-5 ${
                        mine ? 'bg-vocab-tint' : 'hover:bg-panel-2'
                      }`}
                      style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}
                    >
                      <span className="w-6 shrink-0 text-center text-sm font-semibold tabular-nums text-mist">{student.rank}</span>
                      <Avatar student={student} size="h-9 w-9" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-paper">{student.full_name}</span>
                          {mine && <span className="shrink-0 rounded-full bg-vocab px-1.5 text-[10px] font-bold text-white">You</span>}
                          {student.streak > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-writing">
                              <Icon name="flame" className="h-3 w-3" />
                              {student.streak}
                            </span>
                          )}
                          {isTeacher && student.target_band != null && (
                            <span className="hidden shrink-0 items-center gap-1 text-[11px] text-mist sm:inline-flex">
                              <TargetBandIcon value={student.target_band} className="h-3 w-3" />
                              {formatTargetBand(student.target_band)}
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <div className="h-1.5 max-w-[22rem] flex-1 overflow-hidden rounded-full bg-panel-2">
                            <div
                              className={`h-full rounded-full transition-[width] duration-700 ${p >= 80 ? 'bg-reading' : p >= 50 ? 'bg-[#E8B64C]' : p > 0 ? 'bg-writing' : 'bg-transparent'}`}
                              style={{ width: `${p}%` }}
                            />
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-mist">
                            {student.total ? `${student.completed}/${student.total} tasks` : 'no tasks yet'}
                          </span>
                        </div>
                      </div>
                      <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-paper">{student.percentage}%</span>
                      <span className="text-mist transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        )}
      </div>

      {selectedStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeStudentProfile()
              }
            }}
          >
            <div
              className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-panel text-paper shadow-2xl"
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              {viewingPhoto && (
                <PhotoViewer
                  src={selectedStudent.avatar_url}
                  alt={selectedStudent.full_name || 'Student photo'}
                  onClose={() => setViewingPhoto(false)}
                />
              )}
              <div className="flex-shrink-0 border-b border-line bg-panel px-5 py-4 sm:px-7">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative shrink-0">
                      {selectedStudent.avatar_url ? (
                        <button
                          type="button"
                          onClick={() => setViewingPhoto(true)}
                          aria-label="Open photo"
                          title="Open photo"
                          className="focus-ring block cursor-zoom-in rounded-full"
                        >
                          <Avatar student={selectedStudent} size="h-14 w-14" />
                        </button>
                      ) : (
                        <Avatar student={selectedStudent} size="h-14 w-14" />
                      )}
                      <span className="absolute -bottom-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-panel bg-brass px-1 text-[11px] font-bold text-onbrass">
                        {selectedStudent.rank}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-xl font-semibold text-paper">{selectedStudent.full_name}</h2>
                      <p className="truncate text-sm text-mist">
                        @{selectedStudent.username || 'student'}
                        {isTeacher && selectedStudent.contact_email ? ` · ${selectedStudent.contact_email}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={closeStudentProfile}
                    className="focus-ring flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-mist transition hover:bg-panel-2 hover:text-paper"
                    aria-label="Close student profile"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl bg-panel-2 p-3">
                    <p className="text-xs text-mist">Place</p>
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums text-paper">#{selectedStudent.rank}</p>
                  </div>
                  <div className="rounded-2xl bg-reading-tint p-3">
                    <p className="text-xs text-reading">Completion</p>
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums text-paper">{selectedStudent.percentage}%</p>
                  </div>
                  <div className="rounded-2xl bg-listening-tint p-3">
                    <p className="text-xs text-listening">Handed in</p>
                    <p className="mt-0.5 text-2xl font-semibold tabular-nums text-paper">
                      {selectedStudent.completed}
                      <span className="text-sm font-normal text-mist">/{selectedStudent.total}</span>
                    </p>
                  </div>
                  <div className="rounded-2xl bg-writing-tint p-3">
                    <p className="text-xs text-writing">Streak</p>
                    <p className="mt-0.5 flex items-center gap-1 text-2xl font-semibold tabular-nums text-paper">
                      <Icon name="flame" className="h-5 w-5 text-writing" />
                      {selectedStudent.streak ?? 0}
                    </p>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-reading transition-[width] duration-700" style={{ width: `${pct(selectedStudent.percentage)}%` }} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {isTeacher && selectedStudent.target_band != null && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-speaking-tint px-3 py-1.5 text-sm font-medium text-speaking">
                      <TargetBandIcon value={selectedStudent.target_band} className="h-4 w-4" />
                      Target {formatTargetBand(selectedStudent.target_band)}
                    </span>
                  )}
                  {isTeacher && selectedStudent.status && selectedStudent.status !== 'approved' && (
                    <span className="rounded-full bg-urgent-tint px-3 py-1.5 text-sm font-medium text-urgent">{selectedStudent.status}</span>
                  )}
                  <span className="flex-1" />
                  {typeof onOpenChat === 'function' && (
                    <button
                      type="button"
                      onClick={() => handleChat(selectedStudent)}
                      className="focus-ring rounded-full bg-brass px-4 py-2 text-sm font-semibold text-onbrass transition hover:bg-brass-dim"
                    >
                      Chat with student
                    </button>
                  )}
                  {isTeacher && (
                    <button
                      type="button"
                      onClick={() => openManageGroups(selectedStudent)}
                      className="focus-ring rounded-full border border-line px-4 py-2 text-sm font-medium text-paper transition hover:bg-panel-2"
                    >
                      Manage groups
                    </button>
                  )}
                </div>

                <div className="mt-6 border-t border-line pt-5">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-paper">
                        Homework history
                      </h3>
                      <p className="mt-0.5 text-sm text-mist">
                        Day by day, newest first
                      </p>
                    </div>

                    {loadingDaily && (
                      <span className="text-xs font-mono text-mist">
                        Loading...
                      </span>
                    )}
                  </div>

                  {dailyError && (
                    <div className="mt-4 rounded-xl border border-coral/40 bg-coral/10 p-4">
                      <p className="text-sm text-coral">
                        Couldn't load homework history:{' '}
                        {dailyError}
                      </p>
                    </div>
                  )}

                  {!loadingDaily &&
                    !dailyError &&
                    dailyProgress.length === 0 && (
                      <div className="mt-4 rounded-xl border border-line bg-panel-2 p-5">
                        <p className="text-sm text-mist">
                          No homework history yet.
                        </p>
                      </div>
                    )}

                  {!loadingDaily &&
                    !dailyError &&
                    dailyProgress.length > 0 && (
                      <div className="mt-4 flex flex-col gap-4">
                        {dailyProgress.map((day) => (
                          <div
                            key={day.date}
                            className="rounded-2xl border border-line bg-panel p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-paper">
                                  {formatDate(day.date)}
                                </div>

                                <div className="mt-0.5 text-xs text-mist">
                                  {day.completed}/{day.total}{' '}
                                  completed
                                </div>
                              </div>

                              <div className="text-right">
                                <div className={`text-sm font-semibold tabular-nums ${day.percentage >= 100 ? 'text-reading' : day.percentage > 0 ? 'text-vocab' : 'text-urgent'}`}>
                                  {day.percentage}%
                                </div>
                              </div>
                            </div>

                            <div className="mb-1 mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
                              <div
                                className={`h-full rounded-full ${day.percentage >= 100 ? 'bg-reading' : 'bg-[#E8B64C]'}`}
                                style={{
                                  width: `${day.percentage}%`,
                                }}
                              />
                            </div>

                            <div className="flex flex-col">
                              {day.tasks.map((task) => (
                                <div
                                  key={task.id}
                                  className="flex items-start justify-between gap-4 border-t border-line py-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-paper">
                                      {task.title}
                                    </div>

                                    {task.submittedAt ? (
                                      <div className="mt-1 text-xs text-mist">
                                        {task.historicallyCompleted &&
                                        !task.currentlySubmitted
                                          ? 'Historically completed '
                                          : 'Submitted '}
                                        {new Date(
                                          task.submittedAt
                                        ).toLocaleString([], {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    ) : (
                                      <div className="mt-1 text-xs text-mist">
                                        No submission
                                      </div>
                                    )}

                                    {task.dueDate && (
                                      <div className="mt-0.5 text-xs text-mist">
                                        Deadline:{' '}
                                        {new Date(
                                          task.dueDate
                                        ).toLocaleString([], {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                    )}
                                  </div>

                                  <span
                                    className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                      !task.completed
                                        ? 'bg-urgent-tint text-urgent'
                                        : task.late
                                        ? 'bg-vocab-tint text-vocab'
                                        : 'bg-reading-tint text-reading'
                                    }`}
                                  >
                                    {!task.completed
                                      ? 'Not done'
                                      : task.late
                                      ? 'Late'
                                      : 'Done'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-line bg-panel px-5 py-4 sm:px-7">
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={closeStudentProfile}
                    className="focus-ring rounded-full border border-line px-5 py-2 text-sm font-semibold text-paper transition hover:bg-panel-2"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {isTeacher &&
        manageStudent &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeManageGroups()
              }
            }}
          >
            <div
              className="w-full max-w-lg max-h-[85vh] overflow-hidden rounded-2xl border border-line bg-panel text-paper shadow-2xl"
              onMouseDown={(event) =>
                event.stopPropagation()
              }
            >
              <div className="flex items-start justify-between gap-4 border-b border-line bg-panel px-5 py-4">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-xl font-semibold text-paper">
                    Manage groups
                  </h3>
                  <p className="mt-1 truncate text-sm text-mist">
                    {manageStudent.full_name}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={closeManageGroups}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-mist transition hover:border-brass hover:text-brass"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="max-h-[calc(85vh-80px)] overflow-y-auto p-5">
                {groupError && (
                  <div className="mb-4 rounded-xl border border-coral/40 bg-coral/10 p-3 text-sm text-coral">
                    {groupError}
                  </div>
                )}

                {loadingGroups ? (
                  <div className="py-10 text-center text-sm text-mist">
                    Loading groups...
                  </div>
                ) : groups.length === 0 ? (
                  <div className="rounded-xl border border-line bg-panel-2 p-6 text-center">
                    <p className="text-sm text-mist">
                      No groups exist yet.
                    </p>
                    <p className="mt-1 text-xs text-mist">
                      Create a group first from Groups & homework.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {groups.map((group) => {
                      const isMember =
                        memberGroupIds.includes(group.id)

                      const saving =
                        savingGroup === group.id

                      return (
                        <div
                          key={group.id}
                          className={`flex items-center gap-3 rounded-xl border p-3 transition-colors ${
                            isMember
                              ? 'border-brass/50 bg-brass/10'
                              : 'border-line bg-panel-2'
                          }`}
                        >
                          <div
                            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${
                              isMember
                                ? 'bg-brass text-onbrass'
                                : 'border border-line bg-panel text-mist'
                            }`}
                          >
                            {isMember ? '✓' : '—'}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-paper">
                              {group.name}
                            </div>

                            <div className="mt-0.5 text-xs text-mist">
                              {isMember
                                ? 'Student is a member'
                                : 'Student is not a member'}
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              toggleGroupMembership(
                                group,
                                isMember
                              )
                            }
                            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                              isMember
                                ? 'border border-coral text-coral hover:bg-coral/10'
                                : 'border border-brass text-brass hover:bg-brass hover:text-onbrass'
                            }`}
                          >
                            {saving
                              ? 'Saving...'
                              : isMember
                              ? 'Remove'
                              : 'Add'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className="mt-5 border-t border-line pt-4">
                  <p className="text-xs leading-5 text-mist">
                    Removing a student from a group does{' '}
                    <strong className="text-paper">
                      not
                    </strong>{' '}
                    delete their account. It only removes their
                    membership from that group.
                  </p>
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="button"
                    onClick={closeManageGroups}
                    className="rounded-xl border border-line bg-panel-2 px-4 py-2 text-sm font-medium text-paper transition hover:border-brass hover:text-brass"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
