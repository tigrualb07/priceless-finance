import {balanceLines} from './offer-calculation.js';

export const OFFER_PRINT_CSS=`
#offerDocument{display:none}
@page{size:A4 portrait;margin:13mm 12mm}
@media print{
 html,body{height:auto!important;overflow:visible!important;background:white!important}
 body>*:not(#offerDocument){display:none!important}
 #offerDocument{display:block!important;color:#193425;font:10pt/1.35 Arial,sans-serif}
 #offerDocument *{box-sizing:border-box}
 #offerDocument header{display:flex!important;justify-content:space-between;gap:12mm;background:white!important;color:#193425!important;padding:0 0 5mm;border-bottom:2px solid #8fbf70}
 #offerDocument header img{width:43mm;height:17mm;object-fit:contain}
 #offerDocument h1{font-size:18pt;margin:0 0 2mm}#offerDocument h2{font-size:12pt;margin:5mm 0 2mm}
 #offerDocument p{margin:1.5mm 0;white-space:pre-wrap;overflow-wrap:anywhere}
 #offerDocument table{width:100%;border-collapse:collapse;font-size:9pt}
 #offerDocument th,#offerDocument td{padding:2mm;border-bottom:1px solid #d7e4d7;text-align:left;vertical-align:top;overflow-wrap:anywhere}
 #offerDocument td:last-child,#offerDocument th:last-child{text-align:right}
 #offerDocument thead{display:table-header-group}#offerDocument tr{break-inside:avoid}
 #offerDocument .document-grid{display:grid;grid-template-columns:1fr 1fr;gap:8mm}
 #offerDocument .document-total{font-size:15pt;font-weight:bold;border-top:2px solid #8fbf70;padding-top:3mm;display:flex;justify-content:space-between;gap:5mm;break-inside:avoid}
 #offerDocument .document-small{font-size:8pt;color:#52685a}#offerDocument section{break-inside:auto}
 #offerDocument footer{font-size:7pt;overflow-wrap:anywhere;border-top:1px solid #d7e4d7;margin-top:6mm;padding-top:2mm}
}`;
const money=pence=>Number(pence/100).toLocaleString('en-GB',{style:'currency',currency:'GBP'});
const stamp=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Europe/London'}):'';
export function prepareOfferDocument(model,doc=document){
 let root=doc.getElementById('offerDocument');if(!root){root=doc.createElement('article');root.id='offerDocument';doc.body.append(root)}root.replaceChildren();
 if(!doc.getElementById('offerDocumentStyles')){const style=doc.createElement('style');style.id='offerDocumentStyles';style.textContent=OFFER_PRINT_CSS;doc.head.append(style)}
 const final=model.finalAgreement,content=final?.content||model.content,c=content.calculation;
 const el=(tag,text)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);return node};
 const add=(root,tag,text,cls)=>{const n=el(tag,text);if(cls)n.className=cls;root.append(n);return n};
 const header=add(root,'header'),branding=add(header,'div'),logo=add(branding,'img');logo.src='/assets/Priceless%20Auto%20Services%20Logo.png';logo.alt='Priceless Auto Services';add(branding,'p','PRICELESS AUTO SERVICES LTD');add(branding,'p','pricelessfinance.co.uk','document-small');const title=add(header,'div');add(title,'h1',final?'FINAL AGREED OFFER':'PROVISIONAL OFFER');add(title,'p',final?'Reference '+final.reference:'Subject to customer confirmation');add(title,'p',final?'Locked '+stamp(final.lockedAt)+' UK':'Prepared '+stamp(model.preparedAt||new Date().toISOString())+' UK','document-small');
 const grid=add(root,'div',undefined,'document-grid'),customer=add(grid,'section');add(customer,'h2','Customer');for(const value of [content.customer.name,content.customer.phone,content.customer.email])if(value)add(customer,'p',value);const vehicle=add(grid,'section');add(vehicle,'h2','Vehicle');const v=content.vehicle;add(vehicle,'p',v.title||[v.make,v.model].filter(Boolean).join(' '));add(vehicle,'p',v.registration||'');
 const specs=[['Make',v.make],['Model',v.model],['Year',v.year],['Mileage',v.mileage],['Fuel',v.fuel],['Transmission',v.gearbox],['Engine',v.engine],['Seats',v.seats],['Doors',v.doors],['Colour',v.colour],['Body type',v.bodyType],['Service history',v.serviceHistory],['Keys',v.keys],['MOT expiry',v.motExpiry],['Road tax',v.roadTax],['Previous keepers',v.previousKeepers],['Timing system',v.cambelt],['Last service',v.lastService],['Last work',v.lastWork]];
 const table=(headers,rows)=>{const t=add(root,'table'),head=add(t,'thead'),hr=add(head,'tr');for(const h of headers)add(hr,'th',h);const body=add(t,'tbody');for(const values of rows){const tr=add(body,'tr');for(const value of values)add(tr,'td',value)}return t};
 table(['Specification','Details'],specs.filter(([,value])=>value!==null&&value!==undefined&&String(value).trim()!==''));
 if(v.description){add(root,'h2','Vehicle description');add(root,'p',v.description)}
 add(root,'h2','Agreed products and prices');const rows=[['Vehicle',content.vehicleVat?'VAT included':'Gross price',money(c.vehicle.grossPence),money(c.vehicle.vatPence)]];
 for(const line of c.lines.filter(x=>x.active)){const mode=line.type==='included'?'Included':line.type==='free'?'FREE':line.extraMode==='required'?'Mandatory':line.type==='optional'||line.type==='offered'?'Optional selected':'Charged';rows.push([line.title+(line.description?'\n'+line.description:''),mode+(line.savingsPence?'\nSaving '+money(line.savingsPence):''),['included','free'].includes(line.type)?mode:money(line.grossPence),line.vat?money(line.vatPence):'']);}
 const w=content.warranty;if(w?.months)rows.push([w.months+' Months Extended Warranty · '+(w.category||'Category awaiting review'),w.status==='confirmed'?'Confirmed':w.status==='review'?'Estimate':'Awaiting customer reconfirmation',c.warrantyAmount===0?'FREE':money(Math.round(c.warrantyAmount*100)),w.vat?money(Math.round(c.warrantyAmount*100)-Math.round(c.warrantyAmount*100/1.2)):'']);
 table(['Product','Treatment','Gross charge','VAT included'],rows);
 if(w?.months){add(root,'p',w.taxConfirmed?'Warranty tax treatment: '+w.taxTreatment+'. Provider: '+w.provider+'. Evidence: '+w.taxEvidence:'Warranty tax treatment requires provider evidence.','document-small');}
 const px=content.valuation;if(px){add(root,'h2','Part exchange');add(root,'p',(px.registration||'')+' · '+px.status);if(px.status==='accepted'){table(['Valuation','Settlement','Net allowance'],[[money(Math.round(px.value*100)),money(Math.round(px.settlement*100)),money(Math.round(px.net*100))]]);if(px.net<0)add(root,'p','Separate negative equity agreement: '+px.negativeEquityExplanation);}}
 add(root,'h2','Payment summary');table(['Description','Amount'],balanceLines(c).map(([label,pence])=>[label,money(pence)]));add(root,'p','Total savings: '+money(c.savingsPence));const total=add(root,'div',undefined,'document-total');add(total,'span',c.totalPence<0?'Amount overpaid':'Balance remaining');add(total,'strong',money(Math.abs(c.totalPence)));
 if(content.payments?.length){add(root,'h2','Recorded payments and refunds');table(['Date and record','Method and reference','Amount'],content.payments.map(x=>[stamp(x.receivedAt)+' UK\n'+x.kind,x.method+' · '+x.reference,money(x.amountPence)]));}
 if(final){const footer=add(root,'footer');add(footer,'p','Customer confirmed package '+final.confirmationRevision+'. Final agreement '+final.reference+'.');add(footer,'p','Agreement integrity reference: '+final.hash);}
 else add(root,'footer','Provisional offer. The saved agreement will be issued after the current package is confirmed and finalised.');
 return root;
}
export function printOfferDocument(model){const root=prepareOfferDocument(model);window.print();return root}
