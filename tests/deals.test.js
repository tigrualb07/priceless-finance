import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, published, pxFixture, item} from './fixture.js';
import {calculate, pence, warrantyQuote, finalIssues, WARRANTY} from '../assets/deal-engine.js';

const ok = r => { assert.equal(r.status, 200, r.data.error); return r.data; };
const sync = async f => {
  const admin = ok(await f.get()), customer = ok(await f.get(true)), stored = f.state();
  assert.deepEqual(admin.calculation, customer.calculation); assert.deepEqual(admin.calculation, calculate(stored));
  assert.equal(stored.version, customer.deal.version); return {admin, customer, stored};
};
const confirm = async f => ok(await f.send('confirm', {}, 'customer'));
async function ready(f) {
  await confirm(f); ok(await f.send('review', {reviews: {customer: true, vehicle: true, prices: true, vat: true, payments: true, warranty: true, px: true}}));
  return f;
}
async function reviewWarranty(f, {months = 3, price = 18100, original = 18100, vat = false, engine = '2.0', flags = []} = {}) {
  return ok(await f.send('warrantyReview', {months, engine, flags, vat, prices: {[months]: {originalNetPence: original, netPence: price, free: price === 0}}, providerVerified: true, providerEvidence: 'Synthetic test provider document', taxReviewed: true}));
}

