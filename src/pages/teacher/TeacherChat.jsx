import { useEffect, useMemo, useState } from 'react'
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
  const [search, setSearch] = useState('')

  useEffect(() => {
    let active = true

    const loadStudents = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, username, contact_email')
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

  /*
   * Search students by:
   * - full name
   * - username
   * - email
   */
  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) {
      return students
    }

    return students.filter((student) => {
      return [
        student.full_name,
        student.username,
        student.contact_email,
      ]
        .filter(Boolean)
        .some((value) =>
          value.toLowerCase().includes(query)
        )
    })
  }, [students, search])

  return (
    <div className="flex flex-col md:flex-row gap-6">

      <aside className="md:w-56 flex-shrink-0">

        <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
          Students
        </div>

        {/* Student search */}
        <div className="mb-3">

          <input
            type="text"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search students..."
            className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
          />

        </div>

        <div className="flex items-center justify-between mb-2">

          <span className="text-mist text-xs font-mono">
            {search.trim()
              ? `${filteredStudents.length} of ${students.length}`
              : `${students.length} student${
                  students.length === 1
                    ? ''
                    : 's'
                }`}
          </span>

          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="focus-ring text-xs text-brass hover:underline"
            >
              Clear
            </button>
          )}

        </div>

        <div className="flex md:flex-col gap-2 overflow-x-auto">

          {filteredStudents.map((student) => (
            <button
              type="button"
              key={student.id}
              onClick={() =>
                setSelected(student)
              }
              className={`focus-ring text-left px-3 py-2 rounded-md text-sm whitespace-nowrap transition-colors ${
                selected?.id === student.id
                  ? 'bg-brass text-onbrass font-medium'
                  : 'bg-panel-2 text-mist hover:text-paper'
              }`}
            >
              <div>
                {student.full_name}
              </div>

              {student.username && (
                <div
                  className={`text-xs font-mono ${
                    selected?.id === student.id
                      ? 'opacity-80'
                      : 'text-mist'
                  }`}
                >
                  @{student.username}
                </div>
              )}
            </button>
          ))}

          {students.length === 0 && (
            <p className="text-mist text-sm">
              No approved students yet.
            </p>
          )}

          {students.length > 0 &&
            filteredStudents.length === 0 && (
              <p className="text-mist text-sm">
                No students match your search.
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