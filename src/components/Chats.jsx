import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import Chat from './Chat'

export default function Chats({
  selfId,
  teacher,
  initialPeerId = null,
}) {
  const [people, setPeople] = useState([])
  const [selectedPeerId, setSelectedPeerId] =
    useState(initialPeerId)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadPeople = async () => {
    if (!selfId) return

    setLoading(true)
    setError('')

    try {
      /*
       * ============================================================
       * 1. PEOPLE FROM EXISTING PRIVATE MESSAGES
       * ============================================================
       */

      const {
        data: messages,
        error: messagesError,
      } = await supabase
        .from('messages')
        .select(
          'sender_id, receiver_id, created_at'
        )
        .or(
          `sender_id.eq.${selfId},receiver_id.eq.${selfId}`
        )
        .order(
          'created_at',
          { ascending: false }
        )

      if (messagesError) {
        throw messagesError
      }

      const peerIds = new Set()

      ;(messages || []).forEach((message) => {
        if (
          message.sender_id &&
          message.sender_id !== selfId
        ) {
          peerIds.add(
            message.sender_id
          )
        }

        if (
          message.receiver_id &&
          message.receiver_id !== selfId
        ) {
          peerIds.add(
            message.receiver_id
          )
        }
      })

      /*
       * ============================================================
       * 2. PEOPLE FROM THE STUDENT'S GROUPS
       * ============================================================
       */

      const {
        data: memberships,
        error: membershipError,
      } = await supabase
        .from('group_members')
        .select('group_id')
        .eq(
          'student_id',
          selfId
        )

      if (membershipError) {
        throw membershipError
      }

      const groupIds = [
        ...new Set(
          (memberships || [])
            .map(
              (row) =>
                row.group_id
            )
            .filter(Boolean)
        ),
      ]

      if (groupIds.length > 0) {
        const {
          data: groupMembers,
          error: groupMembersError,
        } = await supabase
          .from('group_members')
          .select(
            'student_id'
          )
          .in(
            'group_id',
            groupIds
          )

        if (groupMembersError) {
          throw groupMembersError
        }

        ;(groupMembers || []).forEach(
          (member) => {
            if (
              member.student_id &&
              member.student_id !== selfId
            ) {
              peerIds.add(
                member.student_id
              )
            }
          }
        )
      }

      /*
       * ============================================================
       * 3. TEACHER
       * ============================================================
       */

      if (teacher?.id) {
        peerIds.add(
          teacher.id
        )
      }

      /*
       * ============================================================
       * 4. LOAD PROFILES
       * ============================================================
       */

      const ids = [
        ...peerIds,
      ]

      if (ids.length === 0) {
        setPeople([])
        return
      }

      const {
        data: profiles,
        error: profilesError,
      } = await supabase
        .from('profiles')
        .select(
          'id, full_name, username, role, status'
        )
        .in(
          'id',
          ids
        )

      if (profilesError) {
        throw profilesError
      }

      /*
       * ============================================================
       * 5. SORT
       *
       * Teacher first, then alphabetical.
       * ============================================================
       */

      const sorted =
        [...(profiles || [])].sort(
          (a, b) => {
            if (
              a.id === teacher?.id
            ) {
              return -1
            }

            if (
              b.id === teacher?.id
            ) {
              return 1
            }

            return String(
              a.full_name || ''
            ).localeCompare(
              String(
                b.full_name || ''
              )
            )
          }
        )

      setPeople(sorted)

      /*
       * If the requested peer no longer exists,
       * select the first available person.
       */
      if (
        selectedPeerId &&
        !sorted.some(
          (person) =>
            person.id ===
            selectedPeerId
        )
      ) {
        setSelectedPeerId(
          sorted[0]?.id || null
        )
      }
    } catch (err) {
      console.error(
        'Chats loading error:',
        err
      )

      setError(
        err.message ||
          'Could not load chats.'
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPeople()
  }, [
    selfId,
    teacher?.id,
  ])

  useEffect(() => {
    if (initialPeerId) {
      setSelectedPeerId(
        initialPeerId
      )
    }
  }, [initialPeerId])

  /*
   * Refresh the conversation list whenever
   * a new private message arrives.
   */
  useEffect(() => {
    if (!selfId) return

    const channel =
      supabase
        .channel(
          `student-chats-${selfId}`
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          (payload) => {
            const message =
              payload.new

            if (
              message.sender_id ===
                selfId ||
              message.receiver_id ===
                selfId
            ) {
              loadPeople()
            }
          }
        )
        .subscribe()

    return () => {
      supabase.removeChannel(
        channel
      )
    }
  }, [selfId])

  const selectedPerson =
    useMemo(
      () =>
        people.find(
          (person) =>
            person.id ===
            selectedPeerId
        ) || null,
      [
        people,
        selectedPeerId,
      ]
    )

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[28rem]">

      {/* ============================================================
          CONVERSATION LIST
          ============================================================ */}

      <aside className="w-full lg:w-72 shrink-0 bg-panel border border-line rounded-lg overflow-hidden">

        <div className="px-4 py-3 border-b border-line">
          <div className="font-display text-lg text-paper">
            Chats
          </div>

          <div className="text-xs text-mist mt-1">
            Your conversations
          </div>
        </div>

        {loading && (
          <div className="px-4 py-5 text-sm text-mist">
            Loading chats…
          </div>
        )}

        {error && (
          <div className="px-4 py-4 text-sm text-coral">
            {error}
          </div>
        )}

        {!loading &&
          !error &&
          people.length === 0 && (
            <div className="px-4 py-5 text-sm text-mist">
              No conversations yet.
            </div>
          )}

        {!loading &&
          people.length > 0 && (
            <div className="max-h-[28rem] overflow-y-auto">

              {people.map(
                (person) => {
                  const isTeacher =
                    person.id ===
                    teacher?.id

                  const active =
                    person.id ===
                    selectedPeerId

                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() =>
                        setSelectedPeerId(
                          person.id
                        )
                      }
                      className={`w-full text-left px-4 py-3 border-b border-line transition-colors ${
                        active
                          ? 'bg-panel-2'
                          : 'hover:bg-panel-2'
                      }`}
                    >
                      <div className="flex items-center gap-3">

                        <div className="w-10 h-10 rounded-full border border-line bg-ink flex items-center justify-center text-sm font-medium text-brass shrink-0">
                          {String(
                            person.full_name ||
                              person.username ||
                              '?'
                          )
                            .charAt(0)
                            .toUpperCase()}
                        </div>

                        <div className="min-w-0">

                          <div className="text-sm font-medium text-paper truncate">
                            {person.full_name ||
                              person.username ||
                              'Unknown user'}
                          </div>

                          <div className="text-xs text-mist truncate">
                            {person.username
                              ? `@${person.username}`
                              : isTeacher
                              ? 'Teacher'
                              : 'Student'}
                          </div>

                          {isTeacher && (
                            <div className="text-[10px] uppercase tracking-wider text-brass mt-0.5">
                              Teacher
                            </div>
                          )}

                        </div>

                      </div>
                    </button>
                  )
                }
              )}

            </div>
          )}

      </aside>

      {/* ============================================================
          ACTIVE CHAT
          ============================================================ */}

      <main className="flex-1 min-w-0">

        {selectedPerson ? (
          <Chat
            selfId={selfId}
            peerId={selectedPerson.id}
            peerName={
              selectedPerson.full_name ||
              selectedPerson.username ||
              'User'
            }
          />
        ) : (
          <div className="h-[28rem] bg-panel border border-line rounded-lg flex items-center justify-center text-mist">
            Select a conversation to start chatting.
          </div>
        )}

      </main>

    </div>
  )
}