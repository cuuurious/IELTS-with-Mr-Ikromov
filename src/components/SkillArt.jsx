/*
 * Small flat illustrations that show what a piece of work IS before
 * a student reads a word (Study room design, 2026-10-05): an essay
 * sheet for Writing, a line graph for Task 1, a voice wave for
 * Speaking, a page with a heading number for Reading, headphones and
 * a sound wave for Listening, and flashcards for word lists.
 *
 * Colours come from the skill tokens in index.css through inline
 * `style` (CSS variables don't resolve inside SVG presentation
 * attributes), so every drawing follows light/dark mode on its own.
 */

const v = (name) => `var(--color-${name})`
const fill = (name, opacity = 1) => ({ fill: v(name), fillOpacity: opacity })
const stroke = (name, width = 3, opacity = 1) => ({
  stroke: v(name),
  strokeWidth: width,
  strokeOpacity: opacity,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
})

function EssayArt({ words = 250, className }) {
  return (
    <svg viewBox="0 0 300 220" className={className} aria-hidden="true">
      <rect x="64" y="20" width="168" height="190" rx="12" style={fill('panel')} transform="rotate(-4 148 115)" />
      <rect x="72" y="14" width="168" height="190" rx="12" style={{ ...fill('panel'), stroke: v('writing'), strokeOpacity: 0.35, strokeWidth: 2 }} />
      <rect x="92" y="36" width="88" height="10" rx="5" style={fill('writing')} />
      {[62, 76, 90, 104, 128, 142, 156, 170].map((y, i) => (
        <rect key={y} x="92" y={y} width={i % 4 === 3 ? 70 : 128 - (i % 2) * 8} height="6" rx="3" style={fill('writing', 0.25)} />
      ))}
      <g transform="rotate(38 236 160)">
        <rect x="228" y="88" width="16" height="96" rx="4" style={fill('paper')} />
        <path d="M228 184h16l-8 16z" style={fill('writing', 0.6)} />
        <rect x="228" y="98" width="16" height="9" style={fill('writing')} />
      </g>
      <rect x="18" y="150" width="96" height="46" rx="12" style={fill('paper')} />
      <text x="66" y="172" textAnchor="middle" style={{ fill: v('panel'), font: '600 16px var(--font-body)' }}>0 / {words}</text>
      <text x="66" y="187" textAnchor="middle" style={{ fill: v('panel'), fillOpacity: 0.75, font: '400 10px var(--font-body)' }}>words</text>
    </svg>
  )
}

function ChartArt({ className }) {
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <rect x="26" y="8" width="168" height="82" rx="8" style={fill('panel')} />
      <path d="M44 20v58h138" style={stroke('writing', 2, 0.3)} />
      <path d="M48 64l26-10 24 4 26-18 26 2 26-16" style={stroke('writing', 3)} />
      <path d="M48 70l26-4 24-8 26 0 26-8 26-4" style={stroke('writing', 3, 0.4)} />
    </svg>
  )
}

function SpeakingArt({ className }) {
  const bars = [16, 40, 56, 32, 48, 24, 36, 16, 44, 20, 10]
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <circle cx="34" cy="48" r="26" style={fill('panel')} />
      <rect x="27" y="30" width="14" height="24" rx="7" style={fill('speaking')} />
      <path d="M22 48a12 12 0 0 0 24 0 M34 60v6" style={stroke('speaking', 3)} />
      {bars.map((h, i) => (
        <rect key={i} x={74 + i * 12} y={48 - h / 2} width="6" height={h} rx="3" style={fill('speaking', i === 2 || i === 4 ? 1 : 0.4)} />
      ))}
    </svg>
  )
}

