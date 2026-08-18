import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function NotificationBell({ profile }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const load = async () => {
    if (!profile?.id) return

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (!error) {
      setItems(data || [])
    } else {
      console.error('Failed to load notifications:', error)
    }
  }

  useEffect(() => {
    if (!profile?.id) return

    load()

    const channel = supabase
      .channel(`notif-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          setItems((prev) => [payload.new, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (
        boxRef.current &&
        !boxRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener(
      'mousedown',
      onClickOutside
    )

    return () => {
      document.removeEventListener(
        'mousedown',
        onClickOutside
      )
    }
  }, [])

  const unread = items.filter(
    (n) => !n.read
  ).length

  const markRead = async (notification) => {
    if (notification.read) return

    setItems((prev) =>
      prev.map((n) =>
        n.id === notification.id
          ? { ...n, read: true }
          : n
      )
    )

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification.id)

    if (error) {
      console.error(
        'Failed to mark notification read:',
        error
      )
    }
  }

  const openNotification = async (notification) => {
    console.log(
      'Opening notification:',
      notification
    )

    await markRead(notification)

    setOpen(false)

    /*
     * Send the notification to the dashboard.
     *
     * Example:
     *
     * private-chat:
     * STUDENT_ID:
     * MESSAGE_ID
     */
    window.dispatchEvent(
      new CustomEvent(
        'notification-navigate',
        {
          detail: {
            notification,
            link: notification.link || null,
            type: notification.type || null,
          },
        }
      )
    )
  }

  return (
    <div
      className="relative"
      ref={boxRef}
    >

      <button
        type="button"
        onClick={() =>
          setOpen((value) => !value)
        }
        className="focus-ring relative w-9 h-9 rounded-full border border-line flex items-center justify-center text-mist hover:text-brass hover:border-brass transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >

        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>

        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-coral text-paper text-[10px] font-mono rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9
              ? '9+'
              : unread}
          </span>
        )}

      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto ticket rounded-lg p-2 z-50 shadow-lg">

          {items.length === 0 && (
            <p className="text-mist text-sm p-3">
              No notifications yet.
            </p>
          )}

          {items.map((n) => (
            <button
              type="button"
              key={n.id}
              onClick={() =>
                openNotification(n)
              }
              className={`w-full text-left px-3 py-3 border-b border-line last:border-0 transition-colors rounded-md ${
                n.read
                  ? 'opacity-70 hover:bg-panel-2'
                  : 'bg-panel-2 hover:bg-panel'
              }`}
            >

              <div className="flex items-start gap-2">

                <div className="flex-1 min-w-0">

                  <div className="text-sm font-medium text-paper">
                    {n.title}
                  </div>

                  {n.body && (
                    <div className="text-mist text-xs mt-0.5 line-clamp-2">
                      {n.body}
                    </div>
                  )}

                  <div className="text-mist text-[10px] font-mono mt-1">
                    {new Date(
                      n.created_at
                    ).toLocaleString(
                      [],
                      {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }
                    )}
                  </div>

                </div>

                {!n.read && (
                  <span className="mt-1 w-2 h-2 rounded-full bg-coral flex-shrink-0" />
                )}

              </div>

            </button>
          ))}

        </div>
      )}

    </div>
  )
}