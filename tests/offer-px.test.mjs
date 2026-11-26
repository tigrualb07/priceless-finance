import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';import {calculateOffer} from '../assets/offer-calculation.js';
async function requestPX(f,finance){await f.request('PUT',{token:f.token,action:'partExchange',details:{registration:'DEMO PX',mileage:60000,expected:3000,finance}},false);return (await f.public()).data.offer.preferences.find(e=>e.kind==='partExchange').id;}
const quote={verified:true,evidence:'Synthetic valuation evidence only',inspectionConfirmed:true};
test('only an accepted verified known PX allowance affects the balance',async()=>{const f=await fixture();try{
 await f.patch('publish');let pxId=await requestPX(f,'No');await f.patch('valuation',{pxId,value:3000,settlement:null,...quote});let v=(await f.public()).data.offer.valuation;assert.equal(v.settlement,0);assert.equal(v.net,3000);assert.equal(calculateOffer({price:10000,valuation:v}).total,10000);
 await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted'},false);v=(await f.public()).data.offer.valuation;assert.equal(calculateOffer({price:10000,valuation:v}).total,7000);
 await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'declined'},false);assert.equal(calculateOffer({price:10000,valuation:(await f.public()).data.offer.valuation}).total,10000);
 pxId=await requestPX(f,'Yes');await f.patch('valuation',{pxId,value:3000,settlement:'',...quote});v=(await f.public()).data.offer.valuation;assert.equal(v.net,null);assert.equal(v.settlement,null);assert.equal((await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted'},false)).status,409);
 await f.patch('valuation',{pxId,value:3000,settlement:1000,...quote});v=(await f.public()).data.offer.valuation;assert.equal(v.net,2000);await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted'},false);assert.equal(calculateOffer({price:10000,valuation:(await f.public()).data.offer.valuation}).total,8000);
 await f.request('PUT',{token:f.token,action:'pxWithdraw',pxId},false);v=(await f.public()).data.offer.valuation;assert.equal(v.status,'withdrawn');assert.equal(calculateOffer({price:10000,valuation:v}).total,10000);
 }finally{f.close()}});
test('negative equity requires a separate reviewed customer agreement tied to that valuation',async()=>{const f=await fixture();try{
 await f.patch('publish');const pxId=await requestPX(f,'Yes');await f.patch('valuation',{pxId,value:3000,settlement:4000,...quote});let v=(await f.public()).data.offer.valuation;
 assert.equal((await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted',negativeEquityAgreed:true},false)).status,409);
 await f.patch('valuation',{pxId,value:3000,settlement:4000,...quote,negativeEquityReviewed:true,negativeEquityExplanation:'Synthetic explanation of £1000 shortfall'});v=(await f.public()).data.offer.valuation;
 assert.equal((await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted'},false)).status,409);assert.equal((await f.request('PUT',{token:f.token,action:'valuationDecision',valuationId:v.id,status:'accepted',negativeEquityAgreed:true},false)).status,200);
 assert.equal(calculateOffer({price:10000,valuation:(await f.public()).data.offer.valuation}).total,11000);
 await f.patch('valuation',{pxId,value:2900,settlement:4000,...quote});assert.equal((await f.public()).data.offer.valuation.negativeEquityAgreed,false);
 }finally{f.close()}});
