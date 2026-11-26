import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './offer-fixture.mjs';

test('original offer API preserves existing gross prices during description edits', async()=>{
  const f=await fixture();try{
    const products=[{id:'test_product_01',title:'VAT item',type:'charged',normalValue:120,price:93.32,vat:true,description:'Original'}];
    assert.equal((await f.patch('edit',{price:10000,items:products})).status,200);
    products[0].description='Updated description';
    assert.equal((await f.patch('edit',{price:10000,items:products})).status,200);
    assert.equal(f.row().offer_json.items[0].price,93.32);
    assert.equal(f.row().offer_json.items[0].description,'Updated description');
  }finally{f.close();}
});
test('original API rejects negative prices, nonfinite amounts and inverted discounts',async()=>{
  const f=await fixture();try{
    for(const price of [-1,'NaN',101])assert.equal((await f.patch('edit',{price:10000,items:[{title:'Invalid',type:'charged',normalValue:100,price}]})).status,400);
    assert.deepEqual(f.row().offer_json.items,[]);
  }finally{f.close();}
});
test('Included and FREE cannot silently carry a price',async()=>{
  const f=await fixture();try{
    for(const type of ['included','free'])assert.equal((await f.patch('edit',{price:10000,items:[{title:'Invalid gift',type,price:10}]})).status,400);
  }finally{f.close();}
});
test('protected legal preparation stays in the existing offer',async()=>{
  const f=await fixture();try{
    const item={id:'protected_item',title:'Required preparation',type:'charged',price:100,normalValue:100,protected:true};
    assert.equal((await f.patch('edit',{price:10000,items:[item]})).status,200);
    assert.equal((await f.patch('edit',{price:10000,items:[]})).status,400);
    assert.equal(f.row().offer_json.items[0].id,item.id);
  }finally{f.close();}
});
