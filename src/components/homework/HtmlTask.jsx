import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { markWriting, writingContext } from '../../lib/writingAi'
import PageFrame, { forgetAutosave } from './PageFrame'
import { createPortal } from 'react-dom'
import { dropQueued, flushHandIns, isNetworkError, queueHandIn } from '../../lib/handinQueue'
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
var tt;function texts(){clearTimeout(tt);tt=setTimeout(function(){var out=[];document.querySelectorAll('textarea:not([data-noreport]),[contenteditable="true"]').forEach(function(el,i){var v=el.tagName==='TEXTAREA'?el.value:el.innerText;if(v&&v.trim().length>20)out.push({id:el.id||('box'+(i+1)),text:v.slice(0,20000)})});if(out.length)parent.postMessage({type:'ielts-workshop-text',texts:out},'*')},600)}
function ovOpen(){var cf=document.getElementById('confirm');if(t1()&&cf&&cf.classList.contains('show'))return true;if(t1Res())return true;var wv=document.getElementById('workshopView');if(wv&&!wv.classList.contains('hidden')&&document.getElementById('essay'))return true;var o=document.getElementById('ws-overlay');if(o&&getComputedStyle(o).display!=='none')return true;var ms=document.querySelectorAll('.modal-overlay');for(var i=0;i<ms.length;i++){if(getComputedStyle(ms[i]).display!=='none')return true}return false}
var mk=[];function marks(){if(!mk.length)return;if(!document.getElementById('ielts-mk-st')){var st=document.createElement('style');st.id='ielts-mk-st';st.textContent='.ielts-mk{box-shadow:0 0 0 3px #dc2626!important;border-radius:6px}'+mk.map(function(n){return '[data-q="'+n+'"]'}).join(',')+'{box-shadow:0 0 0 3px #dc2626!important;border-radius:6px}';document.head.appendChild(st)}document.querySelectorAll('.q-num,.footer__navbtn,.navbtn,.nb').forEach(function(el){var n=parseInt((el.textContent||'').replace(/[^0-9]/g,''),10);if(n&&mk.indexOf(n)>=0)el.classList.add('ielts-mk')})}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-mark-questions'&&Array.isArray(e.data.nums)){mk=e.data.nums.map(Number).filter(function(n){return n>0&&n<200});var o=document.getElementById('ielts-mk-st');if(o)o.remove();marks()}});
var wsLast='';function wsProg(){if(!document.getElementById('ws-overlay'))return;var bs=document.querySelectorAll('#ws-tabs .ws-tab');var d=[];bs.forEach(function(b){if(b.querySelector('.ws-done'))d.push((b.textContent||'').replace(/\u2713/g,'').trim())});var k=bs.length+'|'+d.join(',');if(k===wsLast)return;wsLast=k;parent.postMessage({type:'ielts-workshop-progress',total:bs.length||0,done:d},'*')}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-open-workshop'&&window.openWorkshop){try{window.openWorkshop()}catch(_){}}});
var ovLast=null;function ovTell(){var v=ovOpen();if(v!==ovLast){ovLast=v;parent.postMessage({type:'ielts-overlay',open:v},'*')}}
window.addEventListener('message',function(e){if(!e.data||e.data.type!=='ielts-close-overlay')return;if(t1()){var cf=document.getElementById('confirm');if(cf&&cf.classList.contains('show'))cf.classList.remove('show');else if(t1Res()&&window.backToEdit)window.backToEdit();setTimeout(ovTell,50);return}var hb=document.getElementById('hdrBack');var wv=document.getElementById('workshopView');if(hb&&wv&&!wv.classList.contains('hidden')){hb.click();setTimeout(ovTell,50);return}var x=document.getElementById('ws-x');var o=document.getElementById('ws-overlay');if(o&&getComputedStyle(o).display!=='none'){if(x)x.click();else o.style.display='none'}else{var ms=document.querySelectorAll('.modal-overlay');for(var i=0;i<ms.length;i++){if(getComputedStyle(ms[i]).display!=='none'){var c=ms[i].querySelector('.modal-close-btn');if(c)c.click();else ms[i].style.display='none'}}}setTimeout(ovTell,50)});
// Russian under the Uzbek on the Workshop word cards (2026-11-07; the site sends the words).
var RU=null,ruT=0;
function ruApply(){if(!RU)return;if(!document.getElementById('ielts-ru-st')){var st=document.createElement('style');st.id='ielts-ru-st';st.textContent='.ielts-ru{display:block;font-size:.74em;font-weight:700;color:#55607a;margin-top:3px;line-height:1.3}.ielts-ru b{font-size:.75em;font-weight:800;letter-spacing:.04em;background:rgba(85,96,122,.14);border-radius:5px;padding:0 4px;margin-right:5px}';document.head.appendChild(st)}
 document.querySelectorAll('.ws-uz,.ws-uzb').forEach(function(el){if(el.querySelector('.ielts-ru'))return;var t=(el.textContent||'').trim();var r=RU[t];if(!r)return;var s=document.createElement('span');s.className='ielts-ru';s.setAttribute('lang','ru');s.innerHTML='<b>RU</b>';s.appendChild(document.createTextNode(r));el.appendChild(s)})}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-ru'&&e.data.map&&typeof e.data.map==='object'){RU=e.data.map;ruApply();new MutationObserver(function(){clearTimeout(ruT);ruT=setTimeout(ruApply,60)}).observe(document.body,{childList:true,subtree:true})}});
