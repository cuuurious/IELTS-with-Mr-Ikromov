/* ================= WRITING LAB — screen (shared by every chapter) =================
   2026-11-07. Needs from the chapter file: CHAPTER, LEARN, CHIPS, TRAP, PAT, D
   (LEARN / CHIPS / TRAP may be empty when a chapter has no "learn" block).
   Block types: learn · graphs · drills · write · choose · gaps · html.
   Needs from coach.js: analyze, buildVocab, esc.
   Inside the website the page sits in a sealed frame: progress is kept by
   the site (ielts-lab-save / ielts-lab-load messages) and the score goes to
   the homework ("Hand in"). Opened on its own, it keeps progress in the browser. */
(function(){
const $=(s,e)=>(e||document).querySelector(s),$$=(s,e)=>[...(e||document).querySelectorAll(s)];
const inFrame=(()=>{try{return window.parent!==window}catch(e){return true}})();
const CH=CHAPTER;
let ST={v:1,saved:{},ok:{},tries:{},seen:{},step:0,unit:{}};
const REG=[];let uid=0;

/* ---------- saving ---------- */
let saveT=null;
function save(){clearTimeout(saveT);saveT=setTimeout(()=>{const data=JSON.stringify(ST);
  if(inFrame){try{parent.postMessage({type:"ielts-lab-save",id:CH.id,data},"*")}catch(e){}}
  try{localStorage.setItem("ielts-lab:"+CH.id,data)}catch(e){}},400)}
function restore(data){if(!data)return;try{const o=JSON.parse(data);if(o&&o.v===1){ST=Object.assign(ST,o);applyState()}}catch(e){}}

/* ---------- theme ---------- */
function setTheme(t){document.documentElement.setAttribute("data-theme",t==="dark"?"dark":"light")}
setTheme(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches&&!inFrame?"dark":"light");

/* ---------- charts drawn from the numbers ---------- */
function niceTicks(lo,hi){const span=hi-lo||1;const raw=span/4;const p=Math.pow(10,Math.floor(Math.log10(raw)));const st=[1,2,2.5,5,10].map(x=>x*p).find(x=>x>=raw)||p*10;
  const a=Math.floor(lo/st)*st,b=Math.ceil(hi/st)*st;const t=[];for(let v=a;v<=b+1e-9;v+=st)t.push(+v.toFixed(6));return t}
function fmt(v){return Number.isInteger(v)?String(v):String(+v.toFixed(2))}
function disp(v){const t=fmt(v);return Math.abs(v)>=10000?t.replace(/\B(?=(\d{3})+(?!\d))/g,","):t}
function chartSVG(gid){
  const m=D.gmeta[gid];if(!m||!m.svals||!Object.keys(m.svals).length)return "";
  const series=Object.entries(m.svals),years=m.years;const all=[].concat(...series.map(s=>s[1]));
  let lo=Math.min(...all),hi=Math.max(...all);const pad=(hi-lo)*.12||1;lo=Math.max(lo>=0?0:-Infinity,lo-pad);hi=hi+pad;
  const ticks=m.ticks||niceTicks(lo,hi);lo=ticks[0];hi=ticks[ticks.length-1];
  const W=340,H=210,L=42,R=14,T=16,B=26;const x=i=>L+(W-L-R)*i/(years.length-1),y=v=>T+(H-T-B)*(1-(v-lo)/(hi-lo));
  const allowed=new Set(m.allowed||[]);const multi=series.length>1;
  let s='<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(m.title)+'">';
  if(m.shadeFrom!=null){const x0=x(m.shadeFrom);s+='<rect class="shade" x="'+x0+'" y="'+T+'" width="'+(W-R-x0)+'" height="'+(H-T-B)+'"/><text class="axis" x="'+((x0+W-R)/2)+'" y="'+(T+10)+'" text-anchor="middle">'+esc(m.shadeLabel||"forecast")+'</text>'}
  for(const t of ticks)s+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(t)+'" y2="'+y(t)+'"/><text class="axis" x="'+(L-6)+'" y="'+(y(t)+4)+'" text-anchor="end">'+(t>=10000?(t/1000)+"k":fmt(t))+'</text>';
  const every=m.xEvery||1;years.forEach((yr,i)=>{if(i%every===0)s+='<text class="axis" x="'+x(i)+'" y="'+(H-7)+'" text-anchor="middle">'+yr+'</text>'});
  series.forEach(([name,vals],si)=>{
    const up=vals.every((v,i)=>i===0||v>=vals[i-1]),down=vals.every((v,i)=>i===0||v<=vals[i-1]);
    const col=multi?(si===0?"var(--gUp)":(series.length===2&&/^(var\(--gUp\))$/.test("var(--gUp)")&&vals[vals.length-1]<vals[0]?"var(--gDown)":"var(--g2)")):(up?"var(--gUp)":down?"var(--gDown)":"var(--gMix)");
    const d=vals.map((v,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(v).toFixed(1)).join(" ");
    s+='<path class="ln" pathLength="1" d="'+d+'" stroke="'+col+'"/>';
    vals.forEach((v,i)=>{s+='<circle cx="'+x(i)+'" cy="'+y(v)+'" r="3.6" fill="'+col+'"/>';
      if(!m.noLabels&&(m.labelAt?m.labelAt.includes(i):allowed.has(fmt(v)))&&(!multi||i===0||i===vals.length-1))s+='<text class="lbl" x="'+x(i)+'" y="'+(y(v)-8)+'" text-anchor="middle" fill="'+col+'">'+disp(v)+'</text>'});
    if(multi&&name){const ky=T+4+si*16;s+='<line x1="'+(L+8)+'" x2="'+(L+24)+'" y1="'+ky+'" y2="'+ky+'" stroke="'+col+'" stroke-width="3" stroke-linecap="round"/><text class="key" x="'+(L+30)+'" y="'+(ky+4)+'">'+esc(name)+'</text>'}
  });
  (m.marks||[]).forEach(k=>{const v=series[0][1][k.i],cx=x(k.i),cy=Math.min(H-B-10,Math.max(T+10,y(v)+(k.below?20:-30)));s+='<g class="mark"><circle cx="'+cx+'" cy="'+cy+'" r="9"/><text x="'+cx+'" y="'+(cy+3.5)+'" text-anchor="middle">'+esc(k.t)+'</text></g>'});
  return s+"</svg>"}
function animate(el){const c=$("svg.chart",el);if(!c)return;c.classList.remove("draw");void c.getBoundingClientRect();c.classList.add("draw")}

/* ---------- inputs ---------- */
function plain(h){return String(h||"").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&rarr;/g,"→").replace(/&hellip;/g,"…").replace(/&ndash;/g,"–").replace(/&amp;/g,"&")}
function hintHTML(n,hint){if(hint)return hint;if(!n||!LEARN[n-1])return "Write one clear sentence. Keep every figure.";const L=LEARN[n-1];
  return '<b>Structure '+n+'</b> · '+L.t+'<div class="chiprow">'+CHIPS[n].map(c=>'<span class="chip '+c[1]+'">'+esc(c[0])+"</span>").join("")+'</div><div>'+L.rule+"</div>"}
function mkInput(spec){
  const id="i"+(uid++);
  const reg={id,key:spec.key,step:spec.step,unit:spec.unit,counted:spec.counted!==false,ok:false,tries:0,check:spec.check,model:spec.model,n:spec.n,hint:spec.hint,prompt:spec.prompt||"",kind:"write"};
  REG.push(reg);
  return '<div class="iw" id="w'+id+'">'+(spec.label?'<div class="lab">'+spec.label+"</div>":"")+
    '<textarea id="'+id+'" data-noreport="1" rows="'+(spec.rows||2)+'" placeholder="Write your sentence here…" spellcheck="false" autocomplete="off" autocapitalize="sentences"></textarea>'+
    '<div class="irow"><button class="btn" data-a="check">Check</button><button class="btn ghost" data-a="hint">Hint</button><span class="wc" id="wc'+id+'"></span><span class="done-tag" id="dt'+id+'"></span></div>'+
    '<div class="hint" id="h'+id+'"></div><div class="fb" id="f'+id+'"></div></div>'}
const KIND={structure:"Structure",facts:"Facts",warn:"Check",grammar:"Grammar",tense:"Tense",spelling:"Spelling",style:"Style"};
const isHard=x=>["structure","facts","grammar","tense","warn"].includes(x.kind)||(x.kind==="spelling"&&x.hard);
function annotate(text,items){const sp=items.filter(x=>x.len>0&&x.kind!=="warn").slice().sort((a,b)=>a.i-b.i);let out="",pos=0;
  for(const s of sp){if(s.i<pos)continue;out+=esc(text.slice(pos,s.i))+'<mark class="'+s.kind+'" title="'+esc(s.msg)+'">'+esc(text.slice(s.i,s.i+s.len))+"</mark>";pos=s.i+s.len}
  return out+esc(text.slice(pos))}
function itemHTML(x){return '<div class="it '+x.kind+'"><div><span class="k">'+(KIND[x.kind]||"")+"</span>"+esc(x.msg)+(x.fix?'<div class="tryit">Try: '+esc(x.fix)+"</div>":"")+(x.why?'<div class="why">'+esc(x.why)+"</div>":"")+"</div></div>"}
function fbHTML(r,text,reg){
  const hard=r.items.filter(isHard),soft=r.items.filter(x=>!isHard(x)&&(x.kind==="spelling"||x.kind==="style"));
  const has=k=>r.items.some(x=>(k==="grammar"?["grammar","tense"].includes(x.kind):x.kind===k)&&(k!=="spelling"||x.hard));
  const verdict=r.ok?(soft.length?"✓ Correct — now polish it":"✓ Excellent! Accurate and correct"):(hard.length<=1?"Almost there — fix 1 thing":"Keep going — "+hard.length+" things to fix");
  const m=(l,bad)=>'<span class="'+(bad?"no":"ok")+'">'+(bad?"✗ ":"✓ ")+l+"</span>";
  let h='<div class="hd"><span class="vd">'+verdict+'</span><div class="meter">'+m("Structure",has("structure"))+m("Facts",has("facts")||r.items.some(x=>x.kind==="warn"))+m("Grammar",has("grammar"))+m("Spelling",has("spelling"))+'</div></div><div class="body">';
  h+='<div class="ann">'+annotate(text,r.items)+"</div>";
  if(hard.length)h+='<div class="grp">Fix these first</div>'+hard.map(itemHTML).join("");
  if(soft.length)h+='<div class="grp">Polish</div>'+soft.map(itemHTML).join("");
  if(r.praise.length)h+='<div class="grp">What you did well</div>'+r.praise.map(p=>'<div class="it praise"><div><span class="k">Good</span>'+esc(p)+"</div></div>").join("");
  if(reg.model){const show=r.ok||reg.tries>=2;h+=show?'<div class="mdl"><b>Model answer:</b> '+esc(reg.model)+"</div>":'<div class="irow"><button class="btn ghost" data-a="model">Show model answer</button><span class="wc">or try once more first</span></div>'}
  return h+"</div>"}
function runCheck(reg,count){
  const t=(reg.ta.value||"").trim();
  if(!t){reg.fb.className="fb";reg.ta.className="";setOk(reg,false);return}
  if(count){reg.tries=(reg.tries||0)+1;ST.tries[reg.key]=reg.tries}
  let r;try{r=reg.check(t)}catch(e){r={ok:false,items:[{kind:"structure",msg:"The checker had a problem with this sentence. Try writing it again."}],praise:[]}}
  reg.ta.className=r.ok?"ok":"no";
  const hardN=r.items.filter(isHard).length;
  reg.fb.className="fb on "+(r.ok?"good":hardN<=1?"mid":"bad");reg.fb.innerHTML=fbHTML(r,t,reg);
  const was=reg.ok;setOk(reg,r.ok);if(r.ok&&!was&&count&&reg.counted)toast(reg.tries===1?"Correct on the first try!":"Correct — well done!");
  save()}
function setOk(reg,ok){reg.ok=ok;if(ok)ST.ok[reg.key]=1;else delete ST.ok[reg.key];const dt=document.getElementById("dt"+reg.id);if(dt)dt.textContent=ok&&reg.counted?"✓ Done":"";
  if(reg.kind==="select"){}progress()}
function bindInputs(root){
  for(const reg of REG){if(reg.kind!=="write"||reg.bound)continue;reg.ta=document.getElementById(reg.id);if(!reg.ta)continue;reg.bound=true;reg.fb=document.getElementById("f"+reg.id);
    const wc=document.getElementById("wc"+reg.id);reg.wc=()=>{const w=(reg.ta.value.trim().match(/\S+/g)||[]).length;wc.textContent=w?w+" words":""};
    reg.ta.addEventListener("input",()=>{ST.saved[reg.key]=reg.ta.value;reg.wc();if(reg.ok){setOk(reg,false);reg.ta.className=""}save();sendTexts()});
    reg.ta.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();runCheck(reg,true)}});
    document.getElementById("w"+reg.id).addEventListener("click",e=>{const a=e.target.closest("[data-a]");if(!a)return;
      if(a.dataset.a==="check")runCheck(reg,true);
      else if(a.dataset.a==="hint"){const h=document.getElementById("h"+reg.id);h.innerHTML=hintHTML(reg.n,reg.hint);h.classList.toggle("on")}
      else if(a.dataset.a==="model"){reg.tries=Math.max(reg.tries,2);runCheck(reg,false)}})}}

