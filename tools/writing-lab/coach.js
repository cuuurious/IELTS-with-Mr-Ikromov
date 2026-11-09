/* ================= WRITING COACH ENGINE (rule based) ================= */
const STOP=new Set("the and for was were that with this from into have has had its their they them been being are but not all any also then than who which when while his her our your out can will would could should about over under between during after before".split(" "));
function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function norm(t){return t.toLowerCase().replace(/[’‘]/g,"'").replace(/[–—]/g,"-").replace(/\$/g,"").replace(/(\d),(?=\d{3}\b)/g,"$1").replace(/\s+/g," ").trim().replace(/[.!]+$/,"")}
function numsOf(t){return (norm(t).match(/\d+(?:\.\d+)?/g)||[]).map(x=>String(parseFloat(x)))}
function toks(t){return (norm(t).match(/[a-z]+/g)||[]).filter(w=>w.length>2&&!STOP.has(w))}
function overlap(model,stu){const m=toks(model),s=toks(stu);if(!m.length)return 1;let c=0;for(const w of m){if(s.some(x=>x.slice(0,4)===w.slice(0,4)))c++}return c/m.length}
function uniq(a){return [...new Set(a)]}


/* ---- direction lexicon ---- */
const UP=/\b(ris(?:e|es|ing)|rose|risen|increas\w*|grew|grow\w*|climb\w*|jump\w*|surg\w*|soar\w*|improv\w*|rebound\w*|recover\w*|upward\w*|upturn|doubl\w*|tripl\w*|boom\w*|escalat\w*|skyrocket\w*|rocket\w*|upswing|gain\w*|bounc\w* back|pick\w* up|shot up|went up|go(?:es)? up|more popular|peak\w*)\b/gi;
const DOWN=/\b(fall\w*|fell|fallen|drop\w*|declin\w*|decreas\w*|dip\w*|plung\w*|plummet\w*|collaps\w*|slump\w*|slid\w*|slip\w*|tumbl\w*|downward\w*|downturn|halv\w*|shr[ua]nk|shrink\w*|reduc\w*|went down|go(?:es)? down|sank|sink\w*|diminish\w*|dwindl\w*|less popular)\b/gi;
function dirsOf(t){const out=[];const s=t.replace(/[’‘]/g,"'");const all=[];let m;
  UP.lastIndex=0;DOWN.lastIndex=0;
  while((m=UP.exec(s)))all.push([m.index,"U",m[0]]);
  while((m=DOWN.exec(s)))all.push([m.index,"D",m[0]]);
  all.sort((a,b)=>a[0]-b[0]);return all}

/* ---- vocabulary for spelling guard ---- */
const COMMON=("bought sold paid spent saw took gave made went came got given taken seen gone done lost won built broke chose brought held kept left lent met ran sent set sat stood told thought understood wore wrote drove flew fed felt found heard hit hurt knew led put read said sang sank spoke swam threw woke a able about above across after again against all almost along also although always among amount an and another any are around as at average back be became because become been before began behind being below best better between big both but by call came can cannot case change changed changes cent chart close come compared comparison completely consider continue continued could country data day days decade decades decline declined decrease decreased did different do does down downward dramatically during each early either end ended ending enough even ever every few fewer figure figures final first five for four from further future general given go good great greater group grew growth had half has have he her high higher highest his how however hundred if in increase increased increasing into is it its just keep kept known large larger last late later least less level levels like likely little long lot low lower lowest made main make many may mean million more most much must near nearly need never new next no not nothing number numbers of off often old on once one only open or other our out over own part past people per percent percentage period place point points proportion proportions rate rates rather reach reached real record remain remained remains rest result right rise rises rising rose same say second see seen set several she should show shown shows significantly since slight slightly small smaller so some start started still such take than that the their them then there these they third this those three through time to together too total toward towards two under until up upward us use used very was way we well were what when where which while who whole will with within without would year years yet you your "+
"gradually steadily sharply rapidly dramatically considerably substantially noticeably significantly slightly marginally immediately suddenly sharply moderately approximately roughly around about nearly almost exactly precisely overall generally mainly mostly largely mainly respectively approximately "+
"peak peaked peaking trough fluctuate fluctuated fluctuating fluctuation stable stabilise stabilised stabilize stabilized plateau leveled levelled remain remained remaining unchanged constant steady steadily surge surged soar soared plunge plunged plummet plummeted collapse collapsed slump slumped recover recovered recovery rebound rebounded jump jumped climb climbed dip dipped drop dropped fall fell fallen rise rose risen grow grew grown decline declined decrease decreased increase increased improve improved edge edged edges upward downward upturn downturn "+
"proportion percentage amount number figure rate level total average majority minority quarter third half double doubled triple tripled twice thrice "+
"government spending income expenditure consumption production sales exports imports revenue profit cost price prices unemployment employment population households household passengers visitors tourists students workers women men children adults young old female male people countries country company companies industry sector energy oil gas coal sugar rice wheat water electricity cars car train trains rail coach air travel transport transportation public private tonnes tons million billion thousand hundred dollars pounds euros january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday "+
"former latter respectively whereas while although despite starting started reaching followed following preceded before after which that those these another second third fourth fifth sixth "+
"line graph bar chart table pie diagram process map illustrates shows compares displays gives information summarises summarizes overview detail details highlight highlights feature features trend trends pattern patterns key main significant notable noticeable dramatic substantial considerable slight moderate gradual steady sharp rapid sudden marked").split(/\s+/);
const MISSP={dramaticly:"dramatically",dramaticaly:"dramatically",sligthly:"slightly",slighty:"slightly",signifigant:"significant",signficant:"significant",significent:"significant",significantly:"significantly",increse:"increase",incresed:"increased",increasd:"increased",decrese:"decrease",decresed:"decreased",decreasd:"decreased",percentige:"percentage",precentage:"percentage",perecentage:"percentage",percantage:"percentage",porportion:"proportion",proportoin:"proportion",proporsion:"proportion",flucuate:"fluctuate",flactuate:"fluctuate",flucuated:"fluctuated",fluctuaded:"fluctuated",fluctation:"fluctuation",recieve:"receive",recieved:"received",occured:"occurred",occurence:"occurrence",beggining:"beginning",begining:"beginning",untill:"until",thier:"their",definately:"definitely",seperate:"separate",acheive:"achieve",acheived:"achieved",peeked:"peaked",peeked:"peaked",dropt:"dropped",plumet:"plummet",plumeted:"plummeted",plumetted:"plummeted",sharpley:"sharply",steadly:"steadily",stedily:"steadily",gradualy:"gradually",graduly:"gradually",rapidely:"rapidly",rapidlly:"rapidly",consideraly:"considerably",considerabley:"considerably",substantialy:"substantially",noticably:"noticeably",noticable:"noticeable",approximatly:"approximately",aproximately:"approximately",approximetely:"approximately",appoximately:"approximately",compair:"compare",comparision:"comparison",compaired:"compared",diffrence:"difference",diffrent:"different",diferent:"different",beacuse:"because",becuase:"because",becouse:"because",wich:"which",whitch:"which",whic:"which",wile:"while",whle:"while",teh:"the",adn:"and",alot:"a lot",tendancy:"tendency",stablised:"stabilised",stabalise:"stabilise",stabilize:"stabilize",statistcs:"statistics",statistc:"statistic",numbr:"number",nuber:"number",amoung:"among",amout:"amount",totall:"total",totaly:"totally",higest:"highest",lowset:"lowest",lowst:"lowest",higher:"higher",highr:"higher",hight:"height",increasse:"increase",decrasing:"decreasing",decresing:"decreasing",icrease:"increase",raise:"rise"};
delete MISSP.significantly;delete MISSP.higher;delete MISSP.stabilize;delete MISSP.raise;delete MISSP.hight;
let VOCAB=null;
function buildVocab(D){
  const set=new Set(COMMON.map(w=>w.toLowerCase()));
  const feed=s=>{(String(s).toLowerCase().replace(/<[^>]+>/g," ").match(/[a-z]+/g)||[]).forEach(w=>set.add(w))};
  try{
    for(const k in D.gmeta){const m=D.gmeta[k];feed(m.title);feed(m.unit);(m.series||[]).forEach(feed);(m.sents||[]).forEach(feed)}
    const walk=o=>{if(!o)return;if(typeof o==="string"){feed(o);return}if(Array.isArray(o)){o.forEach(walk);return}if(typeof o==="object"){for(const k in o){if(k==="graphs")continue;walk(o[k])}}};
    for(const k in D){if(k!=="gmeta"&&k!=="graphs")walk(D[k])}
  }catch(e){}
  VOCAB=set;return set}
