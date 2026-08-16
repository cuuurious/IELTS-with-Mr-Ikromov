// status: 'done' | 'pending' | 'overdue'
const LABELS = {
  done: 'Done',
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

// Works out done / pending / overdue from a submission + a homework due date.
export function getSubmissionStatus(submission, dueDate) {
  if (submission?.status === 'done') return 'done'
  if (dueDate && new Date(dueDate).getTime() < Date.now()) return 'overdue'
  return 'pending'
}
