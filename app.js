(() => {
  'use strict';
  const STORAGE_KEY = 'kuntokayra_v1';
  const PERIODS = [['30', '30 pv'], ['90', '3 kk'], ['180', '6 kk'], ['365', '12 kk'], ['all', 'Kaikki']];
  const CATEGORIES = ['Etukroppa', 'Takakroppa'];
  const UNGROUPED_EXERCISES = ['Forkut'];
  const KG_PER_LB = 0.45359237;
  const fmt = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 1 });
  const shortFmt = new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'numeric' });
  const fullFmt = new Intl.DateTimeFormat('fi-FI', { day: 'numeric', month: 'long', year: 'numeric' });
  const icons = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    workouts: '<path d="M3 9v6m3-9v12m3-10v8m6-8v8m3-10v12m3-9v6M6 12h12"/>',
    sleep: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/><path d="M16.5 3v4m-2-2h4M21 5v3m-1.5-1.5h3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    weight: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M9 10a3 3 0 0 1 6 0m-3 0 1.5 2.5M8 17h8"/>',
    progress: '<path d="M3 19h18M5 15l5-5 4 3 5-8"/><path d="M16 5h3v3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    edit: '<path d="M12 20h9M4 16l11-11 4 4L8 20H4zM14 6l4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v6m4-6v6"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
    upload: '<path d="M12 17V5m-4 4 4-4 4 4M4 17v4h16v-4"/>'
  };
  const nav = [['home', 'Yhteenveto'], ['workouts', 'Treenit'], ['sleep', 'Yöaika'], ['weight', 'Paino'], ['progress', 'Kehitys']];
  const main = document.getElementById('main');
  const dialog = document.getElementById('entry-dialog');
  const dialogContent = document.getElementById('dialog-content');
  let state = loadState();
  let tab = 'home';
  let period = '90';
  let progressMetric = 'weight';
  let exerciseMetric = 'max';
  let selectedExercise = '';
  let workoutDraft = null;
  let editingId = null;
  let deferredInstall = null;
  let toastTimer;
  let chartSeq = 0;
  let restTimer = null;
  let restInterval = null;
  const pendingSetTimers = new Map();
  let sleepReview = null;
  let pageScrollLock = null;
  let historyCache = null;
  const restTimerNodes = new WeakMap();
  const charts = new Map();
  let expandedChartId = null;
  let chartResizeObserver = null;

  function svg(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.progress}</svg>`; }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c])); }
  function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function dateObj(s) { return new Date(`${s}T12:00:00`); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateObj(s).getTime()) && dateObj(s).getFullYear() === Number(s.slice(0,4)) && dateObj(s).getMonth()+1 === Number(s.slice(5,7)) && dateObj(s).getDate() === Number(s.slice(8,10)); }
  function fullDate(s) { return validDate(s) ? fullFmt.format(dateObj(s)) : s; }
  function shortDate(s) { return validDate(s) ? shortFmt.format(dateObj(s)) : s; }
  function num(v) { return Number(String(v).replace(',', '.')); }
  function weightText(v, unit = 'kg') { return `${fmt.format(v)} ${unit}`; }
  function exerciseUnit(exercise) { return exercise?.unit === 'lbs' ? 'lbs' : 'kg'; }
  function toKg(value, unit) { return unit === 'lbs' ? value * KG_PER_LB : value; }
  function fromKg(value, unit) { return unit === 'lbs' ? value / KG_PER_LB : value; }
  function inputWeight(value) { return String(Number(value.toPrecision(12))); }
  function draftWeightKg(set, unit) {
    return set._canonicalInput === String(set.weight) ? set._canonicalWeight : toKg(num(set.weight),unit);
  }
  function displayDraftWeight(set, kg, unit) {
    set.weight=inputWeight(fromKg(kg,unit));
    set._canonicalInput=set.weight;
    set._canonicalWeight=kg;
  }
  function countText(n, singular, plural) { return `${n} ${n===1?singular:plural}`; }
  // A tiny display-only tolerance keeps exact half-minutes stable after floating-point sums.
  function durationText(hours) { const minutes = Math.round(hours * 60 + 1e-9); return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2,'0')} min`; }
  function nightDuration(bed, wake) { const [bh,bm] = bed.split(':').map(Number), [wh,wm] = wake.split(':').map(Number); let minutes = wh*60+wm-(bh*60+bm); if (minutes <= 0) minutes += 1440; return minutes / 60; }
  function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function localDate(iso) { const d=new Date(iso);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function localTime(iso) { const d=new Date(iso);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function validTimestamp(value) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value; }
  function normalizeName(s) { return s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fi-FI'); }
  function emptyState() { return { workouts: [], sleep: [], weight: [] }; }
  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && Array.isArray(raw.workouts) && Array.isArray(raw.sleep) && Array.isArray(raw.weight)) return raw;
    } catch (_) { /* A damaged local entry is handled by starting empty. */ }
    return emptyState();
  }
  function persist(nextState = state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState)); return true; }
    catch (_) { toast('Tallennus ei onnistunut. Tarkista selaimen tallennustila.'); return false; }
  }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3300);
  }
  function sleepTracker(compact=false) {
    const pending=state.sleepPending, ended=Boolean(pending?.endedAt);
    return `<section class="${compact?'':'panel '}sleep-tracker ${pending?'active':''} ${compact?'sleep-tracker-compact':''}"><div class="sleep-tracker-head"><div><p class="panel-kicker">ILLASTA AAMUUN</p><h2>${pending?(ended?'Yö odottaa tallennusta':'Hyvää yötä'):'Muista yösi yhdellä painalluksella'}</h2></div><span class="sleep-state">${pending?(ended?'Tarkista yöaika':'Yö aloitettu'):'Valmiina iltaan'}</span></div>
      <p class="form-note">${pending?`Nukkumaan ${esc(shortDate(localDate(pending.startedAt)))} klo ${esc(localTime(pending.startedAt))}.${ended?` Heräsit ${esc(shortDate(localDate(pending.endedAt)))} klo ${esc(localTime(pending.endedAt))}.`:' Kellonaika pysyy tallessa, vaikka suljet sovelluksen.'}`:'Paina illalla nukkumaan mennessäsi ja aamulla herättyäsi. Voit tarkistaa kellonajat ennen tallennusta.'}</p>
      <div class="sleep-actions"><button type="button" class="sleep-action secondary" data-action="sleep-start" ${pending?'disabled':''}>${svg('sleep')}<span><strong>Menen nukkumaan</strong><small>${pending?`Aloitettu klo ${esc(localTime(pending.startedAt))}`:'Tallenna tämän hetken kellonaika'}</small></span></button><button type="button" class="sleep-action primary" data-action="sleep-wake" ${pending?'':'disabled'}>${svg('sun')}<span><strong>${ended?'Tarkista ja tallenna yö':'Olen herännyt'}</strong><small>${ended?'Avaa tallennetut kellonajat':'Päätä yö ja tarkista merkintä'}</small></span></button></div>
      ${pending?'<button type="button" class="text-action sleep-cancel" data-action="sleep-cancel">Peruuta aloitettu yö</button>':''}</section>`;
  }
  function startSleep() {
    if (state.sleepPending) return;
    const nextState={...state,sleepPending:{id:id(),startedAt:new Date().toISOString()}};
    if (!persist(nextState)) return;
    state=nextState;sleepReview=null;
    if (dialog.open) dialog.close();
    tab='sleep';render();toast('Nukkumaanmenoaika tallennettu. Hyvää yötä!');
  }
  function wakeSleep() {
    if (!state.sleepPending) return;
    if (!state.sleepPending.endedAt) {
      const nextState={...state,sleepPending:{...state.sleepPending,endedAt:new Date().toISOString()}};
      if (Date.parse(nextState.sleepPending.endedAt)<Date.parse(nextState.sleepPending.startedAt)) {toast('Laitteen kellonaika on muuttunut. Tarkista kellonaika ennen heräämisen kirjaamista.');return;}
      if (!persist(nextState)) return;
      state=nextState;
    }
    const pending=state.sleepPending;
    const initial={date:localDate(pending.endedAt),bed:localTime(pending.startedAt),wake:localTime(pending.endedAt)};
    const review={...pending,initial};
    openSimple('sleep',initial,review);
    const note=document.getElementById('sleep-review-note');
    if (note) note.textContent=Date.parse(pending.endedAt)-Date.parse(pending.startedAt)>16*3600000?'Aloituksesta on yli 16 tuntia. Tarkista ja korjaa päivämäärä tai kellonajat ennen tallentamista.':'Kellonajat on otettu talteen. Tarkista ne ja tallenna yöaika. Voit myös korjata aikoja.';
  }
  function cancelSleep() {
    if (!state.sleepPending || !confirm('Perutaanko aloitettu yö? Aiemmat yömerkinnät säilyvät.')) return;
    const nextState={...state};delete nextState.sleepPending;
    if (!persist(nextState)) return;
    state=nextState;sleepReview=null;
    if (dialog.open) dialog.close();
    tab='sleep';render();toast('Aloitettu yö peruttu');
  }
  function lockPageScroll() {
    if (pageScrollLock) return;
    const body=document.body, root=document.documentElement;
    const properties=['position','top','left','right','width','overflow'];
    pageScrollLock={y:window.scrollY || 0,body:Object.fromEntries(properties.map(key=>[key,body.style[key] || ''])),rootOverflow:root.style.overflow || ''};
    body.classList.add('dialog-open');
    Object.assign(body.style,{position:'fixed',top:`-${pageScrollLock.y}px`,left:'0',right:'0',width:'100%',overflow:'hidden'});
    root.style.overflow='hidden';
  }
  function unlockPageScroll() {
    if (!pageScrollLock || dialog.open) return;
    const saved=pageScrollLock;pageScrollLock=null;
    Object.assign(document.body.style,saved.body);
    document.documentElement.style.overflow=saved.rootOverflow;
    document.body.classList.remove('dialog-open');
    window.scrollTo({top:saved.y,behavior:'auto'});
  }
  function renderRestTimer() {
    const active=Boolean(restTimer);
    document.body.classList.toggle('has-rest-timer',active);
    dialog.classList.toggle('has-rest-timer',active);
    const seconds=restTimer?Math.max(0,Math.ceil((restTimer.endsAt-Date.now())/1000)):0;
    if (!seconds && restInterval!==null) {clearInterval(restInterval);restInterval=null;}
    const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
    for (const hostId of ['rest-timer-host','dialog-rest-timer-host']) {
      const host=document.getElementById(hostId);
      if (!host) continue;
      if (!restTimer) {if(restTimerNodes.has(host)){host.innerHTML='';restTimerNodes.delete(host);}continue;}
      let nodes=restTimerNodes.get(host);
      if (!nodes) {
        host.innerHTML=`<aside id="${hostId}-widget" class="rest-timer" aria-label="Sarjatauko"><span id="${hostId}-label" class="rest-timer-label"></span><strong id="${hostId}-countdown" class="rest-timer-countdown" role="timer" aria-live="off" data-rest-countdown></strong><small id="${hostId}-context" class="rest-timer-context"></small><div class="rest-timer-actions"><button type="button" data-action="rest-restart" aria-label="Aloita sarjatauko uudelleen">Uudelleen</button><button type="button" data-action="rest-cancel" aria-label="Sulje sarjataukoajastin">Sulje</button></div></aside>`;
        nodes=Object.fromEntries(['widget','label','countdown','context'].map(key=>[key,document.getElementById(`${hostId}-${key}`)]));
        restTimerNodes.set(host,nodes);
      }
      nodes.widget.classList.toggle('finished',seconds===0);
      const label=seconds?'Sarjatauko':'Tauko päättyi', context=`${restTimer.name} · sarja ${restTimer.setIndex+1}`;
      if (nodes.countdown.textContent!==time) nodes.countdown.textContent=time;
      if (nodes.context.textContent!==context) nodes.context.textContent=context;
      if (nodes.label.textContent!==label) {nodes.label.textContent=label;if(!seconds)nodes.label.setAttribute('role','status');else nodes.label.removeAttribute('role');}
    }
  }
  function validRestSeconds(value) { return Number.isInteger(value) && value>=15 && value<=1800; }
  function restSeconds() { return validRestSeconds(state.settings?.restSeconds)?state.settings.restSeconds:180; }
  function saveRestSettings(form) {
    const data=new FormData(form), minutes=String(data.get('minutes')??'').trim(), seconds=String(data.get('seconds')??'').trim();
    const min=num(minutes), sec=num(seconds), total=min*60+sec, error=document.getElementById('rest-settings-error');
    if (!minutes || !seconds || !Number.isInteger(min) || min<0 || min>30 || !Number.isInteger(sec) || sec<0 || sec>59 || !validRestSeconds(total)) {error.textContent='Valitse taukoajaksi 15 sekuntia–30 minuuttia.';return;}
    const nextState={...state,settings:{...state.settings,restSeconds:total}};
    if (!persist(nextState)) {error.textContent='Asetusta ei tallennettu. Aiempi taukoaika on edelleen käytössä.';return;}
    state=nextState;error.textContent='';toast(`Sarjatauko tallennettu: ${min} min ${sec} s`);
  }
  function startRestTimer(name, setIndex) {
    if (restInterval!==null) clearInterval(restInterval);
    restTimer={name,setIndex,endsAt:Date.now()+restSeconds()*1000};
    restInterval=setInterval(renderRestTimer,1000);
    renderRestTimer();
  }
  function cancelPendingSetTimers() {
    for (const timeout of pendingSetTimers.values()) clearTimeout(timeout);
    pendingSetTimers.clear();
  }
  function validDraftSet(ex, set) {
    const kg=draftWeightKg(set,exerciseUnit(ex)), reps=num(set.reps);
    return Boolean(ex.name.trim() && String(set.weight).trim() && String(set.reps).trim()) && Number.isFinite(kg) && kg>=0 && kg<=2000 && Number.isInteger(reps) && reps>=1 && reps<=1000;
  }
  function scheduleSetTimer(ex, set) {
    clearTimeout(pendingSetTimers.get(set));
    pendingSetTimers.delete(set);
    if (set._restStarted || !validDraftSet(ex,set)) return;
    pendingSetTimers.set(set,setTimeout(()=>{
      pendingSetTimers.delete(set);
      if (!dialog.open || !workoutDraft?.exercises.includes(ex) || !ex.sets.includes(set) || set._restStarted || !validDraftSet(ex,set)) return;
      set._restStarted=true;
      startRestTimer(ex.name,ex.sets.indexOf(set));
    },800));
  }
  function latest(items) { return [...items].sort((a,b) => b.date.localeCompare(a.date))[0]; }
  function sorted(items) { return [...items].sort((a,b) => b.date.localeCompare(a.date)); }
  function isCategory(value) { return CATEGORIES.includes(value); }
  function savedTime(row) { return Date.parse(row.savedAt) || 0; }
  function lastSavedWorkout() {
    return state.workouts.reduce((last, row) => !last || savedTime(row) >= savedTime(last) ? row : last, null);
  }
  function nextCategory() { return lastSavedWorkout()?.category === 'Etukroppa' ? 'Takakroppa' : 'Etukroppa'; }
  function recentWorkouts() {
    return workoutHistory().recent;
  }
  function workoutHistory() {
    if (historyCache?.workouts===state.workouts && historyCache.editingId===editingId) return historyCache;
    const indexed=state.workouts.map((row,index)=>({row,index}));
    const recent=[...indexed].sort((a,b)=>b.row.date.localeCompare(a.row.date)||savedTime(b.row)-savedTime(a.row)||b.index-a.index).map(item=>item.row);
    const units=new Map(), previous=new Map(), suggestions=new Map(CATEGORIES.map(category=>[category,new Map()]));
    for (const {row} of [...indexed].sort((a,b)=>savedTime(b.row)-savedTime(a.row)||b.index-a.index)) {
      for (const ex of row.exercises) {const key=normalizeName(ex.name);if(!units.has(key))units.set(key,exerciseUnit(ex));}
    }
    for (const row of recent) {
      for (const ex of row.exercises) {
        const key=normalizeName(ex.name), group=suggestions.get(row.category);
        if (row.id!==editingId && !previous.has(key)) previous.set(key,{workout:row,exercise:ex});
        if (group && !group.has(key)) group.set(key,ex.name);
      }
    }
    historyCache={workouts:state.workouts,editingId,recent,units,previous,suggestions};
    return historyCache;
  }
  function suggestedExercises(category) {
    return [...(workoutHistory().suggestions.get(category)?.values()||[])];
  }
  function previousFirstWeight(name) {
    return previousExercise(name)?.exercise.sets[0]?.weight ?? '';
  }
  function preferredExerciseUnit(name) {
    return workoutHistory().units.get(normalizeName(name))||'kg';
  }
  function previousExercise(name) {
    return workoutHistory().previous.get(normalizeName(name))||null;
  }
  function previousRepsText(name, index) {
    const previous=previousExercise(name), set=previous?.exercise.sets[index];
    return set ? `Viimeksi ${shortDate(previous.workout.date)}: ${set.reps} toistoa` : 'Ei aiempaa vastaavaa sarjaa';
  }
  function updatePreviousReps(index) {
    const ex=workoutDraft.exercises[index];
    ex.sets.forEach((set,si)=>{
      const hint=document.getElementById(`previous-reps-${index}-${si}`);
      const text=`Sarja ${si+1} · ${previousRepsText(ex.name,si)}`;
      if (hint && hint.textContent!==text) hint.textContent=text;
    });
  }
  function exerciseNames() {
    const map = new Map();
    for (const workout of sorted(state.workouts).reverse()) for (const ex of workout.exercises) map.set(normalizeName(ex.name), ex.name);
    for (const name of UNGROUPED_EXERCISES) if (!map.has(normalizeName(name))) map.set(normalizeName(name),name);
    return [...map.values()].sort((a,b) => a.localeCompare(b, 'fi'));
  }
  function categoryExerciseNames(category) {
    const ungrouped=new Set(UNGROUPED_EXERCISES.map(normalizeName));
    const keys=new Set(category==='uncategorized' ? ungrouped : []);
    for (const workout of state.workouts) {
      if (category==='uncategorized' ? isCategory(workout.category) : workout.category!==category) continue;
      for (const ex of workout.exercises) if (category==='uncategorized' || !ungrouped.has(normalizeName(ex.name))) keys.add(normalizeName(ex.name));
    }
    return exerciseNames().filter(name=>keys.has(normalizeName(name)));
  }
  function exerciseSeries(name, metric = 'max') {
    const byDate = new Map(), key = normalizeName(name);
    for (const workout of state.workouts) for (const ex of workout.exercises) {
      if (normalizeName(ex.name) !== key) continue;
      const row = byDate.get(workout.date) || {date:workout.date, max:0, reps:0, e1rm:0, volume:0};
      for (const set of ex.sets) {
        row.max = Math.max(row.max, Number(set.weight));
        row.reps = Math.max(row.reps, Number(set.reps));
        row.e1rm = Math.max(row.e1rm, Number(set.weight) * (1 + Number(set.reps) / 30));
        row.volume += Number(set.weight) * Number(set.reps);
      }
      byDate.set(workout.date, row);
    }
    return [...byDate.values()].sort((a,b) => a.date.localeCompare(b.date)).map(row => ({date:row.date, value:row[metric]}));
  }
  function rawSeries(metric) {
    if (metric === 'weight') return sorted(state.weight).reverse().map(row => ({date:row.date, value:Number(row.value)}));
    if (metric === 'sleep') return sorted(state.sleep).reverse().map(row => ({date:row.date, value:Number(row.duration),recordId:row.id}));
    return exerciseSeries(selectedExercise, exerciseMetric);
  }
  function inPeriod(points, selected = period) {
    if (selected === 'all') return points;
    const cutoff = dateObj(today()); cutoff.setDate(cutoff.getDate() - Number(selected) + 1);
    return points.filter(point => dateObj(point.date) >= cutoff);
  }
  function periodButtons() { return `<div class="segmented" role="group" aria-label="Aikaväli">${PERIODS.map(([key,label]) => `<button type="button" data-period="${key}" class="${period===key?'active':''}" aria-pressed="${period===key}">${label}</button>`).join('')}</div>`; }
  function formatValue(v, metric, unit = 'kg') { return metric === 'sleep' ? durationText(v) : metric === 'volume' ? `${fmt.format(v)} ${unit}·toistoa` : metric === 'reps' ? `${fmt.format(v)} toistoa` : weightText(v,unit); }
  function sleepSummary(data) {
    if (!data.length) return {average:null,latestDifference:null,count:0};
    const average=data.reduce((total,point)=>total+point.value,0)/data.length;
    return {average,latestDifference:data.at(-1).value-average,count:data.length};
  }
  function signedSleepDifference(difference) {
    const minutes=Math.round(Math.abs(difference)*60+1e-9);
    if (!minutes) return '0 min';
    return `${difference>0?'+':'−'}${minutes>=60?`${Math.floor(minutes/60)} h `:''}${minutes%60 || minutes<60?`${minutes%60} min`:''}`.trim();
  }
  function nextAxisStep(step,whole=false) {
    const power=10**Math.floor(Math.log10(step));
    for (const scale of [1,2,2.5,5,10,20,25,50,100]) {
      const value=scale*power;
      if (value>step+1e-9 && (!whole || Number.isInteger(value))) return value;
    }
    return step*10;
  }
  function chartAxis(data,metric,unit='kg') {
    const values=data.map(point=>Number(point.value)).filter(Number.isFinite);
    let min=values.length?Math.min(...values):0, max=values.length?Math.max(...values):0;
    const span=Math.max(0,max-min), kgSpan=unit==='lbs'?span*KG_PER_LB:span;
    let step=1;
    if (metric==='sleep') step=.5;
    else if (metric==='max' || metric==='e1rm') step=kgSpan>=10-1e-9?(unit==='lbs'?10:5):kgSpan>5+1e-9?(unit==='lbs'?5:2.5):1;
    else if (metric==='volume' && span>0) step=Math.max(1,10**Math.floor(Math.log10(span/6)));
    if (metric!=='sleep') while(span/step>7) step=nextAxisStep(step,metric==='weight'||metric==='reps');
    // Two extra grid intervals keep extrema away from the chart edges.
    min=Math.max(0,(Math.floor((min+1e-9)/step)-2)*step);
    max=(Math.ceil((max-1e-9)/step)+2)*step;
    const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,index)=>Number((min+index*step).toFixed(8)));
    return {min,max,step,ticks};
  }
  function axisLabel(value,metric) {
    if (metric!=='sleep') return fmt.format(value);
    const total=Math.round(value*60), minutes=total%60;
    return `${Math.floor(total/60)} h${minutes?` ${minutes} min`:''}`;
  }
  function chartDetails(entry,index) {
    const point=entry.data[index], sleep=entry.metric==='sleep';
    if (!point) return '';
    const row=sleep?(state.sleep.find(item=>item.id===point.recordId)||state.sleep.find(item=>item.date===point.date && Number(item.duration)===point.value)):null;
    const summary=sleep?sleepSummary(entry.data):null;
    const cells=sleep?[
      ['Nukkumaan',row?.bed||'—'],['Heräsin',row?.wake||'—'],
      ['Aikavälin keskiarvo',durationText(summary.average)],['Ero keskiarvosta',signedSleepDifference(point.value-summary.average)]
    ]:[['Mittari',entry.metric==='weight'?'Kehonpaino':entry.metric==='reps'?'Toistot':entry.metric==='volume'?'Työmäärä':entry.metric==='e1rm'?'Arvioitu 1RM':'Raskain sarja']];
    return `<p class="chart-detail-date">${sleep?'Valittu yö':'Valittu merkintä'} · ${esc(fullDate(point.date))}</p><strong class="chart-detail-value">${esc(formatValue(point.value,entry.metric,entry.unit))}</strong><div class="chart-detail-grid">${cells.map(([label,value])=>`<div><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`;
  }
  function chartSvg(entry,width=360) {
    const {id,data,metric,color,unit,expanded,compact,interactive}=entry;
    const axis=chartAxis(data,metric,unit),W=width,L=metric==='sleep'?92:64,R=18,T=18,B=36;
    const H=Math.max(expanded?340:compact?210:270,(axis.ticks.length-1)*19+T+B),plotW=W-L-R,plotH=H-T-B;
    let start=dateObj(data[0].date).getTime(),end=dateObj(data.at(-1).date).getTime();
    if(entry.period!=='all') {
      const cutoff=dateObj(today());cutoff.setDate(cutoff.getDate()-Number(entry.period)+1);
      start=cutoff.getTime();end=Math.max(end,dateObj(today()).getTime());
    }
    const x=point=>start===end?L+plotW/2:L+(dateObj(point.date).getTime()-start)/(end-start)*plotW;
    const y=value=>T+(axis.max-value)/(axis.max-axis.min)*plotH;
    const coords=data.map(point=>[x(point),y(point.value)]);
    Object.assign(entry,{W,H,coords});
    const line=coords.map(([px,py],index)=>`${index?'L':'M'}${px.toFixed(2)} ${py.toFixed(2)}`).join(' ');
    const area=`${line} L${coords.at(-1)[0]} ${T+plotH} L${coords[0][0]} ${T+plotH} Z`;
    const ticks=axis.ticks.map(value=>`<line x1="${L}" y1="${y(value)}" x2="${W-R}" y2="${y(value)}" stroke="#dce5db" stroke-dasharray="4 5"/><text class="chart-axis-text" x="${L-12}" y="${y(value)+5}" text-anchor="end" fill="#365244" font-size="13" font-weight="650">${esc(axisLabel(value,metric))}</text>`).join('');
    const average=metric==='sleep'?sleepSummary(data).average:null;
    const meanLine=average===null?'':`<line class="chart-mean-line" x1="${L}" x2="${W-R}" y1="${y(average)}" y2="${y(average)}" stroke="#596f5c" stroke-width="1.5" stroke-dasharray="7 5"><title>Aikavälin keskiarvo ${esc(durationText(average))}</title></line>`;
    const dots=interactive?data.map((point,index)=>`<g id="${id}-point-${index}" class="chart-point ${index===entry.selectedIndex?'selected':''}" role="button" tabindex="0" data-chart-point="${id}" data-index="${index}" aria-pressed="${index===entry.selectedIndex}" aria-label="${esc(fullDate(point.date))}: ${esc(formatValue(point.value,metric,unit))}"><circle class="chart-hit-target" cx="${coords[index][0]}" cy="${coords[index][1]}" r="20" fill="transparent"/><circle class="chart-dot" cx="${coords[index][0]}" cy="${coords[index][1]}" r="4" fill="${color}" stroke="#fff" stroke-width="2"/><title>${esc(fullDate(point.date))}: ${esc(formatValue(point.value,metric,unit))}</title></g>`).join(''):`<circle cx="${coords.at(-1)[0]}" cy="${coords.at(-1)[1]}" r="3.5" fill="${color}" aria-hidden="true"/>`;
    const labelCount=start===end?1:Math.max(2,Math.min(6,Math.floor(plotW/70)+1));
    const dateLabel=new Intl.DateTimeFormat('fi-FI',end-start>150*86400000?{month:'short',...(end-start>365*86400000?{year:'2-digit'}:{})}:{day:'numeric',month:'numeric'});
    const labels=Array.from({length:labelCount},(_,index)=>{
      const fraction=labelCount===1?.5:index/(labelCount-1),px=L+fraction*plotW;
      return `<text class="chart-axis-text" x="${px}" y="${H-8}" text-anchor="${labelCount===1?'middle':index===0?'start':index===labelCount-1?'end':'middle'}" fill="#365244" font-size="13">${esc(dateLabel.format(new Date(start+fraction*(end-start))))}</text>`;
    }).join('');
    return `<svg id="${id}-svg" class="chart-svg" data-chart-svg="${id}" viewBox="0 0 ${W} ${H}" role="${interactive?'group':'img'}" aria-label="Kehityskäyrä, ${data.length} merkintää.${interactive?' Valitse piste nähdäksesi tiedot.':''}"><defs><linearGradient id="${id}-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".10"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${ticks}<path d="${area}" fill="url(#${id}-gradient)"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>${meanLine}${dots}${labels}</svg>`;
  }
  function chart(points, metric, color = '#438867', compact = false, selectedPeriod = period, unit = 'kg', expanded=false) {
    const data=inPeriod(points.filter(point=>Number.isFinite(point.value)),selectedPeriod);
    if (!data.length) return `<div class="chart-empty"><div><strong>Ei merkintöjä tällä aikavälillä</strong>Lisää ensimmäinen kirjaus tai valitse pidempi aikaväli.</div></div>`;
    const id=`chart-${++chartSeq}`,interactive=selectedPeriod==='30';
    const entry={id,points,data,metric,color,period:selectedPeriod,unit,expanded,compact,interactive,selectedIndex:interactive?data.length-1:null};
    charts.set(id,entry);
    if (expanded) expandedChartId=id;
    const hint=interactive?'Valitse piste nähdäksesi tiedot':'Pisteiden tiedot ovat käytössä 30 pv -näkymässä';
    return `<section id="${id}" class="interactive-chart${interactive?' chart-has-details':''}"><div class="chart-toolbar"><span>${hint}${metric==='sleep'?' · katkoviiva näyttää keskiarvon':''}</span>${expanded?'':`<button type="button" class="text-action" data-action="expand-chart" data-chart="${id}">Suurenna käyrä ↗</button>`}</div><div id="${id}-plot" class="chart-plot-scroll">${chartSvg(entry)}</div>${interactive?`<div id="${id}-details" class="chart-details" aria-live="polite">${chartDetails(entry,entry.selectedIndex)}</div>`:''}</section>`;
  }
  function sizeCharts() {
    for(const entry of charts.values()) {
      const plot=document.getElementById(`${entry.id}-plot`);if(!plot)continue;
      const width=Math.floor(plot.getBoundingClientRect().width);
      if(width<180 || width===entry.W)continue;
      const focused=document.activeElement?.dataset.chartPoint===entry.id?Number(document.activeElement.dataset.index):null;
      plot.innerHTML=chartSvg(entry,width);
      if(focused!==null)document.getElementById(`${entry.id}-point-${focused}`)?.focus({preventScroll:true});
    }
  }
  function watchCharts() {
    chartResizeObserver?.disconnect();sizeCharts();
    if(typeof ResizeObserver==='function') {
      chartResizeObserver??=new ResizeObserver(sizeCharts);
      for(const entry of charts.values()) {
        const plot=document.getElementById(`${entry.id}-plot`);if(plot)chartResizeObserver.observe(plot);
      }
    }
  }
  function selectChartPoint(id,index) {
    const entry=charts.get(id);if(!entry?.interactive || !entry.data[index])return;
    const previous=document.getElementById(`${id}-point-${entry.selectedIndex}`),current=document.getElementById(`${id}-point-${index}`);
    previous?.classList.remove('selected');previous?.setAttribute('aria-pressed','false');
    current?.classList.add('selected');current?.setAttribute('aria-pressed','true');entry.selectedIndex=index;
    const details=document.getElementById(`${id}-details`);if(details)details.innerHTML=chartDetails(entry,index);
  }
  function expandChart(id) {
    const entry=charts.get(id);if(!entry || dialog.open)return;
    const title=entry.metric==='sleep'?'Yöajan kehitys':entry.metric==='weight'?'Painon kehitys':selectedExercise||'Liikkeen kehitys';
    dialog.classList.add('chart-modal');
    showDialog(`<div class="dialog-inner chart-expanded">${dialogHead(title,'Koko aikaväli näkyy kerralla. Pisteiden tiedot ovat käytössä 30 pv -näkymässä.')}${chart(entry.points,entry.metric,entry.color,false,entry.period,entry.unit,true)}</div>`);
  }
  function sparkline(points) {
    const data = points.slice(-12); if (!data.length) return '';
    const vals=data.map(p=>p.value), lo=Math.min(...vals), hi=Math.max(...vals), range=hi-lo||1;
    const path=data.map((p,i)=>`${i?'L':'M'}${(3+i*84/Math.max(1,data.length-1)).toFixed(1)} ${(30-(p.value-lo)/range*24).toFixed(1)}`).join(' ');
    return `<svg class="sparkline" viewBox="0 0 90 36" aria-hidden="true"><path d="${path}" fill="none" stroke="#65a67c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${3+(data.length-1)*84/Math.max(1,data.length-1)}" cy="${30-(data[data.length-1].value-lo)/range*24}" r="3" fill="#347958"/></svg>`;
  }
  function header(title, eyebrow, sub, button = '') { return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1>${sub?`<p class="page-sub">${sub}</p>`:''}</div>${button}</div>`; }
  function addButton(action, label) { return `<button type="button" class="button primary" data-action="${action}">${svg('plus')} ${label}</button>`; }
  function empty(iconName, title, body, action, label) { return `<div class="empty-state"><div class="empty-icon">${svg(iconName)}</div><h2>${title}</h2><p>${body}</p>${action?`<button type="button" class="button secondary" data-action="${action}">${svg('plus')} ${label}</button>`:''}</div>`; }
  function entryActions(type, row) { return `<div class="entry-actions"><button type="button" class="icon-button" data-action="edit-${type}" data-id="${esc(row.id)}" aria-label="Muokkaa merkintää ${esc(fullDate(row.date))}" title="Muokkaa">${svg('edit')}</button><button type="button" class="icon-button" data-action="delete-${type}" data-id="${esc(row.id)}" aria-label="Poista merkintä ${esc(fullDate(row.date))}" title="Poista">${svg('trash')}</button></div>`; }
  function exerciseCard(name) {
    const loads=exerciseSeries(name,'max');
    if (!loads.length) return `<button type="button" class="exercise-card" data-action="view-exercise" data-name="${esc(name)}"><strong>${esc(name)}</strong><small>Ei vielä kirjauksia</small><div class="exercise-bottom"><b>—</b></div></button>`;
    const bodyweight=loads.every(point=>point.value===0);
    const points=bodyweight?exerciseSeries(name,'reps'):loads;
    const unit=preferredExerciseUnit(name);
    const value=bodyweight?formatValue(points.at(-1).value,'reps'):weightText(fromKg(points.at(-1).value,unit),unit);
    return `<button type="button" class="exercise-card" data-action="view-exercise" data-name="${esc(name)}"><strong>${esc(name)}</strong><small>${countText(points.length,'treenipäivä','treenipäivää')}</small><div class="exercise-bottom"><b>${esc(value)}</b>${sparkline(points)}</div></button>`;
  }

  function renderHome() {
    const w=latest(state.weight), s=latest(state.sleep), weekCutoff=dateObj(today()); weekCutoff.setDate(weekCutoff.getDate()-6);
    const weekly=state.workouts.filter(row=>dateObj(row.date)>=weekCutoff).length;
    const recent=[...state.workouts.map(row=>({...row,kind:'workouts'})),...state.sleep.map(row=>({...row,kind:'sleep'})),...state.weight.map(row=>({...row,kind:'weight'}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
    return `<section class="hero"><div class="hero-content"><p class="eyebrow">OMA HYVINVOINTIPÄIVÄKIRJA</p><h1>Näe, miten arkesi<br>etenee.</h1><p>Treeni, rauhallinen yöaika ja kehonpaino samassa näkymässä. Jokainen merkintä rakentaa kuvaa kehityksestäsi.</p></div><div class="hero-graphic" aria-hidden="true"><svg viewBox="0 0 265 145" fill="none"><path d="M4 116 51 96 92 106 139 65 177 77 225 25 261 35" stroke="#a9d493" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 116 51 96 92 106 139 65 177 77 225 25 261 35" stroke="#a9d493" stroke-width="20" stroke-opacity=".07" stroke-linecap="round"/><circle cx="225" cy="25" r="8" fill="#d7edaa" stroke="#285849" stroke-width="4"/></svg></div></section>
    <div class="summary-grid">
      <div class="metric-card"><div class="metric-top">Treenit / 7 pv <span class="metric-icon green">${svg('workouts')}</span></div><div class="metric-value">${weekly} <small>krt</small></div><div class="metric-note">Viimeiset seitsemän päivää</div></div>
      <div class="metric-card"><div class="metric-top">Viimeisin yöaika <span class="metric-icon blue">${svg('sleep')}</span></div><div class="metric-value">${s?esc(durationText(s.duration)):'—'}</div><div class="metric-note">${s?esc(shortDate(s.date)):'Ei vielä merkintää'}</div></div>
      <div class="metric-card"><div class="metric-top">Viimeisin paino <span class="metric-icon rose">${svg('weight')}</span></div><div class="metric-value">${w?esc(fmt.format(w.value)):'—'} ${w?'<small>kg</small>':''}</div><div class="metric-note">${w?esc(shortDate(w.date)):'Ei vielä merkintää'}</div></div>
    </div>
    <div class="section-heading"><h2>Pikakirjaus</h2></div><div class="quick-grid">
      ${[['workouts','Treeni','Sarjat ja toistot','new-workout'],['sleep','Yöaika','Illasta aamuun','new-sleep'],['weight','Paino','Päivän mittaus','new-weight']].map(([ic,title,sub,action])=>`<button type="button" class="quick-action" data-action="${action}"><span class="round-icon">${svg(ic)}</span><span><strong>${title}</strong><small>${sub}</small></span><span class="quick-arrow">→</span></button>`).join('')}
    </div><div class="section-heading"><h2>Kehitys yhdellä silmäyksellä</h2><button class="text-action" type="button" data-tab="progress">Kaikki käyrät ${svg('arrow')}</button></div>
    <div class="home-trends"><section class="panel chart-panel"><div class="panel-head"><div><p class="panel-kicker">KEHONPAINO</p><h2 class="panel-title">Viimeiset 3 kuukautta</h2></div></div><div class="chart-wrap">${chart(rawSeries('weight'),'weight','#c3795e',true,'90')}</div></section>
    <section class="panel"><div class="panel-head"><div><p class="panel-kicker">PÄIVÄKIRJA</p><h2 class="panel-title">Viimeisimmät merkinnät</h2></div></div>${recent.length?`<div class="small-list">${recent.map(row=>`<div class="small-list-row"><div><strong>${row.kind==='workouts'?'Treeni':row.kind==='sleep'?'Yöaika':'Paino'}</strong><small>${esc(shortDate(row.date))}</small></div><b>${row.kind==='workouts'?`${row.exercises.length} liikettä`:row.kind==='sleep'?esc(durationText(row.duration)):esc(weightText(row.value))}</b></div>`).join('')}</div>`:'<p class="form-note">Kirjaa ensimmäinen treeni, yö tai paino, niin näet ne tässä.</p>'}</section></div>`;
  }
  function renderWorkouts() {
    return `${header('Treenipäiväkirja','VOIMAA JA TOISTOJA','Kirjaa jokainen liike sarjoineen. Käyrä syntyy automaattisesti, kun liike toistuu.',addButton('new-workout','Kirjaa treeni'))}
    <div class="section-heading"><div><h2>Omat liikkeesi</h2><p>Avaa kategoria ja valitse liike nähdäksesi sen käyrän</p></div></div>
    <div class="exercise-categories">${[...CATEGORIES,'uncategorized'].map(category=>{
      const names=categoryExerciseNames(category);
      return `<details class="exercise-category" data-category="${category}"><summary><span>${category==='uncategorized'?'Ilman kategoriaa':category}</span><span class="category-count">${countText(names.length,'liike','liikettä')}</span></summary>${names.length?`<div class="exercise-grid">${names.map(exerciseCard).join('')}</div>`:'<p class="form-note">Ei vielä liikkeitä tässä kategoriassa.</p>'}</details>`;
    }).join('')}</div>
    <div class="section-heading"><h2>Treenihistoria</h2></div>
    ${state.workouts.length?`<div class="entry-list">${sorted(state.workouts).map(row=>`<article class="entry-card"><div class="entry-main"><h3 class="entry-title">${esc(fullDate(row.date))}${isCategory(row.category)?` <span class="category-badge">${esc(row.category)}</span>`:''}</h3><div class="entry-meta">${row.exercises.length} liikettä · ${row.exercises.reduce((n,ex)=>n+ex.sets.length,0)} sarjaa</div><div class="entry-summary">${row.exercises.map(ex=>`<span><strong>${esc(ex.name)}</strong> · ${ex.sets.map(set=>`${esc(weightText(fromKg(set.weight,exerciseUnit(ex)),exerciseUnit(ex)))} × ${esc(set.reps)}`).join(', ')}</span>`).join('')}</div></div>${entryActions('workout',row)}</article>`).join('')}</div>`:empty('workouts','Ei vielä treenejä','Ensimmäinen kirjaus aloittaa treenihistoriasi.','new-workout','Kirjaa treeni')}`;
  }
  function renderSleep() {
    const points=rawSeries('sleep'), data=inPeriod(points), last=latest(state.sleep);
    return `${header('Yöaika','RAUHALLISET YÖT','Seuraa aikaa, jonka vietit sängyssä ilman puhelinta tai muita virikkeitä.',addButton('new-sleep','Kirjaa yö'))}
    ${sleepTracker()}
    <div class="hint-box">Kirjaa aika siitä, kun jätit puhelimen pois ja asetuit sänkyyn, siihen kun nousit. Painikkeet muistavat kellonajat puolestasi. Voit myös kirjata tai korjata yöajan käsin.</div>
    ${trendPanel(points,'sleep','Yöajan kehitys','Tuntia yötä kohti','#7678b6',data,last)}
    <div class="section-heading"><h2>Yömerkinnät</h2></div>${state.sleep.length?`<div class="entry-list">${sorted(state.sleep).map(row=>`<article class="entry-card"><div class="entry-main"><h3 class="entry-title">${esc(fullDate(row.date))}</h3><div class="entry-meta">Sänkyyn ${esc(row.bed)} · ylös ${esc(row.wake)}</div><div class="entry-summary"><strong>${esc(durationText(row.duration))}</strong></div></div>${entryActions('sleep',row)}</article>`).join('')}</div>`:empty('sleep','Ei vielä yömerkintöjä','Merkitse huomisen aamuna, milloin rauhoituit sänkyyn ja milloin nousit.','new-sleep','Kirjaa yö')}`;
  }
  function renderWeight() {
    const points=rawSeries('weight'), data=inPeriod(points), last=latest(state.weight);
    return `${header('Kehonpaino','OMA MITTAUS','Seuraa muutosta ajan mittaan ilman valmiita tavoitteita tai arvioita.',addButton('new-weight','Kirjaa paino'))}
    ${trendPanel(points,'weight','Painon kehitys','Kilogrammaa','#c3795e',data,last)}
    <div class="section-heading"><h2>Painomerkinnät</h2></div>${state.weight.length?`<div class="entry-list">${sorted(state.weight).map(row=>`<article class="entry-card"><div class="entry-main"><h3 class="entry-title">${esc(fullDate(row.date))}</h3><div class="entry-meta">Päivän mittaus</div><div class="entry-summary"><strong>${esc(weightText(row.value))}</strong></div></div>${entryActions('weight',row)}</article>`).join('')}</div>`:empty('weight','Ei vielä painomerkintöjä','Kirjaa mittaus, niin näet ajan myötä oman painokäyräsi.','new-weight','Kirjaa paino')}`;
  }
  function changeText(data, metric, unit = 'kg') {
    if (metric==='sleep') return data.length?signedSleepDifference(sleepSummary(data).latestDifference):'—';
    if (data.length<2) return '—';
    const delta=data.at(-1).value-data[0].value;
    return `${delta>=0?'+':'−'}${fmt.format(Math.abs(delta))} ${metric==='volume'?`${unit}·toistoa`:metric==='reps'?'toistoa':unit}`;
  }
  function chartStats(data,metric,unit='kg') {
    const value=point=>point?formatValue(point.value,metric,unit):'—';
    const cells=metric==='sleep'?
      [['Aikavälin keskiarvo',data.length?durationText(sleepSummary(data).average):'—'],['Viimeisin yö',value(data.at(-1))],['Ero keskiarvosta',changeText(data,metric,unit)]]:
      [['Ensimmäinen',value(data[0])],['Viimeisin',value(data.at(-1))],['Muutos',changeText(data,metric,unit)]];
    return `<div class="detail-stats">${cells.map(([label,text])=>`<div class="detail-stat"><span>${label}</span><strong>${esc(text)}</strong></div>`).join('')}</div>`;
  }
  function trendPanel(points, metric, title, subtitle, color, data=inPeriod(points)) {
    return `<div class="filter-row"><span class="filter-label">NÄYTÄ AIKAVÄLI</span>${periodButtons()}</div><section class="panel chart-large"><div class="panel-head"><div><p class="panel-kicker">${subtitle.toUpperCase()}</p><h2 class="panel-title">${title}</h2></div><span class="small-muted">${countText(data.length,'merkintä','merkintää')}</span></div><div class="chart-wrap">${chart(points,metric,color)}</div>${chartStats(data,metric)}</section>`;
  }
  function renderProgress() {
    const names=exerciseNames();
    if (names.length && !names.some(n=>normalizeName(n)===normalizeName(selectedExercise))) {
      selectedExercise=names[0];
      if (exerciseSeries(selectedExercise,'max').every(point=>point.value===0)) exerciseMetric='reps';
    }
    const metric=progressMetric==='exercise'?exerciseMetric:progressMetric;
    const unit=progressMetric==='exercise'?preferredExerciseUnit(selectedExercise):'kg';
    const points=(progressMetric==='exercise' && !names.length ? [] : rawSeries(progressMetric)).map(point=>
      progressMetric==='exercise' && metric!=='reps'?{...point,value:fromKg(point.value,unit)}:point);
    const title=progressMetric==='exercise'?selectedExercise:progressMetric==='sleep'?'Yöajan kehitys':'Painon kehitys';
    const subtitle=progressMetric==='exercise'?(exerciseMetric==='max'?`Raskain sarja / ${unit}`:exerciseMetric==='reps'?'Eniten toistoja / sarja':exerciseMetric==='e1rm'?`Arvioitu 1RM / ${unit}`:`Työmäärä / ${unit}·toistoa`):progressMetric==='sleep'?'Tuntia yötä kohti':'Kilogrammaa';
    const color=progressMetric==='exercise'?'#438867':progressMetric==='sleep'?'#7678b6':'#c3795e';
    return `${header('Kehitys','KÄYRÄT JA TRENDI','Valitse mittari ja aikaväli. Jokaisen saliliikkeen tulokset näkyvät omalla käyrällään.')}
    <div class="filter-row"><div class="segmented" role="group" aria-label="Mittari">${[['weight','Paino'],['sleep','Yöaika'],['exercise','Saliliike']].map(([key,label])=>`<button type="button" data-metric="${key}" class="${progressMetric===key?'active':''}" aria-pressed="${progressMetric===key}">${label}</button>`).join('')}</div>${periodButtons()}</div>
    ${progressMetric==='exercise'?(names.length?`<div class="filter-row"><div class="field" style="min-width:min(100%,270px)"><label for="exercise-select">Liike</label><select id="exercise-select">${names.map(n=>`<option value="${esc(n)}" ${normalizeName(n)===normalizeName(selectedExercise)?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div class="segmented" role="group" aria-label="Liikkeen mittari">${[['max','Raskain sarja'],['reps','Toistot'],['e1rm','Arvioitu 1RM'],['volume','Työmäärä']].map(([key,label])=>`<button type="button" data-exercise-metric="${key}" class="${exerciseMetric===key?'active':''}" aria-pressed="${exerciseMetric===key}">${label}</button>`).join('')}</div></div>`:'') : ''}
    ${progressMetric==='exercise'&&!names.length?empty('workouts','Ei vielä liikkeitä','Kirjaa treeni, niin jokaiselle liikkeelle muodostuu oma käyrä.','new-workout','Kirjaa treeni'):trendPanelWithoutFilter(points,metric,title,subtitle,color,unit)}
    ${progressMetric==='exercise'&&names.length?`<p class="form-note">${exerciseMetric==='e1rm'?'Arvioitu 1RM lasketaan painon ja toistojen perusteella (Epleyn kaava); se on suuntaa antava, ei mitattu maksimitulos.':exerciseMetric==='volume'?'Työmäärä = kaikkien saman päivän sarjojen paino × toistot.':exerciseMetric==='reps'?'Käyrän piste on päivän suurin yhden sarjan toistomäärä.':'Käyrän piste on päivän raskain kirjattu sarja.'}</p><div class="section-heading"><h2>Kaikki liikkeet</h2></div><div class="exercise-grid">${names.map(exerciseCard).join('')}</div>`:''}`;
  }
  function trendPanelWithoutFilter(points,metric,title,subtitle,color,unit='kg') {
    const data=inPeriod(points);
    return `<section class="panel chart-large"><div class="panel-head"><div><p class="panel-kicker">${esc(subtitle.toUpperCase())}</p><h2 class="panel-title">${esc(title)}</h2></div><span class="small-muted">${countText(data.length,'merkintä','merkintää')}</span></div><div class="chart-wrap">${chart(points,metric,color,false,period,unit)}</div>${chartStats(data,metric,unit)}</section>`;
  }
  function renderSettings() {
    return `${header('Asetukset','OMAT TIEDOT','Pidä kirjausdata omassa hallinnassasi.')}
    <div class="settings-stack"><section class="panel"><h2>Lisää puhelimen aloitusnäyttöön</h2><p>Avaa tämä sivu puhelimellasi. Asennettuna se näyttää ja toimii sovelluksen tavoin.</p><ol class="install-steps"><li>iPhone: avaa Safari, napauta Jaa-painiketta ja valitse <strong>Lisää Koti-valikkoon</strong>.</li><li>Android: avaa Chrome-valikko ja valitse <strong>Asenna sovellus</strong> tai <strong>Lisää aloitusnäyttöön</strong>.</li></ol>${deferredInstall?'<div class="settings-actions" style="margin-top:17px"><button type="button" class="button primary" data-action="install">Asenna sovellus</button></div>':''}</section>
    <section class="panel"><h2>Sarjataukon pituus</h2><p>Valitse 15 sekuntia–30 minuuttia. Uusi pituus koskee seuraavaa taukoa ja Uudelleen-painiketta. Käynnissä oleva tauko jatkuu nykyiseen loppuhetkeensä.</p><form id="rest-settings-form"><div class="field-row"><div class="field"><label for="rest-minutes">Minuutit</label><input id="rest-minutes" name="minutes" type="number" inputmode="numeric" min="0" max="30" step="1" value="${Math.floor(restSeconds()/60)}" required></div><div class="field"><label for="rest-seconds">Sekunnit</label><input id="rest-seconds" name="seconds" type="number" inputmode="numeric" min="0" max="59" step="1" value="${restSeconds()%60}" required></div></div><div id="rest-settings-error" class="form-error" role="alert"></div><button class="button secondary" type="submit">Tallenna taukoaika</button></form></section>
    <section class="panel"><h2>Varmuuskopio</h2><p>Merkinnät tallentuvat tämän laitteen selaimeen. Ne eivät synkronoidu automaattisesti toiseen puhelimeen tai tietokoneeseen. Vie JSON-varmuuskopio talteen ja tuo se tarvittaessa takaisin.</p><div class="settings-actions"><button type="button" class="button secondary" data-action="export">${svg('download')} Vie tiedot</button><button type="button" class="button ghost" data-action="import">${svg('upload')} Tuo varmuuskopio</button></div></section>
    <section class="panel"><h2>Poista kaikki merkinnät</h2><p>Tämä poistaa tämän selaimen treenit, yömerkinnät ja painot. Vie varmuuskopio ensin, jos haluat säilyttää ne.</p><button type="button" class="button danger" data-action="clear">Poista tiedot</button></section></div>`;
  }
  function render() {
    // Registry entries only describe the current DOM; chart selection never persists data.
    for (const id of charts.keys()) if(id!==expandedChartId) charts.delete(id);
    document.getElementById('header-date').textContent=new Intl.DateTimeFormat('fi-FI',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
    for (const [target,mobile] of [['desktop-nav',false],['mobile-nav',true]]) document.getElementById(target).innerHTML=nav.map(([key,label])=>`<button type="button" class="nav-item ${tab===key?'active':''}" data-tab="${key}" ${tab===key?'aria-current="page"':''}>${svg(key)}<span>${mobile&&key==='home'?'Koti':label}</span></button>`).join('');
    document.querySelector('.settings-button').classList.toggle('active',tab==='settings');
    main.innerHTML=({home:renderHome,workouts:renderWorkouts,sleep:renderSleep,weight:renderWeight,progress:renderProgress,settings:renderSettings})[tab]();
    watchCharts();
  }

  function showDialog(html, {preserveScroll=false, focus=null, reveal=false} = {}) {
    const wasOpen=dialog.open, scrollTop=dialogContent.querySelector('.dialog-inner')?.scrollTop || 0, outerScroll=dialog.scrollTop;
    dialogContent.innerHTML=html.includes('id="dialog-rest-timer-host"')?html:`<div id="dialog-rest-timer-host"></div>${html}`;
    if (!dialog.open) {lockPageScroll();dialog.showModal();}
    if (preserveScroll && wasOpen) {
      const inner=dialogContent.querySelector('.dialog-inner');
      if (inner) inner.scrollTop=scrollTop;
      dialog.scrollTop=outerScroll;
    }
    const target=focus?(Array.isArray(focus)?focus.map(selector=>dialogContent.querySelector(selector)).find(Boolean):dialogContent.querySelector(focus)):!wasOpen?dialogContent.querySelector('.dialog-close'):null;
    if (target && target!==document.activeElement) target.focus({preventScroll:preserveScroll && wasOpen});
    if (reveal) target?.scrollIntoView({block:'nearest',inline:'nearest'});
    renderRestTimer();
    watchCharts();
  }
  function dialogHead(title,sub) { return `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${sub}</p></div><button type="button" class="dialog-close" data-action="close" aria-label="Sulje">×</button></div>`; }
  function openWorkout(row) {
    cancelPendingSetTimers();
    sleepReview=null;
    editingId=row?.id||null;
    workoutDraft=row?JSON.parse(JSON.stringify(row)):{date:today(),category:nextCategory(),exercises:[{name:'',sets:[{weight:'',reps:''}]}]};
    // Existing and manually edited values are never replaced by a name suggestion.
    if (row) for (const ex of workoutDraft.exercises) {
      ex.unit=exerciseUnit(ex);
      ex._unitEdited=true;
      for (const set of ex.sets) {
        displayDraftWeight(set,Number(set.weight),ex.unit);
        set._weightEdited=true;
        set._restStarted=true;
      }
    }
    renderWorkoutEditor({preserveScroll:false});
  }
  function updateExerciseName(index, name) {
    const ex=workoutDraft.exercises[index];
    ex.name=name;
    if (!ex._unitEdited && !ex.sets.some(set=>set._weightEdited)) {const unit=preferredExerciseUnit(name);if(unit!==exerciseUnit(ex))changeExerciseUnit(index,unit);}
    updatePreviousReps(index);
    const first=ex.sets[0];
    if (first && !first._weightEdited && (first.weight==='' || first._weightSuggested)) {
      const kg=previousFirstWeight(name);
      if (kg==='') {first.weight='';delete first._canonicalInput;delete first._canonicalWeight;}
      else displayDraftWeight(first,Number(kg),exerciseUnit(ex));
      first._weightSuggested=true;
      const input=dialogContent.querySelector(`[data-draft="weight"][data-ex="${index}"][data-set="0"]`);
      if (input) input.value=first.weight;
    }
    ex.sets.forEach(set=>scheduleSetTimer(ex,set));
  }
  function changeExerciseUnit(index, unit) {
    const ex=workoutDraft.exercises[index], oldUnit=exerciseUnit(ex);
    if (unit!=='kg' && unit!=='lbs') return;
    ex.sets.forEach((set,si)=>{
      if (set.weight!=='' && Number.isFinite(num(set.weight))) displayDraftWeight(set,draftWeightKg(set,oldUnit),unit);
      const input=dialogContent.querySelector(`[data-draft="weight"][data-ex="${index}"][data-set="${si}"]`);
      if (input) {input.value=set.weight;input.setAttribute('aria-label',`Liike ${index+1}, sarja ${si+1}, paino ${unit}`);}
    });
    ex.unit=unit;
    const select=document.getElementById(`exercise-unit-${index}`), label=document.getElementById(`weight-label-${index}`);
    if (select) select.value=unit;
    if (label) label.textContent=`Paino (${unit})`;
  }
  function chooseExercise(name) {
    const existing=workoutDraft.exercises.findIndex(ex=>normalizeName(ex.name)===normalizeName(name));
    if (existing>=0) { document.getElementById(`exercise-${existing}`)?.focus({preventScroll:true}); return; }
    let index=workoutDraft.exercises.findIndex(ex=>!ex.name.trim());
    if (index<0) { index=workoutDraft.exercises.length; workoutDraft.exercises.push({name:'',sets:[{weight:'',reps:''}]}); }
    updateExerciseName(index,name);
    renderWorkoutEditor({preserveScroll:true,focus:`[data-draft="weight"][data-ex="${index}"][data-set="0"]`,reveal:true});
  }
  function renderWorkoutEditor(options = {preserveScroll:true}) {
    const names=suggestedExercises(workoutDraft.category);
    showDialog(`<div id="dialog-rest-timer-host"></div><div class="dialog-inner">${dialogHead(editingId?'Muokkaa treeniä':'Kirjaa treeni','Lisää liikkeet sekä jokaisen sarjan paino ja toistot.')}
      <div class="field-row"><div class="field"><label for="workout-date">Treenipäivä</label><input id="workout-date" data-draft="date" type="date" value="${esc(workoutDraft.date)}" required></div>
      <div class="field"><label for="workout-category">Treenikategoria</label><select id="workout-category" data-draft="category">${!isCategory(workoutDraft.category)?'<option value="">Ei kategoriaa (vanha merkintä)</option>':''}${CATEGORIES.map(category=>`<option value="${category}" ${workoutDraft.category===category?'selected':''}>${category}</option>`).join('')}</select></div></div>
      <section class="exercise-suggestions" aria-label="Kategorian aiemmat liikkeet"><p class="field-label">${isCategory(workoutDraft.category)?`${esc(workoutDraft.category)}: aiemmat liikkeet`:'Valitse kategoria nähdäksesi aiemmat liikkeet'}</p>${names.length?`<div class="suggestion-list">${names.map(name=>`<button type="button" class="suggestion-button" data-action="choose-exercise" data-name="${esc(name)}">${esc(name)}</button>`).join('')}</div><p class="form-note">Viimeisimmän treenin järjestyksessä. Valitse liike tai kirjoita oma nimi.</p>`:isCategory(workoutDraft.category)?'<p class="form-note">Tässä kategoriassa ei ole vielä liikkeitä. Kirjoita liikkeen nimi alle.</p>':''}</section>
      <datalist id="exercise-suggestions">${names.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist>
      ${workoutDraft.exercises.map((ex,ei)=>`<div class="form-section"><div class="form-section-head"><strong>Liike ${ei+1}</strong><button class="mini-remove" type="button" data-action="remove-exercise" data-ex="${ei}">Poista liike</button></div>
      <div class="field" style="margin-bottom:15px"><label for="exercise-${ei}">Liike</label><input id="exercise-${ei}" name="exercise-title-${ei}" data-draft="name" data-ex="${ei}" list="exercise-suggestions" type="text" maxlength="80" placeholder="Esim. penkkipunnerrus" value="${esc(ex.name)}" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Liike ${ei+1}, liikkeen nimi"></div>
      <div class="field exercise-unit"><label for="exercise-unit-${ei}">Painoyksikkö</label><select id="exercise-unit-${ei}" data-draft="unit" data-ex="${ei}"><option value="kg" ${exerciseUnit(ex)==='kg'?'selected':''}>kg – kilogrammat</option><option value="lbs" ${exerciseUnit(ex)==='lbs'?'selected':''}>lbs – paunat</option></select></div>
      <div class="set-head"><span id="weight-label-${ei}">Paino (${exerciseUnit(ex)})</span><span>Toistot</span><span></span></div>${ex.sets.map((set,si)=>`<div class="set-row"><input data-draft="weight" data-ex="${ei}" data-set="${si}" type="text" inputmode="decimal" value="${esc(set.weight)}" aria-label="Liike ${ei+1}, sarja ${si+1}, paino ${exerciseUnit(ex)}" placeholder="0"><input data-draft="reps" data-ex="${ei}" data-set="${si}" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${esc(set.reps)}" aria-label="Liike ${ei+1}, sarja ${si+1}, toistot" aria-describedby="previous-reps-${ei}-${si}" placeholder="8"><button class="set-remove" type="button" data-action="remove-set" data-ex="${ei}" data-set="${si}" aria-label="Poista sarja ${si+1}">×</button><span id="previous-reps-${ei}-${si}" class="previous-set">Sarja ${si+1} · ${esc(previousRepsText(ex.name,si))}</span></div>`).join('')}
      <button type="button" class="inline-add" data-action="add-set" data-ex="${ei}">+ Lisää sarja</button></div>`).join('')}
      <button type="button" class="button secondary" data-action="add-exercise">${svg('plus')} Lisää liike</button><p class="form-note">Ensimmäiseen sarjaan ehdotetaan liikkeen viimeisintä aloituspainoa. Uusi sarja kopioi nykyisen ensimmäisen sarjan painon. Yksikön vaihto muuntaa kaikki liikkeen sarjapainot. Ilman lisäpainoa merkitse 0. Kun paino ja toistot on täytetty, asetuksissa valittu sarjatauko alkaa automaattisesti.</p>
      <div id="form-error" class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button ghost" data-action="close">Peruuta</button><button type="button" class="button primary" data-action="save-workout">Tallenna treeni</button></div></div>`,options);
  }
  function saveWorkout() {
    const error=document.getElementById('form-error');
    const fail=msg=>{error.textContent=msg;return;};
    if (!validDate(workoutDraft.date)) return fail('Valitse kelvollinen päivämäärä.');
    if (!editingId && !isCategory(workoutDraft.category)) return fail('Valitse treenikategoria.');
    if (!workoutDraft.exercises.length) return fail('Lisää vähintään yksi liike.');
    const cleaned=[];
    for (const ex of workoutDraft.exercises) {
      const name=ex.name.trim().replace(/\s+/g,' ');
      if (!name) return fail('Anna jokaiselle liikkeelle nimi.');
      if (!ex.sets.length) return fail(`Lisää liikkeelle ${name} vähintään yksi sarja.`);
      const sets=[];
      for (const set of ex.sets) {
        const kg=draftWeightKg(set,exerciseUnit(ex)), reps=num(set.reps);
        if (set.weight==='' || !Number.isFinite(kg) || kg<0 || kg>2000 || set.reps==='' || !Number.isInteger(reps) || reps<1 || reps>1000) return fail(`Tarkista liikkeen ${name} sarjojen painot ja toistot.`);
        sets.push({weight:kg,reps});
      }
      cleaned.push({name,unit:exerciseUnit(ex),sets});
    }
    const entry={...state.workouts.find(row=>row.id===editingId),id:editingId||id(),date:workoutDraft.date,exercises:cleaned,
      savedAt:new Date(Math.max(Date.now(), ...state.workouts.map(row=>savedTime(row)+1))).toISOString()};
    if (isCategory(workoutDraft.category)) entry.category=workoutDraft.category;
    const workouts=editingId?state.workouts.map(row=>row.id===editingId?entry:row):[...state.workouts,entry];
    const nextState={...state,workouts};
    if (!persist(nextState)) return fail('Treeniä ei tallennettu. Tiedot ovat yhä tässä lomakkeessa.');
    state=nextState;
    // A quick save also finishes any newly completed row whose typing delay is still pending.
    for (const ex of workoutDraft.exercises) for (const set of ex.sets) if (!set._restStarted && validDraftSet(ex,set)) {set._restStarted=true;startRestTimer(ex.name,ex.sets.indexOf(set));}
    cancelPendingSetTimers();dialog.close(); workoutDraft=null; tab='workouts'; render(); toast('Treeni tallennettu');
  }
  function openSimple(type,row,review=null) {
    cancelPendingSetTimers();
    sleepReview=review;
    editingId=row?.id||null;
    const sleep=type==='sleep';
    showDialog(`<div class="dialog-inner">${dialogHead(sleep?(review?'Tarkista yöaika':row?'Muokkaa yöaikaa':'Kirjaa yöaika'):(row?'Muokkaa painoa':'Kirjaa paino'),sleep?'Merkitse aika ilman puhelinta tai muita virikkeitä.':'Merkitse päivän painomittaus.')}
      ${sleep&&!row?sleepTracker(true):''}
      ${sleep?`<p id="sleep-review-note" class="form-note">${review?'Tarkista talteen otetut kellonajat ja tallenna yö.':'Voit edelleen kirjata yöajan itse näihin kenttiin.'}</p>`:''}
      <form id="simple-form" data-type="${type}"><div class="field-row ${sleep?'three':''}"><div class="field"><label for="entry-date">${sleep?'Aamun päivämäärä':'Päivämäärä'}</label><input id="entry-date" name="date" type="date" value="${esc(row?.date||today())}" required></div>
      ${sleep?`<div class="field"><label for="entry-bed">Sänkyyn ilman puhelinta</label><input id="entry-bed" name="bed" type="time" value="${esc(row?.bed||'')}" required></div><div class="field"><label for="entry-wake">Nousin ylös</label><input id="entry-wake" name="wake" type="time" value="${esc(row?.wake||'')}" required></div>`:`<div class="field"><label for="entry-weight">Paino (kg)</label><input id="entry-weight" name="value" type="text" inputmode="decimal" value="${esc(row?.value??'')}" placeholder="Esim. 69,5" required></div>`}</div>
      ${sleep?'<p class="form-note">Yö kirjataan aamun päivälle. Kellonaikojen erotus lasketaan yön yli tarvittaessa.</p>':''}<div id="form-error" class="form-error" role="alert"></div><div class="dialog-actions"><button type="button" class="button ghost" data-action="close">Peruuta</button><button type="submit" class="button primary">Tallenna</button></div></form></div>`);
  }
  function saveSimple(form) {
    const type=form.dataset.type, data=new FormData(form), date=String(data.get('date')||'');
    const error=document.getElementById('form-error');
    if (!validDate(date)) { error.textContent='Valitse kelvollinen päivämäärä.'; return; }
    let entry;
    if (type==='sleep') {
      const bed=String(data.get('bed')||''),wake=String(data.get('wake')||'');
      if (sleepReview && (!state.sleepPending || state.sleepPending.id!==sleepReview.id || state.sleepPending.startedAt!==sleepReview.startedAt || state.sleepPending.endedAt!==sleepReview.endedAt)) {error.textContent='Aloitettu yö on muuttunut. Sulje lomake ja avaa nykyinen yö uudelleen.';return;}
      if (sleepReview && Date.parse(sleepReview.endedAt)-Date.parse(sleepReview.startedAt)>16*3600000 && date===sleepReview.initial.date && bed===sleepReview.initial.bed && wake===sleepReview.initial.wake) {error.textContent='Aloituksesta on yli 16 tuntia. Korjaa päivämäärä tai kellonajat ennen tallennusta.';return;}
      if (!validTime(bed)||!validTime(wake)) { error.textContent='Tarkista kellonajat.';return; }
      const duration=nightDuration(bed,wake);
      if (duration>16) { error.textContent='Yöaika voi olla enintään 16 tuntia. Tarkista kellonajat.';return; }
      entry={id:editingId||id(),date,bed,wake,duration};
    } else {
      const value=num(data.get('value'));
      if (!Number.isFinite(value)||value<1||value>1000) { error.textContent='Anna kelvollinen paino kilogrammoina.';return; }
      entry={id:editingId||id(),date,value};
    }
    if (type==='sleep' && state.sleep.some(row=>row.date===date && row.id!==editingId) && !confirm('Tälle päivälle on jo yömerkintä. Korvataanko se näillä kellonajoilla?')) return;
    const list=state[type].filter(row=>row.id!==editingId && row.date!==date);
    list.push(entry);
    const nextState={...state,[type]:list};
    if (type==='sleep' && sleepReview) delete nextState.sleepPending;
    if (!persist(nextState)) {error.textContent='Tallennus ei onnistunut. Kellonajat ovat yhä tässä lomakkeessa.';return;}
    state=nextState;sleepReview=null;dialog.close();tab=type;render();toast(type==='sleep'?'Yöaika tallennettu':'Paino tallennettu');
  }
  function validateBackup(raw) {
    const data=raw?.data;
    if (raw?.version!==1||!data||!Array.isArray(data.workouts)||!Array.isArray(data.sleep)||!Array.isArray(data.weight)) throw Error('Tiedosto ei ole Kuntokäyrän varmuuskopio.');
    if (data.workouts.length+data.sleep.length+data.weight.length>10000) throw Error('Varmuuskopio on liian suuri.');
    const output=emptyState();
    for (const row of data.workouts) {
      if (!validDate(row.date)||!Array.isArray(row.exercises)||!row.exercises.length||row.exercises.length>100) throw Error('Treenitiedoissa on virhe.');
      const exercises=row.exercises.map(ex=>{
        if(typeof ex.name!=='string'||!ex.name.trim()||!Array.isArray(ex.sets)||!ex.sets.length||ex.sets.length>100) throw Error('Liikkeen tiedoissa on virhe.');
        const sets=ex.sets.map(set=>{const kg=Number(set.weight), reps=Number(set.reps);if(!Number.isFinite(kg)||kg<0||kg>2000||!Number.isInteger(reps)||reps<1||reps>1000) throw Error('Sarjan tiedoissa on virhe.');return {weight:kg,reps};});
        const exercise={name:ex.name.trim().slice(0,80),sets};
        if (ex.unit!==undefined) {
          if (ex.unit!=='kg' && ex.unit!=='lbs') throw Error('Liikkeen painoyksikössä on virhe.');
          exercise.unit=ex.unit;
        }
        return exercise;
      });
      const entry={id:id(),date:row.date,exercises};
      if (row.category!==undefined) {
        if (!isCategory(row.category) && row.category!==null && row.category!=='') throw Error('Treenin kategoriassa on virhe.');
        entry.category=row.category;
      }
      if (row.savedAt!==undefined) {
        if (typeof row.savedAt!=='string' || !Number.isFinite(Date.parse(row.savedAt))) throw Error('Treenin tallennusajassa on virhe.');
        entry.savedAt=row.savedAt;
      }
      output.workouts.push(entry);
    }
    for (const row of data.sleep) {if(!validDate(row.date)||!validTime(row.bed)||!validTime(row.wake)||nightDuration(row.bed,row.wake)>16) throw Error('Yömerkinnöissä on virhe.');output.sleep.push({id:id(),date:row.date,bed:row.bed,wake:row.wake,duration:nightDuration(row.bed,row.wake)});}
    for (const row of data.weight) {const value=Number(row.value);if(!validDate(row.date)||!Number.isFinite(value)||value<1||value>1000) throw Error('Painomerkinnöissä on virhe.');output.weight.push({id:id(),date:row.date,value});}
    if (data.sleepPending!==undefined) {
      const pending=data.sleepPending;
      if (!pending || typeof pending.id!=='string' || !pending.id.trim() || pending.id.length>100 || !validTimestamp(pending.startedAt) || (pending.endedAt!==undefined && (!validTimestamp(pending.endedAt) || Date.parse(pending.endedAt)<Date.parse(pending.startedAt)))) throw Error('Aloitetun yön tiedoissa on virhe.');
      output.sleepPending={id:pending.id,startedAt:pending.startedAt};
      if (pending.endedAt!==undefined) output.sleepPending.endedAt=pending.endedAt;
    }
    if (data.settings!==undefined) {
      if (!data.settings || typeof data.settings!=='object' || Array.isArray(data.settings) || !validRestSeconds(data.settings.restSeconds)) throw Error('Sarjataukon asetuksessa on virhe.');
      output.settings={restSeconds:data.settings.restSeconds};
    }
    return output;
  }
  function exportBackup() {
    const payload={app:'Kuntokäyrä',version:1,exportedAt:new Date().toISOString(),data:state};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`kuntokayra-varmuuskopio-${today()}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Varmuuskopio ladattu');
  }

  document.addEventListener('click',event=>{
    const point=event.target.closest?.('[data-chart-point]');
    const chartSvg=event.target.closest?.('[data-chart-svg]');
    if(point || chartSvg) {
      const id=point?.dataset.chartPoint||chartSvg.dataset.chartSvg,entry=charts.get(id);
      if(!entry?.interactive)return;
      let index=point?Number(point.dataset.index):null;
      // Resolve overlapping touch targets to the closest visible point.
      if(entry && chartSvg && event.detail>0 && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const rect=chartSvg.getBoundingClientRect();
        if(rect.width && rect.height) {
          const matrix=chartSvg.getScreenCTM?.();
          let x,y;
          if(matrix && chartSvg.createSVGPoint) {
            const cursor=chartSvg.createSVGPoint();cursor.x=event.clientX;cursor.y=event.clientY;
            ({x,y}=cursor.matrixTransform(matrix.inverse()));
          } else {
            // Default SVG xMidYMid meet may add space around the drawing.
            const scale=Math.min(rect.width/entry.W,rect.height/entry.H);
            x=(event.clientX-rect.left-(rect.width-entry.W*scale)/2)/scale;
            y=(event.clientY-rect.top-(rect.height-entry.H*scale)/2)/scale;
          }
          let closest=Infinity;
          entry.coords.forEach(([px,py],i)=>{const distance=(px-x)**2+(py-y)**2;if(distance<closest){closest=distance;index=i;}});
        }
      }
      if(index!==null) selectChartPoint(id,index);
      return;
    }
    const button=event.target.closest('button'); if(!button) return;
    if(button.dataset.tab) { tab=button.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});return; }
    if(button.dataset.period) {period=button.dataset.period;render();return;}
    if(button.dataset.metric) {progressMetric=button.dataset.metric;render();return;}
    if(button.dataset.exerciseMetric) {exerciseMetric=button.dataset.exerciseMetric;render();return;}
    const action=button.dataset.action, rowId=button.dataset.id;
    if(!action) return;
    if(action==='expand-chart') return expandChart(button.dataset.chart);
    if(action==='sleep-start') return startSleep();
    if(action==='sleep-wake') return wakeSleep();
    if(action==='sleep-cancel') return cancelSleep();
    if(action==='rest-cancel') {restTimer=null;if(restInterval!==null)clearInterval(restInterval);restInterval=null;renderRestTimer();return;}
    if(action==='rest-restart') {if(restTimer)startRestTimer(restTimer.name,restTimer.setIndex);return;}
    if(action==='new-workout') return openWorkout();
    if(action==='new-sleep'||action==='new-weight') return openSimple(action.slice(4));
    if(action==='close') {cancelPendingSetTimers();return dialog.close();}
    if(action==='save-workout') return saveWorkout();
    if(action==='choose-exercise') return chooseExercise(button.dataset.name);
    if(action==='add-exercise') {const index=workoutDraft.exercises.length;workoutDraft.exercises.push({name:'',sets:[{weight:'',reps:''}]});return renderWorkoutEditor({preserveScroll:true,focus:`#exercise-${index}`,reveal:true});}
    if(action==='remove-exercise') {workoutDraft.exercises.splice(Number(button.dataset.ex),1);return renderWorkoutEditor();}
    if(action==='add-set') {
      const index=Number(button.dataset.ex), ex=workoutDraft.exercises[index];
      const first=ex.sets[0], set={weight:first?.weight??'',reps:''};
      if (first && set.weight!=='' && Number.isFinite(num(set.weight))) displayDraftWeight(set,draftWeightKg(first,exerciseUnit(ex)),exerciseUnit(ex));
      ex.sets.push(set);
      return renderWorkoutEditor({preserveScroll:true,focus:`[data-draft="weight"][data-ex="${index}"][data-set="${ex.sets.length-1}"]`});
    }
    if(action==='remove-set') {workoutDraft.exercises[Number(button.dataset.ex)].sets.splice(Number(button.dataset.set),1);return renderWorkoutEditor();}
    if(action==='view-exercise') {selectedExercise=button.dataset.name;exerciseMetric=exerciseSeries(selectedExercise,'max').every(point=>point.value===0)?'reps':'max';progressMetric='exercise';tab='progress';render();window.scrollTo({top:0,behavior:'smooth'});return;}
    if(action.startsWith('edit-')) {const type=action.slice(5)==='workout'?'workouts':action.slice(5);const row=state[type]?.find(item=>item.id===rowId);if(row) type==='workouts'?openWorkout(row):openSimple(type,row);return;}
    if(action.startsWith('delete-')) {const type=action.slice(7)==='workout'?'workouts':action.slice(7);if(!state[type]?.some(item=>item.id===rowId)) return;if(confirm('Poistetaanko tämä merkintä?')) {const nextState={...state,[type]:state[type].filter(item=>item.id!==rowId)};if(!persist(nextState))return;state=nextState;render();toast('Merkintä poistettu');}return;}
    if(action==='export') return exportBackup();
    if(action==='import') return document.getElementById('import-file').click();
    if(action==='clear') {if(confirm('Poistetaanko kaikki treenit, yömerkinnät, aloitettu yö ja painot tältä laitteelta? Toimintoa ei voi perua ilman varmuuskopiota.')) {const nextState=emptyState();if(state.settings)nextState.settings=state.settings;if(!persist(nextState))return;state=nextState;render();toast('Kaikki merkinnät poistettu');}return;}
    if(action==='install'&&deferredInstall) {deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;render();});}
  });
  document.addEventListener('keydown',event=>{
    const point=event.target.closest?.('[data-chart-point]');if(!point)return;
    const id=point.dataset.chartPoint,entry=charts.get(id);if(!entry?.interactive)return;
    let index=Number(point.dataset.index);
    if(event.key==='ArrowLeft' || event.key==='ArrowRight') {
      index=Math.max(0,Math.min(entry.data.length-1,index+(event.key==='ArrowLeft'?-1:1)));
      document.getElementById(`${id}-point-${index}`)?.focus({preventScroll:true});
    } else if(!['Enter',' ','Spacebar'].includes(event.key)) return;
    event.preventDefault();selectChartPoint(id,index);
  });
  document.addEventListener('input',event=>{
    const el=event.target, field=el.dataset.draft;
    if(!field||!workoutDraft) return;
    if(field==='date') workoutDraft.date=el.value;
    else if(field==='category' || field==='unit') return; // Selects are handled on change.
    else if(field==='name') updateExerciseName(Number(el.dataset.ex),el.value);
    else {
      const ex=workoutDraft.exercises[Number(el.dataset.ex)], set=ex.sets[Number(el.dataset.set)];
      set[field]=el.value;
      if (field==='weight') set._weightEdited=true;
      scheduleSetTimer(ex,set);
    }
  });
  document.addEventListener('submit',event=>{
    if(event.target.id==='simple-form') {event.preventDefault();saveSimple(event.target);}
    if(event.target.id==='rest-settings-form') {event.preventDefault();saveRestSettings(event.target);}
  });
  document.addEventListener('change',event=>{
    if(event.target.id==='exercise-select') {selectedExercise=event.target.value;render();}
    if(event.target.dataset.draft==='unit' && workoutDraft) {
      const index=Number(event.target.dataset.ex);
      changeExerciseUnit(index,event.target.value);
      workoutDraft.exercises[index]._unitEdited=true;
    }
    if(event.target.id==='workout-category' && workoutDraft && isCategory(event.target.value)) {
      workoutDraft.category=event.target.value;
      renderWorkoutEditor();
    }
  });
  document.getElementById('import-file').addEventListener('change',async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try {
      if(file.size>5_000_000) throw Error('Tiedosto on liian suuri.');
      const imported=validateBackup(JSON.parse(await file.text()));
      if(confirm('Korvataanko tämän selaimen nykyiset merkinnät varmuuskopion tiedoilla?') && persist(imported)) {state=imported;tab='home';render();toast('Varmuuskopio tuotu');}
    } catch(err) {alert(`Tuonti epäonnistui: ${err.message}`);}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog) {cancelPendingSetTimers();dialog.close();}});
  dialog.addEventListener('close',()=>{cancelPendingSetTimers();unlockPageScroll();dialog.classList.remove('chart-modal');if(expandedChartId)charts.delete(expandedChartId);expandedChartId=null;watchCharts();});
  for (const name of ['gesturestart','gesturechange']) document.addEventListener(name,event=>event.preventDefault(),{passive:false});
  document.addEventListener('touchstart',event=>{if (event.touches?.length>1) event.preventDefault();},{passive:false});
  document.addEventListener('touchmove',event=>{if (event.touches?.length>1 || (dialog.open && !event.target.closest?.('.dialog-inner'))) event.preventDefault();},{passive:false});
  document.addEventListener('wheel',event=>{if (dialog.open && !event.target.closest?.('.dialog-inner')) event.preventDefault();},{passive:false});
  document.addEventListener('visibilitychange',renderRestTimer);
  window.addEventListener('pageshow',renderRestTimer);
  window.addEventListener('resize',sizeCharts);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;if(tab==='settings')render();});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  render();
})();