test('01 Create Customer Deal: staff, link, API and database persist the same state', async () => {
  const f = await published(), {stored, admin} = await sync(f); assert.equal(stored.customer.name, 'V2 Test Customer'); assert.equal(admin.calculation.outstandingPence, 1000000); assert.ok(admin.privateUrl); assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM vehicles').get().n, 1);
});
test('02 Customer details: valid edit persists, invalid email rejected', async () => {
  const f = await published(); ok(await f.send('customer', {customer: {name: 'Changed Customer', email: 'valid@example.invalid', phone: '07000000000'}})); assert.equal((await sync(f)).customer.deal.customer.name, 'Changed Customer'); assert.equal((await f.send('customer', {name: 'Name', email: 'bad'})).status, 400);
});
test('03 Vehicle fields map consistently and engine accepts Electric', async () => {
  const f = await published(); const v = {registration: 'ABC123', make: 'Make', model: 'Model', year: '2020', mileage: '0', fuel: 'Electric', gearbox: 'Automatic', engine: 'electric', seats: '5', doors: '5', title: 'Presentation', colour: 'Green', bodyType: 'SUV', serviceHistory: 'Full', keys: '2', motExpiry: '2027-01-20', roadTax: '£100', previousKeepers: '1', cambelt: 'Chain', lastService: 'Done', lastWork: 'Work', videoUrl: 'https://youtu.be/XnJSU35jV3c', photoUrls: 'https://example.invalid/car.jpg', description: 'Full description'}; ok(await f.send('vehicle', {vehicle: v})); assert.deepEqual((await sync(f)).customer.deal.vehicle, v);
});
test('04 Vehicle discount with VAT: pence precision and per-line rounding', async () => {
  const f = await published(); ok(await f.send('pricing', {pricing: {originalNetPence: 2499500, offerNetPence: 2399500, vat: true}})); const {admin} = await sync(f); assert.equal(admin.calculation.vehicleDiscountPence, 120000); assert.equal(admin.calculation.vatPence, 479900); assert.equal(admin.calculation.totalPurchasePence, 2879400); assert.equal(pence('0.01'), 1); assert.throws(() => pence('1.001')); assert.throws(() => pence('1e3'));
});
test('05 Mandatory safety items cannot be removed or customer deselected', async () => {
  const f = await published(), x = item({type: 'charged', title: 'Brake preparation', protected: true}); ok(await f.send('items', {items: [x]})); assert.equal((await f.send('items', {items: []})).status, 400); assert.equal((await f.send('selection', {selectedIds: [x.id]}, 'customer')).status, 400); assert.equal((await sync(f)).admin.calculation.totalPurchasePence, 1015000);
});
test('06 Optional default selection applies only when item first added', async () => {
  const f = await published(), x = item({selectionControl: 'default'}); ok(await f.send('items', {items: [x]})); assert.deepEqual(f.state().selectedIds, [x.id]); ok(await f.send('selection', {selectedIds: []}, 'customer')); ok(await f.send('items', {items: [{...x, title: 'Renamed'}]})); assert.deepEqual(f.state().selectedIds, []); await sync(f);
});
test('07 Repeated selection and deselection remain consistent after reads', async () => {
  const f = await published(), x = item(); ok(await f.send('items', {items: [x]})); for (let i = 0; i < 6; i++) { const selectedIds = i % 2 ? [] : [x.id]; ok(await f.send('selection', {selectedIds}, 'customer')); assert.deepEqual((await sync(f)).stored.selectedIds, selectedIds); }
});
test('08 Selected product can be repriced without losing its identity', async () => {
  const f = await published(), x = item(); ok(await f.send('items', {items: [x]})); ok(await f.send('selection', {selectedIds: [x.id]}, 'customer')); ok(await f.send('items', {items: [{...x, netPence: 19000}]})); const {stored, admin} = await sync(f); assert.deepEqual(stored.selectedIds, [x.id]); assert.equal(admin.calculation.totalPurchasePence, 1019000);
});
test('09 Duplicate names have independent permanent product IDs', async () => {
  const f = await published(), a = item(), b = item({netPence: 18000}); ok(await f.send('items', {items: [a, b]})); ok(await f.send('selection', {selectedIds: [b.id]}, 'customer')); const c = (await sync(f)).admin.calculation; assert.equal(c.totalPurchasePence, 1018000); assert.equal(c.lines[0].active, false); assert.equal(c.lines[1].active, true);
});
test('10 Product reordering preserves selection and confirmation', async () => {
  const f = await published(), a = item(), b = item(); ok(await f.send('items', {items: [a, b]})); ok(await f.send('selection', {selectedIds: [a.id]}, 'customer')); await confirm(f); const packageVersion = f.deal.packageVersion; ok(await f.send('items', {items: [b, a]})); const {stored} = await sync(f); assert.deepEqual(stored.selectedIds, [a.id]); assert.equal(stored.packageVersion, packageVersion); assert.equal(stored.confirmation.packageVersion, packageVersion);
});
test('11 Removing an optional product clears only its own selection', async () => {
  const f = await published(), a = item(), b = item(); ok(await f.send('items', {items: [a, b]})); ok(await f.send('selection', {selectedIds: [a.id, b.id]}, 'customer')); ok(await f.send('items', {items: [b]})); assert.deepEqual((await sync(f)).stored.selectedIds, [b.id]);
});
test('12 FREE and INCLUDED products have zero charge and retail savings', async () => {
  const f = await published(); ok(await f.send('items', {items: [item({type: 'free', vat: true}), item({type: 'included'})]})); const c = (await sync(f)).admin.calculation; assert.equal(c.totalPurchasePence, 1000000); assert.equal(c.vatPence, 0); assert.equal(c.savingsPence, 244000);
});
test('13 Discount and savings count only active products and item VAT once', async () => {
  const f = await published(), a = item({vat: true}), b = item({netPence: 0}); ok(await f.send('items', {items: [a, b]})); ok(await f.send('selection', {selectedIds: [a.id]}, 'customer')); const c = (await sync(f)).admin.calculation; assert.equal(c.vatPence, 3000); assert.equal(c.totalPurchasePence, 1018000); assert.equal(c.savingsPence, 206000);
});
test('14 Standard warranty up to and including 2.5 L uses central tariffs', async () => {
  const f = await published(); ok(await f.send('vehicle', {vehicle: {engine: '2.5'}})); ok(await f.send('warrantySelect', {months: 3}, 'customer')); const {stored, admin} = await sync(f); assert.equal(warrantyQuote(stored).category, 'standard'); assert.equal(admin.calculation.warranty.grossPence, 18100); assert.ok(admin.finalIssues.includes('Warranty Review Required'));
});
test('15 Multiple special categories apply a single surcharge to all four tariffs', async () => {
  const f = await published(); await reviewWarranty(f, {engine: '3.0', flags: ['4x4 / AWD', 'Commercial Vehicle'], price: 27150, original: 27150}); const d = (await sync(f)).stored; assert.deepEqual(WARRANTY.months.map(m => warrantyQuote(d, m).grossPence), [27150, 29850, 74700, 104700]);
});
test('16 Changing warranty period clears confirmation and requires review', async () => {
  const f = await published(); ok(await f.send('warrantySelect', {months: 3}, 'customer')); await reviewWarranty(f); await confirm(f); ok(await f.send('warrantySelect', {months: 6}, 'customer')); const {stored} = await sync(f); assert.equal(stored.warranty.months, 6); assert.equal(stored.warranty.reviewed, false); assert.equal(stored.confirmation, null); ok(await f.send('warrantySelect', {months: 0}, 'customer')); assert.equal((await sync(f)).admin.calculation.warranty, null);
});
test('17 Same warranty period lower/FREE price carries confirmation; price increase invalidates', async () => {
  const f = await published(); ok(await f.send('warrantySelect', {months: 3}, 'customer')); await reviewWarranty(f); await confirm(f); await reviewWarranty(f, {price: 10000}); assert.equal(f.state().confirmation.packageVersion, f.state().packageVersion); await reviewWarranty(f, {price: 0}); assert.equal((await sync(f)).admin.calculation.warranty.grossPence, 0); assert.ok(f.state().confirmation); await reviewWarranty(f, {price: 18100}); assert.equal(f.state().confirmation, null);
});
test('18 Warranty VAT is off by default and applies only after its discount', async () => {
  const f = await published(); assert.equal(f.deal.warranty.vat, false); await reviewWarranty(f, {price: 10000, vat: true}); const c = (await sync(f)).admin.calculation; assert.equal(c.warranty.grossPence, 12000); assert.equal(c.warranty.vatPence, 2000); assert.equal(c.savingsPence, 209720);
});
test('19 PX without finance deducts allowance after purchase VAT', async () => {
  const f = await pxFixture(); ok(await f.send('valuationDecision', {valuationId: f.deal.px.valuation.id, status: 'accepted'}, 'customer')); ok(await f.send('pricing', {pricing: {originalNetPence: 1200000, offerNetPence: 1000000, vat: true}})); const c = (await sync(f)).admin.calculation; assert.equal(c.vatPence, 200000); assert.equal(c.pxAllowancePence, 300000); assert.equal(c.outstandingPence, 900000);
});
test('20 PX with confirmed settlement uses net allowance', async () => {
  const f = await pxFixture({finance: 'yes', settlement: 100000}); ok(await f.send('valuationDecision', {valuationId: f.deal.px.valuation.id, status: 'accepted'}, 'customer')); const c = (await sync(f)).admin.calculation; assert.equal(c.pxNetPence, 200000); assert.equal(c.outstandingPence, 800000);
});
test('21 Unknown PX settlement remains unknown and cannot be accepted', async () => {
  const f = await pxFixture({finance: 'yes', settlement: null}); assert.equal((await f.send('valuationDecision', {valuationId: f.deal.px.valuation.id, status: 'accepted'}, 'customer')).status, 400); const c = (await sync(f)).admin.calculation; assert.equal(c.pxNetPence, null); assert.equal(c.pxAllowancePence, 0); assert.equal(c.outstandingPence, 1000000);
});
test('22 Negative equity requires a separate staff review and customer agreement', async () => {
  const f = await pxFixture({finance: 'yes', gross: 100000, settlement: 150000, negative: true}); const valuationId = f.deal.px.valuation.id; ok(await f.send('valuationDecision', {valuationId, status: 'accepted'}, 'customer')); assert.equal((await sync(f)).admin.calculation.outstandingPence, 1000000); ok(await f.send('negativeEquityAgreement', {valuationId, agreed: true}, 'customer')); const c = (await sync(f)).admin.calculation; assert.equal(c.negativeEquityAppliedPence, 50000); assert.equal(c.outstandingPence, 1050000);
});
test('23 PX accept/decline/withdraw persists; revised valuation invalidates acceptance', async () => {
  const f = await pxFixture(); let valuationId = f.deal.px.valuation.id; ok(await f.send('valuationDecision', {valuationId, status: 'accepted'}, 'customer')); ok(await f.send('valuationDecision', {valuationId, status: 'declined'}, 'customer')); assert.equal((await sync(f)).admin.calculation.pxAllowancePence, 0); ok(await f.send('withdrawPX', {}, 'customer')); assert.equal(f.state().px.status, 'withdrawn'); ok(await f.send('valuation', {grossPence: 290000, financeExists: false, inspected: true})); assert.equal(f.state().px.status, 'pending'); assert.equal((await f.send('valuationDecision', {valuationId, status: 'accepted'}, 'customer')).status, 409); assert.ok(f.state().px.history.length >= 3);
});
test('24 Deposit requested does not reduce balance until receipt confirmed', async () => {
  const f = await published(); ok(await f.send('depositRequested', {amountPence: 20000})); assert.equal((await sync(f)).admin.calculation.outstandingPence, 1000000); ok(await f.send('paymentEntry', {kind: 'deposit', amountPence: 20000, date: new Date().toISOString(), method: 'Bank', reference: 'TEST', confirmed: true})); assert.equal((await sync(f)).admin.calculation.outstandingPence, 980000);
});
test('25 Additional payments and refunds are append-only; excess refunds rejected', async () => {
  const f = await published(); const p = {date: new Date().toISOString(), method: 'Card', reference: 'TEST', confirmed: true}; ok(await f.send('paymentEntry', {...p, kind: 'payment', amountPence: 100000})); ok(await f.send('paymentEntry', {...p, kind: 'refund', amountPence: 20000})); const {admin, customer} = await sync(f); assert.equal(admin.calculation.totalReceivedPence, 80000); assert.equal(admin.deal.payments.length, 2); assert.equal(customer.deal.payments[0].reference, undefined); assert.equal((await f.send('paymentEntry', {...p, kind: 'refund', amountPence: 80001})).status, 400);
});
test('26 Confirm My Selection is tied to an exact package and offer version', async () => {
  const f = await published(); await confirm(f); const {stored} = await sync(f); assert.equal(stored.confirmation.packageVersion, stored.packageVersion); assert.equal(stored.confirmation.offerVersion, stored.version); assert.equal(stored.stage, 'Customer Confirmed');
});
test('27 Material edits after customer confirmation invalidate it; messages preserve it', async () => {
  const f = await published(); await confirm(f); ok(await f.send('note', {message: 'Synthetic message'})); assert.ok(f.state().confirmation); ok(await f.send('vehicle', {vehicle: {colour: 'Blue'}})); assert.equal((await sync(f)).stored.confirmation, null);
});
test('28 Finalise & Lock requires every applicable check and saves snapshot atomically', async () => {
  const f = await published(); assert.equal((await f.send('lock')).status, 409); await ready(f); const locked = ok(await f.send('lock')); assert.equal(locked.deal.locked, true); assert.equal(locked.snapshot.deal.version, locked.deal.version); assert.deepEqual(locked.snapshot.calculation, locked.calculation); assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM private_offer_v2_snapshots').get().n, 1); await sync(f);
});
test('29 Locked offers reject customer choices and every staff financial/data editor', async () => {
  const f = await ready(await published()); ok(await f.send('lock')); for (const [action, values] of [['customer', {name: 'Hacked'}], ['vehicle', {vehicle: {colour: 'Blue'}}], ['pricing', {pricing: {originalNetPence: 10, offerNetPence: 10, vat: false}}], ['items', {items: []}], ['note', {message: 'Blocked'}], ['paymentEntry', {}], ['valuation', {}], ['warrantyReview', {}], ['review', {reviews: {vat: false}}], ['extend', {expiresAt: null}]]) assert.equal((await f.send(action, values)).status, 423, action); assert.equal((await f.send('confirm', {}, 'customer')).status, 423); assert.equal(f.state().locked, true);
});
test('30 Unlock preserves previous final version and requires renewed confirmation', async () => {
  const f = await ready(await published()); const first = ok(await f.send('lock')).snapshot; ok(await f.send('unlock', {reason: 'Synthetic renegotiation'})); assert.equal(f.state().confirmation, null); ok(await f.send('vehicle', {vehicle: {colour: 'Silver'}})); await ready(f); const second = ok(await f.send('lock')).snapshot; assert.ok(second.deal.version > first.deal.version); const saved = f.DB.sqlite.prepare('SELECT snapshot_json FROM private_offer_v2_snapshots ORDER BY version').all(); assert.equal(saved.length, 2); assert.deepEqual(JSON.parse(saved[0].snapshot_json), first);
});
test('31 Unpublish and expiry deny the private link and reject stale writes', async () => {
  const f = await published(); ok(await f.send('unpublish')); assert.equal((await f.get(true)).status, 410); ok(await f.send('publish')); const d = f.state(); d.technical.expiresAt = '2000-01-01T00:00:00.000Z'; f.DB.sqlite.prepare('UPDATE private_offer_v2 SET state_json=? WHERE id=?').run(JSON.stringify(d), f.id); assert.equal((await f.get(true)).status, 410); assert.equal((await f.send('note', {message: 'Too late'}, 'customer')).status, 410);
});
test('32 Messages in both directions persist; unread/read counters remain separate', async () => {
  const f = await published(); ok(await f.send('note', {message: 'From customer'}, 'customer')); ok(await f.send('note', {message: 'From staff'})); const {admin, customer} = await sync(f); assert.deepEqual(admin.notes.map(n => n.message), ['From customer', 'From staff']); assert.deepEqual(admin.notes, customer.notes); assert.equal(f.state().lastMessage.customer, 1); ok(await f.send('markRead')); assert.equal(f.state().readMessages.dealer, 1);
});
test('33 Audit records actor, date, before and after; private history is never public', async () => {
  const f = await published(); ok(await f.send('vehicle', {vehicle: {colour: 'Blue'}})); const {admin, customer} = await sync(f); const event = admin.activity.find(e => e.kind === 'vehicle'); assert.equal(event.before.vehicle.colour, undefined); assert.equal(event.after.vehicle.colour, 'Blue'); assert.equal(event.staff, 'staff@example.invalid'); assert.ok(event.createdAt); assert.equal(customer.activity, undefined); assert.equal(customer.finalIssues, undefined); assert.equal(customer.deal.reviews, undefined);
});
test('34 Print data source is the immutable final snapshot, even after technical updates', async () => {
  const f = await ready(await published()); const locked = ok(await f.send('lock')); ok(await f.send('unpublish')); const data = ok(await f.get()); assert.deepEqual(data.snapshot, locked.snapshot); assert.notEqual(data.deal.version, data.snapshot.deal.version); assert.deepEqual(data.snapshot.calculation, calculate(data.snapshot.deal));
});
test('36 Simultaneous writes: exactly one commit succeeds; no phantom history', async () => {
  const f = await published(), v = f.deal.version, count = f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM private_offer_v2_events WHERE offer_id=?').get(f.id).n; const r = await Promise.all([f.send('customer', {name: 'First'}, 'dealer', v), f.send('note', {message: 'Second'}, 'customer', v)]); assert.deepEqual(r.map(x => x.status).sort(), [200, 409]); assert.equal(f.state().version, v + 1); assert.equal(f.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM private_offer_v2_events WHERE offer_id=?').get(f.id).n, count + 1);
});
test('37 Missing, forged, expired and wrong audience authentication cannot reach staff API', async () => {
  const f = await published(); assert.equal((await f.call('GET', undefined, {staff: false})).status, 403); assert.equal((await f.call('PATCH', {id: f.id, action: 'publish'}, {staff: false})).status, 403); const parts = f.identity.jwt.split('.'), forged = [...parts]; forged[1] = Buffer.from(JSON.stringify({aud: 'forged', exp: 0})).toString('base64url'); assert.equal((await f.call('GET', undefined, {headers: {'Cf-Access-Jwt-Assertion': forged.join('.')}})).status, 403); assert.equal((await f.call('PATCH', {id: f.id, action: 'publish'}, {headers: {Origin: 'https://evil.invalid'}})).status, 403);
  for (const payload of [{exp: 0}, {aud: ['wrong-audience']}, {iss: 'https://wrong.cloudflareaccess.com'}, {nbf: Math.floor(Date.now() / 1000) + 600}]) assert.equal((await f.call('GET', undefined, {headers: {'Cf-Access-Jwt-Assertion': await f.identity.sign(payload)}})).status, 403);
  assert.equal((await f.call('GET', undefined, {headers: {'Cf-Access-Jwt-Assertion': await f.identity.sign({}, {alg: 'HS256'})}})).status, 403);
  assert.equal((await f.call('GET', undefined, {staff: false, headers: {Cookie: 'CF_Authorization=' + f.identity.jwt}})).status, 200);
});

