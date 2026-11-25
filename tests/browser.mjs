import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const {chromium} = createRequire(import.meta.url)('playwright');
import {startServer} from './server.mjs';
import {calculate} from '../assets/deal-engine.js';

const running = await startServer(), f = running.fixture, origin = running.origin;
const artifacts = process.env.V2_TEST_ARTIFACTS || '/tmp/priceless-v2-evidence'; await mkdir(artifacts, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: process.env.V2_CHROMIUM || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox']});
const adminContext = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Europe/London'}), customerContext = await browser.newContext({viewport: {width: 1440, height: 1000}, timezoneId: 'Europe/London'});
await adminContext.addCookies([{name: 'v2_test_staff', value: '1', url: origin}]);
const admin = await adminContext.newPage(), customer = await customerContext.newPage();
const errors = [], results = []; let navigations = 0;
for (const page of [admin, customer]) page.on('pageerror', error => errors.push(error.message));
customer.on('framenavigated', frame => { if (frame === customer.mainFrame()) navigations++; });
const waitFor = async (condition, message, timeout = 10000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await condition()) return; await new Promise(r => setTimeout(r, 80)); } throw Error(message); };
async function saved(page, task) {
  const response = page.waitForResponse(r => r.url().includes('/api/private-offers') && ['POST', 'PATCH', 'PUT'].includes(r.request().method()));
  await task(); const r = await response; const data = await r.json(); assert.ok(r.ok(), data.error);
  await waitFor(() => page.locator('#editor').evaluate(e => !e.open), 'Editor did not close'); return data;
}
async function assertParity() {
  const state = f.state(), expected = calculate(state), display = (expected.outstandingPence / 100).toLocaleString('en-GB', {style: 'currency', currency: 'GBP'});
  await waitFor(async () => await admin.getByTestId('outstanding').textContent() === display && await customer.getByTestId('outstanding').textContent() === display, 'Admin and customer totals did not synchronise');
  const publicData = await (await customer.request.get(origin + '/api/private-offers?token=' + f.token)).json();
  assert.deepEqual(publicData.calculation, expected); assert.equal(publicData.deal.version, f.state().version);
}
const record = (id, detail) => { results.push({id, status: 'PASS', detail}); process.stdout.write('PASS ' + id + ' ' + detail + '\n'); };
try {
  await admin.goto(origin + '/admin/offers/');
  await admin.getByRole('button', {name: '+ New Customer Deal', exact: true}).click();
  const dialog = admin.locator('#editor');
  for (const [label, value] of [['Full Name *', 'Synthetic Customer'], ['Phone Number', '07000000000'], ['Email Address', 'customer@example.invalid'], ['Registration *', 'TEST123'], ['Make *', 'Example'], ['Model *', 'Demo'], ['Mileage', '25000'], ['Vehicle price (£) *', '10000']]) await dialog.getByLabel(label, {exact: true}).fill(value);
  const created = await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click());
  f.id = created.id; f.token = new URL(created.url).searchParams.get('token'); f.deal = created.deal;
  await saved(admin, () => admin.getByRole('button', {name: 'Publish Customer Link', exact: true}).click());
  await customer.goto(origin + '/offer/?token=' + f.token); await customer.getByRole('heading', {name: 'Vehicle Card', exact: true}).waitFor(); await assertParity();
  record('01', 'Created customer deal through Admin UI and opened the private link in a separate session');

  await admin.getByRole('button', {name: 'Edit Vehicle', exact: true}).click();
  await dialog.getByLabel('Engine', {exact: true}).selectOption('2.0'); await dialog.getByLabel('Fuel Type', {exact: true}).selectOption('Petrol');
  await dialog.getByLabel('Presentation Title', {exact: true}).fill('Example Demo Personalised Vehicle'); await dialog.getByLabel('Year', {exact: true}).fill('2020'); await dialog.getByLabel('Colour', {exact: true}).fill('Green');
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click());
  await waitFor(() => customer.getByRole('heading', {name: 'Example Demo Personalised Vehicle', exact: true}).isVisible(), 'Vehicle update did not synchronise');
  record('03', 'Vehicle details update automatically without reloading the link');

  await admin.getByRole('button', {name: 'Edit Vehicle Price', exact: true}).click();
  await dialog.getByLabel('Original vehicle price (£)', {exact: true}).fill('12000');
  await dialog.getByRole('switch', {name: 'Add VAT (20%)', exact: true}).check();
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click()); await assertParity();
  assert.equal(f.state().pricing.vat, true); record('04', 'VAT vehicle discount is identical in Admin, link, API and SQLite');

  async function addProduct(name, type, retail, price, vat = false) {
    await admin.locator('[data-section="products"]').getByRole('button', {name: '+ Add Product or Service', exact: true}).click();
    await dialog.getByLabel('Product name *', {exact: true}).fill(name); await dialog.getByLabel('Original retail price (£)', {exact: true}).fill(retail); await dialog.getByLabel('Priceless offer price (£)', {exact: true}).fill(price); await dialog.getByLabel('Item type', {exact: true}).selectOption(type);
    if (vat) await dialog.getByRole('switch', {name: 'Add VAT (20%)', exact: true}).check();
    await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click());
  }
  await addProduct('Mandatory Preparation', 'charged', '200', '150', true);
  await addProduct('Duplicate Extra', 'optional', '150', '100'); await addProduct('Duplicate Extra', 'optional', '300', '200');
  await addProduct('Free Valet', 'free', '75', '0');
  await waitFor(async () => await customer.getByRole('checkbox', {name: 'Duplicate Extra', exact: true}).count() === 2, 'Optional products did not appear');
  const selected = f.state().items.findLast(x => x.title === 'Duplicate Extra').id;
  await saved(customer, () => customer.getByRole('checkbox', {name: 'Duplicate Extra', exact: true}).nth(1).check()); await assertParity();
  assert.deepEqual(f.state().selectedIds, [selected]); record('05-09,12-13', 'Mandatory, FREE and independently selected duplicate-name optional products use consistent totals');

  const selectedCard = admin.locator('[data-item-id="' + selected + '"]');
  await saved(admin, () => selectedCard.getByRole('button', {name: 'Move Up', exact: true}).click()); await assertParity();
  await selectedCard.getByRole('button', {name: 'Edit', exact: true}).click();
  await dialog.getByLabel('Product name *', {exact: true}).fill('Renamed Selected Extra'); await dialog.getByLabel('Priceless offer price (£)', {exact: true}).fill('175');
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click());
  await waitFor(() => customer.getByRole('checkbox', {name: 'Renamed Selected Extra', exact: true}).isChecked(), 'Renamed selection was lost'); await assertParity();
  for (let i = 0; i < 3; i++) { await saved(customer, () => customer.getByRole('checkbox', {name: 'Renamed Selected Extra', exact: true}).uncheck()); await assertParity(); await saved(customer, () => customer.getByRole('checkbox', {name: 'Renamed Selected Extra', exact: true}).check()); await assertParity(); }
  record('07-10', 'Rename, price edits, reordering and repeated toggles preserve the permanent product identity');

  await customer.locator('details[data-key="vehicle-Additional Vehicle Details"] summary').click();
  await customer.locator('.composer textarea').fill('Unsaved customer draft');
  await admin.getByRole('button', {name: 'Edit Vehicle', exact: true}).click(); await dialog.getByLabel('Colour', {exact: true}).fill('Blue');
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click());
  await waitFor(() => customer.getByText('Blue', {exact: true}).isVisible(), 'Vehicle colour did not update');
  assert.equal(await customer.locator('.composer textarea').inputValue(), 'Unsaved customer draft'); assert.equal(await customer.locator('details[data-key="vehicle-Additional Vehicle Details"]').evaluate(e => e.open), true);
  assert.equal(navigations, 1); record('04-sync', 'Automatic updates preserve the open section and unsent message with no page reload');

  await customer.locator('details[data-key="warranty"] summary').click();
  await saved(customer, () => customer.getByRole('checkbox', {name: '3 Months Extended Warranty', exact: true}).check()); await assertParity();
  assert.equal(f.state().warranty.months, 3);
  await saved(customer, () => customer.getByRole('checkbox', {name: '6 Months Extended Warranty', exact: true}).check()); await assertParity();
  assert.equal(f.state().warranty.months, 6); assert.equal(await customer.getByRole('checkbox', {name: '3 Months Extended Warranty', exact: true}).isChecked(), false);
  record('14,16', 'Customer can select exactly one warranty period, change it and keep the page state');

  await admin.getByRole('button', {name: 'Configure / Review Warranty', exact: true}).click();
  await dialog.getByLabel('Dealer document or provider confirmation reference', {exact: true}).fill('Synthetic provider evidence for local test only');
  await dialog.getByRole('checkbox', {name: 'Provider eligibility and tariff verified against dealer documentation', exact: true}).check();
  await dialog.getByRole('checkbox', {name: 'Warranty tax treatment verified', exact: true}).check();
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click()); await assertParity();
  record('14-review', 'Warranty review is controlled by staff and records synthetic documentary verification');

  await saved(customer, () => customer.getByRole('button', {name: 'Send Message', exact: true}).click());
  await waitFor(() => admin.getByText('Unsaved customer draft', {exact: true}).isVisible(), 'Customer message did not arrive in Admin');
  await admin.locator('.composer textarea').fill('Synthetic reply from staff');
  await saved(admin, () => admin.getByRole('button', {name: 'Send Message', exact: true}).click());
  await waitFor(() => customer.getByText('Synthetic reply from staff', {exact: true}).isVisible(), 'Staff message did not reach customer');
  record('32', 'Messages synchronise in both directions and clear only after successful saving');

  await admin.getByRole('button', {name: 'Set Deposit Requested', exact: true}).click(); await dialog.getByLabel('Deposit requested (£)', {exact: true}).fill('200');
  const beforeDeposit = calculate(f.state()).outstandingPence;
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click()); assert.equal(calculate(f.state()).outstandingPence, beforeDeposit);
  await admin.getByRole('button', {name: 'Record Payment / Refund', exact: true}).click(); await dialog.getByLabel('Amount (£)', {exact: true}).fill('200'); await dialog.getByLabel('Payment reference', {exact: true}).fill('SYNTHETIC-ONLY'); await dialog.getByRole('checkbox', {name: 'I confirm this receipt or refund has actually occurred', exact: true}).check();
  await saved(admin, () => dialog.getByRole('button', {name: 'Save Changes', exact: true}).click()); await assertParity(); assert.equal(calculate(f.state()).outstandingPence, beforeDeposit - 20000);
  record('24', 'Requested deposit leaves the balance intact; recorded receipt reduces it');

  await saved(customer, () => customer.getByRole('button', {name: 'Confirm My Selection', exact: true}).click());
  const review = admin.locator('[data-section="review"]');
  for (const label of ['Customer details verified', 'Vehicle details verified', 'Package prices verified', 'VAT treatment verified', 'Payment arrangements agreed']) {
    await saved(admin, () => review.getByRole('checkbox', {name: label, exact: true}).check());
  }
  await waitFor(() => admin.getByRole('button', {name: 'Finalise & Lock', exact: true}).isEnabled(), 'Finalisation remained blocked');
  await saved(admin, () => admin.getByRole('button', {name: 'Finalise & Lock', exact: true}).click()); await assertParity(); assert.equal(f.state().locked, true);
  record('26,28-29', 'Customer confirmation and final staff review lock the exact offer version');

  await customer.evaluate(() => { window.print = () => {}; });
  await customer.getByRole('button', {name: 'Print Offer / Save PDF', exact: true}).click();
  const printText = await customer.locator('#printDocument').textContent();
  assert.ok(printText.includes('Finalised Offer')); assert.ok(printText.includes('Payments received after refunds')); assert.ok(printText.includes('Renamed Selected Extra')); assert.ok(!printText.includes('Duplicate Extra'));
  await customer.pdf({path: path.join(artifacts, 'final-offer.pdf'), format: 'A4', printBackground: true});
  record('34', 'Final print document uses the saved snapshot and excludes deselected products; PDF generated');

  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 390, 844]]) {
    for (const [role, page] of [['admin', admin], ['customer', customer]]) {
      await page.setViewportSize({width, height});
      const dimensions = await page.evaluate(() => ({scroll: document.documentElement.scrollWidth, viewport: innerWidth})); assert.ok(dimensions.scroll <= dimensions.viewport + 1, role + ' overflows at ' + width);
      assert.equal(await page.locator('#vehicleCard').getByText('Personalised vehicle price', {exact: true}).count(), 0);
      await page.screenshot({path: path.join(artifacts, role + '-' + name + '.png'), fullPage: true});
    }
  }
  assert.equal(errors.length, 0, errors.join('\n')); assert.equal(navigations, 1);
  record('35', 'Admin and customer layouts checked at desktop, tablet and mobile widths, without horizontal overflow or duplicated Vehicle Card prices');
  await customer.reload(); await assertParity(); assert.equal(f.state().locked, true);
  record('persist', 'Locked state, selected products and totals survive a full browser refresh');
  await writeFile(path.join(artifacts, 'browser-results.json'), JSON.stringify({results, errors, artifacts: ['final-offer.pdf', 'admin-desktop.png', 'customer-desktop.png', 'admin-tablet.png', 'customer-tablet.png', 'admin-mobile.png', 'customer-mobile.png']}, null, 2));
} catch (e) {
  await Promise.allSettled([admin.screenshot({path: path.join(artifacts, 'failure-admin.png'), fullPage: true}), customer.screenshot({path: path.join(artifacts, 'failure-customer.png'), fullPage: true})]);
  process.stderr.write(e.stack + '\n'); process.stderr.write('Page errors: ' + JSON.stringify(errors) + '\n'); process.exitCode = 1;
} finally { await browser.close(); await running.close(); }
