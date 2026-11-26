import test from 'node:test';import assert from 'node:assert/strict';import {fixture} from './offer-fixture.mjs';import {originalUI} from './offer-ui.mjs';
test('vehicle fields media description and blank-field hiding work without moving price outside Calculator',async()=>{const f=await fixture();let ui;try{
 await f.patch('publish');assert.equal((await f.patch('vehicle',{vehicle:{title:'Demo vehicle',engine:'2.0',seats:'5',mileage:'0',description:'Demonstration description',photoUrls:'https://example.invalid/demo.jpg',videoUrl:'https://youtu.be/XnJSU35jV3c',colour:''}})).status,200);
 const view=(await f.public()).data;assert.equal(view.vehicle.engine,'2.0');assert.equal(view.offer.price,10000);ui=await originalUI(f,false);
 assert.match(ui.doc.querySelector('#mainVehicleDetails').textContent,/0 miles/);assert.equal(ui.doc.querySelector('#extraVehicle').hidden,true);assert.equal(ui.doc.querySelectorAll('#media img').length,1);assert.equal(ui.doc.querySelectorAll('#media iframe').length,1);
 assert.equal((await f.patch('vehicle',{vehicle:{price:'1'}})).status,400);assert.equal((await f.patch('vehicle',{vehicle:{photoUrls:'javascript:alert(1)'}})).status,400);assert.equal((await f.patch('vehicle',{vehicle:{videoUrl:'https://unrelated.invalid/watch?v=XnJSU35jV3c'}})).status,400);assert.equal((await f.patch('vehicle',{vehicle:{year:'2'}})).status,400);
 }finally{ui?.close();f.close()}});
test('changing engine invalidates the existing warranty review and confirmation',async()=>{const f=await fixture();try{
 await f.patch('publish');await f.request('PUT',{token:f.token,action:'warrantyRequest',months:12},false);let w=(await f.public()).data.offer.warranty;
 await f.patch('warrantyReview',{requestId:w.id,engine:'2.0',months:12,flags:[],price:498,vat:false});assert.equal((await f.public()).data.offer.warranty.status,'confirmed');
 await f.patch('vehicle',{vehicle:{engine:'3.0'}});w=(await f.public()).data.offer.warranty;assert.equal(w.status,'review');assert.equal(w.engine,'3.0');assert.equal(w.category,'special');assert.equal(w.taxConfirmed,false);
 }finally{f.close()}});
