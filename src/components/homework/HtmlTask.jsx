import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { markWriting, writingContext } from '../../lib/writingAi'
import PageFrame from './PageFrame'
import { fetchPage } from '../../lib/fetchPage'
import WritingFeedback from './WritingFeedback'
import { needsWorkshop, openWorkshop, saveWorkshopWords, useWorkshopGate } from '../../lib/workshopGate'

/*
 * One of Mr Ikromov's interactive HTML workshops set as homework
 * (2026-11-02). The file is shown inside the site in a sealed frame
 * (it can't reach the student's account). A small helper added to the
 * page picks up the score the workshop shows after "Submit" — e.g.
 * "Score: 14/18", "You got 14 out of 18" — and sends it here. A
 * workshop can also report it directly:
 *     parent.postMessage({ type: 'ielts-workshop-score', score: 14, max: 18 }, '*')
 * or call window.reportScore(14, 18). Pages with a #scoreBig box
 * (the thematic Reading book, 2026-11-05) are read from that box only,
 * so the workshop games' own scores never count. The student then presses
 * "Hand in". If no score is found, it is handed in as done.
 */

export const HELPER = `<script>(function(){
try{window.localStorage.getItem('x')}catch(e){var mk=function(){var d={};return{getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,'localStorage',{value:mk()});Object.defineProperty(window,'sessionStorage',{value:mk()})}catch(_){}}
function qsNow(){var out=[];try{document.querySelectorAll('#answerReviewList .answer-item').forEach(function(el){var b=el.querySelector('b');var n=parseInt(((b&&b.textContent)||'').replace(/[^0-9]/g,''),10);if(n)out.push({n:n,ok:!el.classList.contains('wrong')})});if(!out.length&&Array.isArray(window._det))window._det.forEach(function(d){if(d&&d[3]!==null&&d[3]!==undefined)out.push({n:+d[0],ok:!!d[3]})})}catch(_){}return out.slice(0,80)}
var last='';function post(s,m,parts){s=+s;m=+m;if(!(m>0)||s<0||s>m)return;var qs=qsNow();var k=s+'/'+m+'|'+JSON.stringify(parts||[])+'|'+qs.length;if(k===last)return;last=k;parent.postMessage({type:'ielts-workshop-score',score:s,max:m,parts:parts||[],qs:qs},'*')}
window.reportScore=function(s,m){post(s,m,[])};
function t1(){return document.getElementById('answer')&&document.getElementById('scoreTot')&&document.getElementById('results')}function t1Res(){var r=t1();return r&&getComputedStyle(r).display!=='none'}var t1Last='';function scan(){if(document.getElementById('essay')&&document.getElementById('workshopView'))return;if(t1()){if(t1Res()){var g=parseInt(document.getElementById('scoreNum').textContent,10),tt=parseInt(document.getElementById('scoreTot').textContent,10);if(tt>0&&g+'/'+tt!==t1Last){t1Last=g+'/'+tt;parent.postMessage({type:'ielts-writing-check',got:g,tot:tt},'*')}}return}var sb=document.getElementById('scoreBig');if(sb){if(sb.offsetParent!==null){var tm=((sb.parentElement&&sb.parentElement.innerText)||'').match(/out\\s+of\\s+(\\d{1,3})/i);if(tm)post(parseInt(sb.textContent,10),+tm[1],[])}return}
var t=(document.body&&document.body.innerText)||'';var found=[];var m;
var re=/(score|result|correct|marks?|points?|you got|natija|ball|to'g'ri)[^0-9]{0,30}?(\\d{1,3})\\s*(?:\\/|out of|of|dan)\\s*(\\d{1,3})/ig;
while((m=re.exec(t)))found.push({s:+m[2],m:+m[3],at:m.index,label:t.slice(Math.max(0,m.index-30),m.index+m[0].length).replace(/\\s+/g,' ').trim()});
var re2=/(\\d{1,3})\\s*(?:\\/|out of|of)\\s*(\\d{1,3})\\s*(?:correct|right|points?|marks?)/ig;
while((m=re2.exec(t)))found.push({s:+m[1],m:+m[2],at:m.index,label:t.slice(Math.max(0,m.index-30),m.index+m[0].length).replace(/\\s+/g,' ').trim()});
var re3=/(\\d{1,3})\\s+out\\s+of\\s+(\\d{1,3})(?!\\s*(?:words|cards|pairs|questions answered))/ig;
while((m=re3.exec(t)))found.push({s:+m[1],m:+m[2],at:m.index,label:t.slice(Math.max(0,m.index-30),m.index+m[0].length).replace(/\\s+/g,' ').trim()});
found=found.filter(function(f){return f.m>0&&f.s>=0&&f.s<=f.m&&f.m<=200&&!/words|cards?\\b|pairs|card \\d/i.test(f.label)});if(!found.length)return;
var best=found[0];found.forEach(function(f){if(f.m>best.m||(f.m===best.m&&f.at>best.at))best=f});
var seen={};var parts=found.filter(function(f){var k=f.label;if(seen[k])return false;seen[k]=1;return true}).slice(0,8).map(function(f){return{score:f.s,max:f.m,label:f.label.slice(0,80)}});
post(best.s,best.m,parts)}
var tt;function texts(){clearTimeout(tt);tt=setTimeout(function(){var out=[];document.querySelectorAll('textarea,[contenteditable="true"]').forEach(function(el,i){var v=el.tagName==='TEXTAREA'?el.value:el.innerText;if(v&&v.trim().length>20)out.push({id:el.id||('box'+(i+1)),text:v.slice(0,20000)})});if(out.length)parent.postMessage({type:'ielts-workshop-text',texts:out},'*')},600)}
function ovOpen(){var cf=document.getElementById('confirm');if(t1()&&cf&&cf.classList.contains('show'))return true;if(t1Res())return true;var wv=document.getElementById('workshopView');if(wv&&!wv.classList.contains('hidden')&&document.getElementById('essay'))return true;var o=document.getElementById('ws-overlay');if(o&&getComputedStyle(o).display!=='none')return true;var ms=document.querySelectorAll('.modal-overlay');for(var i=0;i<ms.length;i++){if(getComputedStyle(ms[i]).display!=='none')return true}return false}
var mk=[];function marks(){if(!mk.length)return;if(!document.getElementById('ielts-mk-st')){var st=document.createElement('style');st.id='ielts-mk-st';st.textContent='.ielts-mk{box-shadow:0 0 0 3px #dc2626!important;border-radius:6px}'+mk.map(function(n){return '[data-q="'+n+'"]'}).join(',')+'{box-shadow:0 0 0 3px #dc2626!important;border-radius:6px}';document.head.appendChild(st)}document.querySelectorAll('.q-num,.footer__navbtn,.navbtn,.nb').forEach(function(el){var n=parseInt((el.textContent||'').replace(/[^0-9]/g,''),10);if(n&&mk.indexOf(n)>=0)el.classList.add('ielts-mk')})}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-mark-questions'&&Array.isArray(e.data.nums)){mk=e.data.nums.map(Number).filter(function(n){return n>0&&n<200});var o=document.getElementById('ielts-mk-st');if(o)o.remove();marks()}});
var wsLast='';function wsProg(){if(!document.getElementById('ws-overlay'))return;var bs=document.querySelectorAll('#ws-tabs .ws-tab');var d=[];bs.forEach(function(b){if(b.querySelector('.ws-done'))d.push((b.textContent||'').replace(/\u2713/g,'').trim())});var k=bs.length+'|'+d.join(',');if(k===wsLast)return;wsLast=k;parent.postMessage({type:'ielts-workshop-progress',total:bs.length||0,done:d},'*')}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-open-workshop'&&window.openWorkshop){try{window.openWorkshop()}catch(_){}}});
var ovLast=null;function ovTell(){var v=ovOpen();if(v!==ovLast){ovLast=v;parent.postMessage({type:'ielts-overlay',open:v},'*')}}
window.addEventListener('message',function(e){if(!e.data||e.data.type!=='ielts-close-overlay')return;if(t1()){var cf=document.getElementById('confirm');if(cf&&cf.classList.contains('show'))cf.classList.remove('show');else if(t1Res()&&window.backToEdit)window.backToEdit();setTimeout(ovTell,50);return}var hb=document.getElementById('hdrBack');var wv=document.getElementById('workshopView');if(hb&&wv&&!wv.classList.contains('hidden')){hb.click();setTimeout(ovTell,50);return}var x=document.getElementById('ws-x');var o=document.getElementById('ws-overlay');if(o&&getComputedStyle(o).display!=='none'){if(x)x.click();else o.style.display='none'}else{var ms=document.querySelectorAll('.modal-overlay');for(var i=0;i<ms.length;i++){if(getComputedStyle(ms[i]).display!=='none'){var c=ms[i].querySelector('.modal-close-btn');if(c)c.click();else ms[i].style.display='none'}}}setTimeout(ovTell,50)});
function fitTables(){if(!(window.innerWidth<760))return;document.querySelectorAll('table').forEach(function(t){if(t.getAttribute('data-ielts-fit'))return;var p=t.parentElement;if(!p)return;if(t.scrollWidth<=p.clientWidth+2)return;t.setAttribute('data-ielts-fit','1');var w=document.createElement('div');w.className='ielts-swipe';w.style.cssText='overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;margin:0 0 .5rem';var h=document.createElement('div');h.textContent='Swipe the table sideways \u2192';h.style.cssText='font-size:11px;font-weight:700;color:#92400e;margin:2px 0 4px';p.insertBefore(h,t);p.insertBefore(w,t);w.appendChild(t);var cols=0;t.querySelectorAll('tr').forEach(function(r){cols=Math.max(cols,r.children.length)});t.style.width='auto';t.style.minWidth=Math.min(Math.max(cols,2)*150,900)+'px';t.style.fontSize='.86rem';t.querySelectorAll('th,td').forEach(function(c){c.style.padding='.35rem .45rem'})})}
function writingPhone(){if(!(window.innerWidth<480)||!(document.getElementById('essay')||t1())||!document.querySelector('.header .brand'))return;var st=document.createElement('style');st.textContent='.header .brand{display:none}.header{padding:0 12px}';document.head.appendChild(st)}
function t1Tabs(){var pc=document.querySelector('.panels-container');if(!t1()||!pc||document.getElementById('ielts-mtabs'))return;var st=document.createElement('style');st.textContent='body.ielts-t1 .left-panel{border:0!important}body.ielts-t1.ielts-w .left-panel{display:none!important}body.ielts-t1:not(.ielts-w) .right-panel{display:none!important}#ielts-mtabs{display:flex;gap:6px;padding:8px 20px;position:sticky;top:60px;z-index:5;background:#fff;border-bottom:1px solid #e5e7eb}#ielts-mtabs button{flex:1;height:40px;border-radius:10px;border:1.5px solid #d97706;background:#fff;color:#92400e;font-weight:800;font-size:.95rem}#ielts-mtabs button.on{background:#d97706;color:#fff}';document.head.appendChild(st);document.body.classList.add('ielts-t1');var bar=document.createElement('div');bar.id='ielts-mtabs';var a=document.createElement('button');a.type='button';a.textContent='Graphic';var b=document.createElement('button');b.type='button';b.textContent='Write';bar.appendChild(a);bar.appendChild(b);pc.parentNode.insertBefore(bar,pc);var tp=document.querySelector('.task-prompt strong');if(tp)tp.textContent='Study the task below, then press Write to write your report.';function show(w){document.body.classList.toggle('ielts-w',w);a.className=w?'':'on';b.className=w?'on':''}a.onclick=function(){show(false)};b.onclick=function(){show(true);setTimeout(function(){var t=document.getElementById('answer');if(t)t.focus()},50)};show(false)}
function mobile(){try{writingPhone()}catch(_){}if(!(window.innerWidth<760))return;try{t1Tabs()}catch(_){};var tc=document.querySelector('.test-container')||(document.querySelector('.part .passage-container')&&document.querySelector('.main'));if(!tc||!document.querySelector('.passage-container')||!document.querySelector('.questions-container')||document.getElementById('ielts-mtabs'))return;
var st=document.createElement('style');st.textContent='body.ielts-m{height:100vh;height:100dvh}body.ielts-m .header{padding:.4rem .75rem}body.ielts-m .header__candidate{display:none}body.ielts-m .header__timer{padding:.2rem .7rem;font-size:.95rem}body.ielts-m .test-container{flex-direction:column;height:auto!important;flex:1;min-height:0}body.ielts-m .divider{display:none!important}body.ielts-m .passage-container,body.ielts-m .questions-container{flex:1 1 auto!important;width:100%!important;max-width:none!important;min-height:0}body.ielts-m.ielts-q .passage-container{display:none!important}body.ielts-m:not(.ielts-q) .questions-container{display:none!important}body.ielts-m .footer{flex-wrap:wrap;gap:.4rem;padding:.45rem .6rem}body.ielts-m .footer__navwrap{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px}body.ielts-m .footer__navbtn{flex:0 0 auto}body.ielts-m .part.active{flex-direction:column}body.ielts-m .navbar{display:flex!important;overflow-x:auto;gap:.4rem;padding:.4rem .6rem}body.ielts-m .navbar>*{flex:0 0 auto;min-width:150px}body.ielts-m .navpart{flex-wrap:nowrap;flex:0 0 auto}body.ielts-m .navbtn{flex:0 0 auto}body.ielts-m .header__right{gap:.4rem}#ielts-mtabs{display:flex;gap:6px;padding:6px 8px;background:#fff;border-bottom:1px solid #e5e7eb;flex-shrink:0}#ielts-mtabs button{flex:1;height:38px;border-radius:10px;border:1.5px solid #d97706;background:#fff;color:#92400e;font-weight:800;font-size:.95rem}#ielts-mtabs button.on{background:#d97706;color:#fff}body.ielts-m.inws #ielts-mtabs,body.ielts-m.inws #mainTabs{display:none!important}body.ielts-m.inws .ws-overlay.open{overflow-y:auto!important;-webkit-overflow-scrolling:touch}body.ielts-m.inws .ws-overlay.open .ws-top{flex-shrink:0}body.ielts-m.inws .ws-overlay.open .ws-body{flex:none!important;overflow:visible!important;min-height:0}';
document.head.appendChild(st);document.body.classList.add('ielts-m');var bar=document.createElement('div');bar.id='ielts-mtabs';var a=document.createElement('button');a.type='button';a.textContent='Passage';var b=document.createElement('button');b.type='button';b.textContent='Questions';bar.appendChild(a);bar.appendChild(b);tc.parentNode.insertBefore(bar,tc);
function show(q){document.body.classList.toggle('ielts-q',q);a.className=q?'':'on';b.className=q?'on':'';setTimeout(function(){try{fitTables()}catch(_){}},30)}a.onclick=function(){show(false)};b.onclick=function(){show(true)};show(false);
var siv=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(){try{if(this.closest&&this.closest('.passage-container')&&document.body.classList.contains('ielts-q'))show(false)}catch(_){}return siv.apply(this,arguments)};
document.addEventListener('click',function(e){var t=e.target;if(t&&t.closest&&(t.closest('.footer__navbtn')||t.closest('.footer .navbtn')))show(true)},true)}
document.addEventListener('input',texts,true);
document.addEventListener('click',function(){setTimeout(scan,500);setTimeout(scan,1500);texts();setTimeout(ovTell,80);setTimeout(wsProg,120)},true);
document.addEventListener('DOMContentLoaded',function(){try{parent.postMessage({type:'ielts-ready'},'*')}catch(_){}try{mobile()}catch(_){}try{fitTables()}catch(_){}try{new MutationObserver(function(){clearTimeout(window.__ielts_t);window.__ielts_t=setTimeout(function(){scan();try{fitTables()}catch(_){}try{wsProg()}catch(_){}try{marks()}catch(_){}},400)}).observe(document.body,{subtree:true,childList:true,characterData:true})}catch(_){}});
document.addEventListener('drop',function(e){var el=e.target;if(!el||el.tagName!=='INPUT'||!el.classList.contains('gap'))return;var d='';try{d=e.dataTransfer.getData('text/plain')||''}catch(_){}var p=d.split('|');if(p.length!==2||p[0].charAt(0)!=='g'||!p[1])return;e.preventDefault();e.stopPropagation();el.value=p[1];el.dispatchEvent(new Event('input',{bubbles:true}));try{el.focus()}catch(_){}},true);
var chipSel=null;document.addEventListener('click',function(e){var t=e.target;var c=t&&t.closest&&t.closest('.chip');if(c&&c.dataset&&c.dataset.id){chipSel=c.dataset.id;return}if(chipSel&&t&&t.tagName==='INPUT'&&t.classList.contains('gap')&&!t.value){t.value=chipSel;t.dispatchEvent(new Event('input',{bubbles:true}))}chipSel=null},true);
document.addEventListener('error',function(e){var a=e.target;if(!a||a.tagName!=='AUDIO')return;var n=+(a.getAttribute('data-ielts-retry')||0);var src=a.currentSrc||a.src;if(n>=3||!src)return;a.setAttribute('data-ielts-retry',String(n+1));setTimeout(function(){a.src=src.split('?')[0]+'?r='+(n+1);a.addEventListener('loadedmetadata',function(){var st=document.getElementById('audiostat');if(st&&/No audio/.test(st.textContent)){st.textContent='Audio ready';var sb=document.getElementById('start');if(sb&&a.paused&&!a.currentTime)sb.style.display=''}},{once:true});a.load()},1500*(n+1))},true);
})();</script>`