/* ---------- progress + score for the site ---------- */
let lastPost="";
function progress(){
  const counted=REG.filter(r=>r.counted),ok=counted.filter(r=>r.ok).length,tot=counted.length;
  $("#pbar").style.width=(tot?100*ok/tot:0)+"%";$("#pnum").textContent=ok+" / "+tot+" done";
  const parts=[];
  CH.steps.forEach((s,si)=>{const rs=counted.filter(r=>r.step===si),o=rs.filter(r=>r.ok).length;const b=$("#st"+si);
    if(b){b.querySelector(".ct").textContent=rs.length?o+"/"+rs.length:"";b.classList.toggle("full",rs.length>0&&o===rs.length)}
    if(rs.length)parts.push({label:s.name,score:o,max:rs.length});
    (s._units||[]).forEach((u,ui)=>{const rr=counted.filter(r=>r.step===si&&r.unit===ui),oo=rr.filter(r=>r.ok).length;const c=$("#u"+si+"_"+ui);
      if(c){const sm=c.querySelector("small");if(sm)sm.textContent=rr.length?oo+"/"+rr.length:"";c.classList.toggle("full",rr.length>0&&oo===rr.length)}})});
  const k=ok+"/"+tot;if(inFrame&&k!==lastPost){lastPost=k;try{parent.postMessage({type:"ielts-workshop-score",score:ok,max:tot,parts:parts.slice(0,8),qs:[]},"*")}catch(e){}}}
