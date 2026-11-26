import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function originalUI(f,staff=true){
 const route=staff?'admin/offers/index.html':'offer/index.html',html=await readFile(path.join(root,route),'utf8');
 const url='https://example.invalid/'+(staff?'admin/offers/?deal='+f.id:'offer/?token='+f.token);
 const dom=new JSDOM(html,{url,pretendToBeVisual:true}),w=dom.window,intervals=[];let pending=0;
 w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 const context=vm.createContext({window:w,document:w.document,location:w.location,history:w.history,navigator:w.navigator,sessionStorage:w.sessionStorage,Option:w.Option,FormData:w.FormData,URL,URLSearchParams,Intl,Date,crypto,structuredClone,console,confirm:()=>true,alert:()=>{},setTimeout,clearTimeout,setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval:()=>{},fetch:async(url,options={})=>{
  pending++;try{
   if(String(url).startsWith('/api/vehicles'))return Response.json({vehicles:f.database.prepare('SELECT * FROM vehicles').all().map(v=>({...v,price:v.retail_price,fuel:v.fuel_type,gearbox:v.transmission}))});
   const method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
   if(body&&['PUT','PATCH'].includes(method)&&body.revision===undefined)body.revision=null;
   const result=await f.request(method,body,staff,new URL(url,'https://example.invalid').search);return Response.json(result.data,{status:result.status});
  }finally{pending--;}
 }});
 const modules=new Map();async function load(file){file=file.split('?')[0];if(modules.has(file))return modules.get(file);const mod=new vm.SourceTextModule(await readFile(file,'utf8'),{context,identifier:file});modules.set(file,mod);await mod.link(spec=>load(spec.startsWith('/')?path.join(root,spec):path.resolve(path.dirname(file),spec)));return mod;}
 const code=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
 const mod=new vm.SourceTextModule(code,{context,identifier:path.join(root,route)});await mod.link(spec=>load(path.join(root,spec)));await mod.evaluate();
 const idle=async()=>{for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,2));if(!pending)return;}throw Error('Original UI did not finish its requests');};await idle();
 return {w,doc:w.document,idle,poll:async()=>{for(const fn of intervals)await fn();await idle()},close:()=>w.close(),input:(node,value)=>{if(node.type==='checkbox')node.checked=value;else node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}