// Before the page's own Submit: which questions are still empty, tap to go there (2026-11-07).
function preSubmit(){
var R=function(){try{if(typeof isAnswered==='function'){var L=typeof ALLQ!=='undefined'?ALLQ:(typeof allQuestions!=='undefined'?allQuestions:null);if(L)return {list:L.slice(),ok:function(n){return isAnswered(n)},go:function(n){try{scrollToQuestion(n)}catch(_){}}}}
 if(typeof answered==='function'&&typeof TEST!=='undefined'&&TEST.key){var l=[];for(var k in TEST.key)if(+k)l.push(+k);return {list:l,ok:function(n){return answered(n)},go:function(n){try{goTo(n)}catch(_){}}}}}catch(_){}return null};
var ask=typeof askSubmit==='function'?askSubmit:null,pass=false;
if(!R())return;
try{parent.postMessage({type:'ielts-has-submit'},'*')}catch(_){}
var st=document.createElement('style');st.textContent='#ielts-pre{position:fixed;inset:0;z-index:2147483500;background:rgba(15,22,38,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}#ielts-pre .bx{background:#fff;color:#17213a;border-radius:20px;max-width:440px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.3)}#ielts-pre h3{margin:0 0 4px;font-size:20px}#ielts-pre p{margin:0 0 12px;color:#4a5570;font-size:15px}#ielts-pre .ns{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;max-height:180px;overflow:auto}#ielts-pre .ns button{min-width:42px;height:38px;border-radius:12px;border:1.5px solid #f2b8c0;background:#fdecef;color:#b23a48;font-weight:800;font-size:15px;cursor:pointer}#ielts-pre .row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}#ielts-pre .b1,#ielts-pre .b2{border:0;border-radius:14px;padding:11px 18px;font-weight:800;font-size:15px;cursor:pointer}#ielts-pre .b1{background:#2456b0;color:#fff}#ielts-pre .b2{background:#efede6;color:#17213a}';document.head.appendChild(st);
function sheet(info,el){var empty=info.list.filter(function(n){return !info.ok(n)}),tot=info.list.length;
 var o=document.createElement('div');o.id='ielts-pre';
 o.innerHTML='<div class="bx" role="dialog" aria-modal="true"><h3>'+(tot-empty.length)+' of '+tot+' answered</h3><p>'+(empty.length===1?'1 question is still empty. Tap it to go there.':empty.length+' questions are still empty. Tap a number to go there.')+'</p><div class="ns">'+empty.map(function(n){return '<button data-n="'+n+'">'+n+'</button>'}).join('')+'</div><div class="row"><button class="b2" data-x="submit">Submit anyway</button><button class="b1" data-x="back">Keep working</button></div></div>';
 document.body.appendChild(o);
 o.addEventListener('click',function(e){var b=e.target.closest('button');if(!b&&e.target===o){o.remove();return}if(!b)return;
  if(b.dataset.n){o.remove();info.go(+b.dataset.n);return}
  if(b.dataset.x==='back'){o.remove();return}
  if(b.dataset.x==='submit'){o.remove();pass=true;
   if(ask&&typeof doSubmit==='function'){try{doSubmit()}catch(_){}pass=false;return}
   var c=window.confirm;window.confirm=function(){return true};try{el.click()}finally{window.confirm=c;pass=false}}})}
document.addEventListener('click',function(e){if(pass)return;var el=e.target.closest&&e.target.closest('button,[role=button],a,div');if(!el)return;
 var hit=el.id==='deliver-button'||(ask&&(el.onclick===ask||el.onclick===window.askSubmit));if(!hit)return;
 if((typeof submitted!=='undefined'&&submitted)||(typeof resultsShown!=='undefined'&&resultsShown))return;
 var info=R();if(!info)return;var empty=info.list.filter(function(n){return !info.ok(n)});if(!empty.length)return;
 e.preventDefault();e.stopImmediatePropagation();sheet(info,el)},true)}