let textT=null;
function sendTexts(){if(!inFrame)return;clearTimeout(textT);textT=setTimeout(()=>{
  const lines=REG.filter(r=>r.kind==="write"&&r.counted&&(r.ta&&r.ta.value.trim())).map(r=>(r.ok?"✓ ":"✗ ")+plain(r.prompt).slice(0,90)+"\n   "+r.ta.value.trim());
  if(lines.length)try{parent.postMessage({type:"ielts-workshop-text",texts:[{id:"sentences",text:(CH.kicker+" — the student's sentences\n\n"+lines.join("\n")).slice(0,20000)}]},"*")}catch(e){}},900)}
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove("on"),2000)}

/* ---------- blocks ---------- */
function blockBar(regs){
  const bar=document.createElement("div");bar.className="blockbar";
  bar.innerHTML='<button class="btn">Check all</button><button class="btn ghost">Clear</button><span class="score"></span>';
  const upd=()=>{bar.querySelector(".score").textContent=regs.filter(r=>r.ok).length+" / "+regs.length+" correct"};
  bar.children[0].onclick=()=>{regs.forEach(r=>{if(r.kind==="select")runSel(r,true);else if(r.kind==="gap")runGap(r,true);else if((r.ta.value||"").trim())runCheck(r,true)});upd()};
  bar.children[1].onclick=()=>{if(!confirm("Clear your answers in this exercise?"))return;regs.forEach(r=>{if(r.kind==="select"){r.ta.value="";r.ta.className="sel"}else if(r.kind==="gap"){r.ta.value="[]";r.ins.forEach(x=>{x.className="gap"});r.fb.className="fb"}else{r.ta.value="";r.ta.className="";r.fb.className="fb";r.wc()}delete ST.saved[r.key];delete ST.tries[r.key];r.tries=0;setOk(r,false)});save();upd()};
  return bar}
