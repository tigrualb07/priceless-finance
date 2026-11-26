import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './offer-fixture.mjs';
import {originalUI} from './offer-ui.mjs';

test('simultaneous API writes cannot overwrite each other or leave losing audit events',async()=>{
 const f=await fixture();try{
  const revision=f.row().revision;
  const a=await f.patch('customer',{revision,name:'First saved',phone:'',email:''});
  const b=await f.patch('customer',{revision,name:'Stale draft',phone:'',email:''});
  assert.equal(a.status,200);assert.equal(b.status,409);assert.equal(f.row().customer_label,'First saved');
  assert.equal(f.database.prepare("SELECT COUNT(*) n FROM private_offer_events WHERE kind='customer'").get().n,1);
  assert.equal((await f.patch('edit',{revision:null,price:1,items:[]})).status,409);
 }finally{f.close()}
});
test('original Admin retains a customer draft while polling and rejects its stale save',async()=>{
 const f=await fixture();let ui;try{
  ui=await originalUI(f);ui.doc.querySelector('#editCustomer').click();ui.input(ui.doc.querySelector('#editName'),'Unsaved local customer');
  await f.patch('edit',{price:9876,items:[]});await ui.poll();
  assert.equal(ui.doc.querySelector('#editName').value,'Unsaved local customer');assert.match(ui.doc.querySelector('#calculator').textContent,/9,876/);
  ui.doc.querySelector('#customerEdit').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));await ui.idle();
  assert.equal(f.row().customer_label,'SYNTHETIC TEST CUSTOMER');assert.equal(ui.doc.querySelector('#editName').value,'Unsaved local customer');assert.match(ui.doc.querySelector('#message').textContent,/changed|draft/i);
 }finally{ui?.close();f.close()}
});
test('original Customer Link receives price changes without reload and preserves PX and message drafts',async()=>{
 const f=await fixture();let ui;try{
  await f.patch('publish');ui=await originalUI(f,false);
  ui.input(ui.doc.querySelector('#noteText'),'Message still being written');const reg=ui.doc.querySelector('#pxForm [name=registration]');ui.input(reg,'DEMO PX');
  await f.patch('edit',{price:9750,items:[{id:'sync_optional_01',title:'Extra',type:'optional',price:50,normalValue:60,extraMode:'available'}]});await ui.poll();
  assert.match(ui.doc.querySelector('#total').textContent,/9,750/);assert.equal(ui.doc.querySelector('#noteText').value,'Message still being written');assert.equal(reg.value,'DEMO PX');
  const check=ui.doc.querySelector('#additionalItems input[type=checkbox]');assert.ok(check);check.checked=true;check.dispatchEvent(new ui.w.Event('change',{bubbles:true}));await ui.idle();
  assert.deepEqual(f.row().offer_json.selectedIds,['sync_optional_01']);assert.match(ui.doc.querySelector('#total').textContent,/9,800/);
 }finally{ui?.close();f.close()}
});
