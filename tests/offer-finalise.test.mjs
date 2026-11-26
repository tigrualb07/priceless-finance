import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';
const checks=Object.fromEntries(['vehicleChecked','productsChecked','taxChecked','paymentsChecked','pxChecked','customerConfirmed'].map(k=>[k,true]));
async function prepared(f){await f.patch('customer',{name:'SYNTHETIC CUSTOMER',phone:'07000000000',email:''});await f.patch('vehicle',{vehicle:{title:'Complete demo',registration:'DEMO1',make:'Example',model:'Demo',year:'2020',mileage:'20000',fuel:'Petrol',gearbox:'Manual',engine:'2.0'}});await f.patch('publish');}
async function confirm(f){return f.request('PUT',{token:f.token,action:'confirm',selectedIds:f.row().offer_json.selectedIds||[]},false)}
test('finalisation requires all checks and confirmation of the exact current package',async()=>{const f=await fixture();try{
 await prepared(f);assert.equal((await f.patch('lock',{checks})).status,409);assert.equal((await confirm(f)).status,200);assert.equal((await f.patch('lock',{checks:{}})).status,400);
 await f.patch('edit',{price:9500,items:[]});assert.equal((await f.patch('lock',{checks})).status,409);await confirm(f);assert.equal((await f.patch('lock',{checks})).status,200);
 const final=(await f.public()).data.offer.finalAgreement;assert.equal(final.content.calculation.total,9500);assert.equal(final.kind,'finalAgreement');assert.equal(final.hash,f.row().offer_json.confirmedHash);
 for(const action of ['edit','customer','vehicle','warrantyRequest','valuation','depositRequest','paymentRecord','commercialStatus','note'])assert.equal((await f.patch(action,{price:1,items:[]})).status,423,action);
 assert.equal((await f.request('PUT',{token:f.token,action:'previewSelection',selectedIds:[]},false)).status,423);
 assert.throws(()=>f.database.prepare('DELETE FROM private_offer_selections WHERE id=?').run(f.row().offer_json.finalAgreementId),/permanent/);
 assert.equal((await f.patch('unlock',{reason:'no'})).status,400);assert.equal((await f.patch('unlock',{reason:'Synthetic authorised correction'})).status,200);assert.equal((await f.public()).data.offer.finalAgreement,null);assert.equal((await f.patch('lock',{checks})).status,409);
 await confirm(f);assert.equal((await f.patch('lock',{checks})).status,200);assert.equal(f.database.prepare("SELECT COUNT(*) n FROM private_offer_selections WHERE json_extract(selection_json,'$.kind')='finalAgreement'").get().n,2);
 }finally{f.close()}});
test('inventory changes after confirmation cannot silently change the final agreement',async()=>{const f=await fixture();try{
 await prepared(f);await confirm(f);f.database.prepare('UPDATE vehicles SET retail_price=20000 WHERE id=?').run(f.row().vehicle_id);assert.equal((await f.patch('lock',{checks})).status,409);
 }finally{f.close()}});
