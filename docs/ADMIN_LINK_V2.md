# Priceless Finance Admin & Link V2

Implementation dated 25 November 2026. Production publication remains gated by authenticated checks against Cloudflare Access and the production D1 binding. A successful source commit or Worker compilation is not evidence of a live deployment.

## Scope

Only Customer Deals Admin, the private customer offer and their API are changed. Homepage, Showroom, Finance Application Form, public Finance Calculator, vehicle inventory administration and its API are not edited.

## Recovery point and branches

Original source commit: `609b0990faa5424fed3a17a3f140ccd6a518efe9`.

Remote restoration branch: `restore/admin-link-before-v2-20261125`.

Remote development branch: `codex/admin-link-v2-20261125`.

The original commit was the main branch head when work began. The public and staff production pages require independent verification; this head has not been asserted to be the deployed production version.

## Single calculation model

`assets/deal-engine.js` is imported by the API and both interfaces. All new monetary inputs are integer pence. VAT is 20% of each discounted net line, rounded once per line. FREE and INCLUDED items have zero charge. Only active items contribute to the price and savings. Payment deductions and PX deductions never reduce the VAT base. Existing gross prices are retained exactly during legacy migration, including values whose net-to-gross round trip would otherwise move by a penny.

`totalPurchasePence` is the gross vehicle and selected product purchase price. `outstandingPence` is the purchase price less accepted positive net PX allowance and confirmed net receipts, plus separately reviewed and agreed negative equity. A requested deposit does not count as a receipt. Refunds cannot exceed net recorded receipts. The payment ledger is append only; corrections use refunds or additional entries. Payment records do not execute financial transactions.

An unknown PX settlement remains `null`. PX acceptance is blocked until finance existence and settlement are known. Any new valuation gets a new ID and invalidates acceptance and negative equity agreement. Physical inspection is required before final lock when PX is used. The three-system/HPI claim appears only when staff explicitly record that those checks occurred.

## Identifiers, versions and concurrency

Products have permanent IDs. Every write uses an integer `version` and a database compare-and-swap. The state update, audit entry, compatibility projection and final snapshot execute in one D1 batch transaction. Conditional writes use a unique mutation identifier, so a losing concurrent request cannot create phantom history or a snapshot. The API returns HTTP 409 for stale writes and HTTP 428 for missing versions. The existing inventory admin's idempotent publish/unpublish/revoke controls remain compatible without changing that page.

`packageVersion` identifies the actual customer package. Customer confirmation records both that package version and the offer version on which confirmation occurred. Messages, read markers and payment receipt records can advance the offer version without invalidating the agreed product package. Material customer, vehicle, item, warranty or PX changes invalidate confirmation and the appropriate staff checks. Reordering products alone preserves confirmation. For the same warranty period and vehicle category, an unchanged or lower warranty price carries the existing confirmation with its provenance; a price increase or period change requires the general Confirm My Selection action.

Both interfaces poll every four seconds while visible. Sections update without page reload. Message drafts and modal editors remain in place. A remote update preserves an open editor's draft and the API rejects a stale save. Open details sections are restored after updates. A message composer clears only after a successful save.

## Authentication and information boundaries

Staff endpoints verify a signed RS256 Cloudflare Access token against the configured team issuer and audience, expiry and not-before time. Public customers use a random 256-bit link token, looked up by SHA-256. Price, VAT, payment ledger, vehicle and review fields are not writable through customer requests. Cross-origin JSON mutations are rejected. Staff-only history, review checks, supplier evidence and internal payment references are excluded from public responses. No real credentials or customer data are included in tests or source.

The existing Cloudflare Access applications and D1 `DB` binding must remain in place. No policy weakening or new public staff access is required. The local test harness signs synthetic test tokens and does not add any authentication bypass to deployed API code.

## Database additions and legacy preservation

New tables:

| Table | Purpose |
| --- | --- |
| private_offer_v2 | Current structured state, version and compare-and-swap mutation ID |
| private_offer_v2_events | Actor, authenticated staff identity, date, before/after state and action |
| private_offer_v2_snapshots | Immutable full finalised versions and calculation results |
| private_offer_v2_backups | Original offer row, event history, customer submissions and source vehicle before conversion |

Existing tables remain. Missing existing compatibility columns are added idempotently. Before converting an offer, its original row, events, submissions and vehicle are saved transactionally. The old token hash and recoverable share token remain unchanged. Existing index selections are assigned deterministic IDs for their exact current products. Duplicate legacy names or invalid index references are marked for staff review; finalisation cannot silently approve an ambiguous legacy selection. An existing locked offer stays locked and receives a preserved legacy snapshot.

After a V2 write the existing offer row receives a compatibility projection of the current customer, vehicle, items, gross prices, selected indexes and technical status. New messages and customer confirmations are also preserved in their existing tables. Advanced V2 ledgers, detailed history and snapshots remain in the V2 tables even during source rollback. Initial list migration is bounded to four legacy offers per request to respect D1 query budgets. Existing V2 state is loaded by a join.

