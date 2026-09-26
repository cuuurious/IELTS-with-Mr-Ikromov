import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { formatTargetBand } from '../../lib/targetBands'
import { guessMimeType } from '../../lib/mime'
import ConfirmModal from '../../components/ConfirmModal'

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

const QUESTION_TYPE_LABELS = {
  multiple_choice: 'Multiple choice',
  true_false_ng: 'True/False/Not Given',
  short_answer: 'Short answer',
}

const TRUE_FALSE_NG_CHOICES = ['True', 'False', 'Not Given']

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

  /*
   * ============================================================
   * CONTENT EDITOR — READING/LISTENING MOCKS
   * ============================================================
   * mock_exams/mock_sections/mock_questions predate this project's own
   * migrations (built by the old standalone ielts-mock-tests app) and
   * had NO teacher RLS at all until migration_36 added it. Drill-down
   * UI: exam list -> section list (within one exam) -> question list
   * (within one section). There's no confirmed DB-level cascade on
   * these tables (unlike writing_mock_attempts.exam_id, which is
   * explicitly "on delete cascade"), so deletes here cascade
   * explicitly at the app level instead of assuming the database will
   * do it.
   */
  const [contentTab, setContentTab] = useState('writing') // 'writing' | 'reading' | 'listening' | 'full-mocks'
  const [rlExams, setRlExams] = useState([])
  const [rlSelectedExamId, setRlSelectedExamId] = useState(null)
  const [rlSections, setRlSections] = useState([])
  const [rlSelectedSectionId, setRlSelectedSectionId] = useState(null)
  const [rlQuestions, setRlQuestions] = useState([])
  const [rlLoading, setRlLoading] = useState(false)

  const [examModal, setExamModal] = useState(null) // { mode: 'create' } | { mode: 'edit', exam }
  const [examModalSaving, setExamModalSaving] = useState(false)
  const [examModalError, setExamModalError] = useState('')

  const [sectionModal, setSectionModal] = useState(null) // { mode: 'create' } | { mode: 'edit', section }
  const [sectionModalSaving, setSectionModalSaving] = useState(false)
  const [sectionModalError, setSectionModalError] = useState('')

  const [questionModal, setQuestionModal] = useState(null) // { mode: 'create' } | { mode: 'edit', question }
  const [questionModalSaving, setQuestionModalSaving] = useState(false)
  const [questionModalError, setQuestionModalError] = useState('')

  /*
   * ============================================================
   * CONTENT EDITOR — LISTENING (a guided wizard, not Reading's drill-down)
   * ============================================================
   * Jasur, 2026-09-25, on seeing Listening reuse Reading's generic
   * exam -> section -> question screens: "why adding content for
   * listening is the same as for the reading and i didnt want you to
   * have it like this... i want it to have a space for pasting part 1
   * for example and then part two but they should not be separate...
   * before posting the whole listening posting shouldnt be possible
   * unlike rn we can post even with the title only" — then, on the
   * fragmented create flow itself: "first u post name then add content
   * then other stuff, this is not what i wanted for overall."
   *
   * Real IELTS Listening is always exactly 4 parts (never a variable
   * count like Reading's passages), so this hard-codes that instead of
   * a free-form "+ Add section" list, walks through Part 1 -> 2 -> 3 ->
   * 4 in one continuous screen (each part stays visible once reached,
   * nothing is "separate"), and the exam row itself is never created in
   * the database at all until every part has audio and at least one
   * question — no more saving a bare title and being left to hunt for
   * where the content goes. Reading is untouched; it keeps the
   * general-purpose drill-down above since its passage count varies.
   */
  const [listeningWizard, setListeningWizard] = useState(null) // { mode: 'create' } | { mode: 'edit', exam, loading, sections, questionsBySection }
  const [listeningWizardSaving, setListeningWizardSaving] = useState(false)
  const [listeningWizardError, setListeningWizardError] = useState('')

  /*
   * ============================================================
   * CONTENT EDITOR — FULL MOCK SETS
   * ============================================================
   * Jasur, 2026-09-25: "i dont want them to be able to do watever test
   * they want at anytime, once they start the mock they have to solve
   * listening first, reading and writing next." A Full Mock bundles one
   * already-authored Listening exam + one Reading exam + one Writing
   * exam (migration_37) — the actual forced-order sequencing happens in
   * FullMockRunner.jsx on the student side; this tab is just where a
   * teacher builds the bundle.
   */
  const [fullMockSets, setFullMockSets] = useState([])
  const [fullMockModal, setFullMockModal] = useState(null) // { mode: 'create' } | { mode: 'edit', set }
  const [fullMockModalSaving, setFullMockModalSaving] = useState(false)
  const [fullMockModalError, setFullMockModalError] = useState('')

  // Styled stand-in for window.confirm()/window.alert() on every delete
  // in this Content tab — Jasur, on seeing the browser's own native
  // dialog: "this window has to be in the style of the website." Same
  // component/pattern already used elsewhere in the app (ConfirmModal.jsx).
  // { title, message, confirmLabel?, tone?, hideCancel?, onConfirm } | null
  const [confirmDialog, setConfirmDialog] = useState(null)

  // Postgres foreign-key errors ("update or delete on table ... violates
  // foreign key constraint ...") are correct but unreadable to a teacher —
  // e.g. deleting a question/section/exam that a student has already
  // answered fails because mock_answers still points at it. Translate
  // that into the same "un-publish instead" guidance already given in
  // the confirm prompts below, instead of surfacing raw SQL error text.
  const friendlyDeleteError = (err, fallback) => {
    const msg = err?.message || ''
    if (err?.code === '23503' || /foreign key constraint/i.test(msg)) {
      return (
        "Can't delete this — a student has already answered one of its questions, so the " +
        "database is protecting that result. Un-publish it instead so students stop seeing it, " +
        "without losing what's already been recorded."
      )
    }
    return msg || fallback
  }

  const rlSelectedExam = useMemo(
    () => rlExams.find((e) => e.id === rlSelectedExamId) || null,
    [rlExams, rlSelectedExamId]
  )
  const rlSelectedSection = useMemo(
    () => rlSections.find((s) => s.id === rlSelectedSectionId) || null,
    [rlSections, rlSelectedSectionId]
  )

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

  const reloadRlExams = async () => {
    const { data, error } = await supabase
      .from('mock_exams')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Failed to load reading/listening mock exams:', error)
      return
    }

    setRlExams(data || [])
  }

  const reloadFullMockSets = async () => {
    const { data, error } = await supabase
      .from('full_mock_sets')
      .select('*')
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('Failed to load full mock sets:', error)
      return
    }

    setFullMockSets(data || [])
  }

  const openExamSections = async (exam) => {
    setRlSelectedExamId(exam.id)
    setRlSelectedSectionId(null)
    setRlQuestions([])
    setRlLoading(true)

    const { data, error } = await supabase
      .from('mock_sections')
      .select('*')
      .eq('exam_id', exam.id)
      .order('order_index', { ascending: true })

    if (error) console.error('Failed to load sections:', error)
    setRlSections(data || [])
    setRlLoading(false)
  }

  const reloadRlSections = async (examId) => {
    const { data, error } = await supabase
      .from('mock_sections')
      .select('*')
      .eq('exam_id', examId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error('Failed to reload sections:', error)
      return
    }
    setRlSections(data || [])
  }

  const openSectionQuestions = async (section) => {
    setRlSelectedSectionId(section.id)
    setRlLoading(true)

    // mock_questions, not mock_questions_public — a teacher needs to
    // see (and edit) the answer key, unlike a student sitting the exam.
    const { data, error } = await supabase
      .from('mock_questions')
      .select('*')
      .eq('section_id', section.id)
      .order('order_index', { ascending: true })

    if (error) console.error('Failed to load questions:', error)
    setRlQuestions(data || [])
    setRlLoading(false)
  }

  const reloadRlQuestions = async (sectionId) => {
    const { data, error } = await supabase
      .from('mock_questions')
      .select('*')
      .eq('section_id', sectionId)
      .order('order_index', { ascending: true })

    if (error) {
      console.error('Failed to reload questions:', error)
      return
    }
    setRlQuestions(data || [])
  }

  const backToRlExams = () => {
    setRlSelectedExamId(null)
    setRlSections([])
    setRlSelectedSectionId(null)
    setRlQuestions([])
  }

  const backToRlSections = () => {
    setRlSelectedSectionId(null)
    setRlQuestions([])
  }

  /*
   * ============================================================
   * CONTENT EDITOR — LISTENING WIZARD (handlers)
   * ============================================================
   */
  const openListeningWizard = async (exam) => {
    setListeningWizardError('')
    setListeningWizard({ mode: 'edit', exam, loading: true, sections: [], questionsBySection: {} })

    const { data: sections, error: sectionsError } = await supabase
      .from('mock_sections')
      .select('*')
      .eq('exam_id', exam.id)
      .order('order_index', { ascending: true })

    if (sectionsError) {
      console.error('Failed to load listening sections:', sectionsError)
      setListeningWizard({ mode: 'edit', exam, loading: false, sections: [], questionsBySection: {} })
      return
    }

    const sectionIds = (sections || []).map((s) => s.id)
    const questionsBySection = {}

    if (sectionIds.length > 0) {
      // mock_questions, not mock_questions_public — a teacher edits the
      // real answer key, same as the Reading/Listening drill-down does.
      const { data: questions, error: questionsError } = await supabase
        .from('mock_questions')
        .select('*')
        .in('section_id', sectionIds)
        .order('order_index', { ascending: true })

      if (questionsError) console.error('Failed to load listening questions:', questionsError)
      ;(questions || []).forEach((q) => {
        questionsBySection[q.section_id] = [...(questionsBySection[q.section_id] || []), q]
      })
    }

    setListeningWizard({ mode: 'edit', exam, loading: false, sections: sections || [], questionsBySection })
  }

  const saveListeningWizard = async (values) => {
    setListeningWizardSaving(true)
    setListeningWizardError('')

    // Tracked so a failure partway through a brand-new exam can clean up
    // after itself instead of leaving an orphaned, content-less exam
    // row behind — exactly the "posting with just a title" problem this
    // wizard exists to prevent in the first place.
    let createdExamId = null

    try {
      let examId

      // Randomize-from-bank is Reading-only (see buildAttemptQuestions in
      // MockExams.jsx) — a Listening section has exactly one fixed audio
      // track that narrates in a set order, so shuffling or drawing a
      // random subset of questions breaks the correspondence between
      // what's on screen and what the student hears. Hard-coded off here
      // regardless of any stale wizard state, rather than trusting the
      // checkbox to always be absent.
      const randomizePayload = {
        randomize_questions: false,
        questions_per_section: null,
      }

      if (listeningWizard.mode === 'create') {
        const { data, error: insertError } = await supabase
          .from('mock_exams')
          .insert({
            title: values.title.trim(),
            module: 'listening',
            is_active: false,
            sort_order: Number(values.sortOrder) || 0,
            ...randomizePayload,
          })
          .select('*')
          .single()
        if (insertError) throw insertError
        examId = data.id
        createdExamId = data.id
      } else {
        examId = listeningWizard.exam.id
        const { error: updateError } = await supabase
          .from('mock_exams')
          .update({
            title: values.title.trim(),
            sort_order: Number(values.sortOrder) || 0,
            ...randomizePayload,
          })
          .eq('id', examId)
        if (updateError) throw updateError
      }

      for (let i = 0; i < values.parts.length; i++) {
        const part = values.parts[i]

        let audioUrl = part.audioUrl || null
        if (part.audioFile) {
          const path = `${profile.id}/mock-audio/${Date.now()}-part${i + 1}-${part.audioFile.name}`
          const { error: uploadError } = await supabase.storage
            .from('homework-files')
            .upload(path, part.audioFile, {
              contentType: guessMimeType(part.audioFile.name, part.audioFile.type),
            })
          if (uploadError) throw uploadError
          audioUrl = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
        } else if (part.clearAudio) {
          audioUrl = null
        }

        let sectionId = part.sectionId

        if (sectionId) {
          const { error: sectionUpdateError } = await supabase
            .from('mock_sections')
            .update({ title: part.title, order_index: i, audio_url: audioUrl })
            .eq('id', sectionId)
          if (sectionUpdateError) throw sectionUpdateError

          // Editing an existing part replaces its whole question set
          // rather than diffing question-by-question — simplest correct
          // approach given questions have no stable client-side key of
          // their own here. Same mock_answers FK this file already
          // works around on delete (migration_38) has to be cleared
          // first, before the old questions, before the new ones go in.
          const { data: oldQuestionRows, error: oldQuestionsError } = await supabase
            .from('mock_questions')
            .select('id')
            .eq('section_id', sectionId)
          if (oldQuestionsError) throw oldQuestionsError

          const oldQuestionIds = (oldQuestionRows || []).map((q) => q.id)
          if (oldQuestionIds.length > 0) {
            const { error: answersDeleteError } = await supabase
              .from('mock_answers')
              .delete()
              .in('question_id', oldQuestionIds)
            if (answersDeleteError) throw answersDeleteError

            const { error: oldQuestionsDeleteError } = await supabase
              .from('mock_questions')
              .delete()
              .eq('section_id', sectionId)
            if (oldQuestionsDeleteError) throw oldQuestionsDeleteError
          }
        } else {
          const { data: newSection, error: sectionInsertError } = await supabase
            .from('mock_sections')
            .insert({ exam_id: examId, order_index: i, title: part.title, audio_url: audioUrl })
            .select('*')
            .single()
          if (sectionInsertError) throw sectionInsertError
          sectionId = newSection.id
        }

        const questionRows = part.questions.map((q, qIndex) => ({
          section_id: sectionId,
          order_index: qIndex,
          prompt: q.prompt.trim(),
          type: q.type,
          options: q.type === 'multiple_choice' ? { choices: q.choices } : null,
          correct_answer: q.correctAnswer.trim(),
        }))

        if (questionRows.length > 0) {
          const { error: questionsInsertError } = await supabase.from('mock_questions').insert(questionRows)
          if (questionsInsertError) throw questionsInsertError
        }
      }

      setListeningWizard(null)
      await reloadRlExams()
    } catch (err) {
      console.error('Could not save listening exam:', err)

      if (createdExamId) {
        // Best-effort cleanup — a half-built exam row with no complete
        // content is exactly what this wizard is meant to prevent, so
        // don't leave one behind just because a later part failed.
        await supabase.from('mock_exams').delete().eq('id', createdExamId)
      }

      setListeningWizardError(err?.message || 'Could not save this listening exam. Nothing was published — please try again.')
    } finally {
      setListeningWizardSaving(false)
    }
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
    reloadRlExams()
    reloadFullMockSets()
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

  const deleteWritingExam = (exam) => {
    setConfirmDialog({
      title: 'Delete this writing mock?',
      message: `Delete "${exam.title}"? This also permanently deletes every student attempt on it. This can't be undone.`,
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        const { error } = await supabase.from('writing_mock_exams').delete().eq('id', exam.id)

        if (error) {
          console.error('Could not delete writing mock exam:', error)
          setConfirmDialog({
            title: "Couldn't delete this exam",
            message: friendlyDeleteError(error, 'Could not delete this exam.'),
            hideCancel: true,
            tone: 'coral',
          })
          return
        }

        await reloadWritingExams()
      },
    })
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

  /*
   * ============================================================
   * CONTENT EDITOR — READING/LISTENING MOCKS (exams)
   * ============================================================
   */
  // Jasur, on first use of this editor: "there is no place to insert the
  // content" — right, on purpose. An exam here is just a title/module
  // shell; the actual passage/audio text and the questions+answers live
  // one and two levels down (sections, then questions). Two fixes for
  // that confusion: (1) the module is now picked by which tab you're on
  // (Reading vs Listening — see his separate "why aren't they separate"
  // question) instead of a dropdown, and (2) saving a new exam or a new
  // section below auto-opens the next level down instead of dropping
  // back to a list, so the flow itself points at where content goes.
  const openCreateRlExam = (module) => {
    setExamModalError('')
    setExamModal({ mode: 'create', module })
  }

  const openEditRlExam = (exam) => {
    setExamModalError('')
    setExamModal({ mode: 'edit', exam })
  }

  const saveRlExam = async (values) => {
    setExamModalSaving(true)
    setExamModalError('')

    try {
      const payload = {
        title: values.title.trim(),
        module: values.module,
        is_active: values.isActive,
        sort_order: Number(values.sortOrder) || 0,
        randomize_questions: values.randomizeQuestions,
        questions_per_section: values.randomizeQuestions && values.questionsPerSection
          ? Number(values.questionsPerSection)
          : null,
      }

      let createdExam = null

      if (examModal.mode === 'create') {
        const { data, error: insertError } = await supabase
          .from('mock_exams')
          .insert(payload)
          .select('*')
          .single()
        if (insertError) throw insertError
        createdExam = data
      } else {
        const { error: updateError } = await supabase
          .from('mock_exams')
          .update(payload)
          .eq('id', examModal.exam.id)
        if (updateError) throw updateError
      }

      setExamModal(null)
      await reloadRlExams()

      // Auto-drill into "Manage sections" for a brand new exam — that's
      // where the passage/audio content actually gets pasted in.
      if (createdExam) openExamSections(createdExam)
    } catch (err) {
      console.error('Could not save mock exam:', err)
      setExamModalError(err?.message || 'Could not save this exam.')
    } finally {
      setExamModalSaving(false)
    }
  }

  const deleteRlExam = (exam) => {
    setConfirmDialog({
      title: `Delete "${exam.title}"?`,
      message:
        'This deletes every section and question in it, plus every student attempt already recorded on ' +
        "this exam — that attempt history is gone for good once this exam is deleted. This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        try {
          const { data: sectionRows, error: sectionsError } = await supabase
            .from('mock_sections')
            .select('id')
            .eq('exam_id', exam.id)
          if (sectionsError) throw sectionsError

          const sectionIds = (sectionRows || []).map((s) => s.id)

          if (sectionIds.length > 0) {
            const { data: questionRows, error: questionsError } = await supabase
              .from('mock_questions')
              .select('id')
              .in('section_id', sectionIds)
            if (questionsError) throw questionsError

            // mock_answers (student-submitted answers, from the original
            // standalone ielts-mock-tests schema) has a FK straight at
            // mock_questions.id — has to go before the questions
            // themselves, or the delete below fails with a foreign key
            // constraint error (exactly what Jasur ran into).
            const questionIds = (questionRows || []).map((q) => q.id)
            if (questionIds.length > 0) {
              const { error: answersDeleteError } = await supabase
                .from('mock_answers')
                .delete()
                .in('question_id', questionIds)
              if (answersDeleteError) throw answersDeleteError
            }

            const { error: questionsDeleteError } = await supabase
              .from('mock_questions')
              .delete()
              .in('section_id', sectionIds)
            if (questionsDeleteError) throw questionsDeleteError
          }

          const { error: sectionsDeleteError } = await supabase
            .from('mock_sections')
            .delete()
            .eq('exam_id', exam.id)
          if (sectionsDeleteError) throw sectionsDeleteError

          // mock_attempts.exam_id also points straight at mock_exams.id —
          // this is what was STILL blocking the delete even after
          // migration_38 cleared mock_answers: every student attempt on
          // this exam has to go before the exam row itself can. By this
          // point every mock_answers row tied to those attempts is
          // already gone (deleted above, by question_id), so this can't
          // hit the same foreign-key wall in the other direction.
          const { error: attemptsDeleteError } = await supabase
            .from('mock_attempts')
            .delete()
            .eq('exam_id', exam.id)
          if (attemptsDeleteError) throw attemptsDeleteError

          const { error: examDeleteError } = await supabase.from('mock_exams').delete().eq('id', exam.id)
          if (examDeleteError) throw examDeleteError

          if (rlSelectedExamId === exam.id) backToRlExams()
          await reloadRlExams()
        } catch (err) {
          console.error('Could not delete mock exam:', err)
          setConfirmDialog({
            title: "Couldn't delete this exam",
            message: friendlyDeleteError(
              err,
              'Could not delete this exam — it may already have student attempts. Try un-publishing it instead.'
            ),
            hideCancel: true,
            tone: 'coral',
          })
        }
      },
    })
  }

  const toggleRlExamActive = async (exam) => {
    const { error } = await supabase
      .from('mock_exams')
      .update({ is_active: !exam.is_active })
      .eq('id', exam.id)

    if (error) {
      console.error('Could not update exam status:', error)
      return
    }

    await reloadRlExams()
  }

  /*
   * ============================================================
   * CONTENT EDITOR — READING/LISTENING MOCKS (sections)
   * ============================================================
   */
  const openCreateSection = () => {
    setSectionModalError('')
    setSectionModal({ mode: 'create' })
  }

  const openEditSection = (section) => {
    setSectionModalError('')
    setSectionModal({ mode: 'edit', section })
  }

  const saveSection = async (values) => {
    setSectionModalSaving(true)
    setSectionModalError('')

    try {
      let audioUrl =
        sectionModal.mode === 'edit' ? sectionModal.section.audio_url : null

      if (values.audioFile) {
        const path = `${profile.id}/mock-audio/${Date.now()}-${values.audioFile.name}`
        const { error: uploadError } = await supabase.storage
          .from('homework-files')
          .upload(path, values.audioFile, {
            contentType: guessMimeType(values.audioFile.name, values.audioFile.type),
          })
        if (uploadError) throw uploadError
        audioUrl = supabase.storage.from('homework-files').getPublicUrl(path).data.publicUrl
      } else if (values.clearAudio) {
        audioUrl = null
      }

      const payload = {
        exam_id: rlSelectedExamId,
        order_index: Number(values.orderIndex) || 0,
        title: values.title.trim(),
        passage_text: rlSelectedExam?.module === 'reading' ? values.passageText.trim() || null : null,
        audio_url: rlSelectedExam?.module === 'listening' ? audioUrl : null,
      }

      let createdSection = null

      if (sectionModal.mode === 'create') {
        const { data, error: insertError } = await supabase
          .from('mock_sections')
          .insert(payload)
          .select('*')
          .single()
        if (insertError) throw insertError
        createdSection = data
      } else {
        const { error: updateError } = await supabase
          .from('mock_sections')
          .update(payload)
          .eq('id', sectionModal.section.id)
        if (updateError) throw updateError
      }

      // Questions pulled in via "Import from a file" above — inserted
      // right alongside the section itself so "Manage questions" opens
      // already populated instead of empty. Numbered to start after
      // whatever's already there, in case this is a re-import into an
      // existing section rather than a brand new one.
      const importedQuestions = values.importedQuestions || []
      if (importedQuestions.length > 0) {
        const sectionId = createdSection ? createdSection.id : sectionModal.section.id

        const { data: existingQuestions, error: existingQuestionsError } = await supabase
          .from('mock_questions')
          .select('order_index')
          .eq('section_id', sectionId)
          .order('order_index', { ascending: false })
          .limit(1)
        if (existingQuestionsError) throw existingQuestionsError

        const startIndex =
          existingQuestions && existingQuestions.length > 0
            ? existingQuestions[0].order_index + 1
            : 0

        const questionRows = importedQuestions.map((q, i) => ({
          section_id: sectionId,
          order_index: startIndex + i,
          prompt: q.prompt || '',
          type: ['multiple_choice', 'true_false_ng', 'short_answer'].includes(q.type)
            ? q.type
            : 'short_answer',
          options: q.type === 'multiple_choice' ? { choices: q.choices || [] } : null,
          correct_answer: q.correct_answer || '',
        }))

        const { error: questionsInsertError } = await supabase
          .from('mock_questions')
          .insert(questionRows)
        if (questionsInsertError) throw questionsInsertError
      }

      setSectionModal(null)
      await reloadRlSections(rlSelectedExamId)

      // Auto-drill into "Manage questions" for a brand new section —
      // that's where the correct-answer field lives, per question.
      if (createdSection) openSectionQuestions(createdSection)
    } catch (err) {
      console.error('Could not save section:', err)
      setSectionModalError(err?.message || 'Could not save this section.')
    } finally {
      setSectionModalSaving(false)
    }
  }

  const deleteSection = (section) => {
    setConfirmDialog({
      title: `Delete "${section.title}"?`,
      message: "This also deletes every question in it. This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        try {
          const { data: questionRows, error: questionsError } = await supabase
            .from('mock_questions')
            .select('id')
            .eq('section_id', section.id)
          if (questionsError) throw questionsError

          // Same mock_answers FK as deleteRlExam above — clear a
          // question's answers before the question itself.
          const questionIds = (questionRows || []).map((q) => q.id)
          if (questionIds.length > 0) {
            const { error: answersDeleteError } = await supabase
              .from('mock_answers')
              .delete()
              .in('question_id', questionIds)
            if (answersDeleteError) throw answersDeleteError
          }

          const { error: questionsDeleteError } = await supabase
            .from('mock_questions')
            .delete()
            .eq('section_id', section.id)
          if (questionsDeleteError) throw questionsDeleteError

          const { error: sectionDeleteError } = await supabase
            .from('mock_sections')
            .delete()
            .eq('id', section.id)
          if (sectionDeleteError) throw sectionDeleteError

          if (rlSelectedSectionId === section.id) backToRlSections()
          await reloadRlSections(rlSelectedExamId)
        } catch (err) {
          console.error('Could not delete section:', err)
          setConfirmDialog({
            title: "Couldn't delete this section",
            message: friendlyDeleteError(err, 'Could not delete this section.'),
            hideCancel: true,
            tone: 'coral',
          })
        }
      },
    })
  }

  /*
   * ============================================================
   * CONTENT EDITOR — READING/LISTENING MOCKS (questions)
   * ============================================================
   */
  const openCreateQuestion = () => {
    setQuestionModalError('')
    setQuestionModal({ mode: 'create' })
  }

  const openEditQuestion = (question) => {
    setQuestionModalError('')
    setQuestionModal({ mode: 'edit', question })
  }

  const saveQuestion = async (values) => {
    setQuestionModalSaving(true)
    setQuestionModalError('')

    try {
      const payload = {
        section_id: rlSelectedSectionId,
        order_index: Number(values.orderIndex) || 0,
        prompt: values.prompt.trim(),
        type: values.type,
        options: values.type === 'multiple_choice' ? { choices: values.choices } : null,
        correct_answer: values.correctAnswer.trim(),
      }

      if (questionModal.mode === 'create') {
        const { error: insertError } = await supabase.from('mock_questions').insert(payload)
        if (insertError) throw insertError
      } else {
        const { error: updateError } = await supabase
          .from('mock_questions')
          .update(payload)
          .eq('id', questionModal.question.id)
        if (updateError) throw updateError
      }

      setQuestionModal(null)
      await reloadRlQuestions(rlSelectedSectionId)
    } catch (err) {
      console.error('Could not save question:', err)
      setQuestionModalError(err?.message || 'Could not save this question.')
    } finally {
      setQuestionModalSaving(false)
    }
  }

  const deleteQuestion = (question) => {
    setConfirmDialog({
      title: 'Delete this question?',
      message: "This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        // Same mock_answers FK as the exam/section deletes above.
        const { error: answersDeleteError } = await supabase
          .from('mock_answers')
          .delete()
          .eq('question_id', question.id)

        if (answersDeleteError) {
          console.error('Could not delete question:', answersDeleteError)
          setConfirmDialog({
            title: "Couldn't delete this question",
            message: friendlyDeleteError(answersDeleteError, 'Could not delete this question.'),
            hideCancel: true,
            tone: 'coral',
          })
          return
        }

        const { error } = await supabase.from('mock_questions').delete().eq('id', question.id)

        if (error) {
          console.error('Could not delete question:', error)
          setConfirmDialog({
            title: "Couldn't delete this question",
            message: friendlyDeleteError(error, 'Could not delete this question.'),
            hideCancel: true,
            tone: 'coral',
          })
          return
        }

        await reloadRlQuestions(rlSelectedSectionId)
      },
    })
  }

  /*
   * ============================================================
   * CONTENT EDITOR — FULL MOCK SETS
   * ============================================================
   */
  const openCreateFullMock = () => {
    setFullMockModalError('')
    setFullMockModal({ mode: 'create' })
  }

  const openEditFullMock = (set) => {
    setFullMockModalError('')
    setFullMockModal({ mode: 'edit', set })
  }

  const saveFullMockSet = async (values) => {
    setFullMockModalSaving(true)
    setFullMockModalError('')

    try {
      const payload = {
        title: values.title.trim(),
        listening_exam_id: values.listeningExamId,
        reading_exam_id: values.readingExamId,
        writing_exam_id: values.writingExamId,
        is_active: values.isActive,
        sort_order: Number(values.sortOrder) || 0,
      }

      if (fullMockModal.mode === 'create') {
        const { error: insertError } = await supabase
          .from('full_mock_sets')
          .insert({ ...payload, created_by: profile.id })
        if (insertError) throw insertError
      } else {
        const { error: updateError } = await supabase
          .from('full_mock_sets')
          .update(payload)
          .eq('id', fullMockModal.set.id)
        if (updateError) throw updateError
      }

      setFullMockModal(null)
      await reloadFullMockSets()
    } catch (err) {
      console.error('Could not save full mock set:', err)
      setFullMockModalError(err?.message || 'Could not save this full mock.')
    } finally {
      setFullMockModalSaving(false)
    }
  }

  const deleteFullMockSet = (set) => {
    setConfirmDialog({
      title: `Delete "${set.title}"?`,
      message:
        "Students partway through it will be stuck mid-sequence. This doesn't delete the underlying " +
        "Listening/Reading/Writing exams, just this bundle. This can't be undone.",
      confirmLabel: 'Delete',
      tone: 'coral',
      onConfirm: async () => {
        const { error } = await supabase.from('full_mock_sets').delete().eq('id', set.id)

        if (error) {
          console.error('Could not delete full mock set:', error)
          setConfirmDialog({
            title: "Couldn't delete this full mock",
            message: friendlyDeleteError(error, 'Could not delete this full mock.'),
            hideCancel: true,
            tone: 'coral',
          })
          return
        }

        await reloadFullMockSets()
      },
    })
  }

  const toggleFullMockActive = async (set) => {
    const { error } = await supabase
      .from('full_mock_sets')
      .update({ is_active: !set.is_active })
      .eq('id', set.id)

    if (error) {
      console.error('Could not update full mock status:', error)
      return
    }

    await reloadFullMockSets()
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
            <p className="font-display text-base text-paper truncate">
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
              Editor. Writing mocks first (a single flat row); Reading/
              Listening (nested sections + per-question answer keys),
              shipped as a drill-down editor, 2026-09-25.
             ====================================================== */}
          {!loading && section === 'content' && (
            <div className="flex flex-col gap-5">
              {/* Three separate tabs, not one combined "Reading & Listening"
                  tab with a module dropdown inside it (Jasur: "why
                  readin/listening are not separate?") — each is its own
                  exam list now, and "+ Add exam" from inside one already
                  knows its module, no picker needed. */}
              <div className="flex gap-2 rounded-full border border-line bg-panel-2 p-1 w-fit">
                <button
                  type="button"
                  onClick={() => setContentTab('writing')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    contentTab === 'writing' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                  }`}
                >
                  Writing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentTab('reading')
                    backToRlExams()
                  }}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    contentTab === 'reading' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                  }`}
                >
                  Reading
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setContentTab('listening')
                    backToRlExams()
                  }}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    contentTab === 'listening' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                  }`}
                >
                  Listening
                </button>
                <button
                  type="button"
                  onClick={() => setContentTab('full-mocks')}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    contentTab === 'full-mocks' ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
                  }`}
                >
                  Full Mocks
                </button>
              </div>

              {contentTab === 'writing' && (
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-mist max-w-lg">
                      Writing mock exams students can sit from their own Mock Test Center — full
                      timed test, task switching, word count, the works.
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
                              className="focus-ring text-xs font-semibold rounded-full border border-line text-mist px-2.5 py-1 hover:border-brass/50 hover:text-brass transition-colors"
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteWritingExam(exam)}
                              className="focus-ring text-xs font-semibold rounded-full border border-coral/30 text-coral px-2.5 py-1 hover:bg-coral/10 transition-colors"
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

              {(contentTab === 'reading' || contentTab === 'listening') && (
                <div className="flex flex-col gap-5">
                  {/* ---- Level 1: exam list (this tab's module only) ---- */}
                  {!rlSelectedExamId && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-mist max-w-lg">
                          {contentTab === 'reading'
                            ? 'Reading mock exams — each has one or more passages (sections), each passage has its own questions and correct answers.'
                            : "Listening mock exams — always 4 parts, built in one guided flow. Can't be created until every part has audio and questions."}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            contentTab === 'listening'
                              ? setListeningWizard({ mode: 'create' })
                              : openCreateRlExam(contentTab)
                          }
                          className="focus-ring shrink-0 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors"
                        >
                          + Add {contentTab} exam
                        </button>
                      </div>

                      {rlExams.filter((e) => e.module === contentTab).length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                          {contentTab === 'reading'
                            ? "No reading mocks yet — add one, then you'll go straight into adding its passages and questions."
                            : "No listening mocks yet — \"+ Add listening exam\" walks you through all 4 parts before it can be created."}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                          {rlExams
                            .filter((e) => e.module === contentTab)
                            .map((exam) => (
                            <div
                              key={exam.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-paper truncate">{exam.title}</p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => toggleRlExamActive(exam)}
                                  className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 transition-colors ${
                                    exam.is_active
                                      ? 'text-sage border-sage/30 bg-sage/10 hover:bg-sage/20'
                                      : 'text-mist border-line bg-panel-2 hover:text-paper'
                                  }`}
                                  title="Click to toggle whether students can see this"
                                >
                                  {exam.is_active ? 'Published' : 'Draft'}
                                </button>

                                {contentTab === 'listening' ? (
                                  <button
                                    type="button"
                                    onClick={() => openListeningWizard(exam)}
                                    className="focus-ring text-xs text-brass hover:text-brass-dim px-2 py-1 font-medium"
                                  >
                                    Edit content →
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openExamSections(exam)}
                                      className="focus-ring text-xs text-brass hover:text-brass-dim px-2 py-1 font-medium"
                                    >
                                      Manage sections →
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openEditRlExam(exam)}
                                      className="focus-ring text-xs font-semibold rounded-full border border-line text-mist px-2.5 py-1 hover:border-brass/50 hover:text-brass transition-colors"
                                    >
                                      Edit
                                    </button>
                                  </>
                                )}

                                <button
                                  type="button"
                                  onClick={() => deleteRlExam(exam)}
                                  className="focus-ring text-xs font-semibold rounded-full border border-coral/30 text-coral px-2.5 py-1 hover:bg-coral/10 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* ---- Level 2: section list within one exam ---- */}
                  {rlSelectedExamId && !rlSelectedSectionId && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={backToRlExams}
                            className="focus-ring text-xs text-mist hover:text-paper"
                          >
                            ← All exams
                          </button>
                          <p className="mt-1 font-display text-lg text-paper truncate">
                            {rlSelectedExam?.title}{' '}
                            <span className="text-xs font-mono text-mist capitalize">
                              ({rlSelectedExam?.module})
                            </span>
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openCreateSection}
                          className="focus-ring shrink-0 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors"
                        >
                          + Add section
                        </button>
                      </div>

                      {rlLoading ? (
                        <p className="text-sm text-mist">Loading sections…</p>
                      ) : rlSections.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                          No sections yet — add one (a passage for reading, an audio track for
                          listening), then add its questions.
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                          {rlSections.map((sec) => (
                            <div
                              key={sec.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-paper truncate">
                                  {sec.order_index + 1}. {sec.title}
                                </p>
                                <p className="text-xs text-mist font-mono mt-0.5">
                                  {rlSelectedExam?.module === 'listening'
                                    ? sec.audio_url
                                      ? 'Audio uploaded'
                                      : 'No audio yet'
                                    : sec.passage_text
                                    ? `${sec.passage_text.length} characters of passage text`
                                    : 'No passage text yet'}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openSectionQuestions(sec)}
                                  className="focus-ring text-xs text-brass hover:text-brass-dim px-2 py-1 font-medium"
                                >
                                  Manage questions →
                                </button>

                                <button
                                  type="button"
                                  onClick={() => openEditSection(sec)}
                                  className="focus-ring text-xs font-semibold rounded-full border border-line text-mist px-2.5 py-1 hover:border-brass/50 hover:text-brass transition-colors"
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => deleteSection(sec)}
                                  className="focus-ring text-xs font-semibold rounded-full border border-coral/30 text-coral px-2.5 py-1 hover:bg-coral/10 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* ---- Level 3: question list within one section ---- */}
                  {rlSelectedExamId && rlSelectedSectionId && (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={backToRlSections}
                            className="focus-ring text-xs text-mist hover:text-paper"
                          >
                            ← {rlSelectedExam?.title}
                          </button>
                          <p className="mt-1 font-display text-lg text-paper truncate">
                            {rlSelectedSection?.title}
                          </p>
                          <p className="text-xs text-mist mt-0.5">
                            Each question's correct answer is set right here, in its own form.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={openCreateQuestion}
                          className="focus-ring shrink-0 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors"
                        >
                          + Add question
                        </button>
                      </div>

                      {rlLoading ? (
                        <p className="text-sm text-mist">Loading questions…</p>
                      ) : rlQuestions.length === 0 ? (
                        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                          No questions yet — click "+ Add question" and you'll set its correct
                          answer as part of that form.
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                          {rlQuestions.map((q) => (
                            <div
                              key={q.id}
                              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="font-medium text-paper truncate">
                                  {q.order_index + 1}. {q.prompt}
                                </p>
                                <p className="text-xs text-mist font-mono mt-0.5">
                                  {QUESTION_TYPE_LABELS[q.type] || q.type} · Answer: {q.correct_answer}
                                </p>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openEditQuestion(q)}
                                  className="focus-ring text-xs font-semibold rounded-full border border-line text-mist px-2.5 py-1 hover:border-brass/50 hover:text-brass transition-colors"
                                >
                                  Edit
                                </button>

                                <button
                                  type="button"
                                  onClick={() => deleteQuestion(q)}
                                  className="focus-ring text-xs font-semibold rounded-full border border-coral/30 text-coral px-2.5 py-1 hover:bg-coral/10 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ======================================================
                  FULL MOCKS — bundles one Listening + one Reading + one
                  Writing exam into a single ordered sitting. Migration_37.
                  This REPLACES free single-module practice on the student
                  side per Jasur's "full sequence only" call — students no
                  longer pick individual Reading/Listening/Writing exams,
                  only a Full Mock set from here.
                 ====================================================== */}
              {contentTab === 'full-mocks' && (
                <div className="flex flex-col gap-5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-mist max-w-lg">
                      What students actually sit: one Listening exam, one Reading exam and one
                      Writing exam bundled together, taken in that order with an instructions +
                      confirm screen between each — same shape as the real test. Build the
                      individual Listening/Reading/Writing exams first (the tabs to the left),
                      then bundle them here.
                    </p>
                    <button
                      type="button"
                      onClick={openCreateFullMock}
                      className="focus-ring shrink-0 rounded-full bg-brass text-onbrass text-sm font-semibold px-4 py-2 shadow-sm hover:bg-brass-dim transition-colors"
                    >
                      + Add full mock
                    </button>
                  </div>

                  {fullMockSets.length === 0 ? (
                    <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
                      No full mocks yet — once you have at least one published Listening, Reading
                      and Writing exam, bundle them into a set here.
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-line bg-panel overflow-hidden">
                      {fullMockSets.map((set) => {
                        const listeningExam = rlExams.find((e) => e.id === set.listening_exam_id)
                        const readingExam = rlExams.find((e) => e.id === set.reading_exam_id)
                        const writingExam = writingExams.find((e) => e.id === set.writing_exam_id)

                        return (
                          <div
                            key={set.id}
                            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-line last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-paper truncate">{set.title}</p>
                              <p className="text-xs text-mist font-mono mt-0.5 truncate">
                                Listening: {listeningExam?.title || '—'} · Reading:{' '}
                                {readingExam?.title || '—'} · Writing: {writingExam?.title || '—'}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => toggleFullMockActive(set)}
                                className={`text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 transition-colors ${
                                  set.is_active
                                    ? 'text-sage border-sage/30 bg-sage/10 hover:bg-sage/20'
                                    : 'text-mist border-line bg-panel-2 hover:text-paper'
                                }`}
                                title="Click to toggle whether students can see this"
                              >
                                {set.is_active ? 'Published' : 'Draft'}
                              </button>

                              <button
                                type="button"
                                onClick={() => openEditFullMock(set)}
                                className="focus-ring text-xs font-semibold rounded-full border border-line text-mist px-2.5 py-1 hover:border-brass/50 hover:text-brass transition-colors"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteFullMockSet(set)}
                                className="focus-ring text-xs font-semibold rounded-full border border-coral/30 text-coral px-2.5 py-1 hover:bg-coral/10 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
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

      {examModal && (
        <ExamFormModal
          modal={examModal}
          saving={examModalSaving}
          error={examModalError}
          onCancel={() => setExamModal(null)}
          onSave={saveRlExam}
        />
      )}

      {sectionModal && (
        <SectionFormModal
          modal={sectionModal}
          module={rlSelectedExam?.module}
          saving={sectionModalSaving}
          error={sectionModalError}
          onCancel={() => setSectionModal(null)}
          onSave={saveSection}
        />
      )}

      {questionModal && (
        <QuestionFormModal
          modal={questionModal}
          saving={questionModalSaving}
          error={questionModalError}
          onCancel={() => setQuestionModal(null)}
          onSave={saveQuestion}
        />
      )}

      {listeningWizard && (
        <ListeningExamWizard
          wizard={listeningWizard}
          saving={listeningWizardSaving}
          error={listeningWizardError}
          onCancel={() => setListeningWizard(null)}
          onSave={saveListeningWizard}
        />
      )}

      {fullMockModal && (
        <FullMockSetFormModal
          modal={fullMockModal}
          listeningExams={rlExams.filter((e) => e.module === 'listening' && e.is_active)}
          readingExams={rlExams.filter((e) => e.module === 'reading' && e.is_active)}
          writingExams={writingExams.filter((e) => e.is_active)}
          saving={fullMockModalSaving}
          error={fullMockModalError}
          onCancel={() => setFullMockModal(null)}
          onSave={saveFullMockSet}
        />
      )}

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />
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
  const task1FileInputRef = useRef(null)

  // Clears a chosen-or-pasted (not-yet-saved) Task 1 image. Also resets
  // the native file input's own value — otherwise choosing the exact
  // same file again wouldn't fire onChange a second time, since as far
  // as the <input> itself is concerned nothing changed.
  const removeTask1ImageFile = () => {
    setTask1ImageFile(null)
    if (task1FileInputRef.current) task1FileInputRef.current.value = ''
  }

  // Jasur: "enable pasting pics here" — a chart/graph screenshot is
  // usually already on the clipboard (Snipping Tool, Win+Shift+S, etc.),
  // so requiring "Choose file" → save it somewhere → browse to it was
  // an extra, unnecessary round trip. Ctrl+V anywhere in this modal now
  // picks up an image straight off the clipboard, same as pasting into
  // Word/Slack. Only intercepts when the clipboard actually holds an
  // image — pasting text into the Title/Task fields is untouched.
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
            const named = new File([file], `pasted-chart-${Date.now()}.${ext}`, { type: file.type })
            setTask1ImageFile(named)
            setClearTask1Image(false)
          }
          e.preventDefault()
          return
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [])

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
              ref={task1FileInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => {
                setTask1ImageFile(e.target.files?.[0] || null)
                setClearTask1Image(false)
              }}
              className="focus-ring mt-1 w-full text-sm text-paper file:mr-3 file:rounded-full file:border file:border-brass/40 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass file:shadow-sm file:transition-colors hover:file:bg-brass/25"
            />
          </label>
          <p className="-mt-2 text-[11px] text-mist normal-case">
            Or just paste a screenshot — click anywhere in this window and press Ctrl+V (⌘V on Mac).
          </p>

          {task1ImageFile && (
            <div className="flex items-center gap-3">
              <img
                src={URL.createObjectURL(task1ImageFile)}
                alt="Pasted Task 1 chart"
                className="h-16 rounded-lg border border-line object-contain"
              />
              <span className="text-xs text-sage">Image ready — {task1ImageFile.name}</span>
              <button
                type="button"
                onClick={removeTask1ImageFile}
                className="focus-ring text-xs text-coral hover:text-coral/80"
              >
                Remove image
              </button>
            </div>
          )}

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
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-mist/70">
                Just the display order in the student's list — lower numbers show first. 0 and 1
                are fine; it doesn't affect grading or timing.
              </span>
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
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
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
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExamFormModal({ modal, saving, error, onCancel, onSave }) {
  const exam = modal.mode === 'edit' ? modal.exam : null
  // Create mode: the module is whichever tab (Reading/Listening) "+ Add
  // exam" was clicked from — no dropdown needed, since it's already
  // unambiguous. Edit mode: shown read-only, can't change post-creation.
  const moduleName = modal.mode === 'edit' ? exam.module : modal.module

  const [title, setTitle] = useState(exam?.title || '')
  const [isActive, setIsActive] = useState(exam ? exam.is_active : true)
  const [sortOrder, setSortOrder] = useState(exam?.sort_order ?? 0)
  const [randomizeQuestions, setRandomizeQuestions] = useState(exam?.randomize_questions ?? false)
  const [questionsPerSection, setQuestionsPerSection] = useState(exam?.questions_per_section ?? '')

  const canSave = title.trim() && (moduleName === 'reading' || moduleName === 'listening')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {modal.mode === 'create'
            ? `Add ${moduleName} exam`
            : `Edit ${moduleName} exam`}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          {moduleName === 'reading'
            ? "60 minutes, timed by the app. Next you'll add its passages and questions."
            : "40 minutes, timed by the app. Next you'll add its audio tracks and questions."}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={moduleName === 'reading' ? 'Reading Mock Test 1' : 'Listening Mock Test 1'}
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
            <span className="mt-1 block text-[11px] normal-case tracking-normal text-mist/70">
              Just the display order in the student's list — lower numbers show first.
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-paper">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="accent-brass"
            />
            Published (students can see and sit this)
          </label>

          {moduleName === 'reading' && (
            <div className="rounded-lg border border-line bg-panel-2 p-3">
              <label className="flex items-center gap-2 text-sm text-paper">
                <input
                  type="checkbox"
                  checked={randomizeQuestions}
                  onChange={(e) => setRandomizeQuestions(e.target.checked)}
                  className="accent-brass"
                />
                Randomize questions from bank
              </label>
              <p className="mt-1 text-[11px] text-mist">
                Author more questions per section than you need — each student sitting this exam
                gets a random draw, in random order, so repeat test-takers don't just memorize one
                fixed paper.
              </p>
              {randomizeQuestions && (
                <label className="mt-2 block text-xs text-mist font-mono uppercase tracking-wide">
                  Questions per section (blank = use every question, just shuffled)
                  <input
                    type="number"
                    min="1"
                    value={questionsPerSection}
                    onChange={(e) => setQuestionsPerSection(e.target.value)}
                    placeholder="e.g. 10"
                    className="focus-ring mt-1 w-32 rounded-lg border border-line bg-panel px-3 py-2 text-sm text-paper normal-case"
                  />
                </label>
              )}
            </div>
          )}
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({
                title,
                module: moduleName,
                isActive,
                sortOrder,
                // Listening can't support this (see the comment on this
                // checkbox above) — forced off regardless of stale state
                // even though the checkbox is hidden for this module.
                randomizeQuestions: moduleName === 'reading' ? randomizeQuestions : false,
                questionsPerSection: moduleName === 'reading' ? questionsPerSection : '',
              })
            }
            disabled={saving || !canSave}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionFormModal({ modal, module: examModule, saving, error, onCancel, onSave }) {
  const { profile } = useAuth()
  const section = modal.mode === 'edit' ? modal.section : null

  const [title, setTitle] = useState(section?.title || '')
  const [orderIndex, setOrderIndex] = useState(section?.order_index ?? 0)
  const [passageText, setPassageText] = useState(section?.passage_text || '')
  const [audioFile, setAudioFile] = useState(null)
  const [clearAudio, setClearAudio] = useState(false)

  const isReading = examModule === 'reading'
  const canSave = title.trim() && (!isReading || passageText.trim())

  // Jasur: "why do i have to write the title first then the passage and
  // then questions separately, it takes a lot of time" — same
  // mock-content-import Edge Function built for Listening already
  // extracts a title + full passage text + a question list in one shot
  // for module 'reading' too (it just wasn't wired into this modal yet).
  // One upload here fills in all three; the questions get bulk-inserted
  // right after this section is saved, in saveSection, so "Manage
  // questions" opens already populated instead of empty.
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importInfo, setImportInfo] = useState('')
  const [importedQuestions, setImportedQuestions] = useState([])
  const importInputRef = useRef(null)

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (importInputRef.current) importInputRef.current.value = ''
    if (!file) return

    setImporting(true)
    setImportError('')
    setImportInfo('')

    try {
      const path = `${profile.id}/mock-content/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('mock-content-uploads')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' })

      if (uploadError) throw uploadError

      const { data, error: fnError } = await supabase.functions.invoke('mock-content-import', {
        body: { storagePath: path, mimeType: file.type || '', module: 'reading' },
      })

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      const result = data?.result || {}
      const extracted = result.questions || []

      if (!result.section_title && !result.passage_text && extracted.length === 0) {
        throw new Error('Nothing usable was found in that file.')
      }

      if (result.section_title) setTitle(result.section_title)
      if (result.passage_text) setPassageText(result.passage_text)
      setImportedQuestions(extracted)

      const missingAnswers = extracted.filter((q) => !q.correct_answer?.trim()).length
      setImportInfo(
        (result.section_title || result.passage_text ? 'Title, passage, and ' : '') +
          `${extracted.length} question${extracted.length === 1 ? '' : 's'} imported — review below, then save.` +
          (missingAnswers
            ? ` ${missingAnswers} had no visible answer key, so you'll need to fill those in after saving.`
            : '')
      )
    } catch (err) {
      console.error('Mock content import failed:', err)
      setImportError(err?.message || 'Could not import that file. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {modal.mode === 'create' ? 'Add section' : 'Edit section'}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          {isReading
            ? 'One passage per section — students read it alongside its questions.'
            : 'One audio track per section — students hear it once, same as the real test.'}
        </p>

        {isReading && (
          <div className="mt-4 rounded-lg border border-dashed border-brass/40 bg-brass/5 p-3">
            <label className="text-xs font-semibold text-brass">
              Import from a file
              <input
                ref={importInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                disabled={importing}
                onChange={handleImportFile}
                className="focus-ring mt-1 block w-full text-sm text-paper file:mr-3 file:rounded-full file:border file:border-brass/40 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass file:shadow-sm file:transition-colors hover:file:bg-brass/25 disabled:opacity-50"
              />
            </label>
            <p className="mt-1 text-[11px] text-mist">
              Upload a PDF, Word doc, or photo of the real passage + questions and the title,
              passage text, and questions below all get filled in at once — review, fill in any
              blank answer, then hit Save just once.
            </p>
            {importing && <p className="mt-1.5 text-xs text-brass">Reading the file — this can take a moment…</p>}
            {importInfo && <p className="mt-1.5 text-xs text-sage">{importInfo}</p>}
            {importError && <p className="mt-1.5 text-xs text-coral">{importError}</p>}
          </div>
        )}

        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Title
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={isReading ? 'Passage 1' : 'Section 1'}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
            </label>

            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Order
              <input
                type="number"
                value={orderIndex}
                onChange={(e) => setOrderIndex(e.target.value)}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
            </label>
          </div>

          {isReading ? (
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Passage text
              <textarea
                value={passageText}
                onChange={(e) => setPassageText(e.target.value)}
                rows={8}
                placeholder="Paste the reading passage here…"
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
              />
            </label>
          ) : (
            <>
              <label className="text-xs text-mist font-mono uppercase tracking-wide">
                Audio file
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(e) => {
                    setAudioFile(e.target.files?.[0] || null)
                    setClearAudio(false)
                  }}
                  className="focus-ring mt-1 w-full text-sm text-paper file:mr-3 file:rounded-full file:border file:border-brass/40 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass file:shadow-sm file:transition-colors hover:file:bg-brass/25"
                />
              </label>

              {section?.audio_url && !audioFile && !clearAudio && (
                <div className="flex items-center gap-3">
                  <audio controls preload="none" src={section.audio_url} className="h-9" />
                  <button
                    type="button"
                    onClick={() => setClearAudio(true)}
                    className="focus-ring text-xs text-coral hover:text-coral/80"
                  >
                    Remove audio
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({ title, orderIndex, passageText, audioFile, clearAudio, importedQuestions })
            }
            disabled={saving || !canSave}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function QuestionFormModal({ modal, saving, error, onCancel, onSave }) {
  const question = modal.mode === 'edit' ? modal.question : null

  const [prompt, setPrompt] = useState(question?.prompt || '')
  const [orderIndex, setOrderIndex] = useState(question?.order_index ?? 0)
  const [type, setType] = useState(question?.type || 'multiple_choice')
  const [choicesText, setChoicesText] = useState(
    (question?.options?.choices || []).join('\n')
  )
  const [correctAnswer, setCorrectAnswer] = useState(question?.correct_answer || '')

  const choices = choicesText
    .split('\n')
    .map((c) => c.trim())
    .filter(Boolean)

  const canSave =
    prompt.trim() &&
    correctAnswer.trim() &&
    (type !== 'multiple_choice' || (choices.length >= 2 && choices.includes(correctAnswer)))

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {modal.mode === 'create' ? 'Add question' : 'Edit question'}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          Grading is an exact, case-insensitive text match against the correct answer below.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Question type
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value)
                  setCorrectAnswer('')
                }}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              >
                <option value="multiple_choice">Multiple choice</option>
                <option value="true_false_ng">True / False / Not Given</option>
                <option value="short_answer">Short answer</option>
              </select>
            </label>

            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Order
              <input
                type="number"
                value={orderIndex}
                onChange={(e) => setOrderIndex(e.target.value)}
                className="focus-ring mt-1 w-24 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
            </label>
          </div>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="What does the writer suggest about...?"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
            />
          </label>

          {type === 'multiple_choice' && (
            <>
              <label className="text-xs text-mist font-mono uppercase tracking-wide">
                Choices (one per line)
                <textarea
                  value={choicesText}
                  onChange={(e) => setChoicesText(e.target.value)}
                  rows={4}
                  placeholder={'Choice A\nChoice B\nChoice C'}
                  className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper resize-none"
                />
              </label>

              <label className="text-xs text-mist font-mono uppercase tracking-wide">
                Correct answer
                <select
                  value={correctAnswer}
                  onChange={(e) => setCorrectAnswer(e.target.value)}
                  className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
                >
                  <option value="">Select the correct choice…</option>
                  {choices.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {type === 'true_false_ng' && (
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Correct answer
              <select
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              >
                <option value="">Select…</option>
                {TRUE_FALSE_NG_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}

          {type === 'short_answer' && (
            <label className="text-xs text-mist font-mono uppercase tracking-wide">
              Correct answer
              <input
                type="text"
                value={correctAnswer}
                onChange={(e) => setCorrectAnswer(e.target.value)}
                placeholder="e.g. photosynthesis"
                className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
              />
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-mist/70">
                Grading trims spaces and ignores case, but otherwise needs an exact match — keep
                it to one accepted spelling.
              </span>
            </label>
          )}
        </div>

        {error && <p className="text-coral text-sm mt-3">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ prompt, orderIndex, type, choices, correctAnswer })}
            disabled={saving || !canSave}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

/*
 * ================================================================
 * LISTENING WIZARD
 * ================================================================
 * Replaces Reading's generic exam -> section -> question drill-down for
 * Listening specifically (see the "CONTENT EDITOR — LISTENING WIZARD"
 * comment above, near listeningWizard's state, for the full context of
 * why). Always exactly 4 parts; in create mode they reveal one at a
 * time as each becomes complete, and nothing is written to the
 * database at all until every part has audio and at least one
 * question — saveListeningWizard (the caller of onSave here) does the
 * actual exam/section/question inserts in one sequence.
 */
function ListeningExamWizard({ wizard, saving, error, onCancel, onSave }) {
  const isEdit = wizard.mode === 'edit'
  const exam = isEdit ? wizard.exam : null

  const [title, setTitle] = useState(exam?.title || '')
  const [sortOrder, setSortOrder] = useState(exam?.sort_order ?? 0)
  // No "randomize questions from bank" here on purpose — a Listening
  // part has exactly one fixed audio track, so shuffling or drawing a
  // random subset of questions would break the correspondence between
  // what's on screen and what the student hears. Reading-only; see
  // ExamFormModal and buildAttemptQuestions (MockExams.jsx).

  const buildInitialParts = () => {
    if (!isEdit) {
      return [0, 1, 2, 3].map((i) => ({
        sectionId: null,
        title: `Part ${i + 1}`,
        audioFile: null,
        audioUrl: null,
        clearAudio: false,
        questions: [],
      }))
    }

    const sections = wizard.sections || []
    return [0, 1, 2, 3].map((i) => {
      const sec = sections[i]
      const existingQuestions = sec ? wizard.questionsBySection[sec.id] || [] : []
      return {
        sectionId: sec?.id || null,
        title: sec?.title || `Part ${i + 1}`,
        audioFile: null,
        audioUrl: sec?.audio_url || null,
        clearAudio: false,
        questions: existingQuestions.map((q) => ({
          prompt: q.prompt,
          type: q.type,
          choicesText: (q.options?.choices || []).join('\n'),
          correctAnswer: q.correct_answer,
        })),
      }
    })
  }

  const [parts, setParts] = useState(buildInitialParts)

  // Create mode: parts reveal one at a time as each becomes complete —
  // Jasur: "space for pasting part 1... then part two but they should
  // not be separate... next part should be there." Edit mode shows all
  // 4 at once, since the content already exists.
  const [revealedCount, setRevealedCount] = useState(isEdit ? 4 : 1)

  const updatePart = (index, patch) => {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  const addQuestion = (partIndex) => {
    setParts((prev) =>
      prev.map((p, i) =>
        i !== partIndex
          ? p
          : {
              ...p,
              questions: [
                ...p.questions,
                { prompt: '', type: 'multiple_choice', choicesText: '', correctAnswer: '' },
              ],
            }
      )
    )
  }

  const updateQuestion = (partIndex, qIndex, patch) => {
    setParts((prev) =>
      prev.map((p, i) =>
        i !== partIndex
          ? p
          : { ...p, questions: p.questions.map((q, j) => (j === qIndex ? { ...q, ...patch } : q)) }
      )
    )
  }

  const removeQuestion = (partIndex, qIndex) => {
    setParts((prev) =>
      prev.map((p, i) =>
        i !== partIndex ? p : { ...p, questions: p.questions.filter((_, j) => j !== qIndex) }
      )
    )
  }

  const isPartValid = (part) => {
    const hasAudio = Boolean(part.audioFile || (part.audioUrl && !part.clearAudio))
    if (!hasAudio || part.questions.length === 0) return false
    return part.questions.every((q) => {
      if (!q.prompt.trim() || !q.correctAnswer.trim()) return false
      if (q.type === 'multiple_choice') {
        const choices = q.choicesText.split('\n').map((c) => c.trim()).filter(Boolean)
        return choices.length >= 2 && choices.includes(q.correctAnswer)
      }
      return true
    })
  }

  const allPartsValid = parts.every(isPartValid)
  const canSave = title.trim() && allPartsValid

  const handleSave = () => {
    onSave({
      title,
      sortOrder,
      parts: parts.map((p) => ({
        sectionId: p.sectionId,
        title: p.title,
        audioFile: p.audioFile,
        audioUrl: p.audioUrl,
        clearAudio: p.clearAudio,
        questions: p.questions.map((q) => ({
          prompt: q.prompt,
          type: q.type,
          choices: q.choicesText.split('\n').map((c) => c.trim()).filter(Boolean),
          correctAnswer: q.correctAnswer,
        })),
      })),
    })
  }

  if (isEdit && wizard.loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
        <div className="w-full max-w-3xl rounded-2xl border border-line bg-panel shadow-xl p-8 text-center">
          <p className="text-sm text-mist">Loading listening exam…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {isEdit ? 'Edit listening exam' : 'New listening exam'}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          {isEdit
            ? 'All 4 parts, right here — update audio or questions in any part, then save.'
            : "Fill in Part 1, then move on to the next — this can't be created until every part has audio and at least one question."}
        </p>

        <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Listening Mock Test 1"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Sort order
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="focus-ring mt-1 w-24 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          {parts.slice(0, revealedCount).map((part, i) => (
            <ListeningPartEditor
              key={i}
              part={part}
              valid={isPartValid(part)}
              onChange={(patch) => updatePart(i, patch)}
              onAddQuestion={() => addQuestion(i)}
              onUpdateQuestion={(qIndex, patch) => updateQuestion(i, qIndex, patch)}
              onRemoveQuestion={(qIndex) => removeQuestion(i, qIndex)}
            />
          ))}
        </div>

        {!isEdit && revealedCount < 4 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setRevealedCount((n) => Math.min(n + 1, 4))}
              disabled={!isPartValid(parts[revealedCount - 1])}
              className="focus-ring rounded-full border border-brass/40 bg-brass/10 text-brass px-4 py-2 text-sm font-semibold hover:bg-brass/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next part →
            </button>
          </div>
        )}

        {error && <p className="text-coral text-sm mt-4">{error}</p>}

        <div className="mt-5 flex gap-2 justify-end border-t border-line pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          {(isEdit || revealedCount === 4) && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !canSave}
              title={!canSave ? 'Every part needs audio and at least one complete question.' : undefined}
              className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create listening exam'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ListeningPartEditor({ part, valid, onChange, onAddQuestion, onUpdateQuestion, onRemoveQuestion }) {
  const { profile } = useAuth()
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importInfo, setImportInfo] = useState('')
  const importInputRef = useRef(null)

  // Jasur: "insert a pdf, word docx pic or any other file and it has
  // to build it to the mock environment" — teacher picks a file (a
  // scanned/typed question paper), it's uploaded to the private
  // mock-content-uploads bucket (migration_43), and the
  // mock-content-import Edge Function reads it with OpenAI and hands
  // back a draft question list. That draft is appended straight into
  // this part's normal, editable question list below — nothing is
  // saved yet. The AI is told to leave correct_answer blank whenever
  // it isn't sure, so any incomplete question shows up as normal here
  // (this part stays "Incomplete" until every answer is filled in),
  // which forces the same review-before-save step a human typing
  // questions in by hand already goes through.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0]
    if (importInputRef.current) importInputRef.current.value = ''
    if (!file) return

    setImporting(true)
    setImportError('')
    setImportInfo('')

    try {
      const path = `${profile.id}/mock-content/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('mock-content-uploads')
        .upload(path, file, { contentType: file.type || 'application/octet-stream' })

      if (uploadError) throw uploadError

      const { data, error: fnError } = await supabase.functions.invoke('mock-content-import', {
        body: { storagePath: path, mimeType: file.type || '', module: 'listening' },
      })

      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)

      const extracted = data?.result?.questions || []

      if (extracted.length === 0) {
        throw new Error('No questions were found in that file.')
      }

      const imported = extracted.map((q) => ({
        prompt: q.prompt || '',
        type: ['multiple_choice', 'true_false_ng', 'short_answer'].includes(q.type)
          ? q.type
          : 'short_answer',
        choicesText: (q.choices || []).join('\n'),
        correctAnswer: q.correct_answer || '',
      }))

      onChange({ questions: [...part.questions, ...imported] })

      const missingAnswers = imported.filter((q) => !q.correctAnswer.trim()).length
      setImportInfo(
        `Imported ${imported.length} question${imported.length === 1 ? '' : 's'} — check each one below.` +
          (missingAnswers
            ? ` ${missingAnswers} of them had no answer key in the file, so the correct answer is still blank — fill those in before saving.`
            : ' Double-check the correct answers before saving.')
      )
    } catch (err) {
      console.error('Mock content import failed:', err)
      setImportError(err?.message || 'Could not import that file. Please try again.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className={`rounded-xl border p-4 ${valid ? 'border-sage/30 bg-sage/5' : 'border-line bg-panel-2'}`}>
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={part.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="focus-ring font-display text-base text-paper bg-transparent border-0 border-b border-transparent hover:border-line focus:border-brass px-0 py-0.5 flex-1 min-w-0"
        />
        <span
          className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide rounded-full border px-2.5 py-1 ${
            valid ? 'text-sage border-sage/30 bg-sage/10' : 'text-mist border-line bg-panel'
          }`}
        >
          {valid ? 'Complete' : 'Incomplete'}
        </span>
      </div>

      <label className="mt-3 block text-xs text-mist font-mono uppercase tracking-wide">
        Audio file
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => onChange({ audioFile: e.target.files?.[0] || null, clearAudio: false })}
          className="focus-ring mt-1 w-full text-sm text-paper file:mr-3 file:rounded-full file:border file:border-brass/40 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass file:shadow-sm file:transition-colors hover:file:bg-brass/25"
        />
      </label>

      {part.audioFile ? (
        <div className="mt-1.5 flex items-center gap-3">
          <audio controls preload="none" src={URL.createObjectURL(part.audioFile)} className="h-9" />
          <span className="text-xs text-sage">Audio ready — {part.audioFile.name}</span>
        </div>
      ) : part.audioUrl && !part.clearAudio ? (
        <div className="mt-1.5 flex items-center gap-3">
          <audio controls preload="none" src={part.audioUrl} className="h-9" />
          <button
            type="button"
            onClick={() => onChange({ clearAudio: true })}
            className="focus-ring text-xs text-coral hover:text-coral/80"
          >
            Remove audio
          </button>
        </div>
      ) : null}

      <div className="mt-3 rounded-lg border border-dashed border-brass/40 bg-brass/5 p-3">
        <label className="text-xs font-semibold text-brass">
          Import questions from a file
          <input
            ref={importInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
            disabled={importing}
            onChange={handleImportFile}
            className="focus-ring mt-1 block w-full text-sm text-paper file:mr-3 file:rounded-full file:border file:border-brass/40 file:bg-brass/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-brass file:shadow-sm file:transition-colors hover:file:bg-brass/25 disabled:opacity-50"
          />
        </label>
        <p className="mt-1 text-[11px] text-mist">
          Upload a PDF, Word doc, or photo of the real question paper for this part and the
          questions below get filled in automatically — review them, fill in any blank answer,
          then save. (This reads the questions only; audio still has to be uploaded above.)
        </p>
        {importing && <p className="mt-1.5 text-xs text-brass">Reading the file — this can take a moment…</p>}
        {importInfo && <p className="mt-1.5 text-xs text-sage">{importInfo}</p>}
        {importError && <p className="mt-1.5 text-xs text-coral">{importError}</p>}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {part.questions.length === 0 && (
          <p className="text-xs text-mist">No questions in this part yet.</p>
        )}

        {part.questions.map((q, qIndex) => {
          const choices = q.choicesText.split('\n').map((c) => c.trim()).filter(Boolean)
          return (
            <div key={qIndex} className="rounded-lg border border-line bg-panel p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <select
                  value={q.type}
                  onChange={(e) => onUpdateQuestion(qIndex, { type: e.target.value, correctAnswer: '' })}
                  className="focus-ring rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-paper"
                >
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="true_false_ng">True / False / Not Given</option>
                  <option value="short_answer">Short answer</option>
                </select>
                <button
                  type="button"
                  onClick={() => onRemoveQuestion(qIndex)}
                  className="focus-ring text-xs text-coral hover:text-coral/80 px-1 shrink-0"
                >
                  Remove
                </button>
              </div>

              <textarea
                value={q.prompt}
                onChange={(e) => onUpdateQuestion(qIndex, { prompt: e.target.value })}
                rows={2}
                placeholder="Question prompt…"
                className="focus-ring w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper resize-none"
              />

              {q.type === 'multiple_choice' && (
                <>
                  <textarea
                    value={q.choicesText}
                    onChange={(e) => onUpdateQuestion(qIndex, { choicesText: e.target.value })}
                    rows={3}
                    placeholder={'Choice A\nChoice B\nChoice C'}
                    className="focus-ring w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper resize-none"
                  />
                  <select
                    value={q.correctAnswer}
                    onChange={(e) => onUpdateQuestion(qIndex, { correctAnswer: e.target.value })}
                    className="focus-ring w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper"
                  >
                    <option value="">Select the correct choice…</option>
                    {choices.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {q.type === 'true_false_ng' && (
                <select
                  value={q.correctAnswer}
                  onChange={(e) => onUpdateQuestion(qIndex, { correctAnswer: e.target.value })}
                  className="focus-ring w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper"
                >
                  <option value="">Select…</option>
                  {TRUE_FALSE_NG_CHOICES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}

              {q.type === 'short_answer' && (
                <input
                  type="text"
                  value={q.correctAnswer}
                  onChange={(e) => onUpdateQuestion(qIndex, { correctAnswer: e.target.value })}
                  placeholder="Correct answer"
                  className="focus-ring w-full rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-paper"
                />
              )}
            </div>
          )
        })}

        <button
          type="button"
          onClick={onAddQuestion}
          className="focus-ring self-start text-xs font-semibold rounded-full border border-brass/40 bg-brass/10 text-brass px-3 py-1.5 hover:bg-brass/20 transition-colors"
        >
          + Add question
        </button>
      </div>
    </div>
  )
}

function FullMockSetFormModal({
  modal,
  listeningExams,
  readingExams,
  writingExams,
  saving,
  error,
  onCancel,
  onSave,
}) {
  const set = modal.mode === 'edit' ? modal.set : null

  const [title, setTitle] = useState(set?.title || '')
  const [listeningExamId, setListeningExamId] = useState(set?.listening_exam_id || '')
  const [readingExamId, setReadingExamId] = useState(set?.reading_exam_id || '')
  const [writingExamId, setWritingExamId] = useState(set?.writing_exam_id || '')
  const [isActive, setIsActive] = useState(set ? set.is_active : true)
  const [sortOrder, setSortOrder] = useState(set?.sort_order ?? 0)

  // Editing an existing set: its own currently-linked exam might no
  // longer be in the "published" list passed in (e.g. it got
  // un-published after this set was built) — still offer it as an
  // option so editing doesn't silently drop a valid selection.
  const listeningOptions = set && !listeningExams.some((e) => e.id === set.listening_exam_id)
    ? [{ id: set.listening_exam_id, title: '(currently linked, unpublished)' }, ...listeningExams]
    : listeningExams
  const readingOptions = set && !readingExams.some((e) => e.id === set.reading_exam_id)
    ? [{ id: set.reading_exam_id, title: '(currently linked, unpublished)' }, ...readingExams]
    : readingExams
  const writingOptions = set && !writingExams.some((e) => e.id === set.writing_exam_id)
    ? [{ id: set.writing_exam_id, title: '(currently linked, unpublished)' }, ...writingExams]
    : writingExams

  const canSave =
    title.trim() && listeningExamId && readingExamId && writingExamId

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-xl p-5 sm:p-6">
        <h3 className="font-display text-lg text-paper">
          {modal.mode === 'create' ? 'Add full mock' : 'Edit full mock'}
        </h3>
        <p className="text-sm text-mist mt-0.5">
          Students sit these three, in this order, as one continuous test — same as the real
          exam.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Full Mock 1"
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            1. Listening exam
            <select
              value={listeningExamId}
              onChange={(e) => setListeningExamId(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            >
              <option value="">
                {listeningOptions.length ? 'Select a listening exam…' : 'No published listening exams yet'}
              </option>
              {listeningOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            2. Reading exam
            <select
              value={readingExamId}
              onChange={(e) => setReadingExamId(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            >
              <option value="">
                {readingOptions.length ? 'Select a reading exam…' : 'No published reading exams yet'}
              </option>
              {readingOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            3. Writing exam
            <select
              value={writingExamId}
              onChange={(e) => setWritingExamId(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            >
              <option value="">
                {writingOptions.length ? 'Select a writing exam…' : 'No published writing exams yet'}
              </option>
              {writingOptions.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-mist font-mono uppercase tracking-wide">
            Sort order
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="focus-ring mt-1 w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-paper"
            />
            <span className="mt-1 block text-[11px] normal-case tracking-normal text-mist/70">
              Just the display order in the student's list — lower numbers show first.
            </span>
          </label>

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
            className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave({ title, listeningExamId, readingExamId, writingExamId, isActive, sortOrder })
            }
            disabled={saving || !canSave}
            className="focus-ring rounded-full bg-brass text-onbrass px-5 py-2 text-sm font-semibold shadow-sm hover:bg-brass-dim transition-colors disabled:opacity-50 disabled:hover:bg-brass"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
