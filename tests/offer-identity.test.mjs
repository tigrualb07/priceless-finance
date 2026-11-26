import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './offer-fixture.mjs';

const items=[{title:'Same title',type:'optional',price:120,normalValue:150,extraMode:'available'},{title:'Same title',type:'optional',price:200,normalValue:250,extraMode:'available'}];
test('legacy positional selections migrate with a backup and unchanged money tokens and lock',async()=>{
 const f=await fixture();try{
  const before=f.row();f.database.prepare('UPDATE private_offers SET offer_json=?,selected_json=?,locked=1 WHERE id=?').run(JSON.stringify({price:10000,items}), '[1]', f.id);
  assert.equal((await f.request('GET')).status,200);
  const row=f.row();assert.equal(row.offer_json.items.length,2);assert.notEqual(row.offer_json.items[0].id,row.offer_json.items[1].id);
  assert.deepEqual(row.offer_json.selectedIds,[row.offer_json.items[1].id]);assert.equal(row.token_hash,before.token_hash);assert.equal(row.share_token,before.share_token);assert.equal(row.locked,1);assert.equal(row.offer_json.items[1].price,200);
  assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM private_offer_events WHERE kind='productIdentityBackup'").get().n,1);
  await f.request('GET');assert.equal(f.database.prepare("SELECT COUNT(*) AS n FROM private_offer_events WHERE kind='productIdentityBackup'").get().n,1);
 }finally{f.close()}
});
test('rename reorder and repricing retain the exact selected product ID',async()=>{
 const f=await fixture();try{
  await f.patch('edit',{price:10000,items});await f.patch('publish');let list=f.row().offer_json.items;
  assert.equal((await f.request('PUT',{token:f.token,action:'previewSelection',selectedIds:[list[1].id]},false)).status,200);
  list=[{...list[1],title:'Renamed',price:190},list[0]];assert.equal((await f.patch('edit',{price:10000,items:list})).status,200);
  assert.deepEqual(f.row().offer_json.selectedIds,[list[0].id]);assert.deepEqual(f.row().selected,[0]);
  const view=await f.public();assert.equal(view.data.offer.items[0].price,190);assert.deepEqual(view.data.offer.selectedIds,[list[0].id]);
  assert.equal((await f.patch('edit',{price:10000,items:[list[1]]})).status,200);assert.deepEqual(f.row().offer_json.selectedIds,[]);
 }finally{f.close()}
});
test('ambiguous legacy references are preserved and blocked instead of guessed',async()=>{
 const f=await fixture();try{
  const data=JSON.stringify({price:10000,items});f.database.prepare('UPDATE private_offers SET offer_json=?,selected_json=? WHERE id=?').run(data,'[8]',f.id);
  const list=await f.request('GET');assert.match(list.data.offers[0].migrationIssue,/manual review/);assert.equal(f.row().offer_json.productIdentityVersion,undefined);
  assert.equal((await f.patch('edit',{price:9000,items})).status,409);assert.equal(f.row().offer_json.price,10000);
 }finally{f.close()}
});