function stems(w){const o=[w];
  if(w.endsWith("ies"))o.push(w.slice(0,-3)+"y");
  if(w.endsWith("es"))o.push(w.slice(0,-2));
  if(w.endsWith("s"))o.push(w.slice(0,-1));
  if(w.endsWith("ied"))o.push(w.slice(0,-3)+"y");
  if(w.endsWith("ed")){o.push(w.slice(0,-2));o.push(w.slice(0,-1))}
  if(w.endsWith("ing")){o.push(w.slice(0,-3));o.push(w.slice(0,-3)+"e")}
  if(w.endsWith("ly")){o.push(w.slice(0,-2));o.push(w.slice(0,-3)+"y")}
  if(w.endsWith("ally"))o.push(w.slice(0,-4));
  if(w.endsWith("er"))o.push(w.slice(0,-2));
  if(w.endsWith("est"))o.push(w.slice(0,-3));
  if(w.endsWith("ment")||w.endsWith("ness"))o.push(w.slice(0,-4));
  if(/(.)\1ing$/.test(w))o.push(w.slice(0,-4));
  if(/(.)\1ed$/.test(w))o.push(w.slice(0,-3));
  return o}
function known(w){if(VOCAB.has(w))return true;return stems(w).some(s=>VOCAB.has(s))}
function lev(a,b){const m=a.length,n=b.length;if(Math.abs(m-n)>2)return 9;const d=Array.from({length:m+1},(_,i)=>[i]);for(let j=1;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n]}
function nearWord(w){let best=null,bd=9;const lim=w.length>=8?2:1;
  for(const v of VOCAB){if(v.length<4||Math.abs(v.length-w.length)>lim)continue;if(v[0]!==w[0]&&v[1]!==w[1])continue;const d=lev(w,v);if(d<bd&&d<=lim){bd=d;best=v}}
  return best}