function learnUnit(si,ui,host){
  const card=document.createElement("div");card.className="card";
  card.innerHTML='<div class="nums" id="lnums"></div><div id="lpanel"></div>';host.appendChild(card);
  const nums=$("#lnums",card);nums.innerHTML=LEARN.map(L=>'<button class="sub" data-n="'+L.n+'">'+L.n+"</button>").join("");
  const GENERIC=CH.learnPatterns||{};
  const panels={};
  LEARN.forEach(L=>{const n=L.n;const m=D.gmeta[L.g]||{};const div=document.createElement("div");div.style.display="none";
    const egs=(L.eg||[]).map(x=>'<div class="eg"><span class="tg">Example</span><span>'+x+"</span></div>").join("")+(L.real||[]).map(x=>'<div class="eg real"><span class="tg">Real task</span><span>'+x+"</span></div>").join("");
    const it={pats:GENERIC[n]||[],n,nums:"graph",minNums:(CH.overviewStructures||[]).includes(n)?0:2};
    div.innerHTML='<div class="lhd"><div class="big">'+n+'</div><h3>'+L.t+'</h3></div><div class="chiprow">'+CHIPS[n].map(c=>'<span class="chip '+c[1]+'">'+esc(c[0])+"</span>").join("")+'</div>'+
      '<div class="legend"><span><i style="background:var(--chipSt)"></i>subject</span><span><i style="background:var(--chipVt)"></i>change / verb</span><span><i style="background:var(--chipLt)"></i>key linking words</span><span><i style="background:var(--chipNt)"></i>-ing / noun phrase</span></div>'+
      '<div class="two"><div>'+egs+'<div class="rule"><b>Rule.</b> '+L.rule+'</div><div class="trap"><b>Trap.</b> '+TRAP[n]+'</div></div>'+
      '<div><div class="gbox">'+chartSVG(L.g)+'</div><div class="gcap">'+esc(m.title||"")+(m.unit?" ("+esc(m.unit)+")":"")+'</div><div class="gmodel">'+((m.sents||[])[L.s]||"")+'</div><button class="replay">▶ Replay the line</button></div></div>'+
      '<div class="yourturn"><h4>Your turn · write your own Structure '+n+' sentence about this graph</h4>'+mkInput({key:"turn"+n,step:si,unit:ui,counted:false,n,check:t=>analyze(it,t,L.g,null),model:(m.sents||[])[L.s]})+"</div>";
    $("#lpanel",card).appendChild(div);panels[n]=div;$(".replay",div).onclick=()=>animate(div)});
  const show=n=>{ST.seen[n]=1;$$(".sub",nums).forEach(b=>{b.classList.toggle("on",+b.dataset.n===n);b.classList.toggle("seen",!!ST.seen[b.dataset.n])});for(const k in panels)panels[k].style.display=+k===n?"":"none";animate(panels[n]);save()};
  nums.onclick=e=>{const b=e.target.closest(".sub");if(b)show(+b.dataset.n)};
  card._show=show;setTimeout(()=>show(1),0)}
