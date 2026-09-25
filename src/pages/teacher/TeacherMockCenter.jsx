import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatTargetBand } from '../../lib/targetBands'
import { guessMimeType } from '../../lib/mime'

/*
 * ================================================================
 * TEACHER MOCK CENTER
 * ================================================================
 * Shipped 2026-09-24. Jasur's own words: "i want mock dashboard to be
 * separate in teachers account as well, he has to see another layout
 * where everything is about mocks, nothing distracting groups
 * leaderboard ANYTHING." So this is its own full-screen portal — same
 * pattern as the student's MockTestCenter.jsx — launched from a card
 * on the regular Teacher dashboard (see TeacherDashboard.jsx's
 * mockCenterOpen state) rather than living as just another tab mixed
 * in with Groups/Students/Leaderboards in the ordinary sidebar.
 *
 * EXPANDED 2026-09-24 — three sections now, per Jasur's follow-up
 * asks in one sitting:
 *   Student Progress — the original section, untouched in shape (one
 *     flat row per student, no search/grouping) — now with a fourth
 *     Speaking column alongside Reading/Listening/Writing, and an
 *     "essay" toggle on each writing review so a teacher can read the
 *     actual submitted text, not just the band + feedback.
 *   Students — new. A searchable version of the same per-student data,
 *     switchable between "By group" (sectioned under each group's own
 *     heading) and "All students" (one flat, search-filtered list) —
 *     Jasur: "search bar to be added, list has to be of each group and
 *     mixed as well". Student Progress itself was deliberately left
 *     alone rather than having search bolted onto it.
 *   Speaking — new. The full speaking-exam timetable across every
 *     examiner (not just one student's row) — booked/completed/
 *     cancelled slots, with the examiner's band + feedback once a
 *     speaking examiner has marked a completed slot (migration_35).
 *
 * Requires migration_32.sql (teacher-visibility policy on
 * mock_attempts), migration_34.sql (writing_mock_exams/
 * writing_mock_attempts), and migration_35.sql (examiner_band/
 * examiner_feedback/examiner_reviewed_at on mock_speaking_slots).
 * ================================================================
 */

const SECTIONS = [
  { key: 'progress', label: 'Student Progress' },
  { key: 'students', label: 'Students' },
  { key: 'speaking', label: 'Speaking' },
  { key: 'content', label: 'Content' },
]

const SPEAKING_STATUS_META = {
  scheduled: { label: 'Scheduled', className: 'text-brass border-brass-dim/30 bg-brass/10' },
  completed: { label: 'Completed', className: 'text-sage border-sage/30 bg-sage/10' },
  cancelled: { label: 'Cancelled', className: 'text-mist border-line bg-panel-2' },
  no_show: { label: 'No-show', className: 'text-coral border-coral/30 bg-coral/10' },
}

function pct(score, max) {
  if (!max) return 0
  return Math.round((score / max) * 100)
}

function studentLabel(student) {
  return student?.full_name || student?.username || 'Student'
}

function formatSlotTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TeacherMockCenter({ onExit }) {
  const { profile } = useAuth()
  const [section, setSection] = useState('progress')

  const [loading, setLoading] = useState(true)
  const [students, setStudents] = useState([])
  const [attempts, setAttempts] = useState([])
  const [examsById, setExamsById] = useState({})
  const [writingReviews, setWritingReviews] = useState([])
  const [speakingSlots, setSpeakingSlots] = useState([])
  const [examinersById, setExaminersById] = useState({})
  const [groups, setGroups] = useState([])
  const [groupMembers, setGroupMembers] = useState([])

  const [expandedId, setExpandedId] = useState(null)
  const [expandedEssays, setExpandedEssays] = useState({})

  const [search, setSearch] = useState('')
  const [studentsView, setStudentsView] = useState('grouped') // 'grouped' | 'mixed'
  const [selectedGroupId, setSelectedGroupId] = useState(null)

  // Content editor (Writing mocks) — Jasur's "next level" ask
  // 2026-09-25: no more inserting these by hand in the Supabase Table
  // Editor. Reading/Listening (mock_exams/mock_sections/mock_questions)
  // is a bigger editor, coming in a follow-up — this covers Writing
  // first since writing_mock_exams is a single flat row, no nested
  // sections/questions to author.
  const [writingExams, setWritingExams] = useState([])
  const [examFormModal, setExamFormModal] = useState(null) // { mode: 'create' } | { mode: 'edit', exam }
  const [examFormSaving, setExamFormSaving] = useState(false)
  const [examFormError, setExamFormError] = useState('')

  const reloadWritingExams = async () => {
    const { data, error } = await supabase
      .from('writing_mock_exams')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Failed to load writing mock exams:', error)
      return
    }

    setWritingExams(data || [])
  }

  useEffect(() => {
    const load = async () => {
      const [
        { data: studentRows, error: studentsError },
        { data: attemptRows, error: attemptsError },
        { data: writingAttemptRows, error: writingAttemptsError },
        { data: speakingSlotRows, error: speakingSlotsError },
        { data: examinerRows, error: examinersError },
        { data: groupRows, error: groupsError },
        { data: groupMemberRows, error: groupMembersError },
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, username, target_band')
          .eq('role', 'student')
          .order('full_name', { ascending: true }),
        supabase
          .from('mock_attempts')
          .select('*')
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: false }),
        // Writing bands live in the brand new self-service system
        // (migration_34) — NEVER homeworks/submissions, which is a
        // separate, teacher-posted homework flow that doesn't count
        // as "the whole mock" (Jasur, 2026-09-24).
        //
        // Fetches every SUBMITTED attempt, reviewed or not — not just
        // reviewed ones, so "never attempted" and "attempted, awaiting
        // review" don't look identical. select('*') also brings back
        // task1_text/task2_text — the actual essay — which the
        // expanded row below can now show a teacher on request.
        supabase
          .from('writing_mock_attempts')
          .select('*')
          .not('submitted_at', 'is', null)
          .order('submitted_at', { ascending: false }),
        // Every speaking slot, every examiner — not filtered to one
        // examiner_id like SpeakingExaminerDashboard.jsx does, since a
        // teacher needs the whole timetable. RLS (migration_29) already
        // grants a teacher select on every row here.
        supabase
          .from('mock_speaking_slots')
          .select('*')
          .order('scheduled_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name, username')
          .eq('role', 'speaking_examiner'),
        supabase
          .from('groups')
          .select('id, name')
          .order('name', { ascending: true }),
        supabase
          .from('group_members')
          .select('group_id, student_id'),
      ])

      if (studentsError) console.error('Failed to load students:', studentsError)
      if (attemptsError) console.error('Failed to load mock attempts:', attemptsError)
      if (writingAttemptsError) console.error('Failed to load writing mock reviews:', writingAttemptsError)
      if (speakingSlotsError) console.error('Failed to load speaking slots:', speakingSlotsError)
      if (examinersError) console.error('Failed to load speaking examiners:', examinersError)
      if (groupsError) console.error('Failed to load groups:', groupsError)
      if (groupMembersError) console.error('Failed to load group members:', groupMembersError)

      const examIds = [...new Set((attemptRows || []).map((a) => a.exam_id))]
      const writingExamIds = [...new Set((writingAttemptRows || []).map((a) => a.exam_id))]
      let examMap = {}

      if (examIds.length > 0) {
        const { data: examRows, error: examsError } = await supabase
          .from('mock_exams')
          .select('id, title, module')
          .in('id', examIds)

        if (examsError) console.error('Failed to load exam titles:', examsError)
        ;(examRows || []).forEach((e) => { examMap[e.id] = e })
      }

      let writingExamTitleById = {}

      if (writingExamIds.length > 0) {
        const { data: writingExamRows, error: writingExamsError } = await supabase
          .from('writing_mock_exams')
          .select('id, title')
          .in('id', writingExamIds)

        if (writingExamsError) console.error('Failed to load writing exam titles:', writingExamsError)
        ;(writingExamRows || []).forEach((e) => { writingExamTitleById[e.id] = e.title })
      }

      const reviews = (writingAttemptRows || []).map((a) => ({
        ...a,
        examTitle: writingExamTitleById[a.exam_id] || 'Writing mock',
      }))

      const examinerMap = {}
      ;(examinerRows || []).forEach((e) => { examinerMap[e.id] = e })

      setStudents(studentRows || [])
      setAttempts(attemptRows || [])
      setExamsById(examMap)
      setWritingReviews(reviews)
      setSpeakingSlots(speakingSlotRows || [])
      setExaminersById(examinerMap)
      setGroups(groupRows || [])
      setGroupMembers(groupMemberRows || [])
      setLoading(false)
    }

    load()
    reloadWritingExams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    return students.map((student) => {
      const own = attempts.filter((a) => a.user_id === student.id)

      const byModule = { reading: [], listening: [] }
      own.forEach((a) => {
        const exam = examsById[a.exam_id]
        if (exam && byModule[exam.module]) {
          byModule[exam.module].push({ ...a, examTitle: exam.title, module: exam.module })
        }
      })

      const summarize = (arr) => {
        if (arr.length === 0) return null
        const pcts = arr.map((a) => pct(a.score, a.max_score))
        return {
          average: Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length),
          highest: Math.max(...pcts),
          count: arr.length,
        }
      }

      const ownReviews = writingReviews.filter((r) => r.student_id === student.id)
      const bands = ownReviews.filter((r) => r.examiner_band != null).map((r) => r.examiner_band)
      const avgBand = bands.length
        ? Math.round((bands.reduce((s, v) => s + Number(v), 0) / bands.length) * 2) / 2
        : null

      const ownSlots = speakingSlots.filter((s) => s.student_id === student.id)
      const completedSlots = ownSlots.filter((s) => s.status === 'completed')
      const speakingBands = completedSlots
        .filter((s) => s.examiner_band != null)
        .map((s) => Number(s.examiner_band))
      const avgSpeakingBand = speakingBands.length
        ? Math.round((speakingBands.reduce((s, v) => s + v, 0) / speakingBands.length) * 2) / 2
        : null

      return {
        student,
        reading: summarize(byModule.reading),
        listening: summarize(byModule.listening),
        readingAttempts: byModule.reading,
        listeningAttempts: byModule.listening,
        // Every submitted attempt (reviewed or not) — used for the
        // expanded per-attempt list AND to tell "never attempted"
        // apart from "attempted, awaiting review" in the collapsed
        // row below.
        writingReviews: ownReviews,
        reviewedWritingCount: bands.length,
        avgBand,
        speakingSlots: ownSlots,
        reviewedSpeakingCount: speakingBands.length,
        avgSpeakingBand,
        hasCompletedSpeaking: completedSlots.length > 0,
      }
    })
  }, [students, attempts, examsById, writingReviews, speakingSlots])

  const groupIdsByStudent = useMemo(() => {
    const map = {}
    groupMembers.forEach((gm) => {
      if (!map[gm.student_id]) map[gm.student_id] = []
      map[gm.student_id].push(gm.group_id)
    })
    return map
  }, [groupMembers])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const name = studentLabel(r.student).toLowerCase()
      const username = (r.student.username || '').toLowerCase()
      return name.includes(q) || username.includes(q)
    })
  }, [rows, search])

  // A pill picker for "By group" — jumps straight to one group instead
  // of stacking every group's full student list and making Jasur
  // scroll past 40+ names to reach the next one. Built from the raw
  // `groups` list (not the search-filtered rowsByGroup) so the picker
  // itself never disappears mid-search — only the list underneath it
  // reacts to the search box.
  const hasUngroupedStudents = useMemo(
    () => rows.some((row) => (groupIdsByStudent[row.student.id] || []).length === 0),
    [rows, groupIdsByStudent]
  )

  const groupPickerOptions = useMemo(() => {
    const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name))
    const options = sorted.map((g) => ({ groupId: g.id, groupName: g.name }))
    if (hasUngroupedStudents) {
      options.push({ groupId: '__none__', groupName: 'No group' })
    }
    return options
  }, [groups, hasUngroupedStudents])

  useEffect(() => {
    if (selectedGroupId) return
    if (groupPickerOptions.length > 0) {
      setSelectedGroupId(groupPickerOptions[0].groupId)
    }
  }, [groupPickerOptions, selectedGroupId])

  const selectedGroupRows = useMemo(() => {
    if (!selectedGroupId) return []
    if (selectedGroupId === '__none__') {
      return filteredRows.filter((row) => (groupIdsByStudent[row.student.id] || []).length === 0)
    }
    return filteredRows.filter((row) => (groupIdsByStudent[row.student.id] || []).includes(selectedGroupId))
  }, [filteredRows, groupIdsByStudent, selectedGroupId])

  const allSpeakingSlots = useMemo(() => {
    const studentById = {}
    students.forEach((s) => { studentById[s.id] = s })

    return speakingSlots.map((slot) => ({
      ...slot,
      student: studentById[slot.student_id],
      examiner: examinersById[slot.examiner_id],
    }))
  }, [speakingSlots, students, examinersById])

  const upcomingSpeaking = allSpeakingSlots
    .filter((s) => s.status === 'scheduled')
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))

  const pastSpeaking = allSpeakingSlots
    .filter((s) => s.status !== 'scheduled')
    .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))

  // Slots booked per examiner per week — Jasur's "examiner workload
  // view" ask. "This week" = the current Mon–Sun calendar week.
  const examinerWorkload = useMemo(() => {
    const now = new Date()
    const dayIndex = (now.getDay() + 6) % 7 // 0 = Monday
    const weekStart = new Date(now)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(now.getDate() - dayIndex)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)

    const byExaminer = {}

    Object.values(examinersById).forEach((examiner) => {
      byExaminer[examiner.id] = { examinerId: examiner.id, examiner, thisWeek: 0, total: 0, noShows: 0 }
    })

    speakingSlots.forEach((slot) => {
      if (!byExaminer[slot.examiner_id]) {
        byExaminer[slot.examiner_id] = {
          examinerId: slot.examiner_id,
          examiner: examinersById[slot.examiner_id] || null,
          thisWeek: 0,
          total: 0,
          noShows: 0,
        }
      }

      const entry = byExaminer[slot.examiner_id]
      entry.total += 1
      if (slot.status === 'no_show') entry.noShows += 1

      const scheduledAt = new Date(slot.scheduled_at)
      if (scheduledAt >= weekStart && scheduledAt < weekEnd) entry.thisWeek += 1
    })

    return Object.values(byExaminer).sort((a, b) =>
      studentLabel(a.examiner).localeCompare(studentLabel(b.examiner))
    )
  }, [speakingSlots, examinersById])

  const openChat = (studentId) => {
    onExit()
    window.dispatchEvent(
      new CustomEvent('notification-navigate', {
        detail: { link: `private-chat:${studentId}` },
      })
    )
  }

  const toggleEssay = (reviewId) => {
    setExpandedEssays((previous) => ({ ...previous, [reviewId]: !previous[reviewId] }))
  }

  /*
   * ============================================================
   * CONTENT EDITOR — WRITING MOCKS
   * ============================================================
   * writing_mock_exams already has full teacher CRUD RLS from
   * migration_34 (writing_mock_exams_insert_teacher/update_teacher/
   * delete_teacher) — no new migration needed for this piece.
   */
  const openCreateExam = () => {
    setExamFormError('')
    setExamFormModal({ mode: 'create' })
  }

  const openEditExam = (exam) => {
    setExamFormError('')
    setExamFormModal({ mode: 'edit', exam })
  }

  const saveWritingExam = async (values) => {
    setExamFormSaving(true)
    setExamFormError('')

    try {
      let task1ImageUrl = examFormModal.mode === 'edit' ? examFormModal.exam.task1_image_url : null

      if (values.task1ImageFile) {
        const path = `${profile.id}/writing-mock/${Date.now()}-${values.task1ImageFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('homework-files')
          .upload(path, values.task1ImageFile, {
            contentType: guessMimeType(values.task1ImageFile.name, values.task1ImageFile.type),
          })
        if (uploadError) throw uploadError
        task1ImageUrl = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      } else if (values.clearTask1Image) {
        task1ImageUrl = null
      }

      const payload = {
        title: values.title.trim(),
        task1_prompt: values.task1Prompt.trim() || null,
        task1_image_url: task1ImageUrl,
        task2_prompt: values.task2Prompt.trim(),
        time_limit_minutes: Number(values.timeLimitMinutes) || 60,
        is_active: values.isActive,
        sort_order: Number(values.sortOrder) || 0,
      }

      if (examFormModal.mode === 'create') {
        const { error: insertError } = await supabase
          .from('writing_mock_exams')
          .insert({ ...payload, created_by: profile.id })
        if (insertError) throw insertError
      } else {
        const { error: updateError } = await supabase
          .from('writing_mock_exams')
          .update(payload)
          .eq('id', examFormModal.exam.id)
        if (updateError) throw updateError
      }

      setExamFormModal(null)
      await reloadWritingExams()
    } catch (err) {
      console.error('Could not save writing mock exam:', err)
      setExamFormError(err?.message || 'Could not save this exam.')
    } finally {
      setExamFormSaving(false)
    }
  }

  const deleteWritingExam = async (exam) => {
    const ok = window.confirm(
      `Delete "${exam.title}"? This also permanently deletes every student attempt on it. This can't be undone.`
    )
    if (!ok) return

    const { error } = await supabase.from('writing_mock_exams').delete().eq('id', exam.id)

    if (error) {
      console.error('Could not delete writing mock exam:', error)
      window.alert(error.message || 'Could not delete this exam.')
      return
    }

    await reloadWritingExams()
  }

  const toggleExamActive = async (exam) => {
    const { error } = await supabase
      .from('writing_mock_exams')
      .update({ is_active: !exam.is_active })
      .eq('id', exam.id)

    if (error) {
      console.error('Could not update exam status:', error)
      return
    }

    await reloadWritingExams()
  }

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col bg-ink text-paper">

      {/* Own chrome, deliberately not the regular Teaching/Communication/
          Insights sidebar — nothing about groups, leaderboards or
          homework belongs in this window at all. */}
      <header className="shrink-0 border-b border-line bg-panel px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-brass/15 border border-brass-dim/30 flex items-center justify-center text-brass font-display text-sm shrink-0">
            MC
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-brass font-mono">
              Mock Center
            </p>
            <p className="text-sm font-medium text-paper truncate">
              {profile?.full_name || profile?.username}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="focus-ring shrink-0 rounded-full border-2 border-brass bg-brass text-onbrass px-4 py-2 text-sm font-bold shadow-sm hover:bg-brass-dim hover:border-brass-dim transition-colors"
        >
          ← Exit to dashboard
        </button>
      </header>

      <nav className="shrink-0 border-b border-line bg-panel-2 px-4 sm:px-6 flex gap-1 overflow-x-auto">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={`focus-ring shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              section === s.key
                ? 'border-brass text-brass'
                : 'border-transparent text-mist hover:text-paper'
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

          {loading && <p className="text-sm text-mist">Loading mock progress…</p>}

          {/* ======================================================
              STUDENT PROGRESS — unchanged shape, no search/grouping.
              Now with a Speaking column and a per-review essay toggle.
             ====================================================== */}
          {!loading && section === 'progress' && (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-mist max-w-lg">
                Reading/listening scores from Mock Exams, writing mock bands once a writing
                examiner has marked them, and speaking bands once a speaking examiner has
                marked a completed session — one row per student.
              </p>

              <StudentRowList
                rows={rows}
                expandedId={expandedId}
                onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                onMessage={openChat}
                expandedEssays={expandedEssays}
                onToggleEssay={toggleEssay}
                emptyLabel="No students yet."
              />
            </div>
          )}

          {/* ======================================================
              STUDENTS — searchable, grouped-or-mixed view of the same
              per-student data. Student Progress above is left alone.
             ====================================================== */}
          {!loading && section === 'students' && (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search students by name…"
                  className="focus-ring w-full sm:max-w-xs rounded-full border border-line bg-panel px-4 py-2 text-sm text-paper placeholder:text-mist"
                />

                <div className="flex items-center gap-1 rounded-full border border-line bg-panel p-1 self-start">
                  <button
                    type="button"
                    onClick={() => setStudentsView('grouped')}
                    className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      studentsView === 'grouped' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                    }`}
                  >
                    By group
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentsView('mixed')}
                    className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                      studentsView === 'mixed' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                    }`}
                  >
                    All mixed
                  </button>
                </div>
              </div>

              {studentsView === 'mixed' ? (
                <StudentRowList
                  rows={filteredRows}
                  expandedId={expandedId}
                  onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                  onMessage={openChat}
                  expandedEssays={expandedEssays}
                  onToggleEssay={toggleEssay}
                  emptyLabel="No students match that search."
                />
              ) : groupPickerOptions.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                  No groups yet.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {/* A group picker, not a stacked scroll — jump straight to one
                      group instead of scrolling past every other group's full
                      student list to reach it. */}
                  <div className="flex gap-2 flex-wrap">
                    {groupPickerOptions.map((option) => (
                      <button
                        key={option.groupId}
                        type="button"
                        onClick={() => setSelectedGroupId(option.groupId)}
                        className={`focus-ring px-3.5 py-1.5 rounded-full text-sm border transition-colors ${
                          selectedGroupId === option.groupId
                            ? 'bg-brass text-onbrass border-brass-dim font-semibold'
                            : 'border-line text-mist hover:text-paper'
                        }`}
                      >
                        {option.groupName}
                      </button>
                    ))}
                  </div>

                  <StudentRowList
                    rows={selectedGroupRows}
                    expandedId={expandedId}
                    onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                    onMessage={openChat}
                    expandedEssays={expandedEssays}
                    onToggleEssay={toggleEssay}
                    emptyLabel="No students in this group match that search."
                  />
                </div>
              )}
            </div>
          )}

          {/* ======================================================
              SPEAKING — the full timetable across every examiner,
              with band + feedback once a speaking examiner has marked
              a completed slot (migration_35).
             ====================================================== */}
          {!loading && section === 'speaking' && (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-mist max-w-lg">
                Every booked speaking exam, across every speaking examiner — upcoming first,
                with the band and feedback once a session has been marked.
              </p>

              {examinerWorkload.length > 0 && (
                <div>
                  <h3 className="font-display text-lg text-paper mb-2.5">Examiner workload</h3>
                  <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                    <div className="hidden sm:grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-line text-[10px] uppercase tracking-[0.14em] text-mist font-mono">
                      <span>Examiner</span>
                      <span>This week</span>
                      <span>All-time</span>
                      <span>No-shows</span>
                    </div>
                    {examinerWorkload.map((entry) => (
                      <div
                        key={entry.examinerId}
                        className="grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b border-line last:border-b-0 text-sm"
                      >
                        <span className="col-span-2 sm:col-span-1 text-paper font-medium truncate">
                          {studentLabel(entry.examiner)}
                        </span>
                        <span className="text-paper">{entry.thisWeek}</span>
                        <span className="text-paper">{entry.total}</span>
                        <span className={entry.noShows > 0 ? 'text-coral font-semibold' : 'text-mist'}>
                          {entry.noShows}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="font-display text-lg text-paper mb-2.5">Upcoming</h3>
                {upcomingSpeaking.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line bg-panel/80 px-5 py-8 text-center text-sm text-mist">
                    No upcoming speaking exams booked.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {upcomingSpeaking.map((slot) => (
                      <SpeakingSlotRow key={slot.id} slot={slot} onMessage={openChat} />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="font-display text-lg text-paper mb-2.5">Past / other</h3>
                {pastSpeaking.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-line bg-panel/80 px-5 py-8 text-center text-sm text-mist">
                    No past speaking exams yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {pastSpeaking.map((slot) => (
                      <SpeakingSlotRow key={slot.id} slot={slot} onMessage={openChat} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================================================
              CONTENT — Jasur's "next level" ask 2026-09-25: no more
              inserting mock exams by hand in the Supabase Table
              Editor. Writing mocks first (a single flat row, quick to
              build a form for); Reading/Listening (nested sections +
              per-question answer keys) is a bigger editor, coming in a
              follow-up.
             ====================================================== */}
          {!loading && section === 'content' && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-mist max-w-lg">
                  Writing mock exams students can sit from their own Mock Test Center. Reading
                  and Listening exam content is still managed directly in Supabase for now.
                </p>
                <button
                  type="button"
                  onClick={openCreateExam}
                  className="focus-ring shrink-0 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors"
                >
                  + Add writing mock
                </button>
              </div>

              {writingExams.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                  No writing mocks yet — add one to let students sit it from their Mock Test
                  Center.
                </div>
              ) : (
                <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                  {writingExams.map((exam) => (
                    <div
                      key={exam.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-paper truncate">{exam.title}</p>
                        <p className="text-xs text-mist font-mono mt-0.5">
                          {exam.task1_prompt ? 'Task 1 + Task 2' : 'Task 2 only'} ·{' '}
                          {exam.time_limit_minutes} min
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleExamActive(exam)}
                          className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 transition-colors ${
                            exam.is_active
                              ? 'text-sage border-sage/30 bg-sage/10 hover:bg-sage/20'
                              : 'text-mist border-line bg-panel-2 hover:text-paper'
                          }`}
                          title="Click to toggle whether students can see this"
                        >
                          {exam.is_active ? 'Published' : 'Draft'}
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditExam(exam)}
                          className="focus-ring text-xs text-mist hover:text-paper px-2 py-1"
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteWritingExam(exam)}
                          className="focus-ring text-xs text-coral hover:text-coral/80 px-2 py-1"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {examFormModal && (
        <WritingExamFormModal
          modal={examFormModal}
          saving={examFormSaving}
          error={examFormError}
          onCancel={() => setExamFormModal(null)}
          onSave={saveWritingExam}
        />
      )}
    </div>
  )
}

