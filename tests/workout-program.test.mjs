import test from 'node:test';
import assert from 'node:assert/strict';
import { boot, plain } from './helpers/browser-harness.mjs';
import { ex, workout, history, legacy } from './helpers/fixtures.mjs';

const key='kuntokayra_v1';
const presets=[
  ['front-back',['Etukroppa','Takakroppa']],
  ['push-pull-legs',['Push','Pull','Legs']],
  ['upper-lower',['Upper','Lower']],
  ['fullbody',['Fullbody']],
];
const categoryOptions=app=>app.document.getElementById('workout-category').querySelectorAll('option').map(option=>option.value);
const settings=app=>app.click(undefined,{tab:'settings'});
async function choose(app,type,categories){
  const select=app.document.getElementById('workout-program-type');
  select.value=type;
  await app.emit('change',select);
  if(categories!==undefined)await app.fillSimple({categories});
}
async function saveProgram(app,type,categories){
  await settings(app);
  await choose(app,type,categories);
  await app.emit('submit',app.document.getElementById('workout-program-form'));
}
async function finishWorkout(app,name='Testiliike'){
  await app.input('name',name);
  await app.input('weight','25');
  await app.input('reps','8');
  await app.click('save-workout');
  assert.equal(app.document.getElementById('entry-dialog').open,false,'Workout must actually save');
}

await test('Legacy data defaults to the existing split with a collapsed compact settings panel and zero startup writes',async()=>{
  const app=boot(history),stored=app.storage.get(key);
  await settings(app);
  const panel=app.document.getElementById('workout-program-panel');
  assert.equal(panel.open,false);
  assert.ok(!('open' in panel.attributes));
  assert.ok(panel.querySelector('summary').textContent.includes('Etukroppa / Takakroppa'));
  assert.deepEqual(app.document.getElementById('workout-program-type').querySelectorAll('option').map(option=>option.value),[...presets.map(([type])=>type),'custom']);
  assert.equal(app.document.getElementById('workout-program-custom').hidden,true);
  await choose(app,'custom','Push\nPull');
  assert.equal(app.document.getElementById('workout-program-custom').hidden,false);
  await choose(app,'upper-lower');
  assert.equal(app.document.getElementById('workout-program-custom').hidden,true);
  assert.equal(app.storage.get(key),stored);
  assert.deepEqual(app.state(),history);
  assert.equal(app.writes.length,0);
  assert.equal(app.fetchCalls.length,0);
});

for(const [type,categories] of presets){
  await test(`${type} persists its exact categories and cycles in order across saves and reopening`,async()=>{
    const app=boot();
    await saveProgram(app,type);
    assert.deepEqual(app.state().settings.workoutProgram,{type});
    for(let index=0;index<=categories.length;index++){
      await app.click('new-workout');
      assert.deepEqual(categoryOptions(app),categories);
      assert.equal(app.draft().category,categories[index%categories.length]);
      await finishWorkout(app,`Liike ${index}`);
    }
    const saved=app.state(),reopened=boot(null,app.storage);
    assert.deepEqual(reopened.state(),saved);
    assert.equal(reopened.writes.length,0);
    await reopened.click('new-workout');
    assert.equal(reopened.draft().category,categories[(categories.length+1)%categories.length]);
    await reopened.click('close');
    await reopened.click(undefined,{tab:'workouts'});
    assert.deepEqual(reopened.document.querySelectorAll('details.exercise-category').map(node=>node.dataset.category),[...categories,'uncategorized']);
  });
}

await test('Custom mixed programs normalize entered whitespace and follow the user-written order and manual category override',async()=>{
  const app=boot(),categories=['Push','Etukroppa / Takakroppa','Lower','Fullbody'];
  await saveProgram(app,'custom','\n Push \nEtukroppa  /  Takakroppa\nLower\nFullbody\n');
  assert.deepEqual(app.state().settings.workoutProgram,{type:'custom',categories});
  assert.ok(app.document.getElementById('workout-program-order').textContent.includes('Push → Etukroppa / Takakroppa → Lower → Fullbody → Push'));
  for(const expected of categories){
    await app.click('new-workout');
    assert.equal(app.draft().category,expected);
    await finishWorkout(app);
  }
  await app.click('new-workout');
  assert.equal(app.draft().category,'Push');
  await app.input('category','Lower',0,0,'change');
  await app.input('date','2026-09-01');
  await finishWorkout(app);
  const reopened=boot(null,app.storage);
  await reopened.click('new-workout');
  assert.equal(reopened.draft().category,'Fullbody','Rotation follows latest save, not workout date');
});