function graphsUnit(si,ui,host,items){
  const grid=document.createElement("div");grid.className="ggrid";
  items.forEach(it=>{const m=D.gmeta[it.graph];const c=document.createElement("div");c.className="gcard";
    let h='<div class="gt"><i>'+it.graph+"</i>"+esc(m.title)+' <span>('+esc(m.unit)+')</span></div><div class="gbox">'+chartSVG(it.graph)+"</div>";
    it.inputs.forEach((inp,j)=>{h+=mkInput({key:"g"+it.graph+"_"+j,step:si,unit:ui,label:inp.label,model:inp.model,n:it.n,hint:inp.hint||it.hint,prompt:m.title+(inp.label?" · "+plain(inp.label):""),check:t=>analyze(it,t,it.graph,inp)})});
    c.innerHTML=h;grid.appendChild(c)});
  host.appendChild(grid);
  const regs=REG.filter(r=>r.step===si&&r.unit===ui);const wrap=document.createElement("div");wrap.appendChild(blockBar(regs));host.appendChild(wrap)}
function writeUnit(si,ui,host,b,items){
  const card=document.createElement("div");card.className="card";
  let h=(b.title?"<h3>"+b.title+"</h3>":"")+(b.ins?'<div class="ins">'+b.ins+"</div>":"")+graphBox(b.graph);
  if(b.worked)h+='<div class="wk"><span class="l">Worked example</span><br>'+b.worked[0]+"<br><b>→</b> "+b.worked[1]+"</div>";
  card.innerHTML=h;
  items.forEach((q,i)=>{const e=document.createElement("div");e.className="q";const pr=b.escape?esc(q.prompt):q.prompt;
    e.innerHTML='<div class="p"><span class="num">'+(i+1)+".</span>"+pr+"</div>"+mkInput({key:b.key+"_"+i,step:si,unit:ui,rows:b.rows||2,model:q.model+(b.modelWhy&&q.why?"  (Mistake: "+q.why+")":""),n:q.n,hint:q.hint||b.hint,prompt:q.prompt,check:t=>analyze(q,t,null,null)});
    card.appendChild(e)});
  card.appendChild(blockBar(REG.filter(r=>r.step===si&&r.unit===ui&&r.key.startsWith(b.key+"_"))));host.appendChild(card)}
function runSel(r,count){const v=r.ta.value;if(!v){r.fb.className="fb";r.ta.className="sel";setOk(r,false);return}
  const answers=[].concat(r.ans).map(String);const ok=answers.includes(v);r.ta.className="sel "+(ok?"ok":"no");
  r.fb.className="fb on "+(ok?"good":"bad");let msg;
  if(r.generic)msg=ok?"Yes — "+esc(v)+"."+(r.why?" "+r.why:""):(r.tried?"The answer is <b>"+answers.map(esc).join("</b> or <b>")+"</b>."+(r.why?" "+r.why:""):(r.clue||"Look again and try once more."));
  else{const L=LEARN[r.ans-1];msg=ok?"Yes — Structure "+r.ans+": "+esc(plain(L.t)):"Look again at the linking words. "+(r.tried?"The answer is Structure "+r.ans+": "+esc(plain(L.t))+".":"Try once more.")}
  r.fb.innerHTML='<div class="hd"><span class="vd">'+(ok?"✓ Correct":"✗ Not yet")+'</span></div><div class="body"><div class="it '+(ok?"praise":"structure")+'"><div>'+msg+"</div></div></div>";
  if(count)r.tried=true;setOk(r,ok);save()}
