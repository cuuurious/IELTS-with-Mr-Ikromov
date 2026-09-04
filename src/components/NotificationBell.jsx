import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function NotificationBell({ profile }) {
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)

  /*
   * ============================================================
   * LOAD NOTIFICATIONS
   * ============================================================
   */

  const load = async () => {
    if (!profile?.id) return

    setLoading(true)

    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('read', false)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      console.error(
        'Failed to load notifications:',
        error
      )
    } else {
      setItems(data || [])
    }

    setLoading(false)
  }

  /*
   * ============================================================
   * INITIAL LOAD + REALTIME
   * ============================================================
   */

  useEffect(() => {
    if (!profile?.id) return

    load()

    const channel = supabase
      .channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          if (!payload?.new) return

          /*
           * Only unread notifications belong
           * in the notification drawer.
           */
          if (payload.new.read) return

          setItems((previous) => {
            /*
             * Prevent duplicate realtime rows.
             */
            if (
              previous.some(
                (item) =>
                  item.id === payload.new.id
              )
            ) {
              return previous
            }

            return [
              payload.new,
              ...previous,
            ].slice(0, 30)
          })
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(
            'Notification realtime connected'
          )
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  /*
   * ============================================================
   * MARK READ FROM ELSEWHERE IN THE APP
   * ============================================================
   *
   * Clicking a notification right here already marks it read. But a
   * student (or teacher) can just as easily reach the same homework
   * by scrolling their homework list instead of going through this
   * dropdown — that used to leave the notification stuck as unread
   * forever, since nothing else in the app ever touched the `read`
   * column. Any component can now dispatch this event with the same
   * `link` a notification carries (e.g. `homework:<id>`) when the
   * thing that notification points at gets opened, and every
   * matching unread notification clears here too.
   */

  useEffect(() => {
    if (!profile?.id) return

    const handleExternalRead = async (event) => {
      const link = event.detail?.link
      if (!link) return

      setItems((previous) =>
        previous.filter(
          (item) => item.link !== link
        )
      )

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', profile.id)
        .eq('link', link)
        .eq('read', false)

      if (error) {
        console.error(
          'Failed to mark notification read:',
          error
        )

        // Reload so a notification that didn't actually get marked
        // read in the database doesn't stay wrongly cleared here.
        await load()
      }
    }

    window.addEventListener(
      'notification-mark-read',
      handleExternalRead
    )

    return () => {
      window.removeEventListener(
        'notification-mark-read',
        handleExternalRead
      )
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  /*
   * ============================================================
   * CLOSE WHEN CLICKING OUTSIDE
   * ============================================================
   */

  useEffect(() => {
    const onClickOutside = (event) => {
      if (
        boxRef.current &&
        !boxRef.current.contains(event.target)
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

  /*
   * ============================================================
   * UNREAD COUNT
   * ============================================================
   */

  const unread = items.length

  /*
   * ============================================================
   * OPEN NOTIFICATION
   * ============================================================
   */

  const openNotification = async (notification) => {
    if (!notification?.id) return

    /*
     * Remove it immediately from the UI.
     *
     * This means the notification disappears as soon
     * as the student/teacher opens it.
     */
    setItems((previous) =>
      previous.filter(
        (item) =>
          item.id !== notification.id
      )
    )

    /*
     * Mark it read in Supabase.
     */
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notification.id)
      .eq('user_id', profile.id)

    if (error) {
      console.error(
        'Failed to mark notification read:',
        error
      )

      /*
       * If the database update failed, reload
       * so the notification doesn't disappear
       * permanently from the UI.
       */
      await load()
      return
    }

    /*
     * Close dropdown.
     */
    setOpen(false)

    /*
     * Navigate inside the application.
     */
    window.dispatchEvent(
      new CustomEvent(
        'notification-navigate',
        {
          detail: {
            notification,
            link:
              notification.link || null,
            type:
              notification.type || null,
          },
        }
      )
    )
  }

  /*
   * ============================================================
   * CLEAR ALL
   * ============================================================
   */

  const clearAll = async () => {
    if (!profile?.id || !items.length) {
      return
    }

    const ids = items.map(
      (notification) =>
        notification.id
    )

    /*
     * Optimistic UI.
     */
    setItems([])
    setOpen(false)

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', profile.id)
      .in('id', ids)

    if (error) {
      console.error(
        'Failed to clear notifications:',
        error
      )

      await load()
    }
  }

  return (
    <div
      ref={boxRef}
      className="relative"
    >

      {/* ======================================================
          BELL
          ====================================================== */}

      <button
        type="button"
        onClick={() =>
          setOpen((previous) => !previous)
        }
        className="
          focus-ring
          relative
          w-10
          h-10
          rounded-full
          border
          border-line
          bg-panel
          flex
          items-center
          justify-center
          text-mist
          hover:text-indigo
          hover:border-indigo
          transition-all
          duration-200
        "
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
      >

        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>

        {unread > 0 && (
          <span
            className="
              absolute
              -top-1
              -right-1
              min-w-[18px]
              h-[18px]
              px-1
              rounded-full
              bg-coral
              text-white
              text-[9px]
              font-bold
              font-mono
              flex
              items-center
              justify-center
              border-2
              border-ink
            "
          >
            {unread > 99
              ? '99+'
              : unread}
          </span>
        )}

      </button>


      {/* ======================================================
          DROPDOWN
          ====================================================== */}

      {open && (
        <div
          className="
            absolute
            right-0
            top-[calc(100%+10px)]
            w-[360px]
            max-w-[calc(100vw-24px)]
            overflow-hidden
            rounded-2xl
            border
            border-line
            bg-panel
            shadow-[0_20px_60px_rgba(20,30,50,.18)]
            z-[100]
          "
        >

          {/* HEADER */}

          <div
            className="
              flex
              items-center
              justify-between
              gap-3
              px-4
              py-3
              border-b
              border-line
              bg-panel-2
            "
          >

            <div>
              <div className="font-semibold text-paper">
                Notifications
              </div>

              <div className="text-xs text-mist mt-0.5">
                {loading
                  ? 'Loading…'
                  : unread > 0
                    ? `${unread} unread`
                    : "You're all caught up"}
              </div>
            </div>

            {unread > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="
                  text-xs
                  font-medium
                  text-mist
                  hover:text-indigo
                  transition-colors
                "
              >
                Clear all
              </button>
            )}

          </div>


          {/* CONTENT */}

          <div className="max-h-[430px] overflow-y-auto">

            {loading && items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-mist">
                Loading notifications…
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="px-5 py-10 text-center">

                <div
                  className="
                    mx-auto
                    mb-3
                    w-11
                    h-11
                    rounded-full
                    bg-indigo/10
                    border
                    border-indigo/20
                    flex
                    items-center
                    justify-center
                    text-indigo
                  "
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 01-3.46 0" />
                  </svg>
                </div>

                <div className="text-sm font-medium text-paper">
                  No new notifications
                </div>

                <div className="text-xs text-mist mt-1">
                  New messages and updates will appear here.
                </div>

              </div>
            )}

            {items.map((notification) => (
              <button
                type="button"
                key={notification.id}
                onClick={() =>
                  openNotification(
                    notification
                  )
                }
                className="
                  w-full
                  text-left
                  px-4
                  py-3.5
                  border-b
                  border-line
                  last:border-b-0
                  bg-panel
                  hover:bg-panel-2
                  transition-colors
                "
              >

                <div className="flex gap-3">

                  <div
                    className="
                      mt-1
                      w-2
                      h-2
                      rounded-full
                      bg-coral
                      shrink-0
                    "
                  />

                  <div className="min-w-0 flex-1">

                    <div className="text-sm font-semibold text-paper">
                      {notification.title}
                    </div>

                    {notification.body && (
                      <div className="text-xs text-mist mt-1 line-clamp-2">
                        {notification.body}
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-mist mt-2">
                      {new Date(
                        notification.created_at
                      ).toLocaleString(
                        [],
                        {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }
                      )}
                    </div>

                  </div>

                  <div className="text-mist shrink-0 mt-1">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>

                </div>

              </button>
            ))}

          </div>

        </div>
      )}

    </div>
  )
}