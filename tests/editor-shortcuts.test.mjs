import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, plain } from './helpers/browser-harness.mjs';
import { history } from './helpers/fixtures.mjs';

const key='kuntokayra_v1';
const data=()=>({...plain(history),
  weight:[{id:'old-weight',date:'2026-08-01',value:80},{id:'recent-weight',date:'2026-11-14',value:75.4},{id:'last-weight',date:'2026-11-16',value:75.3}],
  sleep:[{id:'old-sleep',date:'2026-08-01',bed:'22:00',wake:'06:00',duration:8},{id:'recent-sleep',date:'2026-11-14',bed:'23:00',wake:'06:00',duration:7},{id:'last-sleep',date:'2026-11-16',bed:'22:00',wake:'06:00',duration:8}],
});
const card=(app,kind)=>app.document.getElementById('main').querySelector(`[data-kind="${kind}"]`);
async function pending(app){
  await app.click('new-workout');await app.input('name','Kesken oleva treeni');await app.input('weight','30');await app.clock.tick(500);
}
async function openChart(app,kind='weight'){
  await app.click('view-summary-chart',{kind});
  const svg=app.document.getElementById('main').querySelector('[data-chart-svg]');
  await app.click('expand-chart',{chart:svg.dataset.chartSvg});
  return app.api.getCharts().get(app.document.getElementById('dialog-content').querySelector('[data-chart-svg]').dataset.chartSvg);
}
const closeButton=app=>app.document.getElementById('dialog-content').querySelector('.chart-dialog-head').querySelector('.dialog-close');

await test('The workout footer has continue, save and delete side by side, with deletion requiring two distinct confirmations',async()=>{
  const app=boot(history);await pending(app);
  const buttons=app.document.querySelector('.workout-actions').querySelectorAll('button');
  assert.deepEqual(buttons.map(button=>button.textContent),['Jatka myöhemmin','Tallenna treeni','Poista treeni']);
  assert.equal(app.document.querySelectorAll('[data-action="delete-current-workout"]').length,1);
  app.setConfirmations([true,true]);await app.click('delete-current-workout');
  assert.equal(app.confirmations.length,2);assert.notEqual(app.confirmations[0],app.confirmations[1]);
  assert.ok(!app.state().workoutPending);
});

await test('Cancelling the first delete confirmation leaves the workout, draft and editor untouched',async()=>{
  const app=boot(history);await pending(app);const saved=app.state(),stored=app.storage.get(key),draft=app.draft();
  app.setConfirmations([false]);await app.click('delete-current-workout');
  assert.equal(app.confirmations.length,1);assert.deepEqual(app.state(),saved);assert.deepEqual(app.draft(),draft);
  assert.equal(app.storage.get(key),stored);assert.equal(app.document.getElementById('entry-dialog').open,true);
});

await test('Cancelling the second delete confirmation writes nothing and keeps the current form retryable',async()=>{
  const app=boot(history);await pending(app);const saved=app.state(),stored=app.storage.get(key),writes=app.writes.length;
  app.setConfirmations([true,false]);await app.click('delete-current-workout');
  assert.equal(app.confirmations.length,2);assert.deepEqual(app.state(),saved);assert.equal(app.storage.get(key),stored);
  assert.equal(app.writes.length,writes);assert.equal(app.document.getElementById('entry-dialog').open,true);
});

await test('Deleting an unfinished workout cancels queued autosave and timer callbacks without changing completed data',async()=>{
  const app=boot(history);await app.click('new-workout');await app.input('name','Poistettava');await app.input('weight','30');await app.input('reps','8');
  app.setConfirmations([true,true]);await app.click('delete-current-workout');await app.clock.tick(2000);
  assert.deepEqual(app.state(),history);assert.equal(app.draft(),null);assert.equal(app.countdown(),null);
  assert.equal(app.document.getElementById('entry-dialog').open,false);
});

await test('Deleting an existing workout removes only that record and retains an unrelated unfinished workout and other measurements',async()=>{
  const app=boot(history);await pending(app);await app.click('close');const draft=plain(app.state().workoutPending);
  await app.click('edit-workout',{id:'f1'});app.setConfirmations([true,true]);await app.click('delete-current-workout');
  assert.equal(app.state().workouts.length,history.workouts.length-1);assert.ok(!app.state().workouts.some(row=>row.id==='f1'));
  assert.deepEqual(app.state().workouts,history.workouts.filter(row=>row.id!=='f1'));
  assert.deepEqual(app.state().workoutPending,draft);assert.deepEqual(app.state().sleep,history.sleep);assert.deepEqual(app.state().weight,history.weight);
  const reopened=boot(null,app.storage);assert.equal(reopened.writes.length,0);assert.ok(!reopened.state().workouts.some(row=>row.id==='f1'));
});

await test('Failed deletion is atomic for both a new draft and a saved workout and never closes the editor',async()=>{
  for(const editing of [false,true]){
    const app=boot(history);await pending(app);
    if(editing){await app.click('close');await app.click('edit-workout',{id:'f1'});}
    const saved=app.state(),stored=app.storage.get(key),draft=app.draft();
    app.setStorageFailure(true);app.setConfirmations([true,true]);await app.click('delete-current-workout');
    assert.deepEqual(app.state(),saved);assert.equal(app.storage.get(key),stored);assert.deepEqual(app.draft(),draft);
    assert.equal(app.document.getElementById('entry-dialog').open,true);
  }
});

for(const kind of ['weight','sleep'])await test(`The latest ${kind} home card opens that metric for exactly 30 days and leaves journal data unchanged`,async()=>{
  const initial=data(),app=boot(initial);await app.click(undefined,{period:'all'});
  const selected=card(app,kind);assert.equal(selected.tagName,'button');
  assert.equal(app.document.querySelector('.summary-grid').querySelectorAll('.metric-card').length,3);
  await app.emit('click',selected.querySelector('svg'));
  const svg=app.document.getElementById('main').querySelector('[data-chart-svg]'),entry=app.api.getCharts().get(svg.dataset.chartSvg);
  assert.equal(entry.metric,kind);assert.equal(entry.period,'30');assert.equal(entry.interactive,true);
  assert.equal(entry.data.length,2);assert.ok(entry.data.every(point=>point.date>='2026-10-18'));
  assert.equal(app.document.getElementById('entry-dialog').open,false);
  assert.deepEqual(app.state(),initial);assert.equal(app.writes.length,0);
});

await test('Home chart shortcuts also work with no measurements and display the empty 30-day view',async()=>{
  for(const kind of ['weight','sleep']){const app=boot();await app.emit('click',card(app,kind));assert.ok(app.mainHTML().includes('Ei merkintöjä tällä aikavälillä'));assert.equal(app.writes.length,0);}
});

await test('Portrait-landscape-portrait chart reflow keeps the same close button outside scrolling SVG content and closes normally',async()=>{
  const initial=data(),app=boot(initial),entry=await openChart(app,'sleep'),close=closeButton(app),dialog=app.document.getElementById('entry-dialog'),content=app.document.getElementById('dialog-content');
  assert.equal(close.closest('.chart-expanded'),null);assert.ok(close.closest('.chart-dialog-head'));
  await app.emit('click',app.document.getElementById(`${entry.id}-point-0`));
  const inner=content.querySelector('.chart-expanded'),plot=app.document.getElementById(`${entry.id}-plot`);
  let width=330;plot.getBoundingClientRect=()=>({top:0,left:0,right:width,bottom:340,width,height:340});
  inner.scrollTop=180;
  for(const [viewportWidth,viewportHeight,plotWidth] of [[844,390,780],[390,844,330],[844,390,780],[390,844,330]]){
    app.window.innerWidth=viewportWidth;app.window.innerHeight=viewportHeight;width=plotWidth;dialog.scrollTop=90;content.scrollTop=70;
    await app.emitWindow('orientationchange');await app.emitWindow('resize');await app.clock.tick(200);
    assert.equal(entry.W,plotWidth);assert.equal(entry.selectedIndex,0);assert.equal(dialog.scrollTop,0);assert.equal(content.scrollTop,0);
    assert.equal(inner.scrollTop,180);assert.equal(closeButton(app),close);
  }
  await app.emit('click',close);assert.equal(dialog.open,false);assert.equal(app.document.body.classList.contains('dialog-open'),false);
  await app.clock.tick(500);assert.deepEqual(app.state(),initial);assert.equal(app.writes.length,0);
});

await test('A running rest timer cannot displace the chart close header after rotation and closing preserves an unrelated draft',async()=>{
  const app=boot(data());await app.click('new-workout');await app.input('name','Testiliike');await app.input('weight','40');await app.input('reps','8');await app.clock.tick(800);await app.click('close');
  const saved=app.state();await openChart(app);const close=closeButton(app);
  app.window.innerWidth=844;app.window.innerHeight=390;await app.emitWindow('orientationchange');await app.clock.tick(200);
  app.window.innerWidth=390;app.window.innerHeight=844;await app.emitWindow('resize');await app.clock.tick(200);
  assert.equal(closeButton(app),close);assert.ok(app.document.getElementById('dialog-rest-timer-host').textContent.includes('Sarjatauko'));
  await app.emit('click',close);assert.equal(app.document.getElementById('entry-dialog').open,false);assert.deepEqual(app.state(),saved);
});

await test('Orientation handling does not change an open workout field, keyboard layout policy or unsaved values',async()=>{
  const app=boot(history);await app.click('new-workout');await app.input('name','Kesken');
  const input=app.document.getElementById('exercise-0'),dialog=app.document.getElementById('entry-dialog');input.focus();
  const before=app.draft(),style={...dialog.style};
  await app.emitWindow('orientationchange');await app.emitWindow('resize');await app.clock.tick(200);
  assert.equal(app.document.activeElement,input);assert.deepEqual(app.draft(),before);assert.deepEqual({...dialog.style},style);
});
