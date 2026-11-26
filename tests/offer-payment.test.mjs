import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';import {originalUI} from './offer-ui.mjs';
const record=(kind,amount)=>({kind,amount,method:'bank',reference:'SYNTHETIC RECEIPT ONLY',confirmed:true,receiptId:crypto.randomUUID()});
test('only confirmed money received reduces the balance and refunds remain append only',async()=>{const f=await fixture();try{
 await f.patch('publish');await f.patch('depositRequest',{amount:1000});let o=(await f.public()).data.offer;assert.equal(o.calculation.total,10000);assert.equal(o.calculation.depositRequestedPence,100000);
 assert.equal((await f.patch('paymentRecord',{...record('deposit',500),confirmed:false})).status,400);const receipt=record('deposit',500);assert.equal((await f.patch('paymentRecord',receipt)).status,200);assert.equal((await f.patch('paymentRecord',receipt)).data.duplicate,true);
 await f.patch('paymentRecord',record('payment',1500));await f.patch('paymentRecord',record('refund',200));o=(await f.public()).data.offer;assert.equal(o.calculation.total,8200);assert.equal(o.calculation.receivedPence,180000);assert.equal(o.payments.length,3);
 assert.equal((await f.patch('paymentRecord',record('refund',1801))).status,400);assert.equal((await f.request('PUT',{token:f.token,action:'paymentRecord',...record('deposit',9000)},false)).status,400);
 assert.equal((await f.request('PUT',{token:f.token,action:'confirm',selectedIds:[],total:1,price:1},false)).data.total,8200);
 }finally{f.close()}});
test('Admin Customer Link and API display the same payment and accepted PX arithmetic',async()=>{const f=await fixture();let admin,customer;try{
 await f.patch('publish');await f.patch('depositRequest',{amount:1000});await f.patch('paymentRecord',record('deposit',500));admin=await originalUI(f);customer=await originalUI(f,false);const o=(await f.public()).data.offer;
 assert.equal(o.calculation.total,9500);assert.match(admin.doc.querySelector('#calculator .grand').textContent,/9,500/);assert.match(customer.doc.querySelector('#total').textContent,/9,500/);assert.match(customer.doc.querySelector('#paymentBalance').textContent,/not deducted/);
 }finally{admin?.close();customer?.close();f.close()}});