test('Atomic rollback: an audit failure rolls back state and compatibility projection', async () => {
  const f = await published(), before = f.state(), legacy = f.DB.sqlite.prepare('SELECT customer_label FROM private_offers WHERE id=?').get(f.id).customer_label;
  f.DB.sqlite.exec("CREATE TRIGGER reject_test_audit BEFORE INSERT ON private_offer_v2_events WHEN NEW.kind='customer' BEGIN SELECT RAISE(ABORT,'Synthetic test failure'); END");
  assert.equal((await f.send('customer', {name: 'Must roll back'})).status, 500); assert.deepEqual(f.state(), before); assert.equal(f.DB.sqlite.prepare('SELECT customer_label FROM private_offers WHERE id=?').get(f.id).customer_label, legacy);
});

test('Legacy VAT migration preserves non-representable gross pennies through reordering', async () => {
  const f = await fixture({create: false}), vid = 'vehicle_penny', oid = crypto.randomUUID(), token = 'b'.repeat(64), {digest} = await import('../functions/api/private-offers.js');
  f.DB.sqlite.prepare('INSERT INTO vehicles(id,registration,make,model,mileage,retail_price) VALUES(?,?,?,?,?,?)').run(vid, 'PENNY', 'Example', 'Legacy', 0, 10000.03);
  const old = {price: 10000.03, vehicleVat: true, items: [{title: 'Legacy VAT', type: 'optional', vat: true, price: 0.03, normalValue: 0.03}, {title: 'Other', type: 'included', price: 0, normalValue: 0}]};
  f.DB.sqlite.prepare('INSERT INTO private_offers(id,vehicle_id,customer_label,token_hash,offer_json,published,selected_json) VALUES(?,?,?,?,?,?,?)').run(oid, vid, 'Legacy Penny Test', await digest(token), JSON.stringify(old), 1, '[0]'); f.id = oid; f.token = token;
  const initial = await sync(f); assert.equal(initial.admin.calculation.totalPurchasePence, 1000006); assert.equal(initial.admin.calculation.lines[0].grossPence, 3);
  ok(await f.send('items', {items: [...initial.stored.items].reverse()})); assert.equal((await sync(f)).admin.calculation.totalPurchasePence, 1000006);
});
test('38 Legacy migration preserves link hash, selections and original backup; duplicates flagged', async () => {
  const f = await fixture({create: false}); const vid = 'vehicle_legacy', oid = crypto.randomUUID(), token = 'a'.repeat(64); const {digest} = await import('../functions/api/private-offers.js'); f.DB.sqlite.prepare('INSERT INTO vehicles(id,registration,make,model,mileage,retail_price,extra_json) VALUES(?,?,?,?,?,?,?)').run(vid, 'LEGACY', 'Example', 'Legacy', 50000, 12000, '{}'); const old = {price: 10000, items: [{title: 'Same', type: 'optional', price: 100, normalValue: 120}, {title: 'Same', type: 'optional', price: 200, normalValue: 220}]}; f.DB.sqlite.prepare('INSERT INTO private_offers(id,vehicle_id,customer_label,token_hash,offer_json,published,selected_json,share_token) VALUES(?,?,?,?,?,?,?,?)').run(oid, vid, 'Legacy Test', await digest(token), JSON.stringify(old), 1, '[1]', token); f.id = oid; f.token = token; const {stored, admin} = await sync(f); assert.equal(stored.selectedIds.length, 1); assert.equal(stored.selectedIds[0], stored.items[1].id); assert.equal(admin.calculation.totalPurchasePence, 1020000); assert.ok(stored.migrationIssues.length); const backup = f.DB.sqlite.prepare('SELECT legacy_json FROM private_offer_v2_backups WHERE offer_id=?').get(oid); assert.equal(JSON.parse(backup.legacy_json).offer_json, JSON.stringify(old)); assert.equal(JSON.parse(backup.legacy_json).selected_json, '[1]');
});
test('39 Customer price tampering, foreign item IDs, staff actions and unsafe monetary values rejected', async () => {
  const f = await published(); for (const [action, values] of [['confirm', {price: 1}], ['selection', {selectedIds: ['unknown-id']}], ['pricing', {pricing: {offerNetPence: 0}}], ['warrantySelect', {months: 3, price: 0}], ['paymentEntry', {amountPence: 100}], ['valuationDecision', {valuationId: 'forged', status: 'accepted'}]]) assert.ok((await f.send(action, values, 'customer')).status >= 400, action); assert.equal((await f.send('pricing', {pricing: {originalNetPence: 10.1, offerNetPence: -1}})).status, 400); assert.equal((await f.send('pricing', {pricing: {originalNetPence: 1e12, offerNetPence: 1e12}})).status, 400); assert.equal((await sync(f)).admin.calculation.totalPurchasePence, 1000000);
});