function chooseUnit(si,ui,host,b,items){
  const card=document.createElement("div");card.className="card";card.innerHTML=(b.title?"<h3>"+b.title+"</h3>":"")+(b.ins?'<div class="ins">'+b.ins+"</div>":"")+graphBox(b.graph);
  const regs=[];
  items.forEach((q,i)=>{const id="s"+(uid++);const reg={id,key:b.key+"_"+i,step:si,unit:ui,counted:true,ok:false,kind:"select",ans:q.ans,why:q.why,clue:q.clue,generic:!!b.generic,prompt:q.prompt};REG.push(reg);regs.push(reg);
    const d=document.createElement("div");d.className="q";
    d.innerHTML='<div class="p"><span class="num">'+(i+1)+".</span>"+(b.generic?q.prompt:esc(q.prompt))+'</div><select class="sel" id="'+id+'" data-noreport="1"><option value="">'+(b.generic?(b.pick||"Choose"):(b.label||"Choose"))+"…</option>"+(q.options||b.options||[]).map(x=>"<option>"+esc(String(x))+"</option>").join("")+'</select><div class="fb" id="f'+id+'"></div>';
    card.appendChild(d)});
  card.appendChild(blockBar(regs));host.appendChild(card);
  regs.forEach(r=>{r.ta=card.querySelector("#"+r.id);r.fb=card.querySelector("#f"+r.id);r.wc=()=>{};r.ta.addEventListener("change",()=>{ST.saved[r.key]=r.ta.value;runSel(r,true)})})}
function graphBox(gid){if(!gid)return "";return [].concat(gid).map(g=>{const m=D.gmeta[g]||{};return '<div class="gbox wide">'+chartSVG(g)+'</div><div class="gcap">'+esc(m.title||"")+(m.unit?" ("+esc(m.unit)+")":"")+"</div>"}).join("")}
/* gaps: one word (or a short phrase) in each ___ ; every gap must be right */
const gnorm=t=>String(t||"").toLowerCase().replace(/[’‘]/g,"'").replace(/(\d),(?=\d{3}\b)/g,"$1").replace(/\s+/g," ").replace(/\s*%/g,"%").replace(/[.,;!]+$/,"").trim();
function runGap(r,count){const vals=r.ins.map(x=>x.value);const any=vals.some(v=>v.trim());
  if(!any){r.fb.className="fb";r.ins.forEach(x=>x.className="gap");setOk(r,false);return}
  if(count){r.tries=(r.tries||0)+1;ST.tries[r.key]=r.tries}
  let right=r.ans.map((alts,k)=>alts.map(gnorm).includes(gnorm(vals[k])));
  // Some items have answers that must go together (between … and / from … to).
  if(r.combos){const hit=r.combos.find(c=>c.every((w,k)=>gnorm(vals[k])===gnorm(w)));right=hit?right.map(()=>true):right.map((x,k)=>x&&r.combos.some(c=>gnorm(c[k])===gnorm(vals[k])&&c.some((w,j)=>j!==k&&gnorm(vals[j])===gnorm(w))))}
  const ok=right.every(Boolean);
  r.ins.forEach((x,k)=>x.className="gap "+(right[k]?"ok":"no"));
  const show=!ok&&(r.tries||0)>=2;
  r.fb.className="fb on "+(ok?"good":"bad");
  r.fb.innerHTML='<div class="hd"><span class="vd">'+(ok?"✓ Correct":right.some(Boolean)?"Almost — check the red gap":"✗ Not yet")+'</span></div>'+((ok&&r.why)||show?'<div class="body"><div class="it '+(ok?"praise":"structure")+'"><div>'+(show?"Answer: <b>"+r.ans.map(a=>a.map(esc).join(" / ")).join("</b> … <b>")+"</b>. ":"")+(r.why?esc(r.why):"")+"</div></div></div>":"");
  const was=r.ok;setOk(r,ok);if(ok&&!was&&count)toast(r.tries===1?"Correct on the first try!":"Correct — well done!");save()}
