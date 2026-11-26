import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';
test('commercial status link recovery expiry and complete paginated audit remain in original records',async()=>{const f=await fixture();try{
 assert.equal((await f.patch('commercialStatus',{status:'in_discussion'})).status,200);assert.equal(f.row().offer_json.dealStatus,'in_discussion');
 await f.patch('publish');await f.request('PUT',{token:f.token,action:'note',message:'Synthetic customer message'},false);await f.patch('note',{message:'Synthetic staff response'});
 const notes=(await f.public()).data.offer.notes;assert.equal(notes.length,2);assert.equal(JSON.parse(notes[1].payload).message,'Synthetic staff response');
 const token=f.row().share_token;await f.patch('revoke');assert.equal((await f.public()).status,410);await f.patch('restore');assert.equal(f.row().published,0);assert.equal(f.row().share_token,token);await f.patch('publish');assert.equal((await f.public()).status,200);
 await f.patch('extend',{expiresAt:new Date(Date.now()+86400000).toISOString()});assert.ok(f.row().expires_at);await f.patch('extend',{expiresAt:null});assert.equal(f.row().expires_at,null);
 const stmt=f.database.prepare("INSERT INTO private_offer_events(id,offer_id,actor,kind,payload) VALUES(?,?,'dealer','note','{}')");for(let i=0;i<220;i++)stmt.run(crypto.randomUUID(),f.id);
 const a=await f.request('GET',undefined,true,'?offer='+f.id),b=await f.request('GET',undefined,true,'?offer='+f.id+'&before='+a.data.eventCursor);
 assert.equal(a.data.events.length,200);assert.ok(b.data.events.length>20);assert.equal(new Set([...a.data.events,...b.data.events].map(x=>x.id)).size,a.data.events.length+b.data.events.length);
 }finally{f.close()}});
