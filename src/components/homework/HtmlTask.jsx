import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import TaskShell, { Panel } from './TaskShell'

/*
 * One of Mr Ikromov's interactive HTML workshops set as homework
 * (2026-11-02). The file is shown inside the site in a sealed frame
 * (it can't reach the student's account). A small helper added to the
 * page picks up the score the workshop shows after "Submit" — e.g.
 * "Score: 14/18", "You got 14 out of 18" — and sends it here. A
 * workshop can also report it directly:
 *     parent.postMessage({ type: 'ielts-workshop-score', score: 14, max: 18 }, '*')
 * or call window.reportScore(14, 18). The student then presses
 * "Hand in". If no score is found, it is handed in as done.
 */

const HELPER = `<script>(function(){
try{window.localStorage.getItem('x')}catch(e){var mk=function(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,'localStorage',{value:mk()});Object.defineProperty(window,'sessionStorage',{value:mk()})}catch(_){}}
var last='';function send(s,m){s=+s;m=+m;if(!(m>0)||s<0||s>m)return;var k=s+'/'+m;if(k===last)return;last=k;parent.postMessage({type:'ielts-workshop-score',score:s,max:m},'*')}
window.reportScore=send;
function scan(){var t=(document.body&&document.body.innerText)||'';var re=/(score|result|correct|marks?|points?|you got|natija|ball|to'g'ri)[^0-9\\n]{0,30}(\\d{1,3})\\s*(?:\\/|out of|of|dan)\\s*(\\d{1,3})/ig;var m,f=null;while((m=re.exec(t)))f=m;if(f)send(f[2],f[3])}
document.addEventListener('click',function(){setTimeout(scan,500);setTimeout(scan,1500)},true);
document.addEventListener('DOMContentLoaded',function(){try{new MutationObserver(function(){clearTimeout(window.__ielts_t);window.__ielts_t=setTimeout(scan,400)}).observe(document.body,{subtree:true,childList:true,characterData:true})}catch(_){}});
})();</script>`

function withHelper(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${HELPER}`)
  return HELPER + html
}

export default function HtmlTask({ task, onClose, onChanged }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [score, setScore] = useState(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(task.html_url)
      .then((r) => {
        if (!r.ok) throw new Error('The workshop file could not be opened.')
        return r.text()
      })
      .then((text) => !cancelled && setHtml(withHelper(text)))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [task.html_url])

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data
      if (d && d.type === 'ielts-workshop-score' && Number(d.max) > 0) setScore({ score: Number(d.score), max: Number(d.max) })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const handIn = async () => {
    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('submit_homework_score', {
      p_task_id: task.id,
      p_score: score ? score.score : null,
      p_max: score ? score.max : null,
      p_details: null,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setDone(row || { attempt_no: 1 })
    onChanged?.()
  }

  const srcDoc = useMemo(() => html, [html])

  return (
    <TaskShell kind="html" title={task.title || 'Workshop'} subtitle="Do the workshop, check your answers, then hand it in" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <Panel className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className={`grid h-12 min-w-[64px] place-items-center rounded-2xl px-3 font-brand text-[18px] font-semibold ${score ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
              {score ? `${score.score}/${score.max}` : '—'}
            </span>
            <p className="text-sm font-bold text-paper-dim">
              {done
                ? done.attempt_no === 1
                  ? 'Handed in. Your first try counts.'
                  : 'Handed in as a retake. Your first try still counts.'
                : score
                  ? 'Score found. Hand it in when you are happy.'
                  : 'Press the workshop’s own Submit or Check button — your score appears here.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handIn}
            disabled={saving || !html}
            className="focus-ring h-11 shrink-0 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50"
          >
            {saving ? 'Handing in…' : done ? 'Hand in again' : 'Hand in'}
          </button>
        </Panel>
        {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
        <div className="overflow-hidden rounded-[20px] border border-line bg-white">
          {html ? (
            <iframe
              title={task.title || 'Workshop'}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              className="block h-[78vh] w-full"
            />
          ) : (
            !error && <p className="p-6 text-sm font-semibold text-mist">Opening the workshop…</p>
          )}
        </div>
      </div>
    </TaskShell>
  )
}