function gapsUnit(si,ui,host,b,items){
  const card=document.createElement("div");card.className="card";card.innerHTML=(b.title?"<h3>"+b.title+"</h3>":"")+(b.ins?'<div class="ins">'+b.ins+"</div>":"")+graphBox(b.graph);
  const regs=[];
  items.forEach((q,i)=>{const id="g"+(uid++);const parts=q.text.split(/_{3,}/);const ans=q.ans.map(a=>[].concat(a));
    const reg={id,key:b.key+"_"+i,step:si,unit:ui,counted:true,ok:false,kind:"gap",ans,combos:q.combos,why:q.why,prompt:q.text.replace(/_{3,}/g,"___"),tries:0};REG.push(reg);regs.push(reg);
    const w=Math.max(4,...ans.map(a=>Math.max(...a.map(x=>x.length))));
    let html=esc(parts[0]);for(let k=1;k<parts.length;k++)html+='<input class="gap" data-noreport="1" autocomplete="off" autocapitalize="off" spellcheck="false" style="width:'+Math.min(24,w+3)+'ch" aria-label="gap '+k+'">'+esc(parts[k]);
    const d=document.createElement("div");d.className="q";
    d.innerHTML='<div class="p gp"><span class="num">'+(i+1)+".</span><span>"+html+'</span></div><div class="irow"><button class="btn" data-a="check">Check</button><span class="done-tag" id="dt'+id+'"></span></div><div class="fb" id="f'+id+'"></div>';
    card.appendChild(d);
    reg.ins=[...d.querySelectorAll("input.gap")];
    reg.ta={get value(){return JSON.stringify(reg.ins.map(x=>x.value))},set value(v){let a=[];try{a=JSON.parse(v||"[]")}catch(e){}reg.ins.forEach((x,k)=>{x.value=a[k]||""})},set className(c){}};
    reg.fb=d.querySelector(".fb");reg.wc=()=>{};
    reg.ins.forEach((x,k)=>{x.addEventListener("input",()=>{ST.saved[reg.key]=reg.ta.value;if(reg.ok)setOk(reg,false);x.className="gap";save()});
      x.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();if(k<reg.ins.length-1)reg.ins[k+1].focus();else runGap(reg,true)}})});
    d.querySelector("[data-a=check]").onclick=()=>runGap(reg,true)});
  card.appendChild(blockBar(regs));host.appendChild(card)}
function drillUnit(si,ui,host,d,bkey){
  writeUnit(si,ui,host,{key:bkey+d.n,title:"Drill "+d.n+" · "+d.title,ins:d.formula+" — "+d.rule,worked:d.worked},d.items)}

