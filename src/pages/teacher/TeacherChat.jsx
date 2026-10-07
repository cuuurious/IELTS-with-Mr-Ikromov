import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { fetchAll } from '../../lib/fetchAll'
import Chat, { ChatAvatar, ChatGlyph } from '../../components/Chat'
import Icon from '../../components/Icon'

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
      if (parsed.type === 'image') return 'Photo'
      if (parsed.type === 'video') return 'Video'
      if (parsed.type === 'audio') return 'Voice message'
      if (parsed.type === 'file') {
        return `${parsed.name || 'File'}`
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
  const conversationsRef = useRef([])
  conversationsRef.current = conversations

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

    // Request token: only the newest load may write state (2026-10-06).
    let loadToken = 0

    const loadConversations = async ({ quiet = false } = {}) => {
      if (!teacherId) return
      const token = ++loadToken

      if (!quiet) setLoading(true)
      setError('')

      try {
        // 2026-10-06 review: this read the WHOLE history incl. every
        // message body on every new message, and silently stopped at 1000
        // rows (older conversations vanished from the list). Now it pages
        // through everything with fetchAll but reads only who/when, then
        // fetches the bodies of just each conversation's last message.
        const { data: messages, error: messagesError } =
          await fetchAll(() =>
            supabase
              .from('messages')
              .select(
                'id, sender_id, receiver_id, created_at'
              )
              .or(
                `sender_id.eq.${teacherId},receiver_id.eq.${teacherId}`
              )
              .order('created_at', { ascending: false })
              .order('id')
          )

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
              id: message.id,
              content: '',
              created_at: message.created_at,
            })
          }
        })

        const peerIds = [...lastByPeer.keys()]

        if (peerIds.length === 0) {
          if (active && token === loadToken) setConversations([])
          return
        }

        const lastIds = [...lastByPeer.values()].map((m) => m.id)
        const contentById = {}
        for (let i = 0; i < lastIds.length; i += 200) {
          const { data: bodies, error: bodiesError } = await supabase
            .from('messages')
            .select('id, content')
            .in('id', lastIds.slice(i, i + 200))
          if (bodiesError) throw bodiesError
          ;(bodies || []).forEach((b) => { contentById[b.id] = b.content })
        }
        lastByPeer.forEach((m) => { m.content = contentById[m.id] || '' })

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

        if (active && token === loadToken) setConversations(merged)
      } catch (err) {
        console.error(
          'Failed to load conversations:',
          err
        )

        if (active && token === loadToken) {
          setError(
            err?.message || 'Could not load your chats.'
          )
        }
      } finally {
        if (active && token === loadToken) setLoading(false)
      }
    }

    loadConversations()

    // A message from/to someone already in the list just bumps that
    // conversation from the realtime payload; only a brand-new peer
    // (needs their profile) triggers a reload, debounced (2026-10-06).
    let reloadTimer = null
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        reloadTimer = null
        loadConversations({ quiet: true })
      }, 1000)
    }

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
            const peerId =
              message.sender_id === teacherId
                ? message.receiver_id
                : message.sender_id
            if (!peerId || peerId === teacherId) return
            const known = conversationsRef.current.some((c) => c.id === peerId)
            if (!known) {
              scheduleReload()
              return
            }
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === peerId)
              if (idx < 0) return prev
              const updated = {
                ...prev[idx],
                lastMessage: { id: message.id, content: message.content, created_at: message.created_at },
              }
              return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)]
            })
          }
        }
      )
      .subscribe()

    return () => {
      active = false
      if (reloadTimer) clearTimeout(reloadTimer)
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
    // Study room look (2026-10-07) — same card as PrivateChats.jsx.
    <div
      className={`flex overflow-hidden rounded-[22px] border border-line bg-panel md:h-[calc(100dvh-196px)] md:min-h-[540px] ${
        selected ? 'h-[calc(100dvh-196px)] min-h-[440px]' : 'min-h-[320px]'
      }`}
    >

      {/* ============================================================
          CONVERSATION LIST
          ============================================================ */}

      <aside
        className={`${
          selected ? 'hidden md:flex' : 'flex'
        } w-full shrink-0 flex-col border-line md:w-[300px] md:border-r lg:w-[340px]`}
      >

        <div className="shrink-0 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-paper">Chats</h2>
            <span className="text-xs text-mist">
              {search.trim()
                ? `${filteredConversations.length} of ${conversations.length}`
                : `${conversations.length} conversation${
                    conversations.length === 1 ? '' : 's'
                  }`}
            </span>
          </div>

          <div className="relative mt-3">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist">
              <ChatGlyph name="search" className="h-4 w-4" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="focus-ring w-full rounded-full border !border-transparent !bg-panel-2 py-2.5 pl-9 pr-9 text-sm !text-paper placeholder:text-mist focus:!border-line"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="focus-ring absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-mist hover:bg-panel hover:text-paper"
                aria-label="Clear search"
                title="Clear"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">

          {loading && (
            <div className="px-4 py-5 text-sm text-mist">
              Loading chats…
            </div>
          )}

          {!loading && error && (
            <div className="m-2 rounded-2xl bg-urgent-tint px-4 py-3 text-sm text-urgent">
              {error}
            </div>
          )}

          {!loading &&
            !error &&
            conversations.length === 0 && (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-listening-tint text-listening">
                  <ChatGlyph name="chat" className="h-7 w-7" />
                </span>
                <div className="mt-3 text-sm font-medium text-paper">No conversations yet</div>
                <div className="mt-1 text-xs leading-5 text-mist">
                  Start one from a student's profile in the Leaderboard.
                </div>
              </div>
            )}

          {!loading &&
            !error &&
            conversations.length > 0 &&
            filteredConversations.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-mist">
                No chats match “{search.trim()}”.
              </div>
            )}

          {!loading &&
            filteredConversations.map((student) => {
              const active = selected?.id === student.id
              const label = student.full_name || student.username || 'Unknown user'

              return (
                <button
                  type="button"
                  key={student.id}
                  onClick={() => setSelected(student)}
                  aria-current={active ? 'true' : undefined}
                  className={`focus-ring flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors ${
                    active ? 'bg-brass text-onbrass' : 'hover:bg-panel-2'
                  }`}
                >
                  <ChatAvatar
                    name={label}
                    url={student.avatar_url}
                    seed={student.id}
                    size="h-11 w-11"
                  />

                  <div className="min-w-0 flex-1">

                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm font-medium ${active ? 'text-onbrass' : 'text-paper'}`}>
                        {label}
                      </span>

                      {student.lastMessage?.created_at && (
                        <span className={`shrink-0 text-[11px] ${active ? 'text-onbrass/75' : 'text-mist'}`}>
                          {formatListTime(
                            student.lastMessage.created_at
                          )}
                        </span>
                      )}
                    </div>

                    <div className={`mt-0.5 truncate text-[13px] ${active ? 'text-onbrass/75' : 'text-mist'}`}>
                      {student.lastMessage
                        ? previewText(
                            student.lastMessage.content
                          )
                        : student.username
                        ? `@${student.username}`
                        : ''}
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

      <section
        className={`${
          selected ? 'flex' : 'hidden md:flex'
        } min-w-0 flex-1 flex-col`}
      >

        {selected ? (
          <Chat
            selfId={teacherId}
            peerId={selected.id}
            peerName={selected.full_name}
            targetMessageId={initialMessageId}
            embedded
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-panel-2 px-6 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-listening-tint text-listening">
              <ChatGlyph name="chat" className="h-8 w-8" />
            </span>
            <div className="mt-4 text-base font-semibold text-paper">Pick a conversation</div>
            <p className="mt-1 max-w-xs text-sm leading-6 text-mist">
              Choose a chat on the left, or open a student's profile in the Leaderboard to start a new one.
            </p>
          </div>
        )}

      </section>

    </div>
  )
}