function ReadingArt({ className }) {
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <rect x="34" y="10" width="152" height="80" rx="8" style={fill('panel')} />
      <rect x="48" y="22" width="20" height="14" rx="3" style={fill('reading')} />
      <text x="58" y="33" textAnchor="middle" style={{ fill: v('panel'), font: '600 10px var(--font-body)' }}>iv</text>
      <rect x="76" y="26" width="94" height="6" rx="3" style={fill('reading', 0.45)} />
      {[46, 57, 68, 79].map((y, i) => (
        <rect key={y} x="48" y={y} width={i === 3 ? 70 : 122 - (i % 2) * 8} height="5" rx="2.5" style={fill('reading', 0.2)} />
      ))}
    </svg>
  )
}

function ListeningArt({ className }) {
  const bars = [10, 22, 34, 18, 40, 28, 14, 30, 20, 12]
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <circle cx="40" cy="48" r="28" style={fill('panel')} />
      <path d="M26 54v-6a14 14 0 0 1 28 0v6" style={stroke('listening', 3.5)} />
      <rect x="22" y="50" width="8" height="14" rx="3" style={fill('listening')} />
      <rect x="50" y="50" width="8" height="14" rx="3" style={fill('listening')} />
      {bars.map((h, i) => (
        <rect key={i} x={84 + i * 12} y={48 - h / 2} width="6" height={h} rx="3" style={fill('listening', i % 3 === 1 ? 1 : 0.4)} />
      ))}
    </svg>
  )
}

function VocabArt({ front = 'emissions', back = '', className }) {
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <rect x="18" y="26" width="104" height="56" rx="10" style={fill('panel')} transform="rotate(-6 70 54)" />
      <rect x="96" y="14" width="108" height="58" rx="10" style={{ ...fill('panel'), stroke: v('vocab'), strokeOpacity: 0.45, strokeWidth: 2 }} />
      <text x="150" y={back ? 40 : 48} textAnchor="middle" style={{ fill: v('vocab'), font: '600 13px var(--font-body)' }}>{front}</text>
      {back && (
        <text x="150" y="58" textAnchor="middle" style={{ fill: v('vocab'), fillOpacity: 0.8, font: '400 10px var(--font-body)' }}>{back}</text>
      )}
    </svg>
  )
}

function GeneralArt({ className }) {
  return (
    <svg viewBox="0 0 220 96" className={className} aria-hidden="true">
      <rect x="70" y="10" width="80" height="78" rx="9" style={fill('panel')} />
      <path d="M86 32l6 6 12-12" style={stroke('paper', 3)} />
      <rect x="112" y="30" width="26" height="5" rx="2.5" style={fill('paper', 0.3)} />
      <path d="M86 56l6 6 12-12" style={stroke('paper', 3, 0.5)} />
      <rect x="112" y="54" width="26" height="5" rx="2.5" style={fill('paper', 0.2)} />
    </svg>
  )
}

/*
 * One entry point: pick the drawing for a skill. Writing tasks whose
 * title mentions a graph/chart/diagram/table get the line graph.
 */
export default function SkillArt({ skill, title = '', className = 'w-full h-full' }) {
  switch (skill) {
    case 'writing':
      return /graph|chart|diagram|table|map|process|task ?1/i.test(title) ? (
        <ChartArt className={className} />
      ) : (
        <EssayArt className={className} />
      )
    case 'speaking':
      return <SpeakingArt className={className} />
    case 'reading':
      return <ReadingArt className={className} />
    case 'listening':
      return <ListeningArt className={className} />
    case 'vocab':
      return <VocabArt className={className} />
    default:
      return <GeneralArt className={className} />
  }
}

export { EssayArt, ChartArt, SpeakingArt, ReadingArt, ListeningArt, VocabArt }

/* Small skill icons for tiles, chips and lists (24px line icons). */
const ICON_PATHS = {
  listening: 'M4 14v-2a8 8 0 0 1 16 0v2 M4 14h3v6H4z M17 14h3v6h-3z',
  reading: 'M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4z M20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z',
  writing: 'M4 20h4L19 9l-4-4L4 16z',
  speaking: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4',
  vocab: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  general: 'M5 4h14v16H5z M9 8h6 M9 12h6 M9 16h4',
}

export function SkillIcon({ skill, className = 'h-5 w-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[skill] || ICON_PATHS.general} />
    </svg>
  )
}