`GET /api/private-offers?export=backup` is authenticated and exports the offer-related tables. It contains confidential records and secure share links and must be kept privately. This is an application backup, not a substitute for a native full D1 export or Time Travel bookmark before production migration.

## Warranty evidence and commercial limits

The central estimate configuration retains the instructed tariffs:

| Period | Standard | Special |
| --- | ---: | ---: |
| 3 months | £181.00 | £271.50 |
| 6 months | £199.00 | £298.50 |
| 12 months | £498.00 | £747.00 |
| 24 months | £698.00 | £1,047.00 |

The estimate classifies up to 2.5 L inclusive as Standard unless a configured special category applies. Over 2.5 L, 4x4/AWD, commercial, luxury, performance, taxi/private hire and electric/hybrid use the Special estimate once. All four quoted periods update together when the category changes. VAT defaults off.

Reviewed primary sources on 25 November 2026:

* https://momentumwarranties.co.uk/dealer-plans/
* https://momentumwarranties.co.uk/become-a-momentum-dealer/

Those public pages describe bespoke dealer plans and include EV/hybrid cover but do not establish the quoted dealer tariffs, the 2.5 L surcharge boundary or the tax treatment for this dealership's product. Therefore these rules remain estimates. Finalisation with a selected warranty requires staff to record actual supplier documentary evidence and confirm tax treatment. No supplier confirmation is fabricated.

## Final review and print

Finalise & Lock requires current customer package confirmation and all applicable customer, vehicle, price, VAT, warranty, PX and payment arrangement checks. These checks run in both UI and API. All financial and vehicle editors, customer selections and messages reject writes after lock. Staff can unpublish/revoke a locked link and can unlock with a recorded reason. Unlock preserves previous snapshots and requires renewed customer confirmation.

The print view uses the full saved snapshot for a locked offer, including its version, totals and status. An unlocked offer is labelled Provisional Offer. Deselected products are excluded from document totals and selected-item lists. Print CSS supports A4 and the browser's Save as PDF function. A real browser/PDF layout check must still be executed; DOM content assertions alone are insufficient.

## Reproducible checks

Use Node 24 or newer for the local SQLite test adapter. Production Pages code does not import Node-only test utilities.

```sh
npm ci
npm test
npm run test:dom
npx playwright install chromium
npm run test:browser
```

`test` exercises the real Pages handlers, a SQLite-backed D1 adapter and real synthetic RS256 signatures. `test:dom` executes both UI modules in separate isolated DOM contexts without network access, comparing their financial displays to the API and SQLite state. It does not verify actual CSS rendering. `test:browser` is the separate two-context Chromium scenario, including desktop/tablet/mobile and PDF generation. `V2_CHROMIUM` can select an installed test browser. The default artifact directory is `/tmp/priceless-v2-evidence`.

Production functions can be compiled independently:

```sh
CLOUDFLARE_SEND_METRICS=false npx wrangler pages functions build functions --outdir /tmp/priceless-v2-functions
```

Official D1 semantics verified: https://developers.cloudflare.com/d1/worker-api/d1-database/ . A D1 batch is a transaction and aborts or rolls back if a statement fails.

## Production continuation

1. Authenticate Cloudflare Access for Priceless Finance Admin and identify the actual production deployment commit.
2. Inspect the production D1 schema and create a native backup or Time Travel bookmark, plus an application export.
3. Confirm preview and production D1 bindings, keeping synthetic tests separate from real customer offers.
4. Complete the real two-session browser tests and all required financial cases on synthetic offers. Inspect desktop, tablet, mobile and PDF output. Review any legacy migration warnings.
5. Recheck the production branch for concurrent changes. Integrate the V2 branch only after critical checks pass.
6. Observe Cloudflare Pages successful deployment for the exact integrated SHA. Verify the actual staff and customer URLs against API and D1 values. A GitHub commit is insufficient.
7. Archive only synthetic test deals created for this work. Retain one clearly labelled synthetic review link if required by the owner.

## Rollback

Before rollout retain the original production deployment ID, D1 recovery bookmark/export and restoration branch. To roll back, use Cloudflare Pages' existing deployment rollback to the verified original deployment or create a source revert from the restoration commit. Do not force-reset an active production branch or overwrite subsequent unrelated work.

Keep the V2 tables, backups and snapshot history. Original per-offer rows can be recovered from `private_offer_v2_backups`, but restoration must be reviewed against any transactions made after migration. Restoring an old database over newer receipts or customer activity would lose those changes. Advanced V2 payment deductions are not represented by the old V1 calculator; put affected negotiations on hold while rolling back, reconcile the saved ledger and restore the corresponding data deliberately. Never delete the new tables as a routine rollback step.