// Listening pages: highlight words, like the real computer test (2026-11-07).
function hlSetup(){
if(!document.querySelector('audio'))return;
if(typeof window.applyHL==='function'||typeof window.applyHighlight==='function'||document.getElementById('ielts-hlmenu'))return;
var st=document.createElement('style');st.textContent='mark.ielts-hl{background:#ffe14d;color:inherit;border-radius:2px;padding:0;cursor:pointer}#ielts-hlmenu{position:fixed;z-index:2147483600;display:none;gap:4px;background:#1f2340;border-radius:10px;padding:4px;box-shadow:0 6px 18px rgba(0,0,0,.25);transform:translateX(-50%)}#ielts-hlmenu button{border:0;background:transparent;color:#fff;font:600 14px system-ui,sans-serif;padding:7px 12px;border-radius:7px;cursor:pointer}#ielts-hlmenu button:hover{background:rgba(255,255,255,.15)}';document.head.appendChild(st);
var menu=document.createElement('div');menu.id='ielts-hlmenu';document.body.appendChild(menu);
var store=[],busy=false,pending=null;
function skip(n){var e=n.parentNode;while(e&&e!==document.body){var t=e.nodeName;if(t==='SCRIPT'||t==='STYLE'||t==='TEXTAREA'||t==='SELECT'||t==='OPTION'||t==='BUTTON'||t==='AUDIO'||e.id==='ielts-hlmenu')return true;e=e.parentNode}return false}
function nodes(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),a=[],n,pos=0;while((n=w.nextNode())){if(skip(n))continue;a.push({n:n,s:pos});pos+=n.nodeValue.length}return {list:a,text:a.map(function(x){return x.n.nodeValue}).join('')}}
function offset(all,node,off){if(node.nodeType!==3){var k=node.childNodes[off];if(k){var w=document.createTreeWalker(k,NodeFilter.SHOW_TEXT,null),f=k.nodeType===3?k:w.nextNode();if(f){node=f;off=0}}else{var w2=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,null),l=null,x;while((x=w2.nextNode()))l=x;if(l){node=l;off=l.nodeValue.length}}}
 for(var i=0;i<all.list.length;i++)if(all.list[i].n===node)return all.list[i].s+off;return -1}
function unwrap(){var ms=document.querySelectorAll('mark.ielts-hl');for(var i=0;i<ms.length;i++){var m=ms[i],p=m.parentNode;if(!p)continue;while(m.firstChild)p.insertBefore(m.firstChild,m);p.removeChild(m);p.normalize()}}
function apply(){busy=true;try{unwrap();
 store.forEach(function(h,hi){var all=nodes();var at=all.text.indexOf(h.pre+h.t+h.post);var s=at>=0?at+h.pre.length:-1;
  if(s<0){var best=-1,i=all.text.indexOf(h.t);while(i>=0){if(best<0||Math.abs(i-h.s)<Math.abs(best-h.s))best=i;i=all.text.indexOf(h.t,i+1)}s=best}
  if(s<0)return;h.s=s;var e=s+h.t.length;
  all.list.forEach(function(x){var a=Math.max(s,x.s),b=Math.min(e,x.s+x.n.nodeValue.length);if(a>=b)return;
   var n=x.n;if(!n.parentNode)return;var ra=a-x.s,rb=b-x.s,mid=ra>0?n.splitText(ra):n;if(rb-ra<mid.nodeValue.length)mid.splitText(rb-ra);
   var m=document.createElement('mark');m.className='ielts-hl';m.setAttribute('data-h',hi);mid.parentNode.insertBefore(m,mid);m.appendChild(mid)})})}catch(_){}
 setTimeout(function(){busy=false},0)}
