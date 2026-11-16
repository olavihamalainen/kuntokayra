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
  function durationText(hours) { const minutes = Math.round(hours * 60); return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2,'0')} min`; }
  function nightDuration(bed, wake) { const [bh,bm] = bed.split(':').map(Number), [wh,wm] = wake.split(':').map(Number); let minutes = wh*60+wm-(bh*60+bm); if (minutes <= 0) minutes += 1440; return minutes / 60; }
  function validTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
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
  function renderRestTimer() {
    const active=Boolean(restTimer);
    document.body.classList.toggle('has-rest-timer',active);
    dialog.classList.toggle('has-rest-timer',active);
    let html='';
    if (restTimer) {
      const seconds=Math.max(0,Math.ceil((restTimer.endsAt-Date.now())/1000));
      if (!seconds && restInterval!==null) {clearInterval(restInterval);restInterval=null;}
      const time=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
      html=`<aside class="rest-timer ${seconds?'':'finished'}" aria-label="Sarjatauko"><span class="rest-timer-label" ${seconds?'':'role="status"'}>${seconds?'Sarjatauko':'Tauko päättyi'}</span><strong class="rest-timer-countdown" role="timer" aria-live="off" data-rest-countdown>${time}</strong><small class="rest-timer-context">${esc(restTimer.name)} · sarja ${restTimer.setIndex+1}</small><div class="rest-timer-actions"><button type="button" data-action="rest-restart" aria-label="Aloita uusi kolmen minuutin tauko">Uudelleen</button><button type="button" data-action="rest-cancel" aria-label="Sulje sarjataukoajastin">Sulje</button></div></aside>`;
    }
    for (const hostId of ['rest-timer-host','dialog-rest-timer-host']) {
      const host=document.getElementById(hostId);
      if (host && host.innerHTML!==html) host.innerHTML=html;
    }
  }
  function startRestTimer(name, setIndex) {
    if (restInterval!==null) clearInterval(restInterval);
    restTimer={name,setIndex,endsAt:Date.now()+180000};
    restInterval=setInterval(renderRestTimer,250);
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
    return state.workouts.map((row, index) => ({row, index})).sort((a,b) =>
      b.row.date.localeCompare(a.row.date) || savedTime(b.row) - savedTime(a.row) || b.index - a.index
    ).map(item => item.row);
  }
  function suggestedExercises(category) {
    const names = new Map();
    for (const workout of recentWorkouts()) {
      if (!isCategory(category) || workout.category !== category) continue;
      for (const ex of workout.exercises) {
        const key = normalizeName(ex.name);
        if (!names.has(key)) names.set(key, ex.name);
      }
    }
    return [...names.values()];
  }
  function previousFirstWeight(name) {
    return previousExercise(name)?.exercise.sets[0]?.weight ?? '';
  }
  function preferredExerciseUnit(name) {
    const key=normalizeName(name);
    const workouts=state.workouts.map((row,index)=>({row,index})).sort((a,b)=>savedTime(b.row)-savedTime(a.row)||b.index-a.index);
    for (const {row} of workouts) {
      const ex=row.exercises.find(item=>normalizeName(item.name)===key);
      if (ex) return exerciseUnit(ex);
    }
    return 'kg';
  }
  function previousExercise(name) {
    const key = normalizeName(name);
    if (!key) return null;
    for (const workout of recentWorkouts()) {
      if (workout.id===editingId) continue;
      const ex = workout.exercises.find(item => normalizeName(item.name) === key);
      if (ex) return {workout,exercise:ex};
    }
    return null;
  }
  function previousRepsText(name, index) {
    const previous=previousExercise(name), set=previous?.exercise.sets[index];
    return set ? `Viimeksi ${shortDate(previous.workout.date)}: ${set.reps} toistoa` : 'Ei aiempaa vastaavaa sarjaa';
  }
  function updatePreviousReps(index) {
    const ex=workoutDraft.exercises[index];
    ex.sets.forEach((set,si)=>{
      const hint=document.getElementById(`previous-reps-${index}-${si}`);
      if (hint) hint.textContent=`Sarja ${si+1} · ${previousRepsText(ex.name,si)}`;
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
    if (metric === 'sleep') return sorted(state.sleep).reverse().map(row => ({date:row.date, value:Number(row.duration)}));
    return exerciseSeries(selectedExercise, exerciseMetric);
  }
  function inPeriod(points, selected = period) {
    if (selected === 'all') return points;
    const cutoff = dateObj(today()); cutoff.setDate(cutoff.getDate() - Number(selected) + 1);
    return points.filter(point => dateObj(point.date) >= cutoff);
  }
  function periodButtons() { return `<div class="segmented" role="group" aria-label="Aikaväli">${PERIODS.map(([key,label]) => `<button type="button" data-period="${key}" class="${period===key?'active':''}" aria-pressed="${period===key}">${label}</button>`).join('')}</div>`; }
  function formatValue(v, metric, unit = 'kg') { return metric === 'sleep' ? durationText(v) : metric === 'volume' ? `${fmt.format(v)} ${unit}·toistoa` : metric === 'reps' ? `${fmt.format(v)} toistoa` : weightText(v,unit); }
  function chart(points, metric, color = '#438867', compact = false, selectedPeriod = period, unit = 'kg') {
    const data = inPeriod(points, selectedPeriod);
    if (!data.length) return `<div class="chart-empty"><div><strong>Ei merkintöjä tällä aikavälillä</strong>Lisää ensimmäinen kirjaus tai valitse pidempi aikaväli.</div></div>`;
    const W=720, H=compact?216:300, L=47, R=15, T=20, B=35, plotW=W-L-R, plotH=H-T-B;
    let lo=Math.min(...data.map(p=>p.value)), hi=Math.max(...data.map(p=>p.value));
    const padding = Math.max((hi-lo)*.18, metric==='sleep'?.3:metric==='volume'?5:.5);
    lo=Math.max(0,lo-padding); hi+=padding;
    if (hi<=lo) hi=lo+1;
    const start=dateObj(data[0].date).getTime(), end=dateObj(data[data.length-1].date).getTime();
    const x=p=>start===end?L+plotW/2:L+(dateObj(p.date).getTime()-start)/(end-start)*plotW;
    const y=p=>T+(hi-p.value)/(hi-lo)*plotH;
    const coords=data.map(p=>[x(p),y(p)]);
    const line=coords.map(([px,py],i)=>`${i?'L':'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
    const area=`${line} L${coords[coords.length-1][0].toFixed(1)} ${T+plotH} L${coords[0][0].toFixed(1)} ${T+plotH} Z`;
    const gradient=`chart-gradient-${++chartSeq}`;
    const ticks=[0,1,2,3].map(i=>{const yy=T+i*plotH/3, value=hi-i*(hi-lo)/3;return `<line x1="${L}" y1="${yy}" x2="${W-R}" y2="${yy}" stroke="#e8eee6" stroke-dasharray="${i===3?'0':'4 5'}"/><text x="${L-10}" y="${yy+4}" text-anchor="end" fill="#84958a" font-size="11">${esc(fmt.format(value))}</text>`;}).join('');
    const dots=data.map((p,i)=>`<circle cx="${coords[i][0]}" cy="${coords[i][1]}" r="${i===data.length-1?5:3.5}" fill="${color}" stroke="#fff" stroke-width="2" tabindex="0"><title>${esc(fullDate(p.date))}: ${esc(formatValue(p.value,metric,unit))}</title></circle>`).join('');
    const aria=`Kehityskäyrä, ${countText(data.length,'merkintä','merkintää')}. Ensimmäinen ${fullDate(data[0].date)} ${formatValue(data[0].value,metric,unit)}, viimeisin ${fullDate(data[data.length-1].date)} ${formatValue(data[data.length-1].value,metric,unit)}.`;
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}"><defs><linearGradient id="${gradient}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".18"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${ticks}<path d="${area}" fill="url(#${gradient})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}<text x="${L}" y="${H-5}" fill="#8b9b90" font-size="11">${esc(shortDate(data[0].date))}</text><text x="${W-R}" y="${H-5}" text-anchor="end" fill="#8b9b90" font-size="11">${esc(shortDate(data[data.length-1].date))}</text></svg>`;
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
    <div class="hint-box">Kirjaa aika siitä, kun jätit puhelimen pois ja asetuit sänkyyn, siihen kun nousit. Tämä on oma arviosi rauhallisesta yöajasta, ei unen automaattinen mittaus.</div>
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
    if (data.length<2) return '—';
    const delta=data.at(-1).value-data[0].value;
    if (metric==='sleep') { const m=Math.round(Math.abs(delta)*60); return `${delta>=0?'+':'−'}${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')} min`; }
    return `${delta>=0?'+':'−'}${fmt.format(Math.abs(delta))} ${metric==='volume'?`${unit}·toistoa`:metric==='reps'?'toistoa':unit}`;
  }
  function trendPanel(points, metric, title, subtitle, color, data=inPeriod(points)) {
    return `<div class="filter-row"><span class="filter-label">NÄYTÄ AIKAVÄLI</span>${periodButtons()}</div><section class="panel chart-large"><div class="panel-head"><div><p class="panel-kicker">${subtitle.toUpperCase()}</p><h2 class="panel-title">${title}</h2></div><span class="small-muted">${countText(data.length,'merkintä','merkintää')}</span></div><div class="chart-wrap">${chart(points,metric,color)}</div><div class="detail-stats"><div class="detail-stat"><span>Ensimmäinen</span><strong>${data.length?esc(formatValue(data[0].value,metric)):'—'}</strong></div><div class="detail-stat"><span>Viimeisin</span><strong>${data.length?esc(formatValue(data.at(-1).value,metric)):'—'}</strong></div><div class="detail-stat"><span>Muutos</span><strong>${esc(changeText(data,metric))}</strong></div></div></section>`;
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
  function trendPanelWithoutFilter(points,metric,title,subtitle,color,unit='kg') { return `<section class="panel chart-large"><div class="panel-head"><div><p class="panel-kicker">${esc(subtitle.toUpperCase())}</p><h2 class="panel-title">${esc(title)}</h2></div><span class="small-muted">${countText(inPeriod(points).length,'merkintä','merkintää')}</span></div><div class="chart-wrap">${chart(points,metric,color,false,period,unit)}</div><div class="detail-stats">${[['Ensimmäinen',inPeriod(points)[0]],['Viimeisin',inPeriod(points).at(-1)]].map(([label,p])=>`<div class="detail-stat"><span>${label}</span><strong>${p?esc(formatValue(p.value,metric,unit)):'—'}</strong></div>`).join('')}<div class="detail-stat"><span>Muutos</span><strong>${esc(changeText(inPeriod(points),metric,unit))}</strong></div></div></section>`; }
  function renderSettings() {
    return `${header('Asetukset','OMAT TIEDOT','Pidä kirjausdata omassa hallinnassasi.')}
    <div class="settings-stack"><section class="panel"><h2>Lisää puhelimen aloitusnäyttöön</h2><p>Avaa tämä sivu puhelimellasi. Asennettuna se näyttää ja toimii sovelluksen tavoin.</p><ol class="install-steps"><li>iPhone: avaa Safari, napauta Jaa-painiketta ja valitse <strong>Lisää Koti-valikkoon</strong>.</li><li>Android: avaa Chrome-valikko ja valitse <strong>Asenna sovellus</strong> tai <strong>Lisää aloitusnäyttöön</strong>.</li></ol>${deferredInstall?'<div class="settings-actions" style="margin-top:17px"><button type="button" class="button primary" data-action="install">Asenna sovellus</button></div>':''}</section>
    <section class="panel"><h2>Varmuuskopio</h2><p>Merkinnät tallentuvat tämän laitteen selaimeen. Ne eivät synkronoidu automaattisesti toiseen puhelimeen tai tietokoneeseen. Vie JSON-varmuuskopio talteen ja tuo se tarvittaessa takaisin.</p><div class="settings-actions"><button type="button" class="button secondary" data-action="export">${svg('download')} Vie tiedot</button><button type="button" class="button ghost" data-action="import">${svg('upload')} Tuo varmuuskopio</button></div></section>
    <section class="panel"><h2>Poista kaikki merkinnät</h2><p>Tämä poistaa tämän selaimen treenit, yömerkinnät ja painot. Vie varmuuskopio ensin, jos haluat säilyttää ne.</p><button type="button" class="button danger" data-action="clear">Poista tiedot</button></section></div>`;
  }
  function render() {
    document.getElementById('header-date').textContent=new Intl.DateTimeFormat('fi-FI',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
    for (const [target,mobile] of [['desktop-nav',false],['mobile-nav',true]]) document.getElementById(target).innerHTML=nav.map(([key,label])=>`<button type="button" class="nav-item ${tab===key?'active':''}" data-tab="${key}" ${tab===key?'aria-current="page"':''}>${svg(key)}<span>${mobile&&key==='home'?'Koti':label}</span></button>`).join('');
    document.querySelector('.settings-button').classList.toggle('active',tab==='settings');
    main.innerHTML=({home:renderHome,workouts:renderWorkouts,sleep:renderSleep,weight:renderWeight,progress:renderProgress,settings:renderSettings})[tab]();
  }

  function showDialog(html, {preserveScroll=false, focus=null} = {}) {
    const wasOpen=dialog.open, scrollTop=dialogContent.querySelector('.dialog-inner')?.scrollTop || 0, outerScroll=dialog.scrollTop;
    dialogContent.innerHTML=html;
    if (!dialog.open) dialog.showModal();
    if (preserveScroll && wasOpen) {
      const inner=dialogContent.querySelector('.dialog-inner');
      if (inner) inner.scrollTop=scrollTop;
      dialog.scrollTop=outerScroll;
    }
    const target=focus?(Array.isArray(focus)?focus.map(selector=>dialogContent.querySelector(selector)).find(Boolean):dialogContent.querySelector(focus)):!preserveScroll?dialog.querySelector('input,button'):null;
    target?.focus({preventScroll:preserveScroll && wasOpen});
    renderRestTimer();
  }
  function dialogHead(title,sub) { return `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${sub}</p></div><button type="button" class="dialog-close" data-action="close" aria-label="Sulje">×</button></div>`; }
  function openWorkout(row) {
    cancelPendingSetTimers();
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
    if (!ex._unitEdited && !ex.sets.some(set=>set._weightEdited)) changeExerciseUnit(index,preferredExerciseUnit(name));
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
    if (existing>=0) { document.getElementById(`exercise-${existing}`)?.focus(); return; }
    let index=workoutDraft.exercises.findIndex(ex=>!ex.name.trim());
    if (index<0) { index=workoutDraft.exercises.length; workoutDraft.exercises.push({name:'',sets:[{weight:'',reps:''}]}); }
    updateExerciseName(index,name);
    renderWorkoutEditor();
    dialogContent.querySelector(`[data-draft="weight"][data-ex="${index}"][data-set="0"]`)?.focus();
  }
  function renderWorkoutEditor(options = {preserveScroll:true}) {
    const names=suggestedExercises(workoutDraft.category);
    showDialog(`<div id="dialog-rest-timer-host"></div><div class="dialog-inner">${dialogHead(editingId?'Muokkaa treeniä':'Kirjaa treeni','Lisää liikkeet sekä jokaisen sarjan paino ja toistot.')}
      <div class="field-row"><div class="field"><label for="workout-date">Treenipäivä</label><input id="workout-date" data-draft="date" type="date" value="${esc(workoutDraft.date)}" required></div>
      <div class="field"><label for="workout-category">Treenikategoria</label><select id="workout-category" data-draft="category">${!isCategory(workoutDraft.category)?'<option value="">Ei kategoriaa (vanha merkintä)</option>':''}${CATEGORIES.map(category=>`<option value="${category}" ${workoutDraft.category===category?'selected':''}>${category}</option>`).join('')}</select></div></div>
      <section class="exercise-suggestions" aria-label="Kategorian aiemmat liikkeet"><p class="field-label">${isCategory(workoutDraft.category)?`${esc(workoutDraft.category)}: aiemmat liikkeet`:'Valitse kategoria nähdäksesi aiemmat liikkeet'}</p>${names.length?`<div class="suggestion-list">${names.map(name=>`<button type="button" class="suggestion-button" data-action="choose-exercise" data-name="${esc(name)}">${esc(name)}</button>`).join('')}</div><p class="form-note">Viimeisimmän treenin järjestyksessä. Valitse liike tai kirjoita oma nimi.</p>`:isCategory(workoutDraft.category)?'<p class="form-note">Tässä kategoriassa ei ole vielä liikkeitä. Kirjoita liikkeen nimi alle.</p>':''}</section>
      <datalist id="exercise-suggestions">${names.map(name=>`<option value="${esc(name)}"></option>`).join('')}</datalist>
      ${workoutDraft.exercises.map((ex,ei)=>`<div class="form-section"><div class="form-section-head"><strong>Liike ${ei+1}</strong><button class="mini-remove" type="button" data-action="remove-exercise" data-ex="${ei}">Poista liike</button></div>
      <div class="field" style="margin-bottom:15px"><label for="exercise-${ei}">Liikkeen nimi</label><input id="exercise-${ei}" data-draft="name" data-ex="${ei}" list="exercise-suggestions" type="text" maxlength="80" placeholder="Esim. penkkipunnerrus" value="${esc(ex.name)}" autocomplete="off"></div>
      <div class="field exercise-unit"><label for="exercise-unit-${ei}">Painoyksikkö</label><select id="exercise-unit-${ei}" data-draft="unit" data-ex="${ei}"><option value="kg" ${exerciseUnit(ex)==='kg'?'selected':''}>kg – kilogrammat</option><option value="lbs" ${exerciseUnit(ex)==='lbs'?'selected':''}>lbs – paunat</option></select></div>
      <div class="set-head"><span id="weight-label-${ei}">Paino (${exerciseUnit(ex)})</span><span>Toistot</span><span></span></div>${ex.sets.map((set,si)=>`<div class="set-row"><input data-draft="weight" data-ex="${ei}" data-set="${si}" type="text" inputmode="decimal" value="${esc(set.weight)}" aria-label="Liike ${ei+1}, sarja ${si+1}, paino ${exerciseUnit(ex)}" placeholder="0"><input data-draft="reps" data-ex="${ei}" data-set="${si}" type="number" inputmode="numeric" min="1" max="1000" step="1" value="${esc(set.reps)}" aria-label="Liike ${ei+1}, sarja ${si+1}, toistot" aria-describedby="previous-reps-${ei}-${si}" placeholder="8"><button class="set-remove" type="button" data-action="remove-set" data-ex="${ei}" data-set="${si}" aria-label="Poista sarja ${si+1}">×</button><span id="previous-reps-${ei}-${si}" class="previous-set">Sarja ${si+1} · ${esc(previousRepsText(ex.name,si))}</span></div>`).join('')}
      <button type="button" class="inline-add" data-action="add-set" data-ex="${ei}">+ Lisää sarja</button></div>`).join('')}
      <button type="button" class="button secondary" data-action="add-exercise">${svg('plus')} Lisää liike</button><p class="form-note">Ensimmäiseen sarjaan ehdotetaan liikkeen viimeisintä aloituspainoa. Uusi sarja kopioi nykyisen ensimmäisen sarjan painon. Yksikön vaihto muuntaa kaikki liikkeen sarjapainot. Ilman lisäpainoa merkitse 0. Kun paino ja toistot on täytetty, 3 minuutin sarjatauko alkaa automaattisesti.</p>
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
  function openSimple(type,row) {
    cancelPendingSetTimers();
    editingId=row?.id||null;
    const sleep=type==='sleep';
    showDialog(`<div class="dialog-inner">${dialogHead(sleep?(row?'Muokkaa yöaikaa':'Kirjaa yöaika'):(row?'Muokkaa painoa':'Kirjaa paino'),sleep?'Merkitse aika ilman puhelinta tai muita virikkeitä.':'Merkitse päivän painomittaus.')}
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
      if (!validTime(bed)||!validTime(wake)) { error.textContent='Tarkista kellonajat.';return; }
      const duration=nightDuration(bed,wake);
      if (duration>16) { error.textContent='Yöaika voi olla enintään 16 tuntia. Tarkista kellonajat.';return; }
      entry={id:editingId||id(),date,bed,wake,duration};
    } else {
      const value=num(data.get('value'));
      if (!Number.isFinite(value)||value<1||value>1000) { error.textContent='Anna kelvollinen paino kilogrammoina.';return; }
      entry={id:editingId||id(),date,value};
    }
    const list=state[type].filter(row=>row.id!==editingId && row.date!==date);
    list.push(entry); state[type]=list;
    persist();dialog.close();tab=type;render();toast(type==='sleep'?'Yöaika tallennettu':'Paino tallennettu');
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
    return output;
  }
  function exportBackup() {
    const payload={app:'Kuntokäyrä',version:1,exportedAt:new Date().toISOString(),data:state};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download=`kuntokayra-varmuuskopio-${today()}.json`;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Varmuuskopio ladattu');
  }

  document.addEventListener('click',event=>{
    const button=event.target.closest('button'); if(!button) return;
    if(button.dataset.tab) { tab=button.dataset.tab;render();window.scrollTo({top:0,behavior:'smooth'});return; }
    if(button.dataset.period) {period=button.dataset.period;render();return;}
    if(button.dataset.metric) {progressMetric=button.dataset.metric;render();return;}
    if(button.dataset.exerciseMetric) {exerciseMetric=button.dataset.exerciseMetric;render();return;}
    const action=button.dataset.action, rowId=button.dataset.id;
    if(!action) return;
    if(action==='rest-cancel') {restTimer=null;if(restInterval!==null)clearInterval(restInterval);restInterval=null;renderRestTimer();return;}
    if(action==='rest-restart') {if(restTimer)startRestTimer(restTimer.name,restTimer.setIndex);return;}
    if(action==='new-workout') return openWorkout();
    if(action==='new-sleep'||action==='new-weight') return openSimple(action.slice(4));
    if(action==='close') {cancelPendingSetTimers();return dialog.close();}
    if(action==='save-workout') return saveWorkout();
    if(action==='choose-exercise') return chooseExercise(button.dataset.name);
    if(action==='add-exercise') {workoutDraft.exercises.push({name:'',sets:[{weight:'',reps:''}]});return renderWorkoutEditor({preserveScroll:false,focus:['.suggestion-button','#workout-date']});}
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
    if(action.startsWith('delete-')) {const type=action.slice(7)==='workout'?'workouts':action.slice(7);if(!state[type]?.some(item=>item.id===rowId)) return;if(confirm('Poistetaanko tämä merkintä?')) {state[type]=state[type].filter(item=>item.id!==rowId);persist();render();toast('Merkintä poistettu');}return;}
    if(action==='export') return exportBackup();
    if(action==='import') return document.getElementById('import-file').click();
    if(action==='clear') {if(confirm('Poistetaanko kaikki treenit, yömerkinnät ja painot tältä laitteelta? Toimintoa ei voi perua ilman varmuuskopiota.')) {state=emptyState();persist();render();toast('Kaikki merkinnät poistettu');}return;}
    if(action==='install'&&deferredInstall) {deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;render();});}
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
  document.addEventListener('submit',event=>{if(event.target.id==='simple-form') {event.preventDefault();saveSimple(event.target);}});
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
      document.getElementById('workout-category')?.focus();
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
  dialog.addEventListener('close',cancelPendingSetTimers);
  document.addEventListener('visibilitychange',renderRestTimer);
  window.addEventListener('pageshow',renderRestTimer);
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;if(tab==='settings')render();});
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  render();
})();