await test('A one-category custom program always suggests the same category',async()=>{
  const app=boot();
  await saveProgram(app,'custom','Oma kokovartalo');
  for(let index=0;index<2;index++){
    await app.click('new-workout');
    assert.deepEqual(categoryOptions(app),['Oma kokovartalo']);
    assert.equal(app.draft().category,'Oma kokovartalo');
    await finishWorkout(app);
  }
});

await test('Changing programs preserves old categories, uncategorized records, exercise curves and editing of archived workouts',async()=>{
  const app=boot(history),initial=app.state(),curve=plain(app.api.exerciseSeries('Penkkipunnerrus','volume'));
  await saveProgram(app,'push-pull-legs');
  assert.deepEqual(app.state().workouts,initial.workouts);
  assert.deepEqual(app.state().sleep,initial.sleep);
  assert.deepEqual(app.state().weight,initial.weight);
  assert.deepEqual(plain(app.api.exerciseSeries('Penkkipunnerrus','volume')),curve);
  await app.click(undefined,{tab:'workouts'});
  const groups=app.document.querySelectorAll('details.exercise-category');
  assert.deepEqual(groups.map(node=>node.dataset.category),['Push','Pull','Legs','Etukroppa','Takakroppa','uncategorized']);
  assert.ok(groups.find(node=>node.dataset.category==='Etukroppa').textContent.includes('Aiempi ohjelma'));
  assert.ok(groups.find(node=>node.dataset.category==='uncategorized').textContent.includes('Maastaveto'));
  assert.ok(groups.every(node=>!node.open));
  await app.click('new-workout');
  assert.equal(app.draft().category,'Push','Unrelated old category starts the new program at its first type');
  assert.deepEqual(categoryOptions(app),['Push','Pull','Legs']);
  await app.click('close');
  await app.click('edit-workout',{id:'f2'});
  assert.equal(app.draft().category,'Etukroppa');
  assert.ok(categoryOptions(app).includes('Etukroppa'));
  await app.click('save-workout');
  assert.equal(app.state().workouts.find(row=>row.id==='f2').category,'Etukroppa');
  assert.deepEqual(plain(app.api.exerciseSeries('Penkkipunnerrus','volume')),curve);
  await app.click('edit-workout',{id:'legacy'});
  await app.click('save-workout');
  assert.ok(!('category' in app.state().workouts.find(row=>row.id==='legacy')));
});

await test('Category suggestions work after a warmed history cache and keep session order, previous weights, units and reps',async()=>{
  const initial=plain(history);
  initial.workouts.unshift(workout('push-old','2026-11-09','Push',[ex('Vinopenkki',30),ex('Sivuviparit',5)],'2026-11-09T10:00:00Z'));
  initial.workouts.push(workout('push-new','2026-11-15','Push',[{name:'Pystypunnerrus',unit:'lbs',sets:[{weight:20,reps:6},{weight:18,reps:9}]},ex('Vinopenkki',40)],'2026-11-15T10:00:00Z'));
  initial.workouts.push(workout('pull','2026-11-15','Pull',[ex('Ylätalja',50)],'2026-11-15T10:01:00Z'));
  const app=boot(initial);
  await app.click('new-workout');
  assert.deepEqual(app.options(),['Kulmasoutu','Leuanveto']);
  await app.click('close');
  await saveProgram(app,'push-pull-legs');
  await app.click('new-workout');
  assert.equal(app.draft().category,'Push');
  assert.deepEqual(app.options(),['Pystypunnerrus','Vinopenkki','Sivuviparit']);
  await app.click('choose-exercise',{name:'Pystypunnerrus'});
  assert.equal(app.unit(),'lbs');
  assert.ok(Math.abs(Number(app.weight().replace(',','.'))*0.45359237-20)<0.001);
  assert.ok(app.html().includes('lbs × 6'));
  await app.input('weight','55');
  await app.input('category','Pull',0,0,'change');
  assert.deepEqual(app.options(),['Ylätalja']);
  assert.equal(app.weight(),'55');
  await app.click('delete-current-workout');
  await saveProgram(app,'custom','Push\nPull\nFullbody');
  await app.click('new-workout');
  assert.deepEqual(app.options(),['Pystypunnerrus','Vinopenkki','Sivuviparit']);
});

