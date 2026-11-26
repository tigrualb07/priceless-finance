import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './offer-fixture.mjs';
import {originalUI} from './offer-ui.mjs';

test('existing product editor preserves a gross price that does not round trip through net',async()=>{
 const f=await fixture();let ui;try{
  await f.patch('edit',{price:10000,items:[{id:'existing_penny_item',title:'Penny item',type:'charged',price:0.03,normalValue:0.03,vat:true}]});
  ui=await originalUI(f);[...ui.doc.querySelectorAll('#benefitView button')].find(x=>x.textContent==='Edit').click();
  ui.input(ui.doc.querySelector('[data-field=description]'),'Description changed only');
  ui.doc.querySelector('#benefitsEdit').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));await ui.idle();
  assert.equal(f.row().offer_json.items[0].price,0.03);assert.equal(f.row().offer_json.items[0].normalValue,0.03);
  assert.equal(f.row().offer_json.items[0].description,'Description changed only');
 }finally{ui?.close();f.close()}
});
test('existing product editor supports net discount amount, percentage and individual VAT',async()=>{
 const f=await fixture();let ui;try{
  await f.patch('edit',{price:10000,items:[{id:'existing_discount_item',title:'Discount item',type:'charged',price:150,normalValue:200,vat:false}]});
  ui=await originalUI(f);[...ui.doc.querySelectorAll('#benefitView button')].find(x=>x.textContent==='Edit').click();
  const field=name=>ui.doc.querySelector('[data-field='+name+']');
  ui.input(field('discount'),'25');assert.equal(field('price').value,'175.00');
  ui.input(field('percent'),'40');assert.equal(field('price').value,'120.00');
  ui.input(field('vat'),true);
  ui.doc.querySelector('#benefitsEdit').dispatchEvent(new ui.w.Event('submit',{bubbles:true,cancelable:true}));await ui.idle();
  const item=f.row().offer_json.items[0];assert.equal(item.price,144);assert.equal(item.normalValue,240);assert.equal(item.vat,true);
 }finally{ui?.close();f.close()}
});
