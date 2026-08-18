import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Chat from '../../components/Chat'

export default function TeacherChat({
  teacherId,
  initialStudentId,
  initialStudentName,
  initialMessageId,
}) {
  const [students, setStudents] = useState([])
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    let active = true

    const loadStudents = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username')
        .eq('role', 'student')
        .eq('status', 'approved')
        .order('full_name')

      if (!error && active) {
        setStudents(data || [])
      }
    }

    loadStudents()

    return () => {
      active = false
    }
  }, [])

  /*
   * Notification navigation ALWAYS selects the student
   * specified by the notification.
   */
  useEffect(() => {
    if (!initialStudentId) return

    const student = students.find(
      (s) => s.id === initialStudentId
    )

    if (student) {
      setSelected(student)
    } else if (initialStudentName) {
      setSelected({
        id: initialStudentId,
        full_name: initialStudentName,
      })
    }
  }, [
    initialStudentId,
    initialStudentName,
    students,
  ])

  return (
    <div className="flex flex-col md:flex-row gap-6">

      <aside className="md:w-56 flex-shrink-0">

        <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
          Students
        </div>

        <div className="flex md:flex-col gap-2 overflow-x-auto">

          {students.map((student) => (
            <button
              type="button"
              key={student.id}
              onClick={() => setSelected(student)}
              className={`focus-ring text-left px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                selected?.id === student.id
                  ? 'bg-brass text-onbrass font-medium'
                  : 'bg-panel-2 text-mist hover:text-paper'
              }`}
            >
              {student.full_name}
            </button>
          ))}

          {students.length === 0 && (
            <p className="text-mist text-sm">
              No approved students yet.
            </p>
          )}

        </div>
      </aside>

      <section className="flex-1 min-w-0">

        <Chat
          selfId={teacherId}
          peerId={selected?.id}
          peerName={selected?.full_name}
          targetMessageId={initialMessageId}
        />

      </section>

    </div>
  )
}