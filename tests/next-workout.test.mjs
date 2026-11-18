import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, plain } from './helpers/browser-harness.mjs';
import { ex, workout, history, legacy } from './helpers/fixtures.mjs';

const key='kuntokayra_v1',kgPerLb=.45359237;
function trainingHistory(){
  const data=plain(history);
  data.workouts.find(row=>row.id==='b1').exercises=[
    {name:'Kulmasoutu',unit:'kg',sets:[{weight:60,reps:8},{weight:65,reps:6}]},
    {name:'Leuanveto',unit:'kg',sets:[{weight:0,reps:10}]},
    {name:'Hauiskääntö',unit:'lbs',sets:[{weight:20*kgPerLb,reps:12}]},
  ];
  return data;
}
const names=app=>app.draft().exercises.map(ex=>ex.name);
const openNext=async(initial=trainingHistory())=>{const app=boot(initial);await app.click('next-workout');return app;};
async function saveProgram(app,type){
  await app.click(undefined,{tab:'settings'});
  await app.fillSimple({programType:type});
  await app.emit('submit',app.document.getElementById('workout-program-form'));
}
function arrangePointerRows(app){
  const list=app.document.getElementById('workout-order-list');
  app.document.getElementById('workout-order').open=true;
  list.clientHeight=100;list.scrollHeight=150;
  list.getBoundingClientRect=()=>({top:0,bottom:100,left:0,right:300,width:300,height:100});
  for(const row of list.querySelectorAll('[data-order-index]'))row.getBoundingClientRect=()=>({top:Number(row.dataset.orderIndex)*50-list.scrollTop,bottom:(Number(row.dataset.orderIndex)+1)*50-list.scrollTop,left:0,right:300,width:300,height:50});
  return list;
}

await test('The next-workout button occupies one of the original three metric-card slots and does not write on startup',async()=>{
  const app=boot(history),grid=app.document.querySelector('.summary-grid');
  const cards=grid.querySelectorAll('.metric-card');
  assert.equal(cards.length,3);
  const card=app.document.getElementById('next-workout-card');
  assert.equal(card.tagName,'button');
  assert.ok(cards.includes(card));
  assert.equal(card.dataset.action,'next-workout');
  assert.ok(card.textContent.includes('Seuraava treeni'));
  assert.ok(card.textContent.includes('Takakroppa'));
  assert.ok(card.textContent.includes('14.11.'));
  assert.ok(!app.mainHTML().includes('Treenit / 7 pv'));
  assert.deepEqual(app.state(),history);
  assert.equal(app.writes.length,0);
});

await test('The suggested workout copies only the latest same-category session, including order, sets and physical loads, with blank reps',async()=>{
  const initial=trainingHistory();
  initial.workouts.unshift(workout('older-back','2026-11-02','Takakroppa',[ex('Vanha liike',5)],'2026-11-02T12:00:00Z'));
  const app=await openNext(initial);
  assert.deepEqual(names(app),['Kulmasoutu','Leuanveto','Hauiskääntö']);
  assert.deepEqual(app.draft().exercises.map(ex=>ex.sets.length),[2,1,1]);
  assert.equal(app.weight(),'60');assert.equal(app.weight(0,1),'65');
  assert.equal(app.weight(1),'0');assert.equal(app.weight(2),'20');
  assert.equal(app.unit(2),'lbs');
  assert.ok(app.draft().exercises.every(ex=>ex.sets.every(set=>set.reps==='')));
  assert.deepEqual(app.state().workouts,initial.workouts);
  await app.clock.tick(1500);
  assert.equal(app.countdown(),null,'Suggestions do not pretend that a set was completed');
  await app.input('weight','62');
  await app.click('add-set',{ex:0});
  assert.equal(app.weight(0,2),'62');
  assert.equal(app.weight(0,1),'65');
  await app.input('weight','63');
  assert.equal(app.weight(0,2),'62');
});

await test('No earlier matching category starts an editable empty workout, including a one-type or new custom program',async()=>{
  const app=boot();
  await saveProgram(app,'fullbody');
  await app.click(undefined,{tab:'home'});
  assert.ok(app.document.getElementById('next-workout-card').textContent.includes('Fullbody'));
  await app.click('next-workout');
  assert.equal(app.draft().category,'Fullbody');
  assert.equal(app.draft().exercises.length,1);
  assert.equal(app.weight(),'');
  assert.ok(!app.state().workoutPending,'An untouched empty form creates no draft');
});

