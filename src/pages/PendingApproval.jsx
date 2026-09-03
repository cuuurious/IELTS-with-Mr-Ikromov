import { useAuth } from '../context/AuthContext'

export default function PendingApproval() {
  const { profile, signOut, refreshProfile } = useAuth()
  const rejected = profile?.status === 'rejected'

  return (
    <div
      className="
        min-h-screen
        flex flex-col
        items-center justify-center
        text-paper
        bg-ink
        relative
        overflow-hidden
        px-4
      "
    >

      {/* =====================================================
          DECORATIVE BACKGROUND — same glow language as the
          rest of the app (Layout.jsx), so this screen doesn't
          feel like it belongs to a different site.
          ===================================================== */}

      <div
        aria-hidden="true"
        className="
          pointer-events-none
          fixed inset-0
          overflow-hidden
          -z-0
        "
      >
        <div
          className="
            absolute
            -top-56
            right-[-10rem]
            w-[38rem]
            h-[38rem]
            rounded-full
            bg-indigo/10
            blur-3xl
          "
        />

        <div
          className="
            absolute
            bottom-[-15rem]
            left-[-12rem]
            w-[34rem]
            h-[34rem]
            rounded-full
            bg-cyan/10
            blur-3xl
          "
        />

        <div
          className="
            absolute
            top-[24rem]
            -left-[10rem]
            w-[75rem]
            h-[1px]
            bg-indigo/10
            rotate-[-17deg]
          "
        />
      </div>

      {/* =====================================================
          BRAND
          ===================================================== */}

      <div className="relative z-10 flex flex-col items-center gap-2 mb-8">
        <img
          src="/mrikromov.jpg"
          alt="IELTS with Mr Ikromov"
          className="
            w-14 h-14
            rounded-[1.1rem]
            object-cover
            object-center
            border border-panel
            shadow-[0_8px_25px_rgba(30,35,70,0.16)]
          "
        />

        <div className="text-sm font-mono uppercase tracking-[0.14em] text-mist">
          IELTS with Mr Ikromov
        </div>
      </div>

      {/* =====================================================
          CARD
          ===================================================== */}

      <div
        className="
          ticket
          relative z-10
          rounded-[1.4rem]
          p-8 sm:p-10
          max-w-md w-full
          text-center
          flex flex-col items-center gap-5
        "
      >
        <div className="relative flex items-center justify-center">
          {!rejected && (
            <span
              aria-hidden="true"
              className="
                absolute
                inset-0
                -m-2
                rounded-full
                border-2 border-brass/40
                animate-ping-slow
              "
            />
          )}

          <span
            className={`
              stamp
              relative
              w-20 h-20
              text-xs uppercase
              ${rejected ? 'border-coral text-coral' : ''}
            `}
          >
            {rejected ? 'Not approved' : 'Pending'}
          </span>
        </div>

        <div>
          <h1 className="font-display text-2xl text-paper">
            {rejected ? 'Account not approved' : 'Waiting for approval'}
          </h1>

          <p className="text-mist text-sm mt-3 leading-relaxed">
            {rejected
              ? 'Mr Ikromov did not approve this account. Contact him directly if you think this is a mistake.'
              : `Hi ${
                  profile?.full_name?.split(' ')[0] || 'there'
                }, your account is waiting for Mr Ikromov to approve it. This usually doesn't take long — this page will unlock automatically once you're approved.`}
          </p>
        </div>

        <div className="flex gap-3 mt-1">
          {!rejected && (
            <button
              onClick={refreshProfile}
              className="
                focus-ring
                px-5 py-2.5
                rounded-[0.85rem]
                bg-gradient-to-r from-brass to-lavender
                text-onbrass
                text-sm font-semibold
                shadow-[0_7px_18px_rgba(101,89,236,0.25)]
                hover:brightness-105
                transition-all
              "
            >
              Check again
            </button>
          )}

          <button
            onClick={signOut}
            className="
              focus-ring
              px-5 py-2.5
              rounded-[0.85rem]
              border border-line
              bg-panel-2
              text-sm font-medium
              text-mist
              hover:border-coral/50
              hover:text-coral
              hover:bg-coral/10
              transition-all
            "
          >
            Log out
          </button>
        </div>
      </div>

    </div>
  )
}