function hide(){menu.style.display='none';pending=null}
function show(x,y,below,html){menu.innerHTML=html;menu.style.display='flex';menu.style.left=Math.max(70,Math.min(innerWidth-70,x))+'px';menu.style.top=(below?y+8:Math.max(4,y-48))+'px'}
var t=0;
function onSel(){clearTimeout(t);t=setTimeout(function(){var s=getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;var r=s.getRangeAt(0);var txt=r.toString();if(!txt.trim()||txt.length>600)return;
 var a=r.startContainer.nodeType===1?r.startContainer:r.startContainer.parentNode;if(a&&a.closest&&a.closest('input,textarea,select,#ielts-hlmenu'))return;
 var all=nodes(),s0=offset(all,r.startContainer,r.startOffset),e0=offset(all,r.endContainer,r.endOffset);if(s0<0||e0<=s0)return;
 pending={s:s0,t:all.text.slice(s0,e0),pre:all.text.slice(Math.max(0,s0-24),s0),post:all.text.slice(e0,e0+24)};
 var b=r.getBoundingClientRect(),touch=matchMedia&&matchMedia('(pointer: coarse)').matches;
 show(b.left+b.width/2,touch?b.bottom:b.top,touch,'<button data-hl="add">Highlight</button>')},300)}
document.addEventListener('selectionchange',onSel);document.addEventListener('mouseup',onSel);
menu.addEventListener('mousedown',function(e){e.preventDefault()});
menu.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;var k=b.getAttribute('data-hl');
 if(k==='add'&&pending){store.push(pending);try{getSelection().removeAllRanges()}catch(_){}apply()}
 else if(k==='del'){store.splice(+b.getAttribute('data-i'),1);apply()}
 else if(k==='clear'){store=[];apply()}
 hide()});
document.addEventListener('click',function(e){var m=e.target.closest&&e.target.closest('mark.ielts-hl');if(m){var s=getSelection();if(s&&!s.isCollapsed)return;var r=m.getBoundingClientRect();show(r.left+r.width/2,r.top,false,'<button data-hl="del" data-i="'+m.getAttribute('data-h')+'">Remove highlight</button><button data-hl="clear">Clear all</button>');return}
 if(!(e.target.closest&&e.target.closest('#ielts-hlmenu')))setTimeout(function(){var s=getSelection();if(!s||s.isCollapsed)hide()},0)});
