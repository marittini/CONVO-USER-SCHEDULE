// Engine 2.5.0 personal extension. Weekly blocks follow ME's WeekSchedule format.
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_NAMES=['월요일','화요일','수요일','목요일','금요일','토요일','일요일'];
const LABELS={online:'온라인',idle:'자리 비움',dnd:'방해 금지',offline:'오프라인'};
const DEFAULT={enabled:false,mode:'independent',instructions:'페르소나의 설정과 생활 습관에 맞게 월요일부터 일요일까지 일주일 일정을 생성하세요.',lifestyle:'',zone:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Seoul',connectionId:''};
function minutes(t,end=false){if(end&&t==='24:00')return 1440;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw Error('시간은 HH:MM 형식이어야 합니다: '+t);return Number(t.slice(0,2))*60+Number(t.slice(3));}
function clock(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function range(t){if(typeof t!=='string')throw Error('시간 범위가 없습니다.');const parts=t.split('-').map(x=>x.trim());if(parts.length!==2)throw Error('시간 범위 오류: '+t);const a=minutes(parts[0]),b=minutes(parts[1],true);if(a===b)throw Error('시작과 종료 시간이 같습니다: '+t);return b>a?[[a,b]]:[[a,1440],[0,b]].filter(([x,y])=>x<y);}
function wall(zone,date=new Date()){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));return{day:parts.weekday,date:`${parts.year}-${parts.month}-${parts.day}`,minute:Number(parts.hour)*60+Number(parts.minute)};}
function weekStart(zone){const d=new Date(wall(zone).date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString();}
function emptySchedule(zone=DEFAULT.zone){return{weekStart:weekStart(zone),days:Object.fromEntries(DAYS.map(d=>[d,[]])),talkativeness:50,inactivityThresholdMinutes:45};}
function validateDay(blocks,day,full=false){
 if(!Array.isArray(blocks))throw Error(day+' 일정이 없습니다.');const entries=[];
 for(const block of blocks){if(!Object.hasOwn(LABELS,block.status)||typeof block.activity!=='string'||!block.activity.trim())throw Error(day+' 상태/활동 오류');const time=block.time??(Number.isFinite(block.a)&&Number.isFinite(block.b)?clock(block.a)+'-'+clock(block.b):null);for(const[a,b]of range(time))entries.push({a,b,status:block.status,activity:block.activity.trim().slice(0,500)});}
 entries.sort((a,b)=>a.a-b.a);let end=0;
 for(const b of entries){if(b.a<end)throw Error(day+' 일정에 겹치는 시간이 있습니다.');if(full&&b.a!==end)throw Error(day+' 일정에 빈 시간이 있습니다.');end=b.b;}
 if(full&&end!==1440)throw Error(day+' 일정은 24시간을 채워야 합니다.');
 return entries.map(({a,b,...rest})=>({time:clock(a)+'-'+clock(b),...rest}));
}
function validate(raw,full=false){const source=raw?.schedule||raw;if(!source?.days)throw Error('주간 일정의 days가 없습니다.');const days={};for(const day of DAYS)days[day]=validateDay(source.days[day]||[],day,full);return{...emptySchedule(),...source,days};}
function validateWindows(raw){if(!Array.isArray(raw?.windows))throw Error('접속 상태 분석 형식 오류');return raw.windows.flatMap(w=>{if(!Array.isArray(w.days)||!w.days.length||w.days.some(d=>!DAYS.includes(d))||!['idle','offline','dnd'].includes(w.status))throw Error('접속 상태 분석 오류');return range(w.time).map(([a,b])=>({days:[...new Set(w.days)],a,b,status:w.status}));});}
// Actual routine changes presence only. Activity and fictional meal/wake times are never rewritten here.
function applyAvailability(schedule,windows,onlyDays=DAYS){const result=structuredClone(schedule);for(const day of onlyDays){const rules=windows.filter(w=>w.days.includes(day));result.days[day]=[];for(const block of schedule.days[day])for(const[a,b]of range(block.time)){const edges=[a,b,...new Set(rules.flatMap(r=>[r.a,r.b]).filter(m=>m>a&&m<b))].sort((a,b)=>a-b);for(let i=0;i<edges.length-1;i++){const start=edges[i],end=edges[i+1],cover=rules.filter(r=>start>=r.a&&end<=r.b);let status=block.status;if(status==='online'&&cover.length){status=cover.some(r=>r.status==='dnd')?'dnd':'idle';}result.days[day].push({...block,time:clock(start)+'-'+clock(end),status});}}}return result;}
function current(schedule,config,date){const now=wall(config.zone,date);const block=schedule?.days?.[now.day]?.find(b=>range(b.time).some(([a,z])=>now.minute>=a&&now.minute<z));return{now,block};}
function nextBlock(schedule,config,date){if(!schedule?.days)return null;const now=wall(config.zone,date),today=DAYS.indexOf(now.day);for(let offset=0;offset<=7;offset++){const day=DAYS[(today+offset)%7],blocks=[...(schedule.days[day]||[])].sort((a,b)=>minutes(a.time.split('-')[0])-minutes(b.time.split('-')[0]));for(const block of blocks){const start=minutes(block.time.split('-')[0]);if(offset===0&&start<=now.minute)continue;return{...block,day,dayOffset:offset};}}return null;}
const saved=await marinara.storage.get();let state={profiles:{},...saved},alive=true,editing=null,generating=false,errorText='',activeId='';
for(const[k,p]of Object.entries(state.profiles)){p.config={...DEFAULT,...Object.fromEntries(Object.entries(p.config||{}).filter(([x])=>Object.hasOwn(DEFAULT,x)))};try{if(p.schedule)p.schedule=validate(p.schedule);}catch{p.schedule=null;}}
const nativeFetch=window.fetch,cache=new Map(),pending=new Map(),encode=encodeURIComponent;
async function api(path,body,signal){const response=await nativeFetch.call(window,'/api'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json','x-marinara-csrf':'1'}:undefined,body:body?JSON.stringify(body):undefined,signal});const data=await response.json();if(!response.ok)throw Error(data.error||data.message||'요청 실패 '+response.status);return data;}
async function chat(id,fresh=false){const cached=cache.get(id);if(!fresh&&cached&&Date.now()-cached.time<30000)return cached.value;if(pending.has(id))return pending.get(id);const request=api('/chats/'+encode(id)).then(value=>{cache.set(id,{value,time:Date.now()});return value;}).finally(()=>pending.delete(id));pending.set(id,request);return request;}
function key(c){return c.personaId?'persona:'+c.personaId:c.personaCharacterId?'card:'+c.personaCharacterId:'chat:'+c.id;}
function profile(c){return state.profiles[key(c)]||{config:{...DEFAULT},schedule:null};}
async function persist(k,p){const next={...state,profiles:{...state.profiles,[k]:p}};await marinara.storage.patch({profiles:next.profiles});state=next;render();}
function getActive(){return localStorage.getItem('marinara-active-chat-id')||'';}
function activeOverride(p,date=new Date()){const o=p.override;if(!o||!Object.hasOwn(LABELS,o.status))return null;return o.expiresAt&&(!Number.isFinite(Date.parse(o.expiresAt))||Date.parse(o.expiresAt)<=date.getTime())?null:o;}
function effectiveBlock(p){return activeOverride(p)|| (p.config.enabled?current(p.schedule,p.config).block:null);}
function expiryAt(zone,time,date=new Date()){const now=wall(zone,date),minute=minutes(time);let target=Date.parse(now.date+'T00:00:00Z')+minute*60000;if(minute<=now.minute)target+=86400000;let guess=target;for(let i=0;i<5;i++){const observed=wall(zone,new Date(guess));const offset=Date.parse(observed.date+'T00:00:00Z')+observed.minute*60000-target;if(!offset)return new Date(guess).toISOString();guess-=offset;}throw Error('시간대 전환으로 존재하지 않는 시각입니다. 다른 시각을 선택하세요.');}
// userActivity is capped at 120 chars by ME. Send the complete day separately
// through its supported generationGuide system-message path, never as chat text.
function todayContext(p,date=new Date()){
 if(!p.config.enabled)return '';
 const now=wall(p.config.zone,date),blocks=p.schedule?.days?.[now.day];
 if(!blocks?.length)return '';
 const schedule=blocks.map(b=>`${b.time}: ${b.activity}`).join(', ');
 const override=activeOverride(p,date);
 return `USER/PERSONA schedule context (${now.date}, ${now.day}, ${p.config.zone}). This is the user's fictional persona routine, not your character's routine.\n{{user}}'s schedule today (${now.day}): ${schedule}\n${override?`Current temporary override: ${override.activity} (${LABELS[override.status]}). ${override.expiresAt?'Ends at '+override.expiresAt+'.':'Until manually cleared.'} The override takes precedence for the current activity; the saved day schedule remains unchanged.\n`:''}These are planned activities, not proof they have happened. Use them naturally when relevant; do not recite the schedule or write the user's actions for them.`;
}
function generationFields(body,c,p){
 const fields=payload(c,p),context=c.mode==='conversation'?todayContext(p):'';
 if(!fields&&!context)return null;
 return {...body,...fields,...(context?{generationGuide:[body.generationGuide,context].filter(x=>typeof x==='string'&&x.trim()).join('\n\n')}:{} )};
}
function payload(c,p){if(c.mode!=='conversation')return null;const block=effectiveBlock(p);if(!block)return null;return{userStatus:block.status==='online'?'active':block.status==='dnd'?'dnd':'idle',userActivity:`${LABELS[block.status]}; 설정상 현재 일정: ${block.activity}`.slice(0,120)};}
const hookedFetch=async function(input,init){if(!alive)return nativeFetch.call(this,input,init);let url;try{url=new URL(input instanceof Request?input.url:String(input),location.href);}catch{return nativeFetch.call(this,input,init);}const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();const eligible=url.origin===location.origin&&method==='POST'&&(/^\/api\/generate\/?$/.test(url.pathname)||/^\/api\/conversation\/(?:activity\/presence|autonomous\/check)$/.test(url.pathname));if(!eligible)return nativeFetch.call(this,input,init);let body;try{body=JSON.parse(typeof init?.body==='string'?init.body:input instanceof Request?await input.clone().text():'');}catch{return nativeFetch.call(this,input,init);}if(typeof body.chatId!=='string')return nativeFetch.call(this,input,init);try{const c=await chat(body.chatId,true),p=profile(c),fields=payload(c,p),updated=url.pathname.startsWith('/api/generate')?generationFields(body,c,p):fields?{...body,userStatus:fields.userStatus}:null;if(updated){body=updated;if(input instanceof Request){const request=new Request(input,init);return nativeFetch.call(this,new Request(request,{body:JSON.stringify(body)}));}return nativeFetch.call(this,input,{...init,body:JSON.stringify(body)});}}catch(e){marinara.log.warn('유저 일정 적용 실패',e.message);}return nativeFetch.call(this,input,init);};window.fetch=hookedFetch;
let controller=null;
async function rawGenerate(config,system,signal){const response=await api('/generate/raw',{connectionId:config.connectionId,streaming:false,parameters:{maxTokens:12000},messages:[{role:'system',content:system},{role:'user',content:'Return the requested complete JSON.'}]},signal);return response.content||'';}
function parseJSON(text){const cleaned=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');return JSON.parse(cleaned);}
async function availability(config,signal){if(!config.lifestyle.trim())return[];const text=await rawGenerate(config,`Extract REAL HUMAN unavailable hours only from the following real-life routine. Return JSON {"windows":[{"days":["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],"time":"12:00-13:00","status":"idle"}]}. These are presence constraints, NOT fictional activities. Do not output or change fictional activities, meals or wake times. Use offline for sleeping; idle for real meals/work/other unavailable times; dnd only when explicitly requested not to contact. Infer a reasonable duration (meal usually one hour) when only a start time is supplied. For cross-midnight ranges return normal HH:MM-HH:MM. Use all seven English weekdays for daily habits, specific weekdays when specified. No online windows. Real-life routine:\n${config.lifestyle}`,signal);return validateWindows(parseJSON(text));}
async function generate(c,config,existing=null,action='rewrite',day=null,dayGuidance='',onProgress=()=>{},knownWindows=null){
 if(generating)throw Error('다른 일정 생성이 진행 중입니다.');wall(config.zone);if(!config.connectionId)throw Error('언어 모델 연결을 선택하세요.');generating=true;controller=new AbortController();const signal=controller.signal;render();
 try{const persona=c.personaId?await api('/characters/personas/'+encode(c.personaId)):c.personaCharacterId?await api('/characters/'+encode(c.personaCharacterId)):null;let reference=null;if(config.mode==='linked'){const data=await api('/conversation/status/'+encode(c.id));reference=Object.fromEntries(Object.entries(data.statuses||{}).filter(([,v])=>v.schedule).map(([id,v])=>[id,v.schedule]));if(!Object.keys(reference).length)throw Error('먼저 순정 기능으로 캐릭터 주간 스케줄을 생성하세요.');}
 const prompt=`Generate the USER/PERSONA's fictional routine using Marinara Engine weekly schedule blocks. ${day?'Return only JSON {"blocks":[{"time":"00:00-06:00","activity":"수면","status":"offline"},...]} for '+day+'.':'Return only JSON {"days":{"Monday":[{"time":"00:00-06:00","activity":"수면","status":"offline"}],"Tuesday":[...],"Wednesday":[...],"Thursday":[...],"Friday":[...],"Saturday":[...],"Sunday":[...]}}. ALL SEVEN DAYS REQUIRED.'} Each generated day must cover 00:00-24:00 without overlaps/gaps. Status online/idle/dnd/offline. Activity descriptions in Korean. Respect EXPLICIT persona meal, waking, sleeping and insomnia habits as fixed fictional anchors. Never infer the persona's meals or sleep from real human availability. Action=${action}: rewrite creates a fresh routine; adjust preserves existing blocks except requested changes; vary keeps habitual anchors while varying flexible activities; repair fixes gaps/overlaps with minimal activity changes.\nPersona card: ${JSON.stringify(persona)}\nPersona schedule instructions: ${config.instructions}\n${config.mode==='linked'?'CHARACTER INTERACTION: Increase plausible opportunities to interact at the SAME clock times as character activities. Coordinate compatible meals, breaks, studying/training, outings or shared free time when consistent with persona anchors and instructions. Do not copy incompatible character habits or override explicit persona anchors. Character weekly schedules: '+JSON.stringify(reference):'Invent this persona routine independently.'}\nExisting fictional routine: ${JSON.stringify(existing?.days||null)}\n${day?'Day guidance: '+dayGuidance:''}`;
 onProgress(day?DAY_NAMES[DAYS.indexOf(day)]+' 생성 중…':'월~일 일주일 일정 생성 중…');const text=await rawGenerate(config,prompt,signal);let schedule;try{const result=parseJSON(text);schedule=day?{...(existing||emptySchedule(config.zone)),days:{...(existing?.days||emptySchedule(config.zone).days),[day]:validateDay(result.blocks,day,true)}}:validate(result,true);}catch(e){e.rawScheduleJSON=text;e.day=day;throw e;}
 signal.throwIfAborted();schedule.weekStart=weekStart(config.zone);
 onProgress('실제 생활패턴의 접속 상태만 반영 중…');const windows=knownWindows??await availability(config,signal);signal.throwIfAborted();const effective=applyAvailability(schedule,windows,day?[day]:DAYS);return{schedule:effective,fictionalSchedule:schedule,windows};
 }finally{generating=false;controller=null;render();}
}
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
const button=node('button',undefined,'usc-launch');button.type='button';button.hidden=true;
button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
const panel=node('div',undefined,'usc-settings-overlay');panel.hidden=true;panel.setAttribute('data-component','Modal');document.body.append(panel);
const popup=node('section',undefined,'usc-popup usc-native marinara-chat-popover mari-chat-style-surface');popup.hidden=true;
popup.setAttribute('role','dialog');popup.setAttribute('aria-label','유저 스케줄');popup.setAttribute('data-chat-floating-panel','');document.body.append(popup);
let activeChat=null,lastSignature='',mounted=new Set(),userInfo=new Map(),infoPending=new Set();
let anchor=null,previousFocus=null,renderQueued=false,returnToPopup=false;
let overrideQueue=Promise.resolve();
function setOverride(c,status,activity,expiresAt=undefined){const work=overrideQueue.catch(()=>{}).then(async()=>{const p=profile(c);await persist(key(c),{...p,override:{status,activity:activity.trim().slice(0,500),createdAt:new Date().toISOString(),expiresAt:expiresAt===undefined?(activeOverride(p)?.expiresAt||null):expiresAt}});});overrideQueue=work;return work;}
function restoreUserSchedule(c){const work=overrideQueue.catch(()=>{}).then(()=>persist(key(c),{...profile(c),override:null}));overrideQueue=work;return work;}
function svgIcon(paths,size=12){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const[k,v]of Object.entries({viewBox:'0 0 24 24',width:size,height:size,fill:'none',stroke:'currentColor','stroke-width':2,'aria-hidden':'true'}))svg.setAttribute(k,v);for(const d of paths){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;}
const TONES={online:'online',idle:'idle',dnd:'dnd',offline:'offline'};
function statusData(c,p) {
  const block=effectiveBlock(p);
  if(!block&&!p.config.enabled)return {status:'offline',activity:'자동 적용 꺼짐',name:userInfo.get(key(c))?.name||'{{user}}'};
  return {status:block?.status||'idle',activity:block?.activity||'일정 미생성',name:userInfo.get(key(c))?.name||'{{user}}'};
}
async function loadUserName(c) {
 const k=key(c),cached=userInfo.get(k);if(cached&&Date.now()-cached.loadedAt<30000||infoPending.has(k))return;
 if(!c.personaId&&!c.personaCharacterId){userInfo.set(k,{name:'{{user}}',loadedAt:Date.now()});return;}
 infoPending.add(k);try{const row=await api(c.personaId?'/characters/personas/'+encode(c.personaId):'/characters/'+encode(c.personaCharacterId));const data=typeof row.data==='string'?JSON.parse(row.data):row.data;const cropRaw=row.avatarCrop||data?.extensions?.avatarCrop;let crop=cropRaw;if(typeof cropRaw==='string'){try{crop=JSON.parse(cropRaw);}catch{crop=null;}}userInfo.set(k,{name:row.name||data?.name||'{{user}}',avatar:row.avatarPath||data?.avatarPath||null,crop,loadedAt:Date.now()});if(alive)render();}catch{userInfo.set(k,{name:'{{user}}',loadedAt:Date.now()});}finally{infoPending.delete(k);}
}
// Exact ME getAvatarCropStyle geometry; includes current rectangles and legacy transforms.
function avatarCropStyle(crop){if(!crop)return{};if('zoom'in crop){if(crop.fullImage)return{objectFit:'contain',transform:`scale(${crop.zoom}) translate(${crop.offsetX}%, ${crop.offsetY}%)`};if(crop.zoom<=1)return{};return{transform:`scale(${crop.zoom}) translate(${crop.offsetX}%, ${crop.offsetY}%)`};}const{srcX,srcY,srcWidth,srcHeight}=crop;if(!(srcWidth>0&&srcHeight>0))return{};return{position:'absolute',width:`${100/srcWidth}%`,height:`${100/srcHeight}%`,left:`${-srcX/srcWidth*100}%`,top:`${-srcY/srcHeight*100}%`,maxWidth:'none',maxHeight:'none',objectFit:'fill'};}
function avatar(name,status){const shell=node('div',undefined,'usc-avatar'),picture=node('span',undefined,'usc-avatar-picture'),info=activeChat?userInfo.get(key(activeChat)):null;if(info?.avatar){const img=node('img');img.src=info.avatar;img.alt=name;Object.assign(img.style,avatarCropStyle(info.crop));picture.append(img);}else picture.append(node('span',name.slice(0,1),'usc-avatar-letter'));shell.append(picture);const dot=node('span',undefined,'usc-dot usc-status-'+TONES[status]);dot.setAttribute('aria-hidden','true');shell.append(dot);return shell;}
function openUserSettings(initialDay=null) {
  if(!DAYS.includes(initialDay))initialDay=null;
  returnToPopup=!popup.hidden;previousFocus=document.activeElement;closePopup();
  panel.hidden=false;void openSettings(initialDay).then(()=>panel.querySelector('button')?.focus()).catch(e=>{errorText=e.message;render();});
}
function closeSettings() {
  controller?.abort();++editorSession;panel.hidden=true;editing=null;
  if(returnToPopup&&activeChat){setPopupOpen(true);display(popup,activeChat,profile(activeChat));positionPopup();returnToPopup=false;button.focus();}else if(previousFocus?.isConnected)previousFocus.focus();else if(button.isConnected)button.focus();
}
function setPopupOpen(open){popup.hidden=!open;button.setAttribute('aria-expanded',String(open));document.body.classList.toggle('usc-user-panel-open',open);if(open&&document.querySelector('div[data-chat-floating-panel] svg.lucide-calendar-clock'))button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));}
function closePopup() {setPopupOpen(false);}
function positionPopup() {
  if(popup.hidden||!button.isConnected)return;
  const viewport=window.visualViewport,offsetX=viewport?.offsetLeft||0,offsetY=viewport?.offsetTop||0;
  const height=viewport?.height||window.innerHeight,availableWidth=viewport?.width||window.innerWidth;
  const rect=button.getBoundingClientRect(),width=Math.min(360,availableWidth-24);
  popup.style.width=width+'px';popup.style.left=Math.max(offsetX+12,Math.min(rect.left,offsetX+availableWidth-width-12))+'px';
  const top=Math.max(offsetY+12,Math.min(rect.bottom+6,offsetY+height-140));popup.style.top=top+'px';
  popup.style.maxHeight=Math.max(80,offsetY+height-top-12)+'px';
}
button.onclick=()=> {
  if(!activeChat)return;
  setPopupOpen(popup.hidden);
  if(!popup.hidden){display(popup,activeChat,profile(activeChat));positionPopup();popup.querySelector('button')?.focus();}
};
function display(host,c,p) {
    if(host.contains(document.activeElement)&&document.activeElement.matches('textarea,input,select'))return;if(host.querySelector('.usc-status-menu:not([hidden])'))return;
    host.replaceChildren();const card=node('section',undefined,'usc-presence-card usc-native');host.append(card);host=card;
    const title=node('div',undefined,'usc-panel-title');title.append(svgIcon(['M8 2v4 M16 2v4 M3 10h18 M3 6h18v15H3Z']),node('strong','유저 대화 상태'));host.append(title);
  const info=statusData(c,p),header=node('div',undefined,'usc-card-heading');
  header.append(avatar(info.name,info.status));
  const names=node('div',undefined,'usc-card-names');names.append(node('strong',info.name),node('span',activeOverride(p)?'수동 오버라이드':p.config.enabled?'스케줄 따르는 중':'스케줄 꺼짐'));header.append(names);
  const edit=node('button',undefined,'usc-icon-button');const gear=document.createElementNS('http://www.w3.org/2000/svg','svg');gear.setAttribute('viewBox','0 0 24 24');gear.setAttribute('width','13');gear.setAttribute('height','13');gear.setAttribute('fill','none');gear.setAttribute('stroke','currentColor');gear.setAttribute('stroke-width','2');gear.setAttribute('aria-hidden','true');for(const d of ['M9 7H3 M21 7h-6 M15 17H3 M21 17h-2','M15 7a3 3 0 1 0-6 0 3 3 0 0 0 6 0 M19 17a3 3 0 1 0-6 0 3 3 0 0 0 6 0']){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);gear.append(path);}edit.append(gear);edit.type='button';edit.title='유저 스케줄 설정';edit.setAttribute('aria-label','유저 스케줄 설정');edit.onclick=openUserSettings;header.append(edit);host.append(header);
  const live=node('div',undefined,'usc-live-row'),holder=node('div',undefined,'usc-status-holder');
  const status=node('button',undefined,'usc-live-status');status.type='button';status.dataset.status=info.status;status.setAttribute('aria-label','현재 상태: '+LABELS[info.status]);status.setAttribute('aria-haspopup','menu');status.setAttribute('aria-expanded','false');status.append(node('span',undefined,'usc-status-pip usc-status-'+info.status),svgIcon(['m6 9 6 6 6-6'],10));holder.append(status);
  const activity=node('textarea',undefined,'usc-live-activity');activity.rows=1;activity.maxLength=500;activity.value=info.activity;activity.setAttribute('aria-label','현재 활동');activity.placeholder='현재 활동';
  const resize=()=>{activity.style.height='auto';activity.style.height=Math.min(112,Math.max(32,activity.scrollHeight))+'px';};
  let dirty=false,committing=false;activity.oninput=()=>{dirty=true;resize();};activity.onfocus=resize;
  const saveActivity=async()=>{if(!dirty||committing)return;committing=true;try{await setOverride(c,statusData(c,profile(c)).status,activity.value);dirty=false;}catch(e){errorText=e.message;}finally{committing=false;queueRender();}};
  activity.onblur=event=>{if(!holder.contains(event.relatedTarget)&&!event.relatedTarget?.closest?.('.usc-restore,.usc-expiry-row'))void saveActivity();};
  activity.onkeydown=event=>{if(event.isComposing)return;if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void saveActivity().then(()=>activity.blur());}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();activity.value=statusData(c,profile(c)).activity;dirty=false;activity.blur();}};
  const menu=node('div',undefined,'usc-status-menu');menu.hidden=true;menu.setAttribute('role','menu');
  for(const[value,label]of Object.entries(LABELS)){const option=actionButton(label,async()=>{try{await setOverride(c,value,dirty?activity.value:statusData(c,profile(c)).activity);dirty=false;menu.hidden=true;status.setAttribute('aria-expanded','false');display(popup,c,profile(c));}catch(e){errorText=e.message;queueRender();}},'usc-status-option');option.setAttribute('role','menuitemradio');option.setAttribute('aria-checked',String(info.status===value));option.prepend(node('span',undefined,'usc-status-pip usc-status-'+value));menu.append(option);}
  status.onclick=()=>{menu.hidden=!menu.hidden;status.setAttribute('aria-expanded',String(!menu.hidden));positionPopup();};holder.append(menu);live.append(holder,activity);
  if(activeOverride(p)){const restore=actionButton('',async()=>{dirty=false;try{await restoreUserSchedule(c);display(popup,c,profile(c));}catch(e){errorText=e.message;queueRender();}},'usc-restore');restore.append(svgIcon(['M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7']));restore.title='스케줄로 복귀';restore.setAttribute('aria-label','스케줄로 복귀');live.append(restore);}
  host.append(live);
  marinara.setTimeout(()=>{if(activity.isConnected)resize();},0);
  const expiry=node('div',undefined,'usc-expiry-row'),mode=node('select'),time=node('input');time.type='time';time.setAttribute('aria-label','오버라이드 종료 시각');
  mode.setAttribute('aria-label','오버라이드 유지 시간');for(const[value,label]of [['manual','해제할 때까지'],['until','종료 시각 지정']]){const option=node('option',label);option.value=value;mode.append(option);}
  const savedOverride=activeOverride(p),end=savedOverride?.expiresAt?wall(p.config.zone,new Date(savedOverride.expiresAt)):null;
  mode.value=end?'until':'manual';time.value=end?clock(end.minute):clock((wall(p.config.zone).minute+60)%1440);time.hidden=mode.value!=='until';
  const hint=node('span',undefined,'usc-muted usc-expiry-hint');
  function expiryHint(){if(mode.value==='until'){const e=wall(p.config.zone,new Date(expiryAt(p.config.zone,time.value)));hint.textContent=(e.date===wall(p.config.zone).date?'오늘':'내일')+' '+time.value+'까지 · '+p.config.zone;}else hint.textContent='스케줄로 복귀할 때까지 유지';}
  mode.onchange=()=>{time.hidden=mode.value!=='until';expiryHint();positionPopup();};time.oninput=()=>{if(time.value)expiryHint();};
  const apply=actionButton('적용',async()=>{try{const expiresAt=mode.value==='until'?expiryAt(p.config.zone,time.value):null;await setOverride(c,statusData(c,profile(c)).status,dirty?activity.value:statusData(c,profile(c)).activity,expiresAt);dirty=false;display(popup,c,profile(c));}catch(e){errorText=e.message;queueRender();}});apply.classList.add('usc-expiry-apply');
  expiry.append(node('span','상태 유지'),mode,time,apply,hint);expiryHint();host.append(expiry);
  const scheduleBox=node('div',undefined,'usc-schedule-box'),row=node('div',undefined,'usc-row');row.append(node('strong','스케줄'));
  const editSchedule=node('button','✎ 편집','usc-small-button');editSchedule.type='button';editSchedule.onclick=openUserSettings;row.append(editSchedule);scheduleBox.append(row);
  if(!p.config.enabled)scheduleBox.append(node('p','스케줄 꺼짐','usc-muted'));
  else if(!p.schedule)scheduleBox.append(node('p','일정 미생성','usc-muted'));
  else{const next=nextBlock(p.schedule,p.config);if(next){const line=node('button',undefined,'usc-next-block');line.type='button';const label=next.dayOffset===0?'오늘':next.dayOffset===1?'내일':DAY_NAMES[DAYS.indexOf(next.day)];line.append(node('span',`다음 · ${label} · ${next.time}`,'usc-muted'),node('span',next.activity));line.onclick=()=>openUserSettings(next.day);scheduleBox.append(line);}else scheduleBox.append(node('p','다음 일정 없음','usc-muted'));}
  host.append(scheduleBox);if(errorText)host.append(node('p',errorText,'usc-error'));
}
function render() {
  if(!alive||!activeChat)return;
  if(activeChat.mode!=='conversation'){button.hidden=true;closePopup();for(const n of mounted)n.remove();mounted.clear();return;}
  const native=document.querySelector('[data-conversation-header-identity] button[data-chat-help="identity"]')||document.querySelector('button[data-chat-help="identity"]');
  if(native?.parentElement){
    anchor=native;
    if(button.parentElement!==native.parentElement)native.after(button);
    const nativeClass=native.className.replace(/marinara-chat-toolbar-button--open/g,'');
    const launchClass=nativeClass+' usc-launch';if(button.className!==launchClass)button.className=launchClass;
    const width=native.getBoundingClientRect().width;if(width>0&&button.style.width!==width+'px')button.style.width=width+'px';
    button.hidden=false;
  }else{button.hidden=true;closePopup();}
  const p=profile(activeChat),info=statusData(activeChat,p);
  const sig=JSON.stringify([key(activeChat),p,Boolean(activeOverride(p)),info,userInfo.get(key(activeChat)),wall(p.config.zone).date,wall(p.config.zone).minute,errorText,generating]);
  if(sig!==lastSignature){
    button.replaceChildren(avatar(info.name,info.status));const text=node('div',undefined,'usc-pill-copy');text.append(node('span',info.name,'usc-pill-name'),node('span',info.activity,'usc-pill-activity'));button.append(text);
    button.title=info.name+' 스케줄 · '+LABELS[info.status]+' · '+info.activity;
    for(const n of mounted)if(n.isConnected)display(n,activeChat,p);
    lastSignature=sig;
  }
  if(!popup.hidden&&popup.dataset.signature!==sig){display(popup,activeChat,p);if(!popup.contains(document.activeElement)||!document.activeElement.matches('textarea,input,select'))popup.dataset.signature=sig;}
  // Keep the native character panel untouched. The user owns a separate panel.
  positionPopup();
}
function queueRender() {if(renderQueued||!alive)return;renderQueued=true;marinara.setTimeout(()=>{renderQueued=false;render();},0);}
const observer=new MutationObserver(queueRender);observer.observe(document.body,{childList:true,subtree:true});
function pointerClose(event) {
  if(!event.target.closest?.('.usc-status-holder'))for(const menu of document.querySelectorAll('.usc-status-menu')){menu.hidden=true;menu.parentElement.querySelector('.usc-row-status,.usc-live-status')?.setAttribute('aria-expanded','false');}
  if(!panel.hidden&&event.target===panel){closeSettings();return;}
  const typingTarget=event.target.closest?.('textarea,input:not([type=button]):not([type=submit]),[contenteditable=true]');
  if(!popup.hidden&&!popup.contains(event.target)&&!button.contains(event.target)&&!typingTarget)closePopup();
}
function keyHandler(event) {
  if(event.key==='Escape') {
    const menu=document.querySelector('.usc-status-menu:not([hidden])');if(menu){event.preventDefault();event.stopPropagation();menu.hidden=true;const trigger=menu.parentElement.querySelector('.usc-row-status,.usc-live-status');trigger?.setAttribute('aria-expanded','false');trigger?.focus();return;}
    if(!panel.hidden){event.preventDefault();event.stopPropagation();closeSettings();}
    else if(!popup.hidden){event.preventDefault();closePopup();button.focus();}
  }else if(event.key==='Tab'&&!panel.hidden){
    const items=[...panel.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden&&n.getClientRects().length>0);
    if(!items.length)return;const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
}
function nativePanelClick(event){if(event.target.closest?.('button[data-chat-help=identity]'))closePopup();}
document.addEventListener('click',nativePanelClick);document.addEventListener('mousedown',pointerClose);document.addEventListener('keydown',keyHandler,true);
window.visualViewport?.addEventListener('resize',positionPopup);window.visualViewport?.addEventListener('scroll',positionPopup);
window.addEventListener('resize',positionPopup);window.addEventListener('scroll',positionPopup,true);
function field(form,title,tag,value,options){const label=node('label',title),control=node(tag);if(tag==='select')for(const[v,t]of options){const o=node('option',t);o.value=v;control.append(o);}control.value=value;label.append(control);form.append(label);return control;}
function actionButton(label,handler,cls='usc-small-button'){const b=node('button',label,cls);b.type='button';b.onclick=handler;return b;}
let editorSession=0;
async function openSettings(initialDay=null){
 if(!activeChat)return;const c=activeChat,p=profile(c),session=++editorSession;editing=key(c);panel.replaceChildren();
 let draft=structuredClone(p.schedule||emptySchedule(p.config.zone));let fictionalDraft=structuredClone(p.fictionalSchedule||draft);let draftConfig={...p.config};let dayGuidance={};let busy=false,rawRepair=null;
 const form=node('form',undefined,'usc-settings-dialog usc-native marinara-chat-popover mari-chat-style-surface');form.setAttribute('role','dialog');form.setAttribute('aria-modal','true');form.setAttribute('aria-label','주간 스케줄 편집');panel.append(form);
 const h=node('div',undefined,'usc-row');h.append(node('strong',(userInfo.get(key(c))?.name||'{{user}}')+' 스케줄 편집'));h.append(actionButton('닫기',()=>{controller?.abort();closeSettings();}));form.append(h);
 const identity=node('div',undefined,'usc-editor-identity');identity.append(avatar(userInfo.get(key(c))?.name||'{{user}}','offline'));identity.append(node('strong',userInfo.get(key(c))?.name||'{{user}}'));form.append(identity);
 const summary=node('details',undefined,'usc-editor-section');summary.append(node('summary','일상 요약'));const readout=node('p',draft.routineSummary||'저장된 주간 일정의 일상 요약이 없습니다.','usc-muted');summary.append(readout);
 const summaryButton=actionButton(draft.routineSummary?'요약 새로고침':'요약 생성',async()=>{try{const cfg=config();if(!cfg.connectionId)throw Error('언어 모델 연결을 선택하세요.');setBusy(true);controller=new AbortController();const text=await rawGenerate(cfg,`Summarize this PERSONA weekly routine in a concise Korean paragraph. Return JSON {"summary":"..."}. Do not infer real human behavior. Weekly schedule: ${JSON.stringify(draft.days)}`,controller.signal);draft.routineSummary=parseJSON(text).summary;if(typeof draft.routineSummary!=='string')throw Error('요약 형식 오류');draft.routineSummaryGeneratedAt=new Date().toISOString();readout.textContent=draft.routineSummary;message('요약은 초안입니다. 일정 저장을 눌러 적용하세요.');}catch(e){message(e.name==='AbortError'?'생성 중단됨':e.message,e.name!=='AbortError');}finally{controller=null;setBusy(false);}});summary.append(summaryButton);form.append(summary);
 const preferences=node('details',undefined,'usc-editor-section');preferences.open=!p.schedule;preferences.append(node('summary','스케줄 설정'));form.append(preferences);
 const enabled=field(preferences,'스케줄','select',String(p.config.enabled),[['true','켜기'],['false','끄기']]);
 const mode=field(preferences,'생성 기준','select',p.config.mode,[['linked','캐릭터 일정과 상호작용 기회 맞추기'],['independent','페르소나 설정으로 독립 생성']]);
 const instruction=field(preferences,'스케줄 생성 지침 ({{user}})','textarea',p.config.instructions);
 const lifestyle=field(preferences,'유저의 실제 생활패턴','textarea',p.config.lifestyle);lifestyle.placeholder='실제 점심은 12시, 수면은 23시~07시. 페르소나의 점심/기상 시간은 바꾸지 않고 그 시간에 접속만 불가.';
 preferences.append(node('p','실제 생활패턴은 접속 상태에만 반영합니다. 활동과 식사·기상 시간은 페르소나 설정을 따릅니다. 변경한 지침과 생활패턴은 다음 AI 생성에 반영됩니다.','usc-muted'));
 const zone=field(preferences,'일정 시간대','input',p.config.zone);
 const connection=field(form,'생성 연결','select',p.config.connectionId,[['','연결 선택']]);
 const ai=node('details',undefined,'usc-editor-section');ai.open=true;ai.append(node('summary','스케줄 AI'));form.append(ai);
 const weekMode=field(ai,'주간 작업','select',p.schedule?'adjust':'rewrite',[['rewrite','새로 작성'],['adjust','부분 조정'],['vary','변화 주기'],['repair','빈 시간·겹침 복구']]);
 const requestMode=field(ai,'주간 요청','select','week',[['week','일주일 한 번에'],['day','요일별로 일주일 생성']]);
 ai.append(node('p','생성 결과는 초안입니다. 일정 저장 전에는 현재 일정이 바뀌지 않습니다.','usc-muted'));
 const messageNode=node('p','','usc-status-message');messageNode.setAttribute('role','status');form.append(messageNode);
 const message=(text,error=false)=>{messageNode.textContent=text;messageNode.className=error?'usc-error':'usc-status-message';};
 const config=()=>{const cfg={enabled:enabled.value==='true',mode:mode.value,instructions:instruction.value,lifestyle:lifestyle.value,zone:zone.value.trim(),connectionId:connection.value};wall(cfg.zone);return cfg;};
 const repair=node('div',undefined,'usc-repair');repair.hidden=true;form.append(repair);
 const daysArea=node('fieldset',undefined,'usc-days');form.append(daysArea);
 function setBusy(value){busy=value;daysArea.disabled=value;for(const el of form.querySelectorAll('button,input,select,textarea')){if(el.dataset.allowBusy!=='true')el.disabled=value;}if(session===editorSession)render();}
 function showRepair(e){if(!e.rawScheduleJSON)return;rawRepair={text:e.rawScheduleJSON,day:e.day};repair.hidden=false;repair.replaceChildren();repair.append(node('strong','모델이 반환한 일정 JSON 수정'));const text=node('textarea');text.value=rawRepair.text;repair.append(text);repair.append(actionButton('초안에 적용',async()=>{try{const parsed=parseJSON(text.value);const next=rawRepair.day?{...draft,days:{...draft.days,[rawRepair.day]:validateDay(parsed.blocks,rawRepair.day,true)}}:validate(parsed,true);setBusy(true);controller=new AbortController();const windows=await availability(config(),controller.signal);fictionalDraft=structuredClone(next);draft=applyAvailability(next,windows,rawRepair.day?[rawRepair.day]:DAYS);repair.hidden=true;renderDays();message('수정된 JSON을 초안에 적용했습니다. 일정 저장을 눌러 적용하세요.');}catch(err){message(err.message,true);}finally{controller=null;setBusy(false);}}));}
 async function generateDraft(day=null){if(busy)return;try{setBusy(true);repair.hidden=true;draftConfig=config();let result;if(day||requestMode.value==='week'){result=await generate(c,draftConfig,fictionalDraft,weekMode.value,day,dayGuidance[day]||'',message);if(session!==editorSession||panel.hidden)return;if(day){draft={...draft,weekStart:result.schedule.weekStart,days:{...draft.days,[day]:result.schedule.days[day]}};fictionalDraft={...fictionalDraft,days:{...fictionalDraft.days,[day]:result.fictionalSchedule.days[day]}};}else{draft=result.schedule;fictionalDraft=result.fictionalSchedule;}}else{let windows=null,temp=structuredClone(draft),fictional=structuredClone(fictionalDraft);for(const weekday of DAYS){result=await generate(c,draftConfig,fictional,weekMode.value,weekday,dayGuidance[weekday]||'',message,windows);windows=result.windows;if(session!==editorSession||panel.hidden)return;temp.days[weekday]=result.schedule.days[weekday];fictional.days[weekday]=result.fictionalSchedule.days[weekday];draft=structuredClone(temp);fictionalDraft=structuredClone(fictional);renderDays(weekday);}draft=temp;fictionalDraft=fictional;}
  renderDays(day);message(day?DAY_NAMES[DAYS.indexOf(day)]+' 재생성 완료 · 초안':'월~일 일주일 생성 완료 · 초안');
 }catch(e){message(e.name==='AbortError'?'생성 중단됨 · 저장된 일정 유지':e.message,e.name!=='AbortError');showRepair(e);}finally{setBusy(false);}}
 const gen=actionButton('↻ 일주일 생성',()=>generateDraft());ai.append(gen);
 const stop=actionButton('중단',()=>controller?.abort());stop.dataset.allowBusy='true';ai.append(stop);
 function renderDays(expand=initialDay){const opened=expand||daysArea.querySelector('details[open]')?.dataset.day;daysArea.replaceChildren();for(const day of DAYS){const section=node('details',undefined,'usc-editor-section usc-day');section.dataset.day=day;section.open=day===opened;const heading=node('summary',undefined,'usc-day-heading');const title=node('span',undefined,'usc-day-title');title.append(node('strong',DAY_NAMES[DAYS.indexOf(day)]),node('small',`${draft.days[day].length}개 블록`));heading.append(title);
 const timeline=node('span',undefined,'usc-timeline');for(const block of draft.days[day]){try{for(const[a,b]of range(block.time)){const segment=node('span',undefined,'usc-timeline-segment usc-status-'+block.status);segment.style.left=a/1440*100+'%';segment.style.width=(b-a)/1440*100+'%';segment.title=block.time+' · '+block.activity;timeline.append(segment);}}catch{}}heading.append(timeline);section.append(heading);
 section.ontoggle=()=>{if(section.open)for(const other of daysArea.querySelectorAll('details'))if(other!==section)other.open=false;};
 const rows=node('div',undefined,'usc-day-rows');for(const[index,block]of draft.days[day].entries()){
  const row=node('div',undefined,'usc-block-row'),controls=node('div',undefined,'usc-block-controls');
  const statusHolder=node('div',undefined,'usc-status-holder'),status=node('button',undefined,'usc-row-status');status.type='button';status.dataset.status=block.status;status.setAttribute('aria-label',DAY_NAMES[DAYS.indexOf(day)]+' 상태: '+LABELS[block.status]);status.setAttribute('aria-haspopup','menu');status.setAttribute('aria-expanded','false');const pip=node('span',undefined,'usc-status-pip usc-status-'+block.status);status.append(pip,node('span','▾'));statusHolder.append(status);const menu=node('div',undefined,'usc-status-menu');menu.hidden=true;menu.setAttribute('role','menu');for(const[value,label]of Object.entries(LABELS)){const item=actionButton(label,()=>{block.status=value;status.dataset.status=value;pip.className='usc-status-pip usc-status-'+value;status.setAttribute('aria-label',DAY_NAMES[DAYS.indexOf(day)]+' 상태: '+label);status.setAttribute('aria-expanded','false');menu.hidden=true;for(const option of menu.querySelectorAll('[role=menuitemradio]'))option.setAttribute('aria-checked',String(option.dataset.value===value));fictionalDraft.days[day]=structuredClone(draft.days[day]);},'usc-status-option');item.dataset.value=value;item.setAttribute('role','menuitemradio');item.setAttribute('aria-checked',String(block.status===value));item.prepend(node('span',undefined,'usc-status-pip usc-status-'+value));menu.append(item);}status.onclick=()=>{const open=menu.hidden;for(const other of form.querySelectorAll('.usc-status-menu'))other.hidden=true;menu.hidden=!open;status.setAttribute('aria-expanded',String(open));};statusHolder.append(menu);
  const time=node('input',undefined,'usc-row-time');time.value=block.time;time.placeholder='09:00-11:30';time.setAttribute('aria-label',DAY_NAMES[DAYS.indexOf(day)]+' 시간');time.oninput=()=>{block.time=time.value;fictionalDraft.days[day]=structuredClone(draft.days[day]);};
  const activity=node('input',undefined,'usc-row-activity');activity.value=block.activity;activity.placeholder='활동';activity.setAttribute('aria-label',DAY_NAMES[DAYS.indexOf(day)]+' 활동');activity.oninput=()=>{block.activity=activity.value;fictionalDraft.days[day]=structuredClone(draft.days[day]);};controls.append(statusHolder,time,activity);row.append(controls);
  const remove=actionButton('×',()=>{draft.days[day].splice(index,1);fictionalDraft.days[day]=structuredClone(draft.days[day]);renderDays(day);},'usc-delete-block');remove.setAttribute('aria-label',DAY_NAMES[DAYS.indexOf(day)]+' 블록 삭제');row.append(remove);rows.append(row);
 }
 section.append(rows);const buttons=node('div',undefined,'usc-day-actions');buttons.append(actionButton('+ 블록 추가',()=>{draft.days[day].push({time:'09:00-10:00',activity:'자유 시간',status:'online'});fictionalDraft.days[day]=structuredClone(draft.days[day]);renderDays(day);}));buttons.append(actionButton('↻ 요일 재생성',()=>generateDraft(day)));section.append(buttons);
 const guide=field(section,'이 요일의 생성 지침','input',dayGuidance[day]||'');guide.oninput=()=>{dayGuidance[day]=guide.value;};daysArea.append(section);
 }}
 renderDays();
 const footer=node('div',undefined,'usc-editor-footer');form.append(footer);const importFile=node('input');importFile.type='file';importFile.accept='.json,application/json';importFile.hidden=true;form.append(importFile);
 footer.append(actionButton('일정 가져오기',()=>importFile.click()));footer.append(actionButton('일정 내보내기',()=>{try{const schedule=validate(draft),blob=new Blob([JSON.stringify({kind:'marinara.character-schedule',version:1,exportedAt:new Date().toISOString(),characterName:userInfo.get(key(c))?.name,schedule},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='persona.marinara-schedule.json';link.click();marinara.setTimeout(()=>URL.revokeObjectURL(url),1000);message('현재 초안을 내보냈습니다.');}catch(e){message(e.message,true);}}));
 importFile.onchange=async()=>{const file=importFile.files?.[0];if(!file)return;try{if(file.size>1048576)throw Error('일정 파일은 1MiB 이하여야 합니다.');const parsed=JSON.parse(await file.text());if(parsed.kind&&parsed.kind!=='marinara.character-schedule')throw Error('ME 스케줄 파일 형식이 아닙니다.');if(parsed.version&&parsed.version!==1)throw Error('지원하지 않는 일정 파일 버전');draft=validate(parsed);draft.weekStart=weekStart(config().zone);fictionalDraft=structuredClone(draft);renderDays();message('가져온 일정은 초안입니다. 일정 저장을 눌러 적용하세요.');}catch(e){message(e.message,true);}finally{importFile.value='';}};
 const cancel=actionButton('취소',()=>{controller?.abort();closeSettings();});footer.append(cancel);
 const save=node('button','일정 저장','usc-save');save.type='submit';footer.append(save);
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;try{const cfg=config(),schedule=validate(draft);schedule.weekStart=weekStart(cfg.zone);setBusy(true);await persist(key(c),{...profile(c),config:cfg,schedule,fictionalSchedule:validate(fictionalDraft),created:new Date().toISOString()});message('저장됨');closeSettings();}catch(e){message(e.message,true);}finally{setBusy(false);}};
 try{const list=await api('/connections');if(session!==editorSession)return;for(const conn of list.filter(x=>!['audio','image_generation','video_generation','decision'].includes(x.provider))){const option=node('option',conn.name+' · '+(conn.model||''));option.value=conn.id;connection.append(option);}connection.value=p.config.connectionId;}catch(e){message(e.message,true);}
}
async function tick(){const id=getActive();if(!id){activeChat=null;closePopup();panel.hidden=true;editing=null;button.hidden=true;for(const n of mounted)n.remove();mounted.clear();return;}try{const c=await chat(id);if(!alive||getActive()!==id)return;if(id!==activeId){activeId=id;activeChat=c;lastSignature='';closePopup();controller?.abort();if(editing){panel.hidden=true;editing=null;++editorSession;}for(const n of mounted)n.remove();mounted.clear();}activeChat=c;void loadUserName(c);render();}catch(e){errorText=e.message;}}
const timer=marinara.setInterval(()=>void tick(),1000);await tick();
marinara.onCleanup(()=>{alive=false;closePopup();controller?.abort();marinara.clearInterval(timer);observer.disconnect();document.removeEventListener('click',nativePanelClick);document.removeEventListener('mousedown',pointerClose);document.removeEventListener('keydown',keyHandler,true);window.visualViewport?.removeEventListener('resize',positionPopup);window.visualViewport?.removeEventListener('scroll',positionPopup);window.removeEventListener('resize',positionPopup);window.removeEventListener('scroll',positionPopup,true);if(window.fetch===hookedFetch)window.fetch=nativeFetch;for(const n of mounted)n.remove();button.remove();panel.remove();popup.remove();});
