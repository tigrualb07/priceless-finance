import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';
const evidence={taxTreatment:'noVat',provider:'Demo provider',taxEvidence:'Synthetic evidence for local testing only',taxConfirmed:true,eligibilityConfirmed:true};
test('warranty periods tariffs categories discounts and FREE always need reconfirmation',async()=>{const f=await fixture();try{
 await f.patch('publish');for(const [engine,flags,prices] of [['2.0',[],[181,199,498,698]],['3.0',[],[271.5,298.5,747,1047]]]){
 await f.patch('vehicle',{vehicle:{engine}});for(const [index,months] of [3,6,12,24].entries()){
 await f.request('PUT',{token:f.token,action:'warrantyRequest',months},false);let w=(await f.public()).data.offer.warranty;assert.equal(w.months,months);assert.equal(w.status,'review');
 const r=await f.patch('warrantyReview',{requestId:w.id,engine,flags,months,price:prices[index],...evidence});assert.equal(r.status,200);w=(await f.public()).data.offer.warranty;assert.equal(w.price,prices[index]);assert.equal(w.category,engine==='2.0'?'standard':'special');assert.equal(w.status,'acceptance');
 assert.equal((await f.request('PUT',{token:f.token,action:'warrantyAccept',reviewId:w.id},false)).status,200);
 }}
 let w=(await f.public()).data.offer.warranty;await f.patch('warrantyReview',{requestId:w.id,engine:'3.0',flags:[],months:24,price:700,...evidence});w=(await f.public()).data.offer.warranty;assert.equal(w.price,700);assert.equal(w.retail,1047);assert.equal(w.status,'acceptance');await f.patch('warrantyReview',{requestId:w.id,engine:'3.0',flags:[],months:24,price:0,...evidence});w=(await f.public()).data.offer.warranty;assert.equal(w.price,0);assert.equal(w.status,'acceptance');assert.equal(w.retail,1047);
 }finally{f.close()}});
test('VAT and IPT cannot be marked confirmed without provider evidence',async()=>{const f=await fixture();try{
 await f.patch('publish');await f.patch('warrantyRequest',{months:6});let w=(await f.public()).data.offer.warranty;
 const base={requestId:w.id,engine:'2.0',months:6,flags:[],price:199,eligibilityConfirmed:true};
 assert.equal((await f.patch('warrantyReview',{...base,vat:true})).status,400);assert.equal((await f.patch('warrantyReview',{...base,taxTreatment:'iptIncluded',taxConfirmed:true})).status,400);
 assert.equal((await f.patch('warrantyReview',{...base})).status,200);w=(await f.public()).data.offer.warranty;assert.equal(w.taxConfirmed,false);assert.equal((await f.request('PUT',{token:f.token,action:'warrantyAccept',reviewId:w.id},false)).status,409);
 assert.equal((await f.patch('warrantyReview',{...base,requestId:w.id,...evidence,taxTreatment:'vat20'})).status,200);w=(await f.public()).data.offer.warranty;assert.equal(w.price,238.8);assert.equal(w.vat,true);assert.equal(w.taxConfirmed,true);
 }finally{f.close()}});