// Which questions were right / wrong, as the page reported them (2026-11-05).
export function cleanQs(qs) {
  return Array.isArray(qs)
    ? qs
        .slice(0, 80)
        .map((q) => ({ n: Number(q?.n), ok: Boolean(q?.ok) }))
        .filter((q) => Number.isInteger(q.n) && q.n > 0 && q.n < 200)
    : []
}

export function withHelper(html) {
  // The thematic pages load their logo from an outside emoji site, which
  // often fails and shows a broken picture: use the school's own logo.
  html = html.replace(/https:\/\/em-content\.zobj\.net\/[^"')\s]+/g, '/mrikromov.jpg')
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${HELPER}`)
  return HELPER + html
}

export default function HtmlTask({ task, studentId, onClose, onChanged }) {
  const [html, setHtml] = useState(null)
  const rawRef = useRef('') // the page as it came, for the AI's task details
  const [fb, setFb] = useState(null) // writing: { id, results } of the latest hand-in
  const [showFb, setShowFb] = useState(false)
  const [error, setError] = useState('')
  const [score, setScore] = useState(null)
  const [texts, setTexts] = useState([]) // typed answers (Writing pages)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [check, setCheck] = useState(null) // Task 1 self-check: { got, tot }
  const gate = useWorkshopGate(task.html_url, studentId, needsWorkshop(task.html_url, html))
  useEffect(() => {
    if (gate.on && gate.complete) setError((e) => (/Workshop/.test(e) ? '' : e))
    // The Workshop's words go into the student's own list (My words).
    if (gate.on && gate.complete && rawRef.current) saveWorkshopWords(supabase, { url: task.html_url, html: rawRef.current, title: task.title, studentId })
  }, [gate.on, gate.complete, task.html_url, task.title, studentId])

  useEffect(() => {
    let cancelled = false
    fetchPage(task.html_url)
      .then((text) => {
        if (cancelled) return
        rawRef.current = text
        setHtml(withHelper(text))
      })
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [task.html_url])

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data
      if (d && d.type === 'ielts-workshop-score' && Number(d.max) > 0) setScore({ score: Number(d.score), max: Number(d.max), parts: Array.isArray(d.parts) ? d.parts.slice(0, 8) : [], qs: cleanQs(d.qs) })
      if (d && d.type === 'ielts-writing-check' && Number(d.tot) > 0) setCheck({ got: Number(d.got) || 0, tot: Number(d.tot) })
      if (d && d.type === 'ielts-workshop-text' && Array.isArray(d.texts)) setTexts(d.texts.slice(0, 4).map((t) => ({ id: String(t.id || '').slice(0, 40), text: String(t.text || '').slice(0, 20000) })))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Writing pages (Task 1 / Task 2 essays): no score, the essay itself is
  // what is handed in (2026-11-05). The AI marks it after hand-in.
  const isWriting = /\/writing\//.test(task.html_url || '')

  // The last AI feedback on this task, if any.
  useEffect(() => {
    if (!isWriting || !task.id || !studentId) return undefined
    let cancelled = false
    supabase
      .from('homework_attempts')
      .select('id, results, submitted_at')
      .eq('task_id', task.id)
      .eq('user_id', studentId)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const last = data?.[0]
        if (!cancelled && (last?.results?.ai || last?.results?.teacher)) setFb({ id: last.id, results: last.results })
      })
    return () => {
      cancelled = true
    }
  }, [isWriting, task.id, studentId])

  // While the AI is marking, look again every few seconds.
  const fbStatus = fb?.results?.ai?.status
  useEffect(() => {
    if (fbStatus !== 'processing' || !fb?.id) return undefined
    const t = setInterval(async () => {
      const { data } = await supabase.from('homework_attempts').select('id, results').eq('id', fb.id).maybeSingle()
      if (data?.results?.ai && data.results.ai.status !== 'processing') {
        setFb({ id: data.id, results: data.results })
        onChanged?.()
      }
    }, 6000)
    return () => clearInterval(t)
  }, [fbStatus, fb?.id, onChanged])

  const runMarking = async (attemptId, results) => {
    const ctx = writingContext(rawRef.current, task.html_url)
    setFb({ id: attemptId, results: { ...results, ai: { status: 'processing', task: ctx.task } } })
    setShowFb(true)
    const res = await markWriting(attemptId, ctx)
    setFb((cur) => (cur?.id === attemptId ? { id: attemptId, results: { ...results, ai: res.ai || { status: 'error', error: res.error, task: ctx.task } } } : cur))
    onChanged?.()
  }

  const handIn = async () => {
    // Thematic Reading: the Workshop must be finished first (2026-11-05).
    if (!gate.complete) {
      setError(`Finish all parts of the Workshop first (${gate.label}). Then hand in.`)
      openWorkshop()
      return
    }
    setSaving(true)
    setError('')
    const { data, error: rpcError } = await supabase.rpc('submit_homework_score', {
      p_task_id: task.id,
      // Writing has no score: the teacher marks the essay itself.
      p_score: score && !isWriting ? score.score : null,
      p_max: score && !isWriting ? score.max : null,
      p_details: texts.length || score?.parts?.length || score?.qs?.length || check
        ? { texts, parts: isWriting ? [] : score?.parts || [], qs: isWriting ? [] : score?.qs || [], ...(check ? { check } : {}) }
        : null,
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    const row = Array.isArray(data) ? data[0] : data
    setDone(row || { attempt_no: 1 })
    onChanged?.()
    // Writing: the AI marks the essay (about a minute).
    const essayWords = texts.length ? texts[0].text.trim().split(/\s+/).filter(Boolean).length : 0
    if (isWriting && row?.id && essayWords >= 20) runMarking(row.id, { texts, ...(check ? { check } : {}) })
  }

  const words = texts.length ? texts[0].text.trim().split(/\s+/).filter(Boolean).length : 0
  const status = done
    ? done.attempt_no === 1
      ? 'Handed in. Your first try counts.'
      : 'Handed in as a retake. Your first try still counts.'
    : isWriting
      ? words
        ? `${words} words${check ? ` · self-check ${check.got}/${check.tot}` : ''} — press Hand in when you finish. Your essay is sent with it.`
        : 'Write your essay in the page, then press Hand in.'
      : gate.on && !gate.complete
        ? `${gate.label} — finish every Workshop part, then hand in.${score ? ' Your score is waiting.' : ''}`
        : score
        ? 'Score found. Hand it in when you are happy.'
        : texts.length
          ? `${words} words written. Hand it in when you finish.`
          : 'Press the page’s own Submit — your score appears here.'

  // Leaving with an essay that was never handed in loses it.
  const leave = () => {
    if (isWriting && words > 0 && !done && !window.confirm('Your essay is not handed in yet. Leave and lose it?')) return false
    onClose?.()
    return true
  }

  return (
    <PageFrame
      title={task.title || 'Practice page'}
      kicker="Homework"
      html={html}
      error={error}
      onClose={leave}
      score={isWriting ? null : score}
      badge={isWriting ? `${words}w` : null}
      status={showFb ? 'AI feedback on your hand-in' : status}
      cover={showFb && fb ? <FeedbackCover fb={fb} onBack={() => setShowFb(false)} onRetry={() => runMarking(fb.id, fb.results)} /> : null}
      onCloseCover={() => setShowFb(false)}
      action={
        <>
          {fb && !showFb && (
            <button
              type="button"
              onClick={() => setShowFb(true)}
              className="focus-ring h-10 shrink-0 rounded-[12px] bg-white/15 px-3 text-sm font-extrabold text-white hover:bg-white/25"
            >
              {(() => {
                const b = fb.results?.teacher?.band ?? (fb.results?.ai?.status === 'done' ? fb.results.ai.overall_band : null)
                return b != null ? `Feedback · ${Number(b).toFixed(1)}` : 'Feedback'
              })()}
            </button>
          )}
          {gate.on && !showFb && (
            <button
              type="button"
              onClick={openWorkshop}
              title="Every Workshop part must be finished before you hand in"
              className={`focus-ring h-10 shrink-0 rounded-[12px] px-3 text-sm font-extrabold ${gate.complete ? 'bg-white/15 text-white' : 'bg-white text-[#9a5b12]'} hover:brightness-105`}
            >
              {gate.complete ? '✓ Workshop' : (<><span className="sm:hidden">Workshop</span><span className="hidden sm:inline">{gate.label}</span></>)}
            </button>
          )}
          {showFb ? (
            <button type="button" onClick={() => setShowFb(false)} className="focus-ring h-10 shrink-0 rounded-[12px] bg-saffron px-3.5 text-sm font-extrabold text-[#17213a] hover:brightness-105 sm:px-5">
              Back to essay
            </button>
          ) : (
            <button
              type="button"
              onClick={handIn}
              disabled={saving || !html}
              title={status}
              className="focus-ring h-10 shrink-0 rounded-[12px] bg-saffron px-3.5 text-sm font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50 sm:px-5"
            >
              {saving ? 'Handing in…' : done ? '✓ Hand in again' : 'Hand in'}
            </button>
          )}
        </>
      }
    />
  )
}

// The AI feedback over the writing page (Back returns to the essay).
function FeedbackCover({ fb, onBack, onRetry }) {
  const ai = fb.results?.ai
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:py-8">
      <WritingFeedback results={fb.results} />
      {ai?.status === 'error' && (
        <button type="button" onClick={onRetry} className="focus-ring h-11 self-start rounded-[14px] bg-writing px-5 text-sm font-extrabold text-white">
          Try marking again
        </button>
      )}
      <button type="button" onClick={onBack} className="focus-ring h-11 self-center rounded-[14px] bg-panel px-5 text-sm font-extrabold text-paper hover:bg-panel-2">
        Back to the essay
      </button>
    </div>
  )
}
