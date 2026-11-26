import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateOffer, grossAmount, moneyPence, priceBreakdown, warrantyAmount} from '../assets/offer-calculation.js';

test('existing gross vehicle and product amounts stay exact', () => {
  const c = calculateOffer({price: 16794, items: [{type: 'charged', price: 120, normalValue: 216, vat: true}, {type: 'charged', price: 810, vat: true}], warranty: {months: 24, status: 'confirmed', price: 1256.40, retail: 1256.40, vat: true}});
  assert.equal(c.totalPence, 1898040); assert.equal(c.savings, 96);
});
test('money rounds decimal half pennies correctly without repeated VAT', () => {
  assert.equal(moneyPence('1.005'), 101); assert.equal(moneyPence(1.005), 101);
  assert.equal(grossAmount('99.99', true), 119.99);
  assert.equal(priceBreakdown(93.32, true).grossPence, 9332);
});
test('discounted vehicle and active products use the same penny totals', () => {
  const c = calculateOffer({price: 12000, retailPrice: 14400, vehicleVat: true, items: [{id: 'required', type: 'charged', price: 240, normalValue: 300, vat: true}, {id: 'extra', type: 'optional', price: 450, normalValue: 600, vat: true}, {type: 'free', normalValue: 180}], selectedIds: ['extra']});
  assert.equal(c.totalPence, 1269000); assert.equal(c.vatPence, 211500); assert.equal(c.savingsPence, 279000);
});
test('permanent IDs and legacy index selections both remain supported', () => {
  const items = [{id: 'one', title: 'Same', type: 'optional', price: 100}, {id: 'two', title: 'Same', type: 'optional', price: 250}];
  assert.equal(calculateOffer({price: 1000, items, selectedIds: ['two']}).total, 1250);
  assert.equal(calculateOffer({price: 1000, items, selected: [1]}).total, 1250);
  assert.equal(calculateOffer({price: 1000, items: items.toReversed(), selectedIds: ['two']}).total, 1250);
});
test('mandatory extras cannot disappear from the calculation', () => {
  assert.equal(calculateOffer({price: 1000, items: [{type: 'optional', extraMode: 'required', price: 100}], selected: []}).total, 1100);
});
test('FREE and Included do not add a charge, deselected extras add no savings', () => {
  const c = calculateOffer({price: 1000, items: [{type: 'free', price: 200, normalValue: 200}, {type: 'included', price: 100}, {type: 'optional', price: 50, normalValue: 300}]});
  assert.equal(c.total, 1000); assert.equal(c.savings, 200);
});
test('all Standard and Special warranty estimates match the configured periods', () => {
  for (const [category, prices] of [['standard', [181,199,498,698]], ['special', [271.5,298.5,747,1047]]]) {
    [3,6,12,24].forEach((months, i) => assert.equal(warrantyAmount({category, months, status: 'review'}, months), prices[i]));
  }
});
test('confirmed warranty discounts and FREE preserve the stored gross price', () => {
  const c = calculateOffer({price: 1000, warranty: {months: 12, status: 'confirmed', price: 0, retail: 498}});
  assert.equal(c.total, 1000); assert.equal(c.savings, 498);
  assert.equal(warrantyAmount({months: 3, status: 'confirmed', price: 181.01, vat: true}), 181.01);
});
test('only an accepted known part exchange affects the amount due', () => {
  assert.equal(calculateOffer({price: 10000, valuation: {net: 1500, settlement: 1500, status: 'pending'}}).total, 10000);
  assert.equal(calculateOffer({price: 10000, valuation: {net: 1500, settlement: 1500, status: 'accepted'}}).total, 8500);
  assert.equal(calculateOffer({price: 10000, valuation: {net: 3000, settlement: null, status: 'accepted'}}).total, 10000);
});
test('negative equity needs separate reviewed customer agreement', () => {
  const valuation = {net: -1000, settlement: 4000, status: 'accepted'};
  assert.equal(calculateOffer({price: 10000, valuation}).total, 10000);
  assert.equal(calculateOffer({price: 10000, valuation: {...valuation, negativeEquityReviewed: true, negativeEquityAgreed: true}}).total, 11000);
});
test('requested deposits and unconfirmed receipts never reduce the balance', () => {
  assert.equal(calculateOffer({price: 10000, depositRequested: 200, payments: [{kind: 'deposit', amount: 200, confirmed: false}]}).total, 10000);
});
test('confirmed receipts and refunds affect balance without changing VAT', () => {
  const c = calculateOffer({price: 12000, vehicleVat: true, payments: [{kind: 'deposit', amount: 200, confirmed: true}, {kind: 'payment', amount: 500, confirmed: true}, {kind: 'refund', amount: 50, confirmed: true}]});
  assert.equal(c.total, 11350); assert.equal(c.receivedPence, 65000); assert.equal(c.vatPence, 200000);
});
