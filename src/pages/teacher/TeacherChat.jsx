import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import Chat from '../../components/Chat'

/*
 * Turns a message's raw `content` (plain text, or a JSON blob for
 * photos/videos/voice notes/files — see Chat.jsx's parseMessage) into
 * a short one-line preview for the conversation list, the same way
 * Telegram shows "📷 Photo" instead of a raw URL for the last message.
 */
function previewText(content) {
  if (!content) return ''

  try {
    const parsed = JSON.parse(content)

    if (parsed?.type && parsed?.url) {
      if (parsed.type === 'image') return '📷 Photo'
      if (parsed.type === 'video') return '🎥 Video'
      if (parsed.type === 'audio') return '🎤 Voice message'
      if (parsed.type === 'file') {
        return `📎 ${parsed.name || 'File'}`
      }
    }
  } catch {
    // Plain text message — fall through.
  }

  return content
}

/*
 * Short relative-ish timestamp for the conversation list: just the
 * time for today, the weekday for the last week, otherwise a short
 * date — the same convention Telegram uses so the list stays scannable.
 */
function formatListTime(value) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const startOfDate = new Date(date)
  startOfDate.setHours(0, 0, 0, 0)

  const dayDiff = Math.round(
    (startOfToday - startOfDate) / 86400000
  )

  if (dayDiff === 0) {
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (dayDiff > 0 && dayDiff < 7) {
    return date.toLocaleDateString([], {
      weekday: 'short',
    })
  }

  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })
}

