// status: 'done' | 'late' | 'pending' | 'overdue'
const LABELS = {
  done: 'Done',
  late: 'Late',
  pending: 'Not yet',
  overdue: 'Incomplete',
}

export default function StampBadge({ status }) {
  return (
    <span className={`stamp stamp-${status} w-16 h-16 text-[10px] uppercase text-center leading-tight px-1`}>
      {LABELS[status]}
    </span>
  )
}

// Works out done / late / pending / overdue from a submission + a homework due date.
export function getSubmissionStatus(submission, dueDate) {
  if (submission?.status === 'done') {
    if (isLateSubmission(submission, dueDate)) return 'late'
    return 'done'
  }

  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'overdue'
  return 'pending'
}

// True when a "done" submission was actually saved after its deadline.
export function isLateSubmission(submission, dueDate) {
  if (!dueDate || !submission?.submitted_at) return false
  return (
    new Date(submission.submitted_at).getTime() >
    new Date(dueDate).getTime()
  )
}