function MetricCell({ stats }) {
  if (!stats) {
    return <span className="text-xs text-mist self-center">—</span>
  }

  return (
    <div className="text-sm self-center">
      <span className="text-paper font-medium">{stats.average}%</span>
      <span className="text-mist text-xs"> avg</span>
      <span className="text-mist text-xs mx-1">·</span>
      <span className="text-brass font-medium">{stats.highest}%</span>
      <span className="text-mist text-xs"> high</span>
    </div>
  )
}

// Shared between "Student Progress" and "Students" — same row shape,
// same expand behavior, just fed a different (filtered/grouped or not)
// slice of `rows`.
function StudentRowList({ rows, expandedId, onToggle, onMessage, expandedEssays, onToggleEssay, emptyLabel }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-line bg-panel overflow-hidden">
      <div className="hidden sm:grid grid-cols-[1.3fr_0.85fr_0.85fr_0.85fr_0.85fr_auto] gap-3 px-5 py-3 border-b border-line text-[10px] uppercase tracking-[0.14em] text-mist font-mono">
        <span>Student</span>
        <span>Reading</span>
        <span>Listening</span>
        <span>Writing</span>
        <span>Speaking</span>
        <span />
      </div>

      {rows.map((row) => {
        const expanded = expandedId === row.student.id

        return (
          <div key={row.student.id} className="border-b border-line last:border-b-0">
            <button
              type="button"
              onClick={() => onToggle(row.student.id)}
              className="w-full text-left grid grid-cols-2 sm:grid-cols-[1.3fr_0.85fr_0.85fr_0.85fr_0.85fr_auto] gap-3 px-5 py-3.5 hover:bg-panel-2 transition-colors"
            >
              <div className="col-span-2 sm:col-span-1 min-w-0">
                <p className="font-medium text-paper truncate">{studentLabel(row.student)}</p>
                {row.student.target_band != null && (
                  <p className="text-xs text-brass mt-0.5">
                    Target {formatTargetBand(row.student.target_band)}
                  </p>
                )}
              </div>

              <MetricCell stats={row.reading} />
              <MetricCell stats={row.listening} />

              <div className="text-sm text-paper">
                {row.avgBand != null ? (
                  <>
                    <span className="font-semibold text-sage">Band {row.avgBand}</span>
                    <span className="text-mist text-xs ml-1">
                      ({row.reviewedWritingCount})
                    </span>
                  </>
                ) : row.writingReviews.length > 0 ? (
                  <span className="text-amber text-xs">Not marked</span>
                ) : (
                  <span className="text-mist text-xs">—</span>
                )}
              </div>

              <div className="text-sm text-paper">
                {row.avgSpeakingBand != null ? (
                  <>
                    <span className="font-semibold text-sage">Band {row.avgSpeakingBand}</span>
                    <span className="text-mist text-xs ml-1">
                      ({row.reviewedSpeakingCount})
                    </span>
                  </>
                ) : row.hasCompletedSpeaking ? (
                  <span className="text-amber text-xs">Not marked</span>
                ) : (
                  <span className="text-mist text-xs">—</span>
                )}
              </div>

              <span className="text-xs text-mist self-center hidden sm:block">
                {expanded ? '▲' : '▼'}
              </span>
            </button>

            {expanded && (
              <div className="px-5 pb-4 pt-1 space-y-3 bg-panel-2/40">
                <button
                  type="button"
                  onClick={() => onMessage(row.student.id)}
                  className="focus-ring text-xs text-brass hover:text-brass-dim"
                >
                  Message {studentLabel(row.student)} →
                </button>

                {[...row.readingAttempts, ...row.listeningAttempts].length === 0 &&
                  row.writingReviews.length === 0 &&
                  row.speakingSlots.length === 0 && (
                    <p className="text-sm text-mist">No mock activity yet.</p>
                  )}

                {[...row.readingAttempts, ...row.listeningAttempts]
                  .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))
                  .map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 text-sm rounded-lg border border-line bg-panel px-3.5 py-2.5"
                    >
                      <span className="text-paper capitalize">
                        {a.module} · {a.examTitle}
                      </span>
                      <span className="text-mist font-mono text-xs">
                        {a.score}/{a.max_score} ({pct(a.score, a.max_score)}%) ·{' '}
                        {new Date(a.submitted_at).toLocaleDateString()}
                      </span>
                    </div>
                  ))}

                {row.writingReviews.map((r) => {
                  const essayOpen = Boolean(expandedEssays[r.id])
                  const hasEssay = Boolean(r.task1_text || r.task2_text)

                  return (
                    <div key={r.id} className="rounded-lg border border-line bg-panel px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-paper">{r.examTitle}</span>
                        {r.examiner_band != null ? (
                          <span className="text-sage font-semibold text-xs">
                            Band {r.examiner_band}
                          </span>
                        ) : (
                          <span className="text-amber text-xs">Awaiting review</span>
                        )}
                      </div>

                      {r.examiner_feedback && (
                        <p className="text-xs text-mist mt-1.5 whitespace-pre-wrap">
                          {r.examiner_feedback}
                        </p>
                      )}

                      {hasEssay && (
                        <>
                          <button
                            type="button"
                            onClick={() => onToggleEssay(r.id)}
                            className="focus-ring text-xs text-brass hover:text-brass-dim mt-2"
                          >
                            {essayOpen ? 'Hide essay ▲' : 'View essay ▼'}
                          </button>

                          {essayOpen && (
                            <div className="mt-2 space-y-2.5">
                              {r.task1_text && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1">
                                    Task 1
                                  </p>
                                  <p className="text-xs text-paper whitespace-pre-wrap rounded-md bg-panel-2 p-2.5 max-h-64 overflow-y-auto">
                                    {r.task1_text}
                                  </p>
                                </div>
                              )}
                              {r.task2_text && (
                                <div>
                                  <p className="text-[10px] uppercase tracking-wide text-mist font-mono mb-1">
                                    Task 2
                                  </p>
                                  <p className="text-xs text-paper whitespace-pre-wrap rounded-md bg-panel-2 p-2.5 max-h-64 overflow-y-auto">
                                    {r.task2_text}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}

                {row.speakingSlots
                  .slice()
                  .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
                  .map((slot) => {
                    const meta = SPEAKING_STATUS_META[slot.status] || SPEAKING_STATUS_META.scheduled
                    return (
                      <div key={slot.id} className="rounded-lg border border-line bg-panel px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-paper">{formatSlotTime(slot.scheduled_at)}</span>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${meta.className}`}>
                              {meta.label}
                            </span>
                            {slot.examiner_band != null && (
                              <span className="text-sage font-semibold text-xs">
                                Band {slot.examiner_band}
                              </span>
                            )}
                          </div>
                        </div>
                        {slot.examiner_feedback && (
                          <p className="text-xs text-mist mt-1.5 whitespace-pre-wrap">
                            {slot.examiner_feedback}
                          </p>
                        )}
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function SpeakingSlotRow({ slot, onMessage }) {
  const meta = SPEAKING_STATUS_META[slot.status] || SPEAKING_STATUS_META.scheduled

  return (
    <div className="rounded-2xl border border-line bg-panel shadow-sm p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-paper truncate">
            {studentLabel(slot.student)}
          </p>
          <p className="text-xs text-mist font-mono mt-0.5">
            {formatSlotTime(slot.scheduled_at)} · {slot.duration_minutes} min ·{' '}
            {slot.examiner ? `with ${studentLabel(slot.examiner)}` : 'examiner unassigned'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 ${meta.className}`}>
            {meta.label}
          </span>
          {slot.examiner_band != null ? (
            <span className="text-sage font-semibold text-xs">Band {slot.examiner_band}</span>
          ) : slot.status === 'completed' ? (
            <span className="text-amber text-xs">Not marked</span>
          ) : null}
          {slot.student?.id && (
            <button
              type="button"
              onClick={() => onMessage(slot.student.id)}
              className="focus-ring text-xs text-brass hover:text-brass-dim"
            >
              Message
            </button>
          )}
        </div>
      </div>

      {slot.examiner_feedback && (
        <p className="text-xs text-mist whitespace-pre-wrap">{slot.examiner_feedback}</p>
      )}
    </div>
  )
}

function WritingExamFormModal({ modal, saving, error, onCancel, onSave }) {
  const exam = modal.mode === 'edit' ? modal.exam : null

  const [title, setTitle] = useState(exam?.title || '')
  const [task1Prompt, setTask1Prompt] = useState(exam?.task1_prompt || '')
  const [task2Prompt, setTask2Prompt] = useState(exam?.task2_prompt || '')
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(exam?.time_limit_minutes || 60)
  const [isActive, setIsActive] = useState(exam ? exam.is_active : true)
  const [sortOrder, setSortOrder] = useState(exam?.sort_order ?? 0)
  const [task1ImageFile, setTask1ImageFile] = useState(null)
  const [clearTask1Image, setClearTask1Image] = useState(false)

  const canSave = title.trim() && task2Prompt.trim() && Number(timeLimitMinutes) > 0

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {modal.mode === 'create' ? 'Add writing mock' : 'Edit writing mock'}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          Task 1 is optional — leave its prompt blank for a Task-2-only mock.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Writing Mock Test 1"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Task 1 prompt (optional)
            <textarea
              value={task1Prompt}
              onChange={(e) => setTask1Prompt(e.target.value)}
              rows={3}
              placeholder="The chart below shows... Summarize the information..."
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Task 1 chart/graph image (optional)
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                setTask1ImageFile(e.target.files?.[0] || null)
                setClearTask1Image(false)
              }}
              className="focus-ring mt-1 w-full text-sm text-paper file:mr-3 file:rounded-full file:border-0 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass"
            />
          </label>

          {exam?.task1_image_url && !task1ImageFile && !clearTask1Image && (
            <div className="flex items-center gap-3">
              <img
                src={exam.task1_image_url}
                alt="Current Task 1 chart"
                className="h-16 rounded-lg border border-line object-contain"
              />
              <button
                type="button"
                onClick={() => setClearTask1Image(true)}
                className="focus-ring text-xs text-coral hover:text-coral/80"
              >
                Remove image
              </button>
            </div>
          )}

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Task 2 prompt
            <textarea
              value={task2Prompt}
              onChange={(e) => setTask2Prompt(e.target.value)}
              rows={3}
              placeholder="Some people believe... Discuss both views and give your opinion."
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Time limit (minutes)
              <input
                type="number"
                min="1"
                value={timeLimitMinutes}
                onChange={(e) => setTimeLimitMinutes(e.target.value)}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
            </label>

            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Sort order
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-paper">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-brass"
            />
            Published (students can see and sit this)
          </label>
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-full px-4 py-2 text-sm text-mist hover:text-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                title,
                task1Prompt,
                task2Prompt,
                timeLimitMinutes,
                isActive,
                sortOrder,
                task1ImageFile,
                clearTask1Image,
              })
            }
            disabled={saving || !canSave}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