export default function TeacherChat({
  teacherId,
  initialStudentId,
  initialStudentName,
  initialMessageId,
}) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')

  /*
   * Loads only the students the teacher has an actual message history
   * with, newest conversation first — a fresh account with no
   * conversations yet just shows an empty list, same as opening
   * Telegram for the first time. To message someone new, the teacher
   * starts from that student's profile in the Leaderboard, which is
   * what actually creates the first message and puts them here.
   */
  useEffect(() => {
    let active = true

    const loadConversations = async () => {
      if (!teacherId) return

      setLoading(true)
      setError('')

      try {
        const { data: messages, error: messagesError } =
          await supabase
            .from('messages')
            .select(
              'sender_id, receiver_id, content, created_at'
            )
            .or(
              `sender_id.eq.${teacherId},receiver_id.eq.${teacherId}`
            )
            .order('created_at', { ascending: false })

        if (messagesError) throw messagesError

        /*
         * Messages come back newest-first, so the FIRST time we see
         * a given peer is automatically their most recent message —
         * exactly what the list needs to show and sort by.
         */
        const lastByPeer = new Map()

        ;(messages || []).forEach((message) => {
          const peerId =
            message.sender_id === teacherId
              ? message.receiver_id
              : message.sender_id

          if (!peerId || peerId === teacherId) return

          if (!lastByPeer.has(peerId)) {
            lastByPeer.set(peerId, {
              content: message.content,
              created_at: message.created_at,
            })
          }
        })

        const peerIds = [...lastByPeer.keys()]

        if (peerIds.length === 0) {
          if (active) setConversations([])
          return
        }

        const { data: profiles, error: profilesError } =
          await supabase
            .from('profiles')
            .select(
              'id, full_name, username, contact_email, avatar_url'
            )
            .in('id', peerIds)

        if (profilesError) throw profilesError

        const merged = (profiles || [])
          .map((profile) => ({
            ...profile,
            lastMessage: lastByPeer.get(profile.id) || null,
          }))
          .sort((a, b) => {
            const timeA = a.lastMessage?.created_at
              ? new Date(a.lastMessage.created_at).getTime()
              : 0

            const timeB = b.lastMessage?.created_at
              ? new Date(b.lastMessage.created_at).getTime()
              : 0

            return timeB - timeA
          })

        if (active) setConversations(merged)
      } catch (err) {
        console.error(
          'Failed to load conversations:',
          err
        )

        if (active) {
          setError(
            err?.message || 'Could not load your chats.'
          )
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    loadConversations()

    /*
     * Keep the list live: a brand new conversation (or a bump back
     * to the top from a new message) should appear without needing
     * to leave and reopen the Chat tab.
     */
    const channel = supabase
      .channel(`teacher-chats-${teacherId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload) => {
          const message = payload.new

          if (
            message.sender_id === teacherId ||
            message.receiver_id === teacherId
          ) {
            loadConversations()
          }
        }
      )
      .subscribe()

    return () => {
      active = false
      supabase.removeChannel(channel)
    }
  }, [teacherId])

  /*
   * Notification navigation (and "Chat with student" from the
   * Leaderboard) always selects the requested student, even if this
   * is the very first message and they don't have a conversation row
   * yet — the conversation list only fills in once that first
   * message actually sends.
   */
  useEffect(() => {
    if (!initialStudentId) return

    const existing = conversations.find(
      (s) => s.id === initialStudentId
    )

    if (existing) {
      setSelected(existing)
    } else if (initialStudentName) {
      setSelected({
        id: initialStudentId,
        full_name: initialStudentName,
      })
    }
  }, [
    initialStudentId,
    initialStudentName,
    conversations,
  ])

  /*
   * Search by name, username, or email — within the conversations
   * the teacher already has, same as Telegram's chat-list search.
   */
  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase()

    if (!query) return conversations

    return conversations.filter((student) => {
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
  }, [conversations, search])

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[28rem]">

      {/* ============================================================
          CONVERSATION LIST
          ============================================================ */}

      <aside className="w-full md:w-72 shrink-0 bg-panel border border-line rounded-lg overflow-hidden flex flex-col">

        <div className="px-4 py-3 border-b border-line">
          <div className="font-display text-lg text-paper">
            Chats
          </div>

          <div className="text-xs text-mist mt-1">
            Your conversations with students
          </div>
        </div>

        <div className="px-3 pt-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your chats..."
            className="focus-ring w-full bg-panel-2 border border-line rounded-md px-3 py-2 text-sm"
          />
        </div>

        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-mist text-xs font-mono">
            {search.trim()
              ? `${filteredConversations.length} of ${conversations.length}`
              : `${conversations.length} conversation${
                  conversations.length === 1 ? '' : 's'
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

        <div className="flex-1 overflow-y-auto max-h-[28rem]">

          {loading && (
            <div className="px-4 py-5 text-sm text-mist">
              Loading chats…
            </div>
          )}

          {!loading && error && (
            <div className="px-4 py-4 text-sm text-coral">
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            conversations.length === 0 && (
              <div className="px-4 py-6 text-sm text-mist text-center">
                No conversations yet.
                <div className="mt-1 text-xs">
                  Start one from a student's profile in the
                  Leaderboard.
                </div>
              </div>
            )}

          {!loading &&
            !error &&
            conversations.length > 0 &&
            filteredConversations.length === 0 && (
              <div className="px-4 py-5 text-sm text-mist">
                No chats match your search.
              </div>
            )}

          {!loading &&
            filteredConversations.map((student) => {
              const active = selected?.id === student.id

              return (
                <button
                  type="button"
                  key={student.id}
                  onClick={() => setSelected(student)}
                  className={`w-full text-left px-4 py-3 border-b border-line transition-colors ${
                    active ? 'bg-panel-2' : 'hover:bg-panel-2'
                  }`}
                >
                  <div className="flex items-center gap-3">

                    {student.avatar_url ? (
                      <img
                        src={student.avatar_url}
                        alt={
                          student.full_name ||
                          student.username ||
                          'Student'
                        }
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full border border-line bg-ink flex items-center justify-center text-sm font-medium text-brass shrink-0">
                        {String(
                          student.full_name ||
                            student.username ||
                            '?'
                        )
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-paper truncate">
                          {student.full_name ||
                            student.username ||
                            'Unknown user'}
                        </span>

                        {student.lastMessage?.created_at && (
                          <span className="text-[10px] text-mist font-mono shrink-0">
                            {formatListTime(
                              student.lastMessage.created_at
                            )}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-mist truncate mt-0.5">
                        {student.lastMessage
                          ? previewText(
                              student.lastMessage.content
                            )
                          : student.username
                          ? `@${student.username}`
                          : ''}
                      </div>

                    </div>

                  </div>
                </button>
              )
            })}

        </div>
      </aside>

      {/* ============================================================
          ACTIVE CHAT
          ============================================================ */}

      <section className="flex-1 min-w-0">

        {selected ? (
          <Chat
            selfId={teacherId}
            peerId={selected.id}
            peerName={selected.full_name}
            targetMessageId={initialMessageId}
          />
        ) : (
          <div className="h-[28rem] bg-panel border border-line rounded-lg flex items-center justify-center text-mist text-center px-6">
            Select a conversation, or open a student's
            profile from the Leaderboard to start a new one.
          </div>
        )}

      </section>

    </div>
  )
}
