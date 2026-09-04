// Shared constants and small pure helpers for the "Writing Mock Test"
// homework type — a timed, in-app IELTS Writing simulation (Task 1,
// Task 2, or both back-to-back under one continuous clock).
//
// Kept framework-free and imported by both the teacher-side form
// (PostHomeworkForm.jsx / EditHomeworkModal.jsx) and the student-side
// timed environment (HomeworkCard.jsx / WritingMockTest.jsx) and the
// teacher's review view (SubmissionPanel.jsx), so the numbers and
// labels never drift apart between them.

export const MOCK_TASK_MODES = [
  { value: 'task1', label: 'Task 1 only' },
  { value: 'task2', label: 'Task 2 only' },
  { value: 'full', label: 'Full test (Task 1 + Task 2)' },
]

export const TASK_MODE_LABELS = {
  task1: 'Task 1',
  task2: 'Task 2',
  full: 'Full Test',
}

// Real IELTS timing — used to prefill the teacher's time-limit field
// the moment they pick a task mode. The teacher can still type a
// different number afterwards (the "or other" from the original
// request) — this is only a starting point, never enforced.
export const DEFAULT_TIME_LIMITS = {
  task1: 20,
  task2: 40,
  full: 60,
}

// Real IELTS minimum word counts. The word counter turns amber/red
// below these as a soft warning only — going under is a real,
// penalized-but-allowed thing a student can still choose to submit,
// exactly like the actual exam.
export const MIN_WORDS = {
  task1: 150,
  task2: 250,
}

export function countWords(text) {
  if (!text) return 0

  const trimmed = text.trim()

  if (!trimmed) return 0

  return trimmed.split(/\s+/).filter(Boolean).length
}

// How many whole seconds are left in a mock test, given when it
// started and its total time limit. Deliberately computed from a
// fixed started_at timestamp saved to the server rather than a plain
// client-side counter that starts ticking down from mount — that way
// a reload, a crashed tab, or reopening on another device can't hand
// the student extra time, and the countdown always agrees with the
// server record used for grading.
export function secondsRemaining(startedAt, timeLimitMinutes) {
  if (!startedAt || !timeLimitMinutes) return 0

  const startMs = new Date(startedAt).getTime()
  const endMs = startMs + timeLimitMinutes * 60 * 1000

  return Math.max(0, Math.round((endMs - Date.now()) / 1000))
}

export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60

  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
