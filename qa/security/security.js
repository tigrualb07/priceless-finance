const form=document.querySelector('#test'),output=document.querySelector('#result');
form.addEventListener('submit',async event=>{
event.preventDefault();form.querySelector('button').disabled=true;
const results=[];const render=()=>output.textContent=JSON.stringify(results,null,2);
const check=(name,pass,detail)=>{results.push({name,result:pass?'PASS':'FAIL',...detail});render();if(!pass)throw Error(name);};
try{
if(!location.hostname.endsWith('.priceless-finance.pages.dev'))throw Error('Separate Preview hostname required');
const values=new FormData(form),id=values.get('id'),token=values.get('token'),publicURL='/api/private-offers?token='+encodeURIComponent(token);
const initialResponse=await fetch(publicURL);const initial=await initialResponse.json();
if(!initialResponse.ok||initial.deal.id!==id||initial.deal.customer.name!=='V2 TEST CUSTOMER')throw Error('Only the existing synthetic test offer is allowed');
const before={version:initial.deal.version,pricing:initial.deal.pricing,selectedIds:initial.deal.selectedIds,total:initial.calculation.outstandingPence};
check('Synthetic Preview fixture verified',true,{before});
for(const attempt of [
{name:'Customer cannot set vehicle pricing',status:403,payload:{action:'pricing',pricing:{offerNetPence:1,originalNetPence:1,vat:false}}},
{name:'Selection cannot carry a forged price',status:400,payload:{action:'selection',selectedIds:initial.deal.selectedIds,price:0}},
{name:'Selection cannot carry a forged product ID',status:400,payload:{action:'selection',selectedIds:['00000000-0000-4000-8000-000000000000']}}
]){
const r=await fetch('/api/private-offers',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({token,version:initial.deal.version,...attempt.payload})});
const body=await r.json();check(attempt.name,r.status===attempt.status,{status:r.status,message:body.error});
}
const unauth=await fetch('/api/private-offers?id='+encodeURIComponent(id),{credentials:'omit',redirect:'manual'});
check('Access blocks staff API without session',unauth.type==='opaqueredirect'||[401,403].includes(unauth.status),{status:unauth.status,type:unauth.type});
const afterResponse=await fetch(publicURL),after=await afterResponse.json();
const actual={version:after.deal.version,pricing:after.deal.pricing,selectedIds:after.deal.selectedIds,total:after.calculation.outstandingPence};
check('Rejected requests preserve persisted version, pricing and selections',JSON.stringify(before)===JSON.stringify(actual),{after:actual});
check('Public response excludes staff activity',!('activity' in after)&&!('legacyActivity' in after)&&!('finalIssues' in after),{});
output.textContent=JSON.stringify({result:'PASS',results},null,2);
}catch(error){results.push({result:'FAIL',message:error.message});render();}
finally{form.querySelector('button').disabled=false;}
});