/* ---------- page ---------- */
function build(){
  document.title=CH.title.replace(/<[^>]+>/g,"")+" · "+CH.kicker+" · Mr Ikromov's IELTS";
  document.body.innerHTML='<header class="band"><div class="wrap"><div class="kick">'+CH.kicker+'</div><h1>'+CH.title+'</h1><p>'+CH.lead+'</p><div class="prog"><div class="bar"><i id="pbar"></i></div><b id="pnum"></b></div></div></header>'+
    '<nav class="steps"><div class="wrap"><div class="row" id="steps"></div></div></nav><main class="wrap" id="main"></main><div class="foot">'+(CH.footer||"")+'</div><div id="toast"></div>';
  const nav=$("#steps"),main=$("#main");
  CH.steps.forEach((s,si)=>{
    nav.insertAdjacentHTML("beforeend",'<button class="step" id="st'+si+'" data-i="'+si+'"><span class="no">'+s.no+"</span>"+s.name+' <span class="ct"></span></button>');
    const sec=document.createElement("section");sec.className="sec";sec.id="sec"+si;sec.style.display="none";
    sec.innerHTML='<div class="sec-title"><span class="n">'+s.no+"</span><h2>"+s.title+"</h2></div>"+(s.lead?'<p class="lead">'+s.lead+"</p>":"")+(s.note?'<div class="note">'+s.note+"</div>":"");
    main.appendChild(sec);
    // units: each shown on its own (sub menu) when the step has more than one
    const units=[];
    for(const b of s.blocks){
      if(b.type==="graphs"){const groups=[];for(const it of D[b.data]){let g=groups.find(x=>x.k===it.group);if(!g){g={k:it.group,label:it.groupLabel,items:[]};groups.push(g)}g.items.push(it)}
        groups.forEach(g=>units.push({label:(g.label||"").replace(/^Structures? /,"").replace(/ ·.*/,""),title:g.label,render:(ui,h)=>graphsUnit(si,ui,h,g.items)}))}
      else if(b.type==="drills")D[b.data].forEach(d=>units.push({label:String(d.n),title:"Drill "+d.n,render:(ui,h)=>drillUnit(si,ui,h,d,b.key||"d")}));
      else if(b.type==="learn")units.push({label:"Learn",render:(ui,h)=>learnUnit(si,ui,h)});
      else if(b.type==="html")units.push({label:b.label||"Info",inline:true,render:(ui,h)=>{const c=document.createElement("div");c.innerHTML=(b.title?'<h3 class="sub-h" style="font-size:16px;margin:18px 0 8px">'+b.title+"</h3>":"")+(b.graph?'<div class="card">'+graphBox(b.graph)+"</div>":"")+(b.html||"");h.appendChild(c)}});
      else if(b.type==="gaps")units.push({label:b.label||b.title,render:(ui,h)=>gapsUnit(si,ui,h,b,D[b.data])});
      else if(b.type==="write")units.push({label:b.label||b.title,render:(ui,h)=>writeUnit(si,ui,h,b,D[b.data])});
      else if(b.type==="choose")units.push({label:b.label||b.title,render:(ui,h)=>chooseUnit(si,ui,h,b,D[b.data])});
    }
    s._units=units;
    const tabs=units.filter(u=>!u.inline);
    const sub=document.createElement("div");sub.className="subnav";if(s.subnav&&tabs.length>1)sec.appendChild(sub);
    const host=document.createElement("div");sec.appendChild(host);
    units.forEach((u,ui)=>{const box=document.createElement("div");box.className="unit";box.dataset.u=ui;u.render(ui,box);host.appendChild(box);u.box=box;
      if(s.subnav&&!u.inline&&tabs.length>1)sub.insertAdjacentHTML("beforeend",'<button class="sub" id="u'+si+'_'+ui+'" data-u="'+ui+'">'+esc(u.label)+" <small></small></button>")});
    if(s.subnav&&tabs.length>1){sub.onclick=e=>{const b=e.target.closest(".sub");if(b)showUnit(si,+b.dataset.u,true)}}
    const nb=document.createElement("div");nb.className="nextbar";
    nb.innerHTML=(si>0?'<button class="btn ghost" data-go="'+(si-1)+'">← '+CH.steps[si-1].name+"</button>":"<span></span>")+(si<CH.steps.length-1?'<button class="btn go" data-go="'+(si+1)+'">Next: '+CH.steps[si+1].name+" →</button>":'<span class="wc">This is the last step. Check your progress at the top.</span>');
    nb.onclick=e=>{const b=e.target.closest("[data-go]");if(b){showStep(+b.dataset.go);window.scrollTo(0,0)}};sec.appendChild(nb);
  });
  nav.onclick=e=>{const b=e.target.closest(".step");if(b){showStep(+b.dataset.i);window.scrollTo(0,0)}};
  bindInputs();buildVocab(D);
}
function showUnit(si,ui,scroll){const s=CH.steps[si];if(!s.subnav)return;ST.unit[si]=ui;
  s._units.forEach((u,k)=>{if(u.inline)return;u.box.style.display=k===ui?"":"none";const b=$("#u"+si+"_"+k);if(b)b.classList.toggle("on",k===ui)});
  $$("svg.chart",s._units[ui].box).forEach(c=>{c.classList.remove("draw");void c.getBoundingClientRect();c.classList.add("draw")});
  if(scroll){const t=$("#sec"+si);window.scrollTo({top:Math.max(0,t.getBoundingClientRect().top+window.scrollY-70)})}save()}
function showStep(si){ST.step=si;CH.steps.forEach((s,k)=>{$("#sec"+k).style.display=k===si?"":"none";$("#st"+k).classList.toggle("on",k===si)});
  const b=$("#st"+si);if(b&&b.scrollIntoView)b.scrollIntoView({block:"nearest",inline:"center"});
  const s=CH.steps[si];if(s.subnav){const first=Math.max(0,s._units.findIndex(u=>!u.inline));let u=ST.unit[si];if(u==null||!s._units[u]||s._units[u].inline)u=first;showUnit(si,u,false)}save()}
function applyState(){
  for(const r of REG){const v=ST.saved[r.key];if(v==null||!r.ta)continue;r.ta.value=v;r.tries=ST.tries[r.key]||0;
    if(r.kind==="select"){if(v)runSel(r,false)}else if(r.kind==="gap"){r.tries=ST.tries[r.key]||0;if(ST.ok[r.key])runGap(r,false)}else{r.wc();if(ST.ok[r.key]){r.ta.className="ok";setOk(r,true)}}}
  showStep(Math.min(ST.step||0,CH.steps.length-1));progress();sendTexts()}

build();
// load saved progress: from the site (in the frame) or from this browser
let got=false;
window.addEventListener("message",e=>{const d=e.data;if(!d||d.type!=="ielts-lab-state"||d.id!==CH.id)return;if(d.theme)setTheme(d.theme);if(!got){got=true;restore(d.data);if(!d.data)fallback()}});
function fallback(){try{restore(localStorage.getItem("ielts-lab:"+CH.id))}catch(e){}}
showStep(0);progress();
if(inFrame){try{parent.postMessage({type:"ielts-lab-load",id:CH.id},"*")}catch(e){}setTimeout(()=>{if(!got){got=true;fallback()}},900)}else{got=true;fallback()}
})();