document.addEventListener('scroll',function(){if(menu.style.display!=='none'&&!pending)hide()},true);
var mt=0;new MutationObserver(function(){if(busy||!store.length)return;clearTimeout(mt);mt=setTimeout(function(){apply()},120)}).observe(document.body,{childList:true,subtree:true,characterData:true})}
function small(){return window.innerWidth<760}
function wsPhone(){if(document.getElementById('ielts-wsph'))return;var st=document.createElement('style');st.id='ielts-wsph';st.textContent='@media (max-width:759px){#wsOverlay.open{position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;height:auto!important;max-height:none!important;z-index:2147483000;display:block!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch}#wsOverlay.open .ws-body{flex:none!important;overflow:visible!important;height:auto!important;min-height:0}#wsOverlay .ws-top{position:sticky;top:0;z-index:6;background:#fff;padding:8px 10px!important;display:flex!important;flex-wrap:wrap;align-items:center;gap:6px 8px;box-shadow:0 4px 10px -8px rgba(0,0,0,.35)}body.dark #wsOverlay .ws-top{background:#111827}#wsOverlay .ws-back{height:34px;padding:0 10px!important;font-size:.85rem!important;margin:0!important}#wsOverlay .ws-title{flex:1 1 0;min-width:0;font-size:1rem!important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0!important}#wsOverlay .ws-title small{display:none!important}#wsOverlay .ws-tabs{flex:1 1 100%;display:flex!important;flex-direction:row!important;flex-wrap:nowrap!important;overflow-x:auto;gap:6px!important;margin:0!important;padding:0 0 2px!important}#wsOverlay .ws-tab{flex:0 0 auto!important;width:auto!important;min-width:0!important;padding:6px 12px!important;font-size:.85rem!important;white-space:nowrap}#wsOverlay .ws-paused{display:none!important}#wsOverlay .ws-intro{font-size:.9rem!important;line-height:1.45;padding:10px 12px!important;margin-bottom:10px!important}#ws-overlay #ws-tabs{display:flex!important;flex-wrap:nowrap!important;overflow-x:auto;gap:6px!important;padding:8px 10px!important}#ws-overlay #ws-tabs .ws-tab{flex:0 0 auto!important;white-space:nowrap;padding:6px 12px!important;font-size:.85rem!important}#ws-overlay .ws-help{font-size:.9rem!important;line-height:1.45}.ws-bank{position:sticky!important;top:0;z-index:5;max-height:30vh;overflow-y:auto!important;background:#fff!important;box-shadow:0 8px 14px -10px rgba(0,0,0,.4)}.ws-bank .ws-chip{font-size:.9rem!important;padding:4px 10px!important;margin:3px!important}body.ielts-m .navbar>.ngroup,body.ielts-m .ngroup{min-width:0!important;flex:0 0 calc(100vw - 24px)!important;max-width:calc(100vw - 24px)!important;box-sizing:border-box}body.ielts-m .ngroup .ngt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}body.ielts-m .ngroup .nbtns{flex-wrap:wrap}}';document.head.appendChild(st);var nb=document.querySelector('.navbar');var cur=document.querySelector('.ngroup.cur');if(small()&&nb&&cur)try{nb.scrollLeft=cur.offsetLeft-8}catch(_){}}
function fitTables(){if(!small())return;document.querySelectorAll('table').forEach(function(t){if(t.getAttribute('data-ielts-fit'))return;var p=t.parentElement;if(!p)return;if(t.scrollWidth<=p.clientWidth+2)return;t.setAttribute('data-ielts-fit','1');var w=document.createElement('div');w.className='ielts-swipe';w.style.cssText='overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;margin:0 0 .5rem';var h=document.createElement('div');h.textContent='Swipe the table sideways \u2192';h.style.cssText='font-size:11px;font-weight:700;color:#92400e;margin:2px 0 4px';p.insertBefore(h,t);p.insertBefore(w,t);w.appendChild(t);var cols=0;t.querySelectorAll('tr').forEach(function(r){cols=Math.max(cols,r.children.length)});t.style.width='auto';t.style.minWidth=Math.min(Math.max(cols,2)*150,900)+'px';t.style.fontSize='.86rem';t.querySelectorAll('th,td').forEach(function(c){c.style.padding='.35rem .45rem'})})}
function writingPhone(){if(!(window.innerWidth<480)||!(document.getElementById('essay')||t1())||!document.querySelector('.header .brand'))return;var st=document.createElement('style');st.textContent='.header .brand{display:none}.header{padding:0 12px}';document.head.appendChild(st)}
function t1Tabs(){var pc=document.querySelector('.panels-container');if(!t1()||!pc||document.getElementById('ielts-mtabs'))return;var st=document.createElement('style');st.textContent='body.ielts-t1 .left-panel{border:0!important}body.ielts-t1.ielts-w .left-panel{display:none!important}body.ielts-t1:not(.ielts-w) .right-panel{display:none!important}#ielts-mtabs{display:flex;gap:6px;padding:8px 20px;position:sticky;top:60px;z-index:5;background:#fff;border-bottom:1px solid #e5e7eb}#ielts-mtabs button{flex:1;height:40px;border-radius:10px;border:1.5px solid #d97706;background:#fff;color:#92400e;font-weight:800;font-size:.95rem}#ielts-mtabs button.on{background:#d97706;color:#fff}';document.head.appendChild(st);document.body.classList.add('ielts-t1');var bar=document.createElement('div');bar.id='ielts-mtabs';var a=document.createElement('button');a.type='button';a.textContent='Graphic';var b=document.createElement('button');b.type='button';b.textContent='Write';bar.appendChild(a);bar.appendChild(b);pc.parentNode.insertBefore(bar,pc);var tp=document.querySelector('.task-prompt strong');if(tp)tp.textContent='Study the task below, then press Write to write your report.';function show(w){document.body.classList.toggle('ielts-w',w);a.className=w?'':'on';b.className=w?'on':''}a.onclick=function(){show(false)};b.onclick=function(){show(true);setTimeout(function(){var t=document.getElementById('answer');if(t)t.focus()},50)};show(false)}
function mobile(){try{writingPhone()}catch(_){}if(!small())return;try{t1Tabs()}catch(_){};var tc=document.querySelector('.test-container')||(document.querySelector('.part .passage-container')&&document.querySelector('.main'));if(!tc||!document.querySelector('.passage-container')||!document.querySelector('.questions-container')||document.getElementById('ielts-mtabs'))return;
var st=document.createElement('style');st.textContent='body.ielts-m{height:100vh;height:100dvh}body.ielts-m .header{padding:.4rem .75rem}body.ielts-m .header__candidate{display:none}body.ielts-m .header__timer{padding:.2rem .7rem;font-size:.95rem}body.ielts-m .test-container{flex-direction:column;height:auto!important;flex:1;min-height:0}body.ielts-m .divider{display:none!important}body.ielts-m .passage-container,body.ielts-m .questions-container{flex:1 1 auto!important;width:100%!important;max-width:none!important;min-height:0}body.ielts-m.ielts-q .passage-container{display:none!important}body.ielts-m:not(.ielts-q) .questions-container{display:none!important}body.ielts-m .footer{flex-wrap:wrap;gap:.4rem;padding:.45rem .6rem}body.ielts-m .footer__navwrap{flex:1 1 100%;flex-wrap:nowrap;overflow-x:auto;padding-bottom:2px}body.ielts-m .footer__navbtn{flex:0 0 auto}body.ielts-m .part.active{flex-direction:column}body.ielts-m .navbar{display:flex!important;overflow-x:auto;gap:.4rem;padding:.4rem .6rem}body.ielts-m .navbar>*{flex:0 0 auto;min-width:150px}body.ielts-m .navpart{flex-wrap:nowrap;flex:0 0 auto}body.ielts-m .navbtn{flex:0 0 auto}body.ielts-m .header__right{gap:.4rem}#ielts-mtabs{display:flex;gap:6px;padding:6px 8px;background:#fff;border-bottom:1px solid #e5e7eb;flex-shrink:0}#ielts-mtabs button{flex:1;height:38px;border-radius:10px;border:1.5px solid #d97706;background:#fff;color:#92400e;font-weight:800;font-size:.95rem}#ielts-mtabs button.on{background:#d97706;color:#fff}body.ielts-m.inws #ielts-mtabs,body.ielts-m.inws #mainTabs{display:none!important}body.ielts-m.inws .ws-overlay.open{overflow-y:auto!important;-webkit-overflow-scrolling:touch}body.ielts-m.inws .ws-overlay.open .ws-top{flex-shrink:0}body.ielts-m.inws .ws-overlay.open .ws-body{flex:none!important;overflow:visible!important;min-height:0}';
document.head.appendChild(st);document.body.classList.add('ielts-m');var bar=document.createElement('div');bar.id='ielts-mtabs';var a=document.createElement('button');a.type='button';a.textContent='Passage';var b=document.createElement('button');b.type='button';b.textContent='Questions';bar.appendChild(a);bar.appendChild(b);tc.parentNode.insertBefore(bar,tc);
function show(q){document.body.classList.toggle('ielts-q',q);a.className=q?'':'on';b.className=q?'on':'';setTimeout(function(){try{fitTables()}catch(_){}},30)}a.onclick=function(){show(false)};b.onclick=function(){show(true)};show(false);
var siv=Element.prototype.scrollIntoView;Element.prototype.scrollIntoView=function(){try{if(this.closest&&this.closest('.passage-container')&&document.body.classList.contains('ielts-q'))show(false)}catch(_){}return siv.apply(this,arguments)};
document.addEventListener('click',function(e){var t=e.target;if(t&&t.closest&&(t.closest('.footer__navbtn')||t.closest('.footer .navbtn')))show(true)},true)}
/* AUTOSAVE (2026-11-09): a phone may reload the page while the student is in another app or tab, and every answer was lost. The page cannot keep anything itself, so it sends its answers (and which Workshop step is open) to the site, and gets them back when it opens again. */
var asOn=false,asT=0;function asFields(root){if(!root)return[];return Array.prototype.slice.call(root.querySelectorAll('input,select,textarea')).filter(function(el){var t=(el.type||'').toLowerCase();return t!=='hidden'&&t!=='file'&&t!=='button'&&t!=='submit'&&t!=='reset'&&t!=='range'&&!el.closest('#ielts-pre')&&!el.hasAttribute('data-noreport')})}
function asOv(){return document.getElementById('ws-overlay')||document.getElementById('wsOverlay')}
function asSig(el){return el.tagName+'|'+(el.type||'')+'|'+(el.name||el.id||el.getAttribute('data-q')||'')}
function asVal(el){var t=(el.type||'').toLowerCase();return(t==='radio'||t==='checkbox')?(el.checked?1:0):String(el.value||'').slice(0,5000)}
function asPack(list){return list.map(function(el){return[asSig(el),asVal(el)]})}
function asSnap(){var ov=asOv();var main=asFields(document).filter(function(el){return!ov||!ov.contains(el)});var o={v:1,f:asPack(main)};if(ov&&ov.offsetWidth>0){var tabs=Array.prototype.slice.call(document.querySelectorAll('#ws-tabs .ws-tab'));var on=-1;tabs.forEach(function(b,i){if(b.classList.contains('on'))on=i});o.ws={tab:on,f:asPack(asFields(ov))}}return o}
function asHas(o){var any=function(a){return a.some(function(x){return x[1]!==''&&x[1]!==0})};return any(o.f)||Boolean(o.ws)}
function asSave(){if(!asOn)return;try{var o=asSnap();parent.postMessage({type:'ielts-autosave',data:asHas(o)?JSON.stringify(o):''},'*')}catch(_){}}
function asLater(){if(!asOn)return;clearTimeout(asT);asT=setTimeout(asSave,700)}
function asPut(list,saved){var n=0;list.forEach(function(el,i){var s=saved[i];if(!s||s[0]!==asSig(el))return;var t=(el.type||'').toLowerCase(),v=s[1];if(t==='radio'){if(v===1&&!el.checked){el.click();n++}}else if(t==='checkbox'){if(Boolean(v)!==el.checked){el.click();n++}}else if(typeof v==='string'&&v!==''&&el.value!==v){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));n++}});return n}
function asToast(){var t=document.createElement('div');t.textContent='Your answers were brought back.';t.setAttribute('style','position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;background:#17213a;color:#fff;font:700 14px/1.3 system-ui,sans-serif;padding:10px 16px;border-radius:14px;box-shadow:0 6px 20px rgba(0,0,0,.25)');document.body.appendChild(t);setTimeout(function(){t.remove()},3200)}
function asRestore(raw){var o=null;try{o=raw?JSON.parse(raw):null}catch(_){}if(!o||o.v!==1){asOn=true;return}setTimeout(function(){var n=0;try{n+=asPut(asFields(document).filter(function(el){var ov=asOv();return!ov||!ov.contains(el)}),o.f||[])}catch(_){}if(!o.ws){asOn=true;if(n)asToast();return}try{if(window.openWorkshop)window.openWorkshop();else{var b=document.getElementById('wsBtn');if(b)b.click()}}catch(_){}setTimeout(function(){try{var tabs=document.querySelectorAll('#ws-tabs .ws-tab');if(o.ws.tab>=0&&tabs[o.ws.tab]&&!tabs[o.ws.tab].classList.contains('on'))tabs[o.ws.tab].click()}catch(_){}setTimeout(function(){try{n+=asPut(asFields(asOv()),o.ws.f||[])}catch(_){}asOn=true;asToast()},300)},300)},450)}
window.addEventListener('message',function(e){if(e.data&&e.data.type==='ielts-autosave-state')asRestore(e.data.data)});
setTimeout(function(){asOn=true},6000);
document.addEventListener('input',asLater,true);document.addEventListener('change',asLater,true);document.addEventListener('click',asLater,true);
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')asSave()});window.addEventListener('pagehide',asSave);
document.addEventListener('input',texts,true);
document.addEventListener('click',function(){setTimeout(scan,500);setTimeout(scan,1500);texts();setTimeout(ovTell,80);setTimeout(wsProg,120)},true);
document.addEventListener('DOMContentLoaded',function(){try{parent.postMessage({type:'ielts-ready'},'*')}catch(_){}try{mobile()}catch(_){}try{wsPhone()}catch(_){}try{hlSetup()}catch(_){}try{preSubmit()}catch(_){}try{fitTables()}catch(_){}try{new MutationObserver(function(){clearTimeout(window.__ielts_t);window.__ielts_t=setTimeout(function(){scan();try{fitTables()}catch(_){}try{wsProg()}catch(_){}try{marks()}catch(_){}},400)}).observe(document.body,{subtree:true,childList:true,characterData:true})}catch(_){}});
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
  const [hasSubmit, setHasSubmit] = useState(false) // the page has its own Submit
  const [ask, setAsk] = useState(false) // 'Hand in without Submit?' sheet
  const [receipt, setReceipt] = useState(null) // { at, score, max, attempt_no, pending }
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
      if (d && d.type === 'ielts-has-submit') setHasSubmit(true)
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

  const handIn = async (force = false) => {
    // The page's own Submit not pressed yet: nothing is checked (2026-11-07).
    if (!force && !score && !isWriting && hasSubmit) {
      setAsk(true)
      return
    }
    setAsk(false)
    // Thematic Reading: the Workshop must be finished first (2026-11-05).
    if (!gate.complete) {
      setError(`Finish all parts of the Workshop first (${gate.label}). Then hand in.`)
      openWorkshop()
      return
    }
    setSaving(true)
    setError('')
    const args = {
      p_task_id: task.id,
      // Writing has no score: the teacher marks the essay itself.
      p_score: score && !isWriting ? score.score : null,
      p_max: score && !isWriting ? score.max : null,
      p_details: texts.length || score?.parts?.length || score?.qs?.length || check
        ? { texts, parts: isWriting ? [] : score?.parts || [], qs: isWriting ? [] : score?.qs || [], ...(check ? { check } : {}) }
        : null,
    }
    const { data, error: rpcError } = await supabase.rpc('submit_homework_score', args).then(
      (r) => r,
      (err) => ({ data: null, error: err })
    )
    setSaving(false)
    if (rpcError) {
      // No internet: keep it on this device and send it later (2026-11-07).
      if (isNetworkError(rpcError) && !isWriting) {
        queueHandIn(args)
        setDone({ attempt_no: 1, pending: true })
        setReceipt({ at: new Date(), score: score?.score ?? null, max: score?.max ?? null, pending: true })
        return
      }
      setError(rpcError.message)
      return
    }
    dropQueued(task.id)
    forgetAutosave(studentId, html) // handed in: the next try starts clean
    const row = Array.isArray(data) ? data[0] : data
    setDone(row || { attempt_no: 1 })
    if (!isWriting) setReceipt({ at: new Date(), score: score?.score ?? null, max: score?.max ?? null, attempt_no: row?.attempt_no || 1 })
    flushHandIns()
    onChanged?.()
    // Writing: the AI marks the essay (about a minute).
    const essayWords = texts.length ? texts[0].text.trim().split(/\s+/).filter(Boolean).length : 0
    if (isWriting && row?.id && essayWords >= 20) runMarking(row.id, { texts, ...(check ? { check } : {}) })
  }

  const words = texts.length ? texts[0].text.trim().split(/\s+/).filter(Boolean).length : 0
  const status = done?.pending
    ? 'Saved on this device — it is sent as soon as the internet is back.'
    : done
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
    <>
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
              onClick={() => handIn()}
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
    {ask && (
      <Sheet
        title="Press Submit in the page first"
        text="You haven't pressed the page's own Submit yet, so your answers are not checked and no score is sent. Press Submit at the bottom of the page, then Hand in."
        main="Go back to the page"
        onMain={() => setAsk(false)}
        other="Hand in without a score"
        onOther={() => handIn(true)}
      />
    )}
    {receipt && (
      <Sheet
        tone={receipt.pending ? 'amber' : 'good'}
        title={receipt.pending ? 'Saved on this device' : receipt.max ? '✓ All answers saved' : '✓ Handed in'}
        text={
          receipt.pending
            ? 'The internet dropped, so your work is kept on this phone/computer. It is sent automatically when the internet is back — keep the site open or open it again later.'
            : `${receipt.score != null && receipt.max ? `Score ${receipt.score} / ${receipt.max}. ` : ''}Received at ${receipt.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. ${receipt.attempt_no > 1 ? 'This was a retake — your first try still counts.' : 'Your teacher can see it now.'}`
        }
        main="Back to homework"
        onMain={() => {
          setReceipt(null)
          leave()
        }}
        other="Stay on the page"
        onOther={() => setReceipt(null)}
      />
    )}
    </>
  )
}

// A small card over the page: hand-in receipt / Submit reminder (2026-11-07).
function Sheet({ title, text, main, onMain, other, onOther, tone }) {
  return createPortal(
    <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4" style={{ background: 'rgba(15, 22, 38, 0.55)' }} role="dialog" aria-modal="true">
      <div className="w-full max-w-[440px] rounded-[20px] bg-panel p-5 text-paper shadow-xl">
        <p className={`font-brand text-[19px] font-semibold ${tone === 'good' ? 'text-sage' : tone === 'amber' ? 'text-amber' : 'text-paper'}`}>{title}</p>
        <p className="mt-2 text-[15px] font-semibold leading-relaxed text-paper-dim">{text}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {other && (
            <button type="button" onClick={onOther} className="focus-ring h-11 rounded-[14px] bg-panel-2 px-4 text-sm font-extrabold text-paper">
              {other}
            </button>
          )}
          <button type="button" onClick={onMain} className="focus-ring h-11 rounded-[14px] bg-brass px-4 text-sm font-extrabold text-onbrass">
            {main}
          </button>
        </div>
      </div>
    </div>,
    document.body
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