await test('Draft autosave waits for a typing pause, retains partial fields and never adds unfinished sets to curves',async()=>{
  const app=boot(history),stored=app.storage.get(key),curve=plain(app.api.exerciseSeries('Penkkipunnerrus'));
  await app.click('new-workout');
  await app.input('name','Kesken');
  await app.input('weight','12,');
  await app.clock.tick(499);
  assert.equal(app.storage.get(key),stored);
  await app.clock.tick(1);
  assert.equal(app.state().workoutPending.exercises[0].sets[0].weight,'12,');
  assert.equal(app.state().workoutPending.exercises[0].sets[0].reps,'');
  assert.deepEqual(app.state().workouts,history.workouts);
  assert.deepEqual(plain(app.api.exerciseSeries('Penkkipunnerrus')),curve);
  assert.ok(app.document.getElementById('next-workout-card').textContent.includes('Jatka treeniä'));
  const writes=app.writes.length;
  await app.clock.tick(2000);
  assert.equal(app.writes.length,writes);
});

await test('Reload and resume preserve cleared weights, per-set values, units, date and manual suggestion guards with zero startup writes',async()=>{
  const app=await openNext();
  await app.input('weight','',0,0);
  await app.input('weight','66,5',0,1);
  await app.input('reps','9',0,1);
  await app.input('date','2026-11-15');
  await app.clock.tick(500);
  const saved=app.state(),reopened=boot(null,app.storage);
  assert.deepEqual(reopened.state(),saved);
  assert.equal(reopened.writes.length,0);
  assert.equal(reopened.document.getElementById('entry-dialog').open,false);
  await reopened.click('next-workout');
  assert.equal(reopened.draft().date,'2026-11-15');
  assert.equal(reopened.weight(),'');assert.equal(reopened.weight(0,1),'66,5');
  assert.equal(reopened.draft().exercises[0].sets[1].reps,'9');
  assert.equal(reopened.unit(2),'lbs');
  await reopened.input('name','Kulmasoutu');
  assert.equal(reopened.weight(),'','A deliberately cleared field stays cleared after resume');
  await reopened.clock.tick(1000);
  assert.equal(reopened.countdown(),null,'Resuming a completed set does not restart its rest timer');
});

await test('Background, pagehide and closing flush the latest fields immediately, while a blank date can remain unfinished',async()=>{
  const app=boot();await app.click('new-workout');
  await app.input('name','Kyykky');await app.input('date','');
  app.document.visibilityState='hidden';await app.emit('visibilitychange',app.document);
  assert.equal(app.state().workoutPending.date,'');
  await app.input('weight','60');await app.emitWindow('pagehide');
  assert.equal(app.state().workoutPending.exercises[0].sets[0].weight,'60');
  await app.input('reps','8');await app.click('close');
  assert.equal(app.document.getElementById('entry-dialog').open,false);
  assert.equal(app.state().workoutPending.exercises[0].sets[0].reps,'8');
  await app.click('new-workout');
  assert.equal(app.draft().date,'');assert.equal(app.draft().exercises[0].sets[0].reps,'8');
});

await test('Storage failure keeps the editor open and retryable and leaves previous records untouched',async()=>{
  const app=boot(history),stored=app.storage.get(key);await app.click('new-workout');
  await app.input('name','Kyykky');await app.input('weight','60');await app.input('reps','8');
  app.setStorageFailure(true);await app.clock.tick(500);
  assert.equal(app.storage.get(key),stored);
  assert.deepEqual(app.state(),history);
  await app.click('close');
  assert.equal(app.document.getElementById('entry-dialog').open,true);
  assert.ok(app.document.getElementById('workout-draft-status').textContent.includes('ei tallentunut'));
  const cancel=await app.emitElement('cancel',app.document.getElementById('entry-dialog'));
  assert.equal(cancel.defaultPrevented,true);
  app.setStorageFailure(false);await app.click('close');
  assert.equal(app.document.getElementById('entry-dialog').open,false);
  assert.equal(app.state().workoutPending.exercises[0].sets[0].weight,'60');
  assert.deepEqual(app.state().workouts,history.workouts);
});

await test('A successful workout save atomically consumes its draft once while a failed save preserves it and the editor',async()=>{
  const app=await openNext();
  await app.click('save-workout');
  assert.equal(app.state().workouts.length,history.workouts.length);
  assert.ok(app.document.getElementById('form-error').textContent);
  for(let index=0;index<app.draft().exercises.length;index++)for(let set=0;set<app.draft().exercises[index].sets.length;set++)await app.input('reps','8',index,set);
  const stored=app.storage.get(key),before=app.state();
  app.setStorageFailure(true);await app.click('save-workout');
  assert.deepEqual(app.state(),before);assert.equal(app.storage.get(key),stored);
  assert.equal(app.document.getElementById('entry-dialog').open,true);
  app.setStorageFailure(false);await app.click('save-workout');
  assert.equal(app.state().workouts.length,history.workouts.length+1);
  assert.ok(!app.state().workoutPending);
  await app.clock.tick(1500);
  assert.ok(!app.state().workoutPending,'No delayed callback resurrects a completed draft');
  const reopened=boot(null,app.storage);
  assert.ok(!reopened.state().workoutPending);
  assert.equal(reopened.writes.length,0);
});

await test('Discard requires confirmation, is atomic on failure and preserves all completed records',async()=>{
  const app=await openNext(),initial=app.state();
  app.setConfirmation(false);await app.click('delete-current-workout');
  assert.deepEqual(app.state(),initial);
  app.setConfirmation(true);app.setStorageFailure(true);await app.click('delete-current-workout');
  assert.deepEqual(app.state(),initial);assert.equal(app.document.getElementById('entry-dialog').open,true);
  app.setStorageFailure(false);await app.click('delete-current-workout');
  assert.ok(!app.state().workoutPending);assert.deepEqual(app.state().workouts,initial.workouts);
  assert.equal(app.document.getElementById('entry-dialog').open,false);
  assert.ok(app.document.getElementById('next-workout-card').textContent.includes('Seuraava treeni'));
});

await test('Editing a completed workout or changing program does not consume an unrelated draft, and its original category remains editable',async()=>{
  const app=await openNext();await app.input('weight','63');await app.click('close');
  const pending=app.state().workoutPending;
  await app.click('edit-workout',{id:'f1'});await app.input('weight','41');await app.click('save-workout');
  assert.deepEqual(app.state().workoutPending,pending);
  await saveProgram(app,'fullbody');await app.click('next-workout');
  assert.equal(app.draft().category,'Takakroppa');assert.equal(app.weight(),'63');
  assert.ok(app.document.getElementById('workout-category').querySelectorAll('option').some(option=>option.value==='Takakroppa'));
});

await test('Weight and sleep logging retain an unrelated unfinished workout',async()=>{
  const app=await openNext();await app.click('close');const pending=app.state().workoutPending;
  await app.click('new-weight');await app.fillSimple({value:'81,2'});await app.submitSimple();
  assert.deepEqual(app.state().workoutPending,pending);
  await app.click('new-sleep');await app.fillSimple({bed:'22:30',wake:'06:30'});await app.submitSimple();
  assert.deepEqual(app.state().workoutPending,pending);
  await app.click('next-workout');assert.deepEqual(names(app),['Kulmasoutu','Leuanveto','Hauiskääntö']);
});

await test('Version-1 backups retain partial drafts and exact physical weights through repeated kg/lbs switches and reopening',async()=>{
  const app=await openNext();
  for(let i=0;i<6;i++)await app.input('unit',i%2?'kg':'lbs',0,0,'change');
  await app.input('weight','',1);await app.click('export');
  const payload=JSON.parse(await app.blobs[0].text());
  assert.equal(payload.version,1);assert.ok(payload.data.workoutPending);
  const visit=value=>{if(value && typeof value==='object')for(const [key,item] of Object.entries(value)){assert.ok(!key.startsWith('_'));visit(item);}};visit(payload.data.workoutPending);
  const imported=boot();await imported.importBackup(payload);
  assert.equal(imported.alerts.length,0);
  const reopened=boot(null,imported.storage);assert.equal(reopened.writes.length,0);
  await reopened.click('next-workout');
  assert.equal(reopened.weight(1),'');assert.equal(reopened.weight(),'60');
  await reopened.input('reps','8',0,0);await reopened.input('reps','8',0,1);
  await reopened.input('weight','0',1);await reopened.input('reps','8',1);await reopened.input('reps','8',2);
  await reopened.click('save-workout');
  assert.equal(reopened.state().workouts.at(-1).exercises[0].sets[0].weight,60);
  assert.ok(Math.abs(reopened.state().workouts.at(-1).exercises[2].sets[0].weight-20*kgPerLb)<1e-10);
});

await test('Malformed pending backups are rejected atomically, including inconsistent canonical weight metadata',async()=>{
  const app=await openNext(),saved=app.state(),stored=app.storage.get(key),base=plain(saved.workoutPending);
  const variants=[null,{...base,id:''},{...base,date:'broken'},{...base,exercises:[{...base.exercises[0],name:'x'.repeat(81)}]},{...base,exercises:[{...base.exercises[0],sets:[{...base.exercises[0].sets[0],canonicalWeight:999}]}]}];
  for(const pending of variants){await app.importBackup({version:1,data:{...plain(legacy),workoutPending:pending}});assert.deepEqual(app.state(),saved);assert.equal(app.storage.get(key),stored);}
  assert.equal(app.alerts.length,variants.length);
});

