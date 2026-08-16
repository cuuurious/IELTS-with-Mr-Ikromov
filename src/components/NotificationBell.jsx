import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'

export default function NotificationBell() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  const load = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)
    setItems(data || [])
  }

  useEffect(() => {
    load()
    const channel = supabase
      .channel(`notif-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${profile.id}` },
        (payload) => setItems((prev) => [payload.new, ...prev])
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  useEffect(() => {
    const onClickOutside = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const unread = items.filter((n) => !n.read).length

  const markAllRead = async () => {
    const unreadIds = items.filter((n) => !n.read).map((n) => n.id)
    if (!unreadIds.length) return
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    await supabase.from('notifications').update({ read: true }).in('id', unreadIds)
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => {
          setOpen((o) => !o)
          if (!open) markAllRead()
        }}
        className="focus-ring relative w-9 h-9 rounded-full border border-line flex items-center justify-center text-mist hover:text-brass hover:border-brass transition-colors"
        title="Notifications"
        aria-label="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-coral text-paper text-[10px] font-mono rounded-full w-4 h-4 flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto ticket rounded-lg p-2 z-50 shadow-lg">
          {items.length === 0 && (
            <p className="text-mist text-sm p-3">No notifications yet.</p>
          )}
          {items.map((n) => (
            <div key={n.id} className="px-3 py-2 border-b border-line last:border-0">
              <div className="text-sm font-medium">{n.title}</div>
              {n.body && <div className="text-mist text-xs mt-0.5">{n.body}</div>}
              <div className="text-mist text-[10px] font-mono mt-1">
                {new Date(n.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