await test('New custom categories learn movement suggestions only from workouts saved to that category',async()=>{
  const app=boot();
  await saveProgram(app,'custom','Voima\nKestävyys');
  await app.click('new-workout');
  assert.deepEqual(app.options(),[]);
  await finishWorkout(app,'Kyykky');
  await app.click('new-workout');
  assert.equal(app.draft().category,'Kestävyys');
  assert.deepEqual(app.options(),[]);
  await app.input('category','Voima',0,0,'change');
  assert.deepEqual(app.options(),['Kyykky']);
  await app.click('choose-exercise',{name:'Kyykky'});
  assert.equal(app.weight(),'25');
});

await test('Custom category text is escaped in options, groups and history and cannot collide with the uncategorized group',async()=>{
  const label='Veto "A" & <B>',app=boot();
  await saveProgram(app,'custom',`uncategorized\n${label}`);
  await app.click('new-workout');
  assert.deepEqual(categoryOptions(app),['uncategorized',label]);
  await finishWorkout(app,'Luokiteltu liike');
  await app.click('new-workout');
  assert.equal(app.draft().category,label);
  assert.ok(!app.html().includes('<B>'));
  await finishWorkout(app,'Toinen liike');
  const groups=app.document.querySelectorAll('details.exercise-category');
  const named=groups.find(node=>node.dataset.category==='uncategorized' && node.dataset.uncategorized==='false');
  const ungrouped=groups.find(node=>node.dataset.uncategorized==='true');
  assert.ok(named.textContent.includes('Luokiteltu liike'));
  assert.ok(!ungrouped.textContent.includes('Luokiteltu liike'));
  assert.ok(ungrouped.textContent.includes('Forkut'));
  assert.ok(app.mainHTML().includes('Veto &quot;A&quot; &amp; &lt;B&gt;'));
  assert.ok(!app.mainHTML().includes('<B>'));
});

await test('Invalid, empty, duplicate and oversized custom programs leave saved data and draft form values untouched',async()=>{
  const app=boot(history);
  await saveProgram(app,'upper-lower');
  const saved=app.state(),stored=app.storage.get(key);
  for(const categories of ['\n  \n','Push\nPUSH','Ylä\nYLÄ','x'.repeat(61),Array.from({length:21},(_,i)=>`Kategoria ${i}`).join('\n'),'Nimi\u0000']){
    await settings(app);
    const panel=app.document.getElementById('workout-program-panel');panel.open=true;
    await choose(app,'custom',categories);
    await app.emit('submit',app.document.getElementById('workout-program-form'));
    assert.ok(app.document.getElementById('workout-program-error').textContent);
    assert.equal(panel.open,true);
    assert.equal(app.simpleValue('categories'),categories);
    assert.deepEqual(app.state(),saved);
    assert.equal(app.storage.get(key),stored);
  }
  await choose(app,'__proto__');
  await app.emit('submit',app.document.getElementById('workout-program-form'));
  assert.deepEqual(app.state(),saved);
  assert.equal(app.storage.get(key),stored);
});

await test('Saving a program is atomic on storage failure, retains retryable input and leaves other unsaved settings fields in place',async()=>{
  const initial={...plain(history),settings:{restSeconds:90,garmin:{start:'07:00',end:'11:00'}}};
  const app=boot(initial);
  await settings(app);
  await app.fillSimple({minutes:'7',start:'08:00'});
  const panel=app.document.getElementById('workout-program-panel');panel.open=true;
  await choose(app,'custom','Voima\nLiikkuvuus');
  const stored=app.storage.get(key);
  app.setStorageFailure(true);
  await app.emit('submit',app.document.getElementById('workout-program-form'));
  assert.deepEqual(app.state(),initial);
  assert.equal(app.storage.get(key),stored);
  assert.equal(panel.open,true);
  assert.equal(app.simpleValue('categories'),'Voima\nLiikkuvuus');
  app.setStorageFailure(false);
  await app.emit('submit',app.document.getElementById('workout-program-form'));
  assert.equal(panel.open,false);
  assert.equal(app.simpleValue('minutes'),'7');
  assert.equal(app.simpleValue('start'),'08:00');
  assert.deepEqual(app.state().settings,{...initial.settings,workoutProgram:{type:'custom',categories:['Voima','Liikkuvuus']}});
  assert.deepEqual(app.state().workouts,initial.workouts);
});