await test('Successful import and clearing cancel queued draft writes instead of resurrecting old unfinished exercises',async()=>{
  for(const action of ['import','clear']){
    const app=boot(history);await app.click('new-workout');await app.input('name','Vanha keskeneräinen');await app.input('weight','30');await app.input('reps','8');
    if(action==='import')await app.importBackup({version:1,data:legacy});else await app.click('clear');
    await app.clock.tick(1500);
    assert.ok(!app.state().workoutPending);
    assert.equal(app.draft(),null);assert.equal(app.countdown(),null);
    assert.equal(app.state().workouts.length,action==='import'?1:0);
  }
});

await test('Draft loading is passive and does not rewrite malformed local pending data or completed records',async()=>{
  const initial={...plain(history),workoutPending:{id:'broken'}};
  const app=boot(initial);
  assert.deepEqual(app.state(),initial);assert.equal(app.writes.length,0);
  assert.ok(app.document.getElementById('next-workout-card').textContent.includes('Seuraava treeni'));
});

await test('Movement arrows and keyboard handles reorder full exercises without changing their sets or starting a timer',async()=>{
  const app=await openNext(),before=app.draft().exercises;
  app.document.getElementById('workout-order').open=true;
  await app.click('move-exercise-down',{ex:0});
  assert.deepEqual(names(app),['Leuanveto','Kulmasoutu','Hauiskääntö']);
  assert.deepEqual(app.draft().exercises[1],before[0]);
  assert.equal(app.document.getElementById('workout-order').open,true);
  const handle=app.document.getElementById('workout-drag-1');
  const event=await app.emit('keydown',handle,{key:'ArrowUp'});
  assert.equal(event.defaultPrevented,true);assert.deepEqual(names(app),before.map(ex=>ex.name));
  await app.click('move-exercise-up',{ex:0});assert.deepEqual(names(app),before.map(ex=>ex.name));
  await app.clock.tick(1000);assert.equal(app.countdown(),null);
});

await test('Touch pointer dragging commits one reorder, persists it, and pointer cancellation leaves order unchanged',async()=>{
  const app=await openNext();arrangePointerRows(app);
  let handle=app.document.getElementById('workout-drag-0');
  await app.emit('pointerdown',handle,{pointerId:7,pointerType:'touch',clientY:25});
  await app.emit('pointermove',handle,{pointerId:7,clientY:125});
  await app.emit('pointercancel',handle,{pointerId:7});
  assert.deepEqual(names(app),['Kulmasoutu','Leuanveto','Hauiskääntö']);
  handle=app.document.getElementById('workout-drag-0');
  await app.emit('pointerdown',handle,{pointerId:8,pointerType:'touch',clientY:25});
  await app.emit('pointermove',handle,{pointerId:8,clientY:125});
  await app.emit('pointerup',handle,{pointerId:8});
  assert.deepEqual(names(app),['Leuanveto','Hauiskääntö','Kulmasoutu']);
  await app.clock.tick(500);
  const reopened=boot(null,app.storage);await reopened.click('next-workout');
  assert.deepEqual(names(reopened),['Leuanveto','Hauiskääntö','Kulmasoutu']);
  assert.equal(reopened.weight(2,1),'65');
});

await test('Dragging near the list edge scrolls its own list and keeps the original exercise attached to a pending rest timer',async()=>{
  const app=await openNext();await app.input('reps','8');
  const list=arrangePointerRows(app),handle=app.document.getElementById('workout-drag-0');
  await app.emit('pointerdown',handle,{pointerId:3,pointerType:'touch',clientY:25});
  await app.emit('pointermove',handle,{pointerId:3,clientY:92});
  await app.clock.tick(96);assert.ok(list.scrollTop>0);
  await app.emit('pointerup',handle,{pointerId:3});
  assert.equal(names(app).at(-1),'Kulmasoutu');
  await app.clock.tick(704);
  assert.equal(app.countdown(),'3:00');
  assert.ok(app.document.querySelector('.rest-timer').textContent.includes('Kulmasoutu · sarja 1'));
});

await test('Previous-set references include the actual indexed weight and repetitions and follow kg/lbs selection',async()=>{
  const app=await openNext();
  assert.equal(app.document.getElementById('previous-reps-0-0').textContent,'Sarja 1 · Viimeksi 60 kg × 8 · 14.11.');
  assert.equal(app.document.getElementById('previous-reps-0-1').textContent,'Sarja 2 · Viimeksi 65 kg × 6 · 14.11.');
  await app.input('unit','lbs',0,0,'change');
  assert.ok(app.document.getElementById('previous-reps-0-1').textContent.includes('143,3 lbs × 6'));
  assert.equal(app.draft().exercises[0].sets[1].reps,'');
});