/* ---- grammar rules (hard errors) ---- */
const CHV="rose|rise|rises|risen|rising|increased?|increases|increasing|fell|fall|falls|fallen|falling|dropped|drops?|dropping|declined?|declines|declining|grew|grows?|growing|climbed|climbs?|climbing|dipped|dips?|decreased?|decreases|decreasing|jumped|jumps?|surged?|soared?|plunged?|plummeted|collapsed|improved?|slumped|recovered|rebounded|peaked";
const SUBJ="figure|figures|number|numbers|amount|percentage|proportion|rate|level|price|cost|total|sales|production|consumption|it|they|exports|imports|spending|income|unemployment|population";
const ADV="(?:\\w+ly\\s+)?";
const RULES=[
 {id:"followedNoArt",re:/\bfollowed by\s+(?:(slight|small|sharp|steady|gradual|dramatic|significant|considerable|rapid|noticeable|substantial|marginal|further|modest|steep|large|big|huge)\s+)?(rise|fall|drop|increase|decrease|decline|dip|jump|growth|recovery|plunge|surge|climb|reduction|slump|rebound)\b/gi,test:m=>true,fix:m=>"followed by "+(/^[aeiou]/i.test(m[1]||m[2])?"an ":"a ")+(m[1]?m[1]+" ":"")+m[2],msg:"Put a / an before the noun after ‘followed by’.",why:"This was followed by + a / an + (adjective) + noun: a fall, a sharp rise, an increase."},
 {id:"rised",re:/\brised\b/gi,msg:"'rised' is not a word.",fix:"rose",why:"Rise is irregular: rise – rose – risen."},
 {id:"falled",re:/\bfalled\b/gi,msg:"'falled' is not a word.",fix:"fell",why:"Fall is irregular: fall – fell – fallen."},
 {id:"growed",re:/\bgrowed\b/gi,msg:"'growed' is not a word.",fix:"grew",why:"Grow is irregular: grow – grew – grown."},
 {id:"raisedI",re:/\braised\s+(?=(?:to|from|slightly|sharply|steadily|significantly|dramatically|gradually|considerably|rapidly|noticeably)\b)/gi,test:(m,t,i)=>!/\b(?:was|were|been|be|being)\s$/i.test(t.slice(0,i)),msg:"'raised' needs an object (someone raises something). A figure on a graph rises by itself.",fix:"rose",why:"Raise (transitive) ≠ rise (intransitive). A line or figure ‘rose’."},
 {id:"risen",re:/\brisen\b/gi,test:(m,t,i)=>{const pre=t.slice(0,i);return !/\b(?:has|have|had|having|been|be)\s$/i.test(pre)&&!/\b(?:has|have|had)\s\w+ly\s$/i.test(pre)},msg:"'risen' is the past participle: it needs has / have / had.",fix:"rose",why:"Past simple = rose. Perfect = has risen."},
 {id:"fallen",re:/\bfallen\b/gi,test:(m,t,i)=>{const pre=t.slice(0,i);return !/\b(?:has|have|had|having|been|be)\s$/i.test(pre)&&!/\b(?:has|have|had)\s\w+ly\s$/i.test(pre)},msg:"'fallen' is the past participle: it needs has / have / had.",fix:"fell",why:"Past simple = fell. Perfect = has fallen."},
 {id:"felt",re:new RegExp("\\b(?:"+SUBJ+")\\s+"+ADV+"(felt)\\b","gi"),grp:1,msg:"'felt' is from ‘feel’. The past of ‘fall’ is ‘fell’.",fix:"fell",why:"Fall – fell – fallen."},
 {id:"svbase",re:new RegExp("\\b(?:figure|number|amount|percentage|proportion|rate|level|total|production|consumption)\\s+"+ADV+"(rise|increase|fall|drop|decline|decrease|grow|climb|dip|jump)(?=\\s+(?:to|from|by|slightly|sharply|steadily|gradually|significantly|dramatically|considerably|and|but|then)\\b)","gi"),grp:1,msg:"The verb is missing its ending (the sentence is in the past).",fix:"add -ed (or use rose / fell / grew)",why:"Task 1 about past years uses the past simple: increased, dropped, rose."},
 {id:"aan1",re:/\ba\s+(?=(?:[aeiou]\w*|8\d*\b|11\b|18\b))(?!(?:uni\w*|use\w*|usual\w*|euro\w*|one\b|once\b|ubiq\w*|util\w*|uran\w*|ut\w*))(\S+)/gi,msg:"Use ‘an’ before a vowel sound.",fix:m=>"an "+m[1],why:"‘an’ goes before a vowel sound: an increase, an upward trend, an 8% rise."},
 {id:"aan2",re:/\ban\s+(?!(?:[aeiou]|hour|honest|honou?r|heir|mp\b|8\b|8\d|11\b|18\b|x-))(\S+)/gi,msg:"Use ‘a’ before a consonant sound.",fix:m=>"a "+m[1],why:"‘a’ goes before a consonant sound: a rise, a decrease, a 20% fall."},
 {id:"nofv",re:/\b(the (?:number|amount|percentage|proportion|figure|rate|level|price|cost|total) (?:of|for) (?:[^,.;()]{1,60}?)\s)(were|are|have)\b/gi,test:m=>!/\b(who|which|that|and|while|but|whereas|as|with|from|to)\b/i.test(m[1]),grp:2,msg:"‘The number of …’ takes a singular verb.",fix:m=>({were:"was",are:"is",have:"has"}[m[2].toLowerCase()]),why:"The head noun is ‘number / amount / percentage’: it is singular. The number of people WAS 5 million."},
 {id:"plsv",re:/\b(figures|numbers|percentages|proportions|rates|levels)\s+(?:for [a-z ]{3,30}?\s)?(was|has|is)\b/gi,grp:2,msg:"The subject is plural, so the verb must be plural.",fix:m=>({was:"were",has:"have",is:"are"}[m[2].toLowerCase()]),why:"The figures WERE …, the numbers HAVE …"},
 {id:"prepAt",re:new RegExp("\\b(?:rose|rise|increased?|fell|fall|dropped|drop|declined?|grew|climbed|dipped|decreased?|jumped|surged|soared|plunged|plummeted)\\s+"+ADV+"(at)\\s+(?=\\$?\\d)","gi"),grp:1,msg:"After a change verb use ‘to’ (the end figure) or ‘by’ (the size of the change), not ‘at’.",fix:"to",why:"rose TO 20 million (end point) · rose BY 5 million (amount). ‘stood at / peaked at’ describe a level."},
 {id:"prepIn",re:new RegExp("\\b(?:rose|increased?|fell|dropped|declined?|grew|climbed|dipped|decreased?|jumped|surged|soared|plunged|plummeted)\\s+"+ADV+"(in|with|of)\\s+(?!(?:19|20)\\d\\d\\b)(?=\\$?\\d)","gi"),grp:1,msg:"Wrong preposition before a figure.",fix:"to (end figure) or by (amount)",why:"rose TO 20% · rose BY 5%. Use ‘in’ only with a year or month."},
 {id:"nounBy",re:/\b(?:an?|the)\s+(?:\w+ly\s+|\w+\s+)?(increase|rise|fall|drop|decline|decrease|growth|dip|jump|surge)\s+(by)\b/gi,grp:2,msg:"After the noun ‘increase / rise / fall’ use ‘of’ (size) or ‘to’ (end figure).",fix:"of",why:"a rise OF 5% · a rise TO 20%. (The verb takes ‘by’: rose BY 5%.)"},
 {id:"despOf",re:/\bdespite of\b/gi,msg:"Do not add ‘of’ after Despite.",fix:"Despite",why:"Despite = in spite of. Use only one of the two."},
 {id:"despClause",re:new RegExp("\\bdespite\\s+(?:the\\s+)?(?:\\w+\\s+){0,5}?(?:"+SUBJ+")\\s+"+ADV+"(?:rose|fell|increased|decreased|dropped|declined|grew|climbed|dipped|jumped|surged|soared|plunged|plummeted|was|were)\\b","gi"),msg:"After Despite use -ing or a noun phrase, not a full clause with a verb.",fix:"Despite rising … / Despite a rise …",why:"Despite + noun/-ing. (Although + clause is the clause version.)"},
 {id:"despV",re:/(^|[.!?]\s+)(despite)\s+(?=(?:rose|fell|increased|decreased|dropped|declined|grew|climbed|dipped|peaked|reached|jumped|surged)\b)/gi,grp:2,msg:"Despite + verb must be Despite + -ing.",fix:"Despite rising / falling …",why:"Despite + -ing / noun: Despite rising to 5%, the figure fell."},
 {id:"runOn",re:new RegExp("(?:\\d|%|million|billion|thousand)\\s+(it|they)\\s+"+ADV+"(?:rose|fell|increased|decreased|dropped|declined|grew|climbed|dipped|jumped|surged|soared|plunged|plummeted|peaked|reached|remained)\\b","gi"),grp:1,msg:"Two clauses run together with no linking word or punctuation (run-on sentence).",fix:"add ‘and’ / ‘but’ / ‘, after which’ or start a new sentence",why:"Join two changes with a linking word (Structures 1, 4, 9) or use a full stop."},
 {id:"afterV",re:/(^|[.!?]\s+)(after)\s+(?=(?:rose|fell|increased|decreased|dropped|declined|grew|climbed|dipped|peaked|reached)\b)/gi,grp:2,msg:"After + verb must be After + -ing.",fix:"After rising / falling …",why:"After + -ing: After rising to 4,000, the figure fell."},
 {id:"whichIng",re:/\bwhich\s+(reaching|rising|falling|leaving|bringing|standing|dropping|increasing|decreasing)\b/gi,msg:"Do not put ‘which’ before an -ing form.",fix:m=>m[1],why:"either ‘, which reached …’ or ‘, reaching …’, never ‘which reaching’."},
 {id:"commaReached",re:/,\s+(reached|hit|brought|left)\s+(?=(?:\d|\$|a\s|an\s|its\b|the\s))/gi,test:(m,t,i)=>!/\b(?:and|but)\s*$/i.test(t.slice(Math.max(0,i-5),i)),grp:1,msg:"A verb after a comma needs a subject or ‘and’. For one subject, use -ing.",fix:m=>({reached:"reaching",hit:"hitting",brought:"bringing",left:"leaving"}[m[1].toLowerCase()]),why:"…rose in 2000, REACHING 200 tons (Structure 5)."},
 {id:"reachTo",re:/\breach(?:ed|es|ing)?\s+(to)\b/gi,grp:1,msg:"‘reach’ takes the figure directly, without ‘to’.",fix:"(delete ‘to’)",why:"reached 200 tons · rose to 200 tons."},
 {id:"riseUp",re:/\b(?:rose|rise|rising|rises|fell|fall|falling|falls|raised)\s+(up|down)\b/gi,grp:1,msg:"‘up / down’ is not needed after rise or fall.",fix:"(delete)",why:"rose already means ‘went up’."},
 {id:"moreHigher",re:/\b(more|most)\s+(higher|lower|bigger|larger|highest|lowest|smaller|better|worse)\b/gi,msg:"Do not use ‘more/most’ with -er / -est words.",fix:m=>m[2],why:"higher (not more higher); the highest (not the most highest)."},
 {id:"advAdj",re:/\ba\s+(significantly|dramatically|sharply|slightly|steadily|gradually|considerably|rapidly|noticeably|substantially|suddenly|moderately)\s+(?=(?:rise|fall|increase|drop|decline|decrease|dip|jump|growth|surge|peak)\b)/gi,grp:1,msg:"Before a noun use an adjective, not an adverb.",fix:m=>m[1].replace(/ly$/,"").replace(/ical$/,"ic").replace(/^significant$/,"significant"),why:"a significant rise (noun phrase) · rose significantly (verb + adverb)."},
 {id:"adjAdv",re:new RegExp("\\b(?:rose|increased|fell|decreased|dropped|declined|grew|climbed|dipped|jumped|surged|soared|plunged)\\s+(slight|sharp|steady|gradual|dramatic|significant|considerable|rapid|noticeable|substantial|sudden|marked|moderate)\\b(?!ly)(?!\\s+(?:rise|fall|increase|drop|decline|decrease|dip|jump|growth|change|peak))","gi"),grp:1,msg:"After a verb use an adverb (-ly), not an adjective.",fix:m=>m[1]+"ly",why:"rose slightly · a slight rise."},
 {id:"yearThe",re:/\bin the\s+((?:19|20)\d\d)\b/gi,msg:"No ‘the’ before a year.",fix:m=>"in "+m[1],why:"in 2005 (not in the 2005)."},
 {id:"yearOn",re:/\b(on|at)\s+((?:19|20)\d\d)\b/gi,grp:1,msg:"Use ‘in’ with a year.",fix:"in",why:"in 2005 · in July · on Monday · at the end of 2005."},
 {id:"betweenTo",re:/\bbetween\s+(?:19|20)\d\d\s+(to|-|until)\s+(?:19|20)\d\d/gi,grp:1,msg:"between … AND …; from … TO …",fix:"and",why:"between 2000 and 2005 · from 2000 to 2005."},
 {id:"fromAnd",re:/\bfrom\s+(?:19|20)\d\d\s+(and)\s+(?:19|20)\d\d/gi,grp:1,msg:"from … TO …; between … AND …",fix:"to",why:"from 2000 to 2005 · between 2000 and 2005."},
 {id:"plNum",re:/\b\d+(?:\.\d+)?\s+(millions|thousands|billions|hundreds)\b/gi,grp:1,msg:"After a number, million / thousand / hundred are singular.",fix:m=>m[1].slice(0,-1),why:"5 million people (but millions of people)."},
 {id:"percents",re:/\bpercents\b/gi,msg:"‘percent’ has no plural -s.",fix:"percent",why:"20 percent · 20%."},
 {id:"amtCount",re:/\b(amount of)\s+(?=(?:people|students|cars|computers|items|visitors|passengers|men|women|children|workers|tourists|companies|households|goods|products|jobs|houses|tourists)\b)/gi,grp:1,msg:"Use ‘number of’ with countable nouns.",fix:"number of",why:"the NUMBER of people · the AMOUNT of money."},
 {id:"numUncount",re:/\b(number of)\s+(?=(?:money|oil|sugar|water|electricity|energy|rice|coal|gas|rain|traffic|pollution|waste|income|revenue|spending)\b)/gi,grp:1,msg:"Use ‘amount of’ with uncountable nouns.",fix:"amount of",why:"the AMOUNT of oil · the NUMBER of barrels."},
 {id:"lessCount",re:/\bless\s+(?=(?:people|students|cars|computers|visitors|passengers|men|women|children|workers|tourists|items|households)\b)/gi,msg:"Use ‘fewer’ with countable nouns.",fix:"fewer",why:"fewer people · less money."},
 {id:"dbl",re:/\b(\w+)\s+\1\b/gi,test:m=>!/^\d+$/.test(m[1])&&!/^(had|that)$/i.test(m[1]),msg:"A word is repeated.",fix:m=>m[1],why:"Read your sentence aloud: you wrote the same word twice."},
 {id:"spB",re:/\s+([,.;:])/g,test:(m,t,i)=>i>0,grp:0,msg:"No space before a comma or full stop.",fix:m=>m[1],why:"Punctuation touches the word before it."},
 {id:"spA",re:/,(?=[A-Za-z])/g,msg:"Put a space after a comma.",fix:", ",why:"Comma + space: 2000, the figure …"},
 {id:"month",re:/\b(?:in|by|from|until|during|of|since)\s+(january|february|april|june|july|august|september|october|november|december)\b/g,grp:1,msg:"Months start with a capital letter.",fix:m=>m[1][0].toUpperCase()+m[1].slice(1),why:"July, September, December."},
 {id:"i",re:/\bi\b(?!\.)/g,msg:"‘I’ is always a capital letter.",fix:"I",why:"I"}
];
/* informal / style tips (not errors) */
const STYLE=[
 {id:"goUp",re:/\b(?:go(?:es|ing)?|went|gone)\s+(up|down)\b/gi,msg:"‘go up / go down’ is informal.",fix:"rise / increase · fall / decrease",why:"Academic Task 1 uses rise, increase, fall, decline."},
 {id:"alot",re:/\b(a lot of|lots of|loads of)\b/gi,msg:"‘a lot of’ is informal.",fix:"a large number of · a great deal of · a high proportion of",why:"Be precise and formal."},
 {id:"big",re:/\b(big|huge)\s+(?=(?:rise|increase|fall|drop|decrease|decline|change|jump)\b)/gi,msg:"‘big’ is vague.",fix:"considerable · significant · dramatic",why:"Use a precise adjective."},
 {id:"kids",re:/\b(kids|stuff|things|guys|bunch)\b/gi,msg:"Informal word.",fix:"children · items · people",why:"Avoid casual words in academic writing."},
 {id:"get",re:/\b(got|gets|getting)\b(?!\s+(?:to|back))/gi,msg:"‘get / got’ is informal for a change.",fix:"reached · rose to · fell to",why:"Use a precise verb."},
 {id:"very",re:/\bvery\s+(?=(?:high|low|big|small|large|good|bad|sharp|slight|fast|quick))/gi,msg:"‘very + adjective’ is weak.",fix:"a single strong word: huge → ‘substantial’; very sharp → ‘dramatic’",why:"Better vocabulary gains marks for Lexical Resource."},
 {id:"cont",re:/\b(?:\w+n't|it's|that's|there's|they're|we're|I'm|can't|won't)\b/gi,msg:"Avoid contractions in academic writing.",fix:"do not · it is · cannot",why:"Formal register."},
 {id:"pct",re:/\d\s+%/g,msg:"Write the % sign next to the number.",fix:"20%",why:"No space between the number and %."}
];

/* ---- sentence-level checks (functions) ---- */
function sentences(t){
  const out=[];const re=/[.!?]\s+(?=[A-Z"“])/g;let last=0,m;const cut=[];
  while((m=re.exec(t)))cut.push([last,m.index+1]),last=m.index+m[0].length;
  cut.push([last,t.length]);
  for(const [a,b] of cut){const raw=t.slice(a,b);const txt=raw.trim();if(txt.length>2&&/[a-z]/i.test(txt))out.push({txt,i:a+raw.indexOf(txt),raw})}
  return out}
const INTRO=/^(after|before|despite|while|although|though|whereas|starting|when|as|since|given)\b/i;

function grammarCheck(text){
  const items=[];
  const add=(kind,i,len,msg,fix,why)=>items.push({kind,i,len,msg,fix,why});
  // regex rules
  for(const r of RULES){
    const re=new RegExp(r.re.source,r.re.flags.includes("g")?r.re.flags:r.re.flags+"g");let m;
    while((m=re.exec(text))){
      if(m[0].length===0){re.lastIndex++;continue}
      if(r.test&&!r.test(m,text,m.index))continue;
      let i=m.index,len=m[0].length;
      if(r.grp){ // highlight the group only
        const g=r.grp===0?m[0]:m[r.grp];if(g===undefined)continue;
        const off=m[0].indexOf(g,r.id==="nofv"?m[1].length:0);i=m.index+(off<0?0:off);len=g.length;if(r.id==="spB"){i=m.index;len=m[0].length}}
      const fix=typeof r.fix==="function"?r.fix(m):r.fix;
      add("grammar",i,len,r.msg,fix,r.why)}
  }
  // sentence-level
  for(const s of sentences(text)){
    const t=s.txt;
    if(/^[a-z]/.test(t)){const w0=(t.match(/^[a-z]+/)||[t[0]])[0];add("grammar",s.i,w0.length,"A sentence starts with a capital letter.",w0[0].toUpperCase()+w0.slice(1),"Capital letter at the start.")}
    const words=t.split(/\s+/).length;
    // intro phrase needs comma
    if(INTRO.test(t)&&!t.replace(/(\d),(?=\d)/g,"$1").includes(",")&&words>6){const mm=t.match(/^(\S+(?:\s+\S+){1,6}?)\s+(?:the|it|this|that|there|they|[a-z]+'s)\b/i);
      add("grammar",s.i,Math.min(t.length,mm?mm[1].length:t.split(" ").slice(0,3).join(" ").length),"Put a comma after the introductory phrase.","…, (comma) before the main clause","An opening phrase (After rising…, Despite…, While …, Starting at…) is followed by a comma.")}
    // comma before 'after which'
    const am=t.match(/[a-z0-9%]\s+(after which)\b/i);if(am){const i=s.i+t.indexOf(am[1],am.index);add("grammar",i,am[1].length,"Put a comma before ‘after which’.",", after which","…in 2001, after which it …")}
    // comma splice: full clause , it/the X change-verb
    if(!INTRO.test(t)||/^starting at/i.test(t)===false){
      const cs=t.match(new RegExp("^(?!(?:after|before|despite|while|although|though|whereas|starting|when|as|since|from|in|by|over|between|during|at|with)\\b)[^,]{10,},\\s+((?:it|this|that)|(?:the|its)\\s+[a-z' ]{3,40}?)\\s+"+ADV+"(?:"+CHV+")\\b","i"));
      if(cs){const i=s.i+t.indexOf(",");add("grammar",i,1,"Two full clauses cannot be joined by a comma (comma splice).","use ‘and’ / ‘but’ / ‘, after which’ / ‘.’ instead of the comma","A comma cannot join two independent sentences. Use a linking word (Structures 1, 4, 9) or start a new sentence.")}}
    // while + same direction
  }
  // tense warning (soft, but listed as grammar-hint)
  const yrs=(text.match(/\b(19|20)\d\d\b/g)||[]).map(Number);
  if(yrs.length&&Math.max(...yrs)<=2024){
    const m=text.match(new RegExp("\\b(?:"+SUBJ+")\\s+"+ADV+"(rises|falls|increases|decreases|drops|declines|grows|reaches|climbs|dips|jumps|peaks|remains)\\b","i"));
    if(m)add("tense",text.indexOf(m[1],m.index),m[1].length,"The years are in the past, so use the past simple.","rose · fell · increased · reached","Describing 2000–2020 data: past simple (rose, fell). Present simple is for facts that are true now.")}
  items.sort((a,b)=>a.i-b.i);
  // remove overlapping duplicates
  const out=[];let end=-1;for(const it of items){if(it.i>=end){out.push(it);end=it.i+it.len}else if(it.kind==="grammar"&&out.length&&out[out.length-1].len<=it.len){}}
  return out}

function styleCheck(text){
  const items=[];
  for(const r of STYLE){const re=new RegExp(r.re.source,r.re.flags.includes("g")?r.re.flags:r.re.flags+"g");let m;
    while((m=re.exec(text))){if(!m[0])continue;
      if(r.id==="cont"&&/'s$/i.test(m[0])&&!/^(it|that|there)'s$/i.test(m[0]))continue;
      items.push({kind:"style",i:m.index,len:m[0].length,msg:r.msg,fix:r.fix,why:r.why})}}
  // repeated change verbs
  const dirs=dirsOf(text).filter(d=>!/peak/i.test(d[2]));const cnt={};
  for(const d of dirs){const k=d[2].toLowerCase().replace(/(ed|ing|s|d)$/,"");cnt[k]=(cnt[k]||[]);cnt[k].push(d)}
  for(const k in cnt)if(cnt[k].length>=2){const d=cnt[k][1];items.push({kind:"style",i:d[0],len:d[2].length,msg:"You used ‘"+d[2].toLowerCase()+"’ twice.",fix:"use a synonym: "+(d[1]==="U"?"rose · climbed · grew · went up to":"fell · dropped · declined · dipped"),why:"Varying vocabulary raises your Lexical Resource score."})}
  const words=text.trim().split(/\s+/).length;
  if(words>45)items.push({kind:"style",i:0,len:0,msg:"This sentence is very long ("+words+" words).",fix:"split it into two sentences",why:"Aim for 20–35 words per sentence so the reader does not get lost."});
  if(!/[.!?]\s*$/.test(text.trim()))items.push({kind:"style",i:Math.max(0,text.trimEnd().length-1),len:1,msg:"End the sentence with a full stop.",fix:".",why:"Punctuation is part of accuracy."});
  return items}

function spellCheck(text){
  const items=[];const re=/[A-Za-z][A-Za-z'’-]*/g;let m;const sents=sentences(text);
  while((m=re.exec(text))){const raw=m[0];const w=raw.toLowerCase().replace(/['’]s$/,"");
    if(w.length<4)continue;
    if(MISSP[w]){items.push({kind:"spelling",i:m.index,len:raw.length,msg:"Spelling: ‘"+raw+"’",fix:MISSP[w],why:"Correct spelling: "+MISSP[w]+".",hard:true});continue}
    if(known(w))continue;
    // capitalised word inside a sentence = a name
    const atStart=sents.some(s=>s.i===m.index);
    if(/^[A-Z]/.test(raw)&&!atStart)continue;
    if(w.includes("-"))continue;
    const near=nearWord(w);
    if(near)items.push({kind:"spelling",i:m.index,len:raw.length,msg:"Possible spelling mistake: ‘"+raw+"’",fix:near,why:"Check the spelling. Did you mean ‘"+near+"’?",hard:false})}
  return items}

/* ---- figures & years ---- */
function yearValues(meta){
  const yv={};if(!meta||!meta.years||!meta.svals)return yv;
  for(const s in meta.svals){meta.svals[s].forEach((v,idx)=>{const y=String(meta.years[idx]);(yv[y]=yv[y]||new Set()).add(String(parseFloat(v)))})}
  return yv}
function figureCheck(text,gid){
  const items=[];const meta=gid&&D.gmeta[gid];const yv=yearValues(meta);
  const n=norm(text);const pairs=[];
  const re=/(\d+(?:\.\d+)?)\s*(?:%|percent|per cent|million|billion|thousand|tonnes|tons|m\b|k\b)?\s*(?:million|billion|thousand|tonnes|tons)?\s+(?:in|by|at the end of|during)\s+((?:19|20)\d\d)\b/g;let m;
  while((m=re.exec(n))){pairs.push({v:String(parseFloat(m[1])),y:m[2],i:m.index,end:m.index+m[0].length})}
  if(meta&&Object.keys(yv).length){
    const allowed=new Set(meta.allowed||[]);
    for(const p of pairs){
      if(!yv[p.y])continue;
      if(allowed.has(p.v)&&!yv[p.y].has(p.v)){
        const real=[...yv[p.y]].join(" / ");
        const i=text.toLowerCase().indexOf(p.y,Math.max(0,text.toLowerCase().indexOf(p.v)));
        items.push({kind:"facts",i:Math.max(0,i),len:4,msg:"Check the figure for "+p.y+": you wrote "+p.v+", but the graph shows "+real+" in "+p.y+".",fix:"read the graph at "+p.y,why:"Each figure belongs to one year. Put your finger on the year, then read up to the line."})}}}
  // direction vs numbers
  for(let k=0;k+1<pairs.length;k++){
    const a=pairs[k],b=pairs[k+1];if(a.y===b.y)continue;
    const between=n.slice(a.end,b.i);const d=dirsOf(between).filter(x=>!/peak/i.test(x[2]));
    if(!d.length)continue;
    const real=parseFloat(b.v)>parseFloat(a.v)?"U":parseFloat(b.v)<parseFloat(a.v)?"D":"";
    if(real&&d.every(x=>x[1]!==real)){items.push({kind:"facts",i:Math.max(0,text.toLowerCase().indexOf(d[0][2].toLowerCase())),len:d[0][2].length,msg:"Direction check: "+a.v+" ("+a.y+") → "+b.v+" ("+b.y+") is a "+(real==="U"?"rise":"fall")+", but you wrote ‘"+d[0][2]+"’.",fix:real==="U"?"rose · increased · climbed":"fell · dropped · declined",why:"Compare the two figures first, then choose the verb."})}}
  // 'from A to B' with a verb before
  const fm=n.match(/\b(\w+(?:\s+\w+){0,2}?)\s+from\s+\$?(\d+(?:\.\d+)?)\S*(?:\s+\w+){0,3}?\s+to\s+\$?(\d+(?:\.\d+)?)/);
  if(fm){const a=parseFloat(fm[2]),b=parseFloat(fm[3]);const d=dirsOf(fm[1]);const real=b>a?"U":b<a?"D":"";
    if(real&&d.length&&d.every(x=>x[1]!==real)&&!(a>=1900&&a<=2100&&b>=1900&&b<=2100))items.push({kind:"facts",i:Math.max(0,text.toLowerCase().indexOf(d[0][2].toLowerCase())),len:d[0][2].length,msg:"Direction check: from "+fm[2]+" to "+fm[3]+" is a "+(real==="U"?"rise":"fall")+", but you wrote ‘"+d[0][2]+"’.",fix:real==="U"?"rose · increased":"fell · dropped",why:"Compare the two figures first, then choose the verb."})}
  return items}
function directionVsModel(it,text){
  const items=[];if(!it.model)return items;
  const m=new Set(dirsOf(it.model).filter(x=>!/peak/i.test(x[2])).map(x=>x[1]));
  const sd=dirsOf(text).filter(x=>!/peak/i.test(x[2]));if(!m.size||!sd.length)return items;
  if(sd.every(x=>!m.has(x[1])))items.push({kind:"facts",i:sd[0][0],len:sd[0][2].length,msg:"Direction check: the facts show "+(m.has("U")?"an increase":"a decrease")+", but you wrote ‘"+sd[0][2]+"’.",fix:m.has("U")?"rose · increased · climbed":"fell · dropped · declined",why:"Re-read the facts. The direction of the verb must match the numbers."});
  return items}

/* ---- main analyser ---- */
function analyze(it,text,gid,inp,opts){
  opts=opts||{};
  const base=inp?checkGraphItem(it,inp,text):checkText(it,text,gid);
  const items=[];const praise=[];
  const structure=[],facts=[];
  for(const s of base.issues){
    if(/^(Missing figure|Use more figures|Your sentence is too different|The figure|Write about this graph|Add the unit)/.test(s))facts.push({kind:"facts",msg:s,why:"Use the figures and years from the graph or the facts. Accuracy of data is part of Task Achievement.",fix:null});
    else structure.push({kind:"structure",msg:s,why:null,fix:null})}
  for(const s of base.warns||[])facts.push({kind:"warn",msg:s,why:"This figure is not in the data. Check it before you continue.",fix:null});
  const nn=it.n||(inp&&it.n);
  if(structure.length&&nn&&LEARN[nn-1]){const L=LEARN[nn-1];structure[0].fix=L.f.replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ");structure[0].why="Structure "+nn+" · "+L.rule.replace(/<[^>]+>/g,"")}
  items.push(...structure,...facts);
  const text0=text;
  const g=grammarCheck(text0);
  const sp=spellCheck(text0);
  const fg=figureCheck(text0,gid);
  const dm=(fg.length?[]:directionVsModel(it,text0));
  const st=styleCheck(text0);
  // A chapter can add its own grammar rules (CHAPTER.grammar: [{re, msg, fix, why}]).
  const cg=[];try{for(const r of ((typeof CHAPTER!=="undefined"&&CHAPTER.grammar)||[])){const re=new RegExp(r.re,"i");const mm=re.exec(text0);if(mm&&!g.some(y=>y.i===mm.index))cg.push({kind:"grammar",i:mm.index,len:mm[0].length,msg:r.msg,fix:r.fix||null,why:r.why||null})}}catch(e){}
  g.push(...cg);
  // dedupe spelling vs grammar overlap
  items.push(...fg,...dm,...g,...sp.filter(x=>!g.some(y=>y.i===x.i)),...st);
  // positives
  if(!structure.length&&(it.pats||(inp&&inp.pats)||[]).length){praise.push(nn&&LEARN[nn-1]?"Structure "+nn+" ("+LEARN[nn-1].t.replace(/<[^>]+>/g,"")+") is built correctly.":"The required structure is correct.")}
  const nums=uniq(numsOf(text0));if(nums.length>=2&&!facts.length)praise.push("You included the key figures"+(/\b(19|20)\d\d\b/.test(text0)?" and the years":"")+".");
  if(/\b(slightly|sharply|steadily|gradually|dramatically|significantly|considerably|rapidly|noticeably|substantially|marginally|moderately)\b/i.test(text0)||/\b(slight|sharp|steady|gradual|dramatic|significant|considerable|rapid|noticeable|substantial|marginal)\s+(rise|fall|increase|drop|decline|decrease|dip|jump|growth|recovery)/i.test(text0))praise.push("Good vocabulary: you described HOW the change happened (adverb / adjective).");
  if(!g.length&&!sp.some(x=>x.hard))praise.push("No grammar errors found in the rules I check.");
  if(/\b(whereas|although|however|in contrast|by contrast|respectively)\b/i.test(text0))praise.push("Nice linking words.");
  const hard=items.filter(x=>["structure","facts","grammar","tense"].includes(x.kind)||(x.kind==="spelling"&&x.hard));
  const ok=hard.length===0&&base.ok;
  return {ok,items,praise,hard:hard.length,base}}

/* ---- original text check helpers (kept) ---- */
function checkText(it,text,gid){
  const n=norm(text),issues=[],warns=[];
  if(n.split(" ").length<4){return {ok:false,issues:["Write a full sentence."],warns}}
  for(const name of (it.pats||[])){const p=PAT[name];if(!p)continue;const hit=p.re.test(n);if(p.not?hit:!hit)issues.push(p.msg)}
  for(const [re,msg] of (it.forbid||[])){if(new RegExp(re,"i").test(n))issues.push(msg)}
  for(const [re,msg] of (it.kw||[])){if(Array.isArray(re)){}else if(!new RegExp(re,"i").test(n))issues.push(msg)}
  const have=uniq(numsOf(text));
  if(it.nums==="model"){const need=uniq(numsOf(it.model));const miss=need.filter(x=>!have.includes(x));
    if(miss.length>(it.missTol||0))issues.push("Missing figure(s): "+miss.join(", ")+". Use the figures from the facts.");
    const extra=have.filter(x=>!need.includes(x));if(extra.length)warns.push("Check the figure(s): "+extra.join(", "))}
  else if(it.nums==="graph"){const meta=D.gmeta[gid];const al=meta.allowed||[];
    // A graph in thousands: "24,000" is the same figure as "24 thousand".
    if(/thousand/i.test(meta.unit||"")){for(let k=0;k<have.length;k++){const v=parseFloat(have[k]);if(v>=1000&&al.includes(String(v/1000)))have[k]=String(v/1000)}}
    const known=have.filter(x=>al.includes(x));const mn=it.minNums==null?2:it.minNums;
    if(known.length<mn)issues.push("Use more figures and years from the graph: your sentence should include the start and the end of the change ("+mn+" figures or years).");
    // Figures that are not on the graph (differences between figures, like "by 8 million", are fine).
    const vals=[...new Set([].concat(...Object.values(meta.svals||{})).map(Number))],yrs=(meta.years||[]).map(Number),der=new Set();
    for(const a of vals)for(const b of vals){der.add(String(+Math.abs(a-b).toFixed(2)));if(b)der.add(String(+(a/b).toFixed(2)))}
    for(const a of yrs)for(const b of yrs)der.add(String(Math.abs(a-b)));
    const unk=have.filter(x=>!al.includes(x)&&!der.has(x));
    if(unk.length)issues.push("The figure "+unk.join(", ")+" is not on the graph. Read the figure at that year again.");
    // The right graph: name what changed.
    const tw=toks([meta.title].concat(meta.series||[]).join(" ")).filter(w=>!/^(number|amount|figure|total|sold|used|made|level)/.test(w));
    const st=toks(text);
    if(tw.length&&!tw.some(w=>st.some(x=>x.slice(0,4)===w.slice(0,4))))issues.push("Write about this graph: "+meta.title.toLowerCase()+". Name what changed (for example ‘"+meta.title.toLowerCase()+"’).");
    // The unit: 20 million, not just 20.
    const u=String(meta.unit||"").toLowerCase();const need=/billion/.test(u)?[/\b(billion|bn)\b/,"billion"]:/million/.test(u)?[/\b(million|millions|mn|m)\b/,"million"]:/thousand/.test(u)?[/\b(thousand|thousands|k)\b/,"thousand"]:/%|per ?cent/.test(u)?[/%|\bper ?cent\b/,"%"]:null;
    const tnums=numsOf(meta.title||"");const figs=known.filter(x=>!/^(19|20)\d\d$/.test(x)&&!tnums.includes(x));
    if(need&&figs.length){
      // Each figure needs its unit, unless the next figure carries it ("from 12 to 20 million").
      const re=/(\d+(?:\.\d+)?)(?!\d)/g;let m,miss=null;
      while((m=re.exec(n))){const v=String(parseFloat(m[1]));if(/^(19|20)\d\d$/.test(m[1])||!figs.includes(v))continue;
        const after=n.slice(m.index+m[1].length,m.index+m[1].length+14);
        if(need[0].test(after.replace(/^\s*/," ").slice(0,need[1]==="%"?3:14)))continue;
        const shared=n.slice(m.index+m[1].length).match(/^\s*(?:to|and|-|–)\s*\d+(?:\.\d+)?\s*(\S+)/);
        if(shared&&need[0].test(" "+shared[1]))continue;
        miss=m[1];break}
      if(miss)issues.push("Add the unit: "+miss+(need[1]==="%"?"%":" "+need[1])+" (the graph is in "+meta.unit+").")}}
  if(it.overlap&&overlap(it.model,text)<it.overlap)issues.push("Your sentence is too different from the facts given. Keep the same information.");
  return {ok:issues.length===0,issues,warns}
}
function checkGraphItem(it,inp,text){
  const r=checkText({pats:inp.pats,nums:it.nums,minNums:inp.minNums},text,it.graph);
  const n=norm(text);
  if(it.kw){for(const [a,b] of it.kw){if(!new RegExp("\\b("+a+")\\b","i").test(n)||!new RegExp("\\b("+b+")\\b","i").test(n)){r.issues.push("Mention both lines of the graph by name.");r.ok=false}}}
  if(it.bigger&&r.ok){
    const big=it.kw[0][0],sm=it.kw[0][1];const ib=n.search(new RegExp("\\b("+big+")\\b","i")),is=n.search(new RegExp("\\b("+sm+")\\b","i"));
    if(/with the latter\b/.test(n)){if(!(ib>is)){r.issues.push("Check the bigger change: the latter is the second line you mention.")}}
    else if(/with the former\b/.test(n)){if(!(ib<is)){r.issues.push("Check the bigger change: the former is the first line you mention. Which line changed more?")}}
    else{const m=n.match(/with (?:the \w+ for|that for|those for) ([a-z ]+?) seeing/);if(m&&!new RegExp("\\b("+big+")\\b","i").test(m[1]))r.issues.push("Check which line changed more.")}
    r.ok=r.issues.length===0}
  return r}