await test('Program settings coexist with later rest and Garmin changes and survive clearing entries',async()=>{
  const app=boot(history);
  await saveProgram(app,'custom','Voima\nTekniikka');
  await app.fillSimple({minutes:'2',seconds:'30'});
  await app.emit('submit',app.document.getElementById('rest-settings-form'));
  await app.fillSimple({start:'07:15',end:'11:30'});
  await app.emit('submit',app.document.getElementById('garmin-window-form'));
  assert.deepEqual(app.state().settings,{workoutProgram:{type:'custom',categories:['Voima','Tekniikka']},restSeconds:150,garmin:{start:'07:15',end:'11:30'}});
  const saved=app.state().settings;
  await app.click('clear');
  assert.deepEqual(app.state().settings,saved);
  assert.equal(app.state().workouts.length,0);
  await app.click('new-workout');
  assert.equal(app.draft().category,'Voima');
});

await test('Version-1 backup export, import and reopening preserve custom programs, inactive categories and all existing series',async()=>{
  const app=boot(history);
  await saveProgram(app,'custom','Push\nPull\nLegs\nFullbody');
  await app.click('new-workout');
  await finishWorkout(app);
  await app.click('export');
  const payload=JSON.parse(await app.blobs[0].text());
  assert.equal(payload.version,1);
  assert.deepEqual(payload.data.settings.workoutProgram,{type:'custom',categories:['Push','Pull','Legs','Fullbody']});
  const imported=boot();
  await imported.importBackup(payload);
  assert.equal(imported.alerts.length,0);
  assert.deepEqual(imported.state().settings,app.state().settings);
  assert.deepEqual(imported.state().workouts.map(({id,...row})=>row),app.state().workouts.map(({id,...row})=>row));
  assert.deepEqual(plain(imported.api.exerciseSeries('Penkkipunnerrus','volume')),plain(app.api.exerciseSeries('Penkkipunnerrus','volume')));
  const reopened=boot(null,imported.storage);
  assert.deepEqual(reopened.state(),imported.state());
  assert.equal(reopened.writes.length,0);
  await reopened.click('new-workout');
  assert.equal(reopened.draft().category,'Pull');
  await reopened.click('close');
  await reopened.importBackup({version:1,data:legacy});
  assert.equal(reopened.alerts.length,0);
  assert.ok(!reopened.state().settings?.workoutProgram);
  assert.ok(!('category' in reopened.state().workouts[0]));
});

await test('Preset-only backup settings and categories from a different program are validated independently of current selection',async()=>{
  const app=boot();
  await saveProgram(app,'fullbody');
  const data={...plain(legacy),settings:{workoutProgram:{type:'push-pull-legs'}},workouts:[workout('old','2026-11-15','Etukroppa',[ex('Vanha liike',10)])]};
  await app.importBackup({version:1,data});
  assert.equal(app.alerts.length,0);
  assert.deepEqual(app.state().settings,{workoutProgram:{type:'push-pull-legs'}});
  assert.equal(app.state().workouts[0].category,'Etukroppa');
  await app.click('new-workout');
  assert.equal(app.draft().category,'Push');
});

await test('Invalid program or category metadata rejects an entire backup before replacing data',async()=>{
  const app=boot(history);
  await saveProgram(app,'fullbody');
  const saved=app.state(),stored=app.storage.get(key);
  for(const program of [null,[],{type:'unknown'},{type:'custom',categories:[]},{type:'custom',categories:['A','a']},{type:'custom',categories:[2]},{type:'custom',categories:[' A ']},{type:'fullbody',categories:['A']}]){
    const data={...plain(history),settings:{workoutProgram:program}};
    await app.importBackup({version:1,data});
    assert.deepEqual(app.state(),saved);
    assert.equal(app.storage.get(key),stored);
  }
  for(const category of [22,{},'x'.repeat(61),'bad\u0000name']){
    const data=plain(history);data.workouts[0].category=category;
    await app.importBackup({version:1,data});
    assert.deepEqual(app.state(),saved);
    assert.equal(app.storage.get(key),stored);
  }
  assert.equal(app.alerts.length,12);
});
