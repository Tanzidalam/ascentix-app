import { useState, useEffect, useRef } from "react";

const FB_API_KEY = "AIzaSyAhz84dlb1A-oCLOX-Vm1fRqKBNj1s4mh8";
const FB_DB      = "https://ascentix-51271-default-rtdb.firebaseio.com";
const FB_EMAIL   = "service@ascentix.com";
const FB_PASS    = "AscentixService2025!";
let _fbToken = null, _fbExpiry = 0;

const SKEY_LOCAL = "ascentix-v6";

async function getFBToken() {
  if (_fbToken && Date.now() < _fbExpiry) return _fbToken;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FB_API_KEY}`,
      { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ email:FB_EMAIL, password:FB_PASS, returnSecureToken:true }) });
    const d = await r.json();
    if (!d.idToken) return null;
    _fbToken = d.idToken; _fbExpiry = Date.now() + 55*60*1000;
    return _fbToken;
  } catch { return null; }
}

const SAMPLE = {
  groups:[{ id:"g1", name:"ZIC", contactName:"", email:"", phone:"", notes:"" }],
  llcs:[{ id:"l1", name:"Pineview Property Care LLC", state:"VA", owner:"", email:"", model:"owner", ar:30, or:70, groupId:"g1", active:true, mgmtFeeType:"pct_rev", mgmtFeeValue:8 }], jobs:[], ins:[], usaExp:[], bdExp:[],
  capital:[], receipts:[], llcPayments:[], employees:[], payroll:[], bonusPool:[],
  users:[{ id:"usr1", username:"admin", password:"admin123", role:"admin", name:"Ascentix Admin", email:"admin@ascentix.com.bd", llcId:null, groupId:null }],
  settings:{ xRate:110, reportEmail:"" }
};

function toArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return Object.values(v);
}

async function dbLoad() {
  try {
    const token = await getFBToken();
    const url = token ? `${FB_DB}/data.json?auth=${token}` : `${FB_DB}/data.json`;
    const r = await fetch(url);
    const d = await r.json();
    if (!d || d.error) return SAMPLE;
    // Normalize arrays (Firebase may return objects)
    const norm = {};
    for (const k of Object.keys(SAMPLE)) norm[k] = k==="settings" ? (d[k]||SAMPLE.settings) : toArr(d[k]);
    // Ensure admin always exists
    if (!norm.users.some(u=>u.username==="admin")) norm.users.unshift(SAMPLE.users[0]);
    return norm;
  } catch { return SAMPLE; }
}

async function dbSave(d) {
  try {
    const token = await getFBToken();
    const url = token ? `${FB_DB}/data.json?auth=${token}` : `${FB_DB}/data.json`;
    await fetch(url, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(d) });
  } catch {}
}

// ── Formatters ───────────────────────────────────────
const fmt$ = n => "$"+Number(n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtBDT = n => "৳"+Number(n||0).toLocaleString();
const fmtDate = d => d ? new Date(d+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "—";
const fmtMonth = (y,m) => new Date(y,m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"});
let _c = Date.now();
const uid = () => (_c++).toString(36);

// ── Payroll ──────────────────────────────────────────
const BD_TAX_SLABS=[[350000,0],[100000,0.05],[300000,0.10],[400000,0.15],[500000,0.20],[Infinity,0.25]];
function calcBDTax(a){let t=0,r=Math.max(0,a);for(const[l,p]of BD_TAX_SLABS){if(r<=0)break;const c=Math.min(r,l);t+=c*p;r-=c;}return Math.round(t);}
function calcPayslip(emp){
  const gross=(emp.basicSalary||0)+(emp.houseRent||0)+(emp.medical||0)+(emp.transport||0);
  const pfE=Math.round((emp.basicSalary||0)*((emp.pfRate||10)/100));
  const pfER=Math.round((emp.basicSalary||0)*((emp.pfEmployerRate||10)/100));
  const tax=Math.round(calcBDTax(gross*12-pfE*12)/12);
  return{gross,pfEmployee:pfE,pfEmployer:pfER,incomeTax:tax,totalDeductions:pfE+tax,netSalary:gross-pfE-tax,
    basicSalary:emp.basicSalary||0,houseRent:emp.houseRent||0,medical:emp.medical||0,transport:emp.transport||0};
}

// ── LLC P&L ──────────────────────────────────────────
function calcLLCPL(llc,jobs,ins,usaExp,ym){
  const mj=jobs.filter(j=>j.llcId===llc.id&&(!ym||j.date.startsWith(ym)));
  const revenue=mj.reduce((s,j)=>s+j.amount,0);
  const jobCosts=mj.reduce((s,j)=>s+(j.vendors||[]).reduce((vs,v)=>vs+v.payments.reduce((ps,p)=>ps+p.amount,0),0),0);
  const insInst=ins.filter(i=>{if(i.llcId!==llc.id||!ym)return false;const st=new Date(i.start+"T00:00:00");const from=new Date(st.getFullYear(),st.getMonth()+1,1);const to=new Date(st.getFullYear(),st.getMonth()+1+i.months,1);const ch=new Date(+ym.slice(0,4),+ym.slice(5,7)-1,1);return ch>=from&&ch<to;}).reduce((s,i)=>s+i.monthly,0);
  const insAdv=ins.filter(i=>i.llcId===llc.id&&(!ym||i.start.startsWith(ym))).reduce((s,i)=>s+i.advance,0);
  const usaOps=usaExp.filter(e=>e.llcId===llc.id&&(!ym||e.date.startsWith(ym))).reduce((s,e)=>s+e.amount,0);
  let mgmtFee=0;
  if(llc.mgmtFeeType==="fixed") mgmtFee=ym?llc.mgmtFeeValue:0;
  else if(llc.mgmtFeeType==="pct_rev") mgmtFee=revenue*(llc.mgmtFeeValue/100);
  else if(llc.mgmtFeeType==="pct_profit"){const pre=revenue-jobCosts-insInst-insAdv-usaOps;mgmtFee=Math.max(0,pre*(llc.mgmtFeeValue/100));}
  const totalExp=jobCosts+insInst+insAdv+usaOps+mgmtFee;
  const op=revenue-totalExp;
  return{revenue,jobCosts,insInstallment:insInst,insAdvance:insAdv,usaOps,mgmtFee:+mgmtFee.toFixed(2),
    totalExpenses:+totalExp.toFixed(2),operatingProfit:+op.toFixed(2),
    ascentixEquityShare:+(op*(llc.ar||0)/100).toFixed(2),ownerShare:+(op*(llc.or||0)/100).toFixed(2),jobCount:mj.length};
}

// ── AR helpers ───────────────────────────────────────
const jobTotalPaid=j=>(j.vendors||[]).reduce((s,v)=>s+v.payments.reduce((ps,p)=>ps+p.amount,0),0);
const vendorTotalPaid=v=>v.payments.reduce((s,p)=>s+p.amount,0);
const jobAmtRcv=(jid,recs)=>(recs||[]).reduce((s,r)=>s+r.allocations.filter(a=>a.jobId===jid).reduce((a2,a)=>a2+a.amount,0),0);
const arStatus=(job,recs)=>{const r=jobAmtRcv(job.id,recs);if(r<=0)return"unpaid";if(r>=job.amount)return"paid";return"partial";};

const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
const DEPTS=["Operations","Finance","Technology","Admin","HR","Sales","Other"];
const PMETH=["Bank Transfer","Cash","Cheque","Mobile Banking"];
const PAY_TYPES=["Monthly Management Fee","Service Fee","Profit Sharing"];
const PAY_METHODS=["ACH","Check","Wire","Zelle","Credit Card","Cash","Other"];

// ── Design ───────────────────────────────────────────
const C={bg:"#f5f7fa",card:"#ffffff",border:"#e4e8ef",borderMid:"#cdd4e0",text:"#111827",textMid:"#4b5563",textMuted:"#9ca3af",indigo:"#4f46e5",indigoBg:"#eef2ff",indigoText:"#3730a3",indigoBorder:"#c7d2fe",green:"#059669",greenBg:"#d1fae5",greenText:"#065f46",amber:"#d97706",amberBg:"#fef3c7",amberText:"#92400e",red:"#dc2626",redBg:"#fee2e2",redText:"#991b1b",blue:"#0284c7",blueBg:"#dbeafe",blueText:"#1e40af",teal:"#0d9488",tealBg:"#ccfbf1",tealText:"#134e4a",gray:"#6b7280",grayBg:"#f3f4f6",grayText:"#374151",purple:"#7c3aed",purpleBg:"#ede9fe",purpleText:"#4c1d95"};
const card={background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"20px",marginBottom:"16px"};
const th={padding:"9px 12px",background:C.grayBg,color:C.textMid,fontWeight:500,fontSize:"12px",borderBottom:`1px solid ${C.border}`,textAlign:"left",whiteSpace:"nowrap"};
const td={padding:"9px 12px",borderBottom:`1px solid ${C.bg}`,color:C.text,fontSize:"13px",verticalAlign:"top"};
const inp={padding:"7px 10px",border:`1px solid ${C.border}`,borderRadius:"6px",fontSize:"13px",color:C.text,outline:"none",width:"100%",background:"#fff",boxSizing:"border-box"};
const sel={...inp,cursor:"pointer"};
const btnP={padding:"8px 16px",border:"none",borderRadius:"6px",background:C.indigo,color:"#fff",cursor:"pointer",fontSize:"13px",fontWeight:500};
const btnS={padding:"5px 12px",border:`1px solid ${C.border}`,borderRadius:"5px",background:"#fff",cursor:"pointer",fontSize:"12px",color:C.textMid};
const btnD={...btnS,borderColor:"#fca5a5",color:C.red};
const bMap={indigo:{bg:C.indigoBg,c:C.indigoText},green:{bg:C.greenBg,c:C.greenText},amber:{bg:C.amberBg,c:C.amberText},red:{bg:C.redBg,c:C.redText},blue:{bg:C.blueBg,c:C.blueText},teal:{bg:C.tealBg,c:C.tealText},gray:{bg:C.grayBg,c:C.grayText},purple:{bg:C.purpleBg,c:C.purpleText}};
const badge=col=>{const m=bMap[col]||bMap.gray;return{display:"inline-block",padding:"2px 8px",borderRadius:"20px",fontSize:"11px",fontWeight:500,background:m.bg,color:m.c};};

// ── UI Primitives ─────────────────────────────────────
function Field({label,children}){return <div style={{display:"flex",flexDirection:"column",gap:"4px"}}><label style={{fontSize:"12px",color:C.textMid,fontWeight:500}}>{label}</label>{children}</div>;}
function G2({children}){return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>{children}</div>;}
function G3({children}){return <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px"}}>{children}</div>;}
function Empty({msg}){return <div style={{textAlign:"center",padding:"36px",color:C.textMuted,fontSize:"13px"}}>{msg}</div>;}
function PLRow({label,val,indent=0,bold=false,color,separator=false,note}){
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:`${bold?"7":"5"}px 0`,borderBottom:separator?`2px solid ${C.borderMid}`:`1px solid ${C.bg}`,paddingLeft:indent*16,marginTop:separator?"4px":0}}>
    <span style={{fontSize:"13px",color:indent?C.textMid:C.text,fontWeight:bold?600:400}}>{label}{note&&<span style={{fontSize:"11px",color:C.textMuted,marginLeft:"6px"}}>({note})</span>}</span>
    <span style={{fontSize:"13px",fontWeight:bold?600:400,color:color||(bold?C.text:C.textMid)}}>{val}</span>
  </div>;}
function SectionLabel({children}){return <div style={{fontSize:"10px",color:C.textMuted,fontWeight:600,padding:"8px 10px 2px",textTransform:"uppercase",letterSpacing:"0.6px"}}>{children}</div>;}
function AddBox({children,onCancel,onSave,saveLabel="Save"}){
  return <div style={{background:C.indigoBg,border:`1px solid ${C.indigoBorder}`,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>{children}</div>
    <div style={{display:"flex",gap:"8px",marginTop:"14px"}}><button style={btnP} onClick={onSave}>{saveLabel}</button><button style={btnS} onClick={onCancel}>Cancel</button></div>
  </div>;}
function Toast({toast}){
  if(!toast)return null;
  return <div style={{position:"fixed",bottom:"20px",right:"20px",padding:"10px 16px",background:toast.type==="error"?C.redBg:C.greenBg,color:toast.type==="error"?C.redText:C.greenText,border:`1px solid ${toast.type==="error"?"#fca5a5":"#6ee7b7"}`,borderRadius:"8px",fontSize:"13px",fontWeight:500,zIndex:9999,boxShadow:"0 2px 12px rgba(0,0,0,.1)"}}>
    {toast.type==="error"?"✕ ":"✓ "}{toast.msg}
  </div>;}
function NavBtn({n,nav,setNav}){
  return <button onClick={()=>setNav(n.id)} style={{display:"flex",alignItems:"center",gap:"7px",padding:"7px 10px",borderRadius:"6px",border:"none",background:nav===n.id?C.indigoBg:"transparent",color:nav===n.id?C.indigo:C.textMid,cursor:"pointer",fontSize:"13px",fontWeight:nav===n.id?600:400,textAlign:"left",marginBottom:"1px",width:"100%"}}>
    <span>{n.icon}</span>{n.label}
  </button>;}

// ══════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════
function Dashboard({data}){
  const now=new Date(), ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const xRate=data.settings.xRate||110;
  const llcPLs=data.llcs.map(llc=>({llc,pl:calcLLCPL(llc,data.jobs,data.ins,data.usaExp,ym)}));
  const totalMgmt=llcPLs.reduce((s,{pl})=>s+pl.mgmtFee,0);
  const totalEq=llcPLs.reduce((s,{pl})=>s+pl.ascentixEquityShare,0);
  const bdUSD=data.bdExp.filter(e=>e.date.startsWith(ym)).reduce((s,e)=>s+e.amount,0)/xRate;
  const axNet=totalMgmt+totalEq-bdUSD;
  return <div>
    <div style={{marginBottom:"20px"}}><div style={{fontSize:"20px",fontWeight:700,color:C.text}}>Overview</div><div style={{fontSize:"13px",color:C.textMuted}}>Current month · {fmtMonth(now.getFullYear(),now.getMonth()+1)}</div></div>
    <div style={{...card,borderLeft:`4px solid ${C.indigo}`,marginBottom:"16px"}}>
      <div style={{fontSize:"12px",fontWeight:600,color:C.indigoText,marginBottom:"12px",textTransform:"uppercase",letterSpacing:"0.5px"}}>Ascentix Entity — This Month</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px"}}>
        {[{l:"Management Fee Income",v:fmt$(totalMgmt),c:C.purple},{l:"Equity Profit Shares",v:fmt$(totalEq),c:C.indigo},{l:"BD Operational Costs",v:fmt$(bdUSD),c:C.red},{l:"Net Ascentix Profit",v:fmt$(axNet),c:axNet>=0?C.green:C.red}].map((s,i)=>
          <div key={i} style={{background:C.grayBg,borderRadius:"8px",padding:"12px 14px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"19px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
        )}
      </div>
    </div>
    <div style={card}>
      <div style={{fontSize:"15px",fontWeight:600,color:C.text,marginBottom:"14px"}}>LLC Entities — This Month</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{["LLC","Group","Revenue","Direct Costs","Mgmt Fee","Oper. Profit","Owner Share","Ascentix Equity"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {llcPLs.map(({llc,pl})=>{const grp=data.groups.find(g=>g.id===llc.groupId);return <tr key={llc.id}>
            <td style={{...td,fontWeight:500,maxWidth:"130px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{llc.name}</td>
            <td style={{...td,fontSize:"12px",color:C.textMid}}>{grp?.name||"—"}</td>
            <td style={{...td,color:C.green,fontWeight:500}}>{fmt$(pl.revenue)}</td>
            <td style={{...td,color:C.red}}>{fmt$(pl.jobCosts+pl.insInstallment+pl.insAdvance+pl.usaOps)}</td>
            <td style={{...td,color:C.purple}}>{fmt$(pl.mgmtFee)}</td>
            <td style={{...td,fontWeight:600,color:pl.operatingProfit<0?C.red:C.text}}>{fmt$(pl.operatingProfit)}</td>
            <td style={{...td,color:C.teal}}>{fmt$(pl.ownerShare)}</td>
            <td style={{...td,color:C.indigo,fontWeight:500}}>{fmt$(pl.ascentixEquityShare)}</td>
          </tr>;})}
          <tr style={{background:C.grayBg}}>
            <td style={th} colSpan={2}>Total</td>
            <td style={{...th,color:C.green}}>{fmt$(llcPLs.reduce((s,{pl})=>s+pl.revenue,0))}</td>
            <td style={{...th,color:C.red}}>{fmt$(llcPLs.reduce((s,{pl})=>s+pl.jobCosts+pl.insInstallment+pl.insAdvance+pl.usaOps,0))}</td>
            <td style={{...th,color:C.purple}}>{fmt$(totalMgmt)}</td>
            <td style={th}>{fmt$(llcPLs.reduce((s,{pl})=>s+pl.operatingProfit,0))}</td>
            <td style={{...th,color:C.teal}}>{fmt$(llcPLs.reduce((s,{pl})=>s+pl.ownerShare,0))}</td>
            <td style={{...th,color:C.indigo}}>{fmt$(totalEq)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    {data.groups.length>0&&<div style={card}>
      <div style={{fontSize:"15px",fontWeight:600,color:C.text,marginBottom:"14px"}}>Portfolio Groups — This Month</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
        {data.groups.map(grp=>{
          const gPLs=data.llcs.filter(l=>l.groupId===grp.id).map(llc=>calcLLCPL(llc,data.jobs,data.ins,data.usaExp,ym));
          const cnt=data.llcs.filter(l=>l.groupId===grp.id).length;
          return <div key={grp.id} style={{border:`1px solid ${C.border}`,borderRadius:"8px",padding:"14px"}}>
            <div style={{fontWeight:600,fontSize:"14px",color:C.text}}>{grp.name}</div>
            <div style={{fontSize:"12px",color:C.textMuted,marginBottom:"10px"}}>{cnt} LLC{cnt!==1?"s":""} · {grp.contactName||"No contact"}</div>
            <div style={{display:"flex",gap:"20px"}}>
              <div><div style={{fontSize:"11px",color:C.textMuted}}>Revenue</div><div style={{fontWeight:600,color:C.green}}>{fmt$(gPLs.reduce((s,pl)=>s+pl.revenue,0))}</div></div>
              <div><div style={{fontSize:"11px",color:C.textMuted}}>Profit</div><div style={{fontWeight:600}}>{fmt$(gPLs.reduce((s,pl)=>s+pl.operatingProfit,0))}</div></div>
              <div><div style={{fontSize:"11px",color:C.textMuted}}>Owner Dist.</div><div style={{fontWeight:600,color:C.teal}}>{fmt$(gPLs.reduce((s,pl)=>s+pl.ownerShare,0))}</div></div>
            </div>
          </div>;
        })}
      </div>
    </div>}
  </div>;}

// ══════════════════════════════════════════════════════
// GROUPS
// ══════════════════════════════════════════════════════
function GroupsPage({data,onSave,showToast}){
  const blank={name:"",contactName:"",email:"",phone:"",notes:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{if(!form.name){showToast("Group name required","error");return;}onSave("groups",[...data.groups,{...form,id:uid()}]);setForm(blank);setShow(false);showToast("Group created");};
  const del=id=>{if(data.llcs.some(l=>l.groupId===id)){showToast("Cannot delete — LLCs assigned","error");return;}onSave("groups",data.groups.filter(g=>g.id!==id));showToast("Deleted");};
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Portfolio Groups</div><div style={{fontSize:"12px",color:C.textMuted}}>Cluster LLCs for consolidated reporting</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ New Group</button>
    </div>
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Create Group">
      <G2><Field label="Group Name *"><input style={inp} value={form.name} onChange={e=>f("name",e.target.value)} /></Field><Field label="Primary Contact"><input style={inp} value={form.contactName} onChange={e=>f("contactName",e.target.value)} /></Field><Field label="Email"><input style={inp} value={form.email} onChange={e=>f("email",e.target.value)} /></Field><Field label="Phone"><input style={inp} value={form.phone} onChange={e=>f("phone",e.target.value)} /></Field></G2>
      <Field label="Notes"><input style={inp} value={form.notes} onChange={e=>f("notes",e.target.value)} /></Field>
    </AddBox>}
    {data.groups.length===0?<Empty msg="No groups yet."/>:
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
        {data.groups.map(grp=>{const members=data.llcs.filter(l=>l.groupId===grp.id);return <div key={grp.id} style={{border:`1px solid ${C.border}`,borderRadius:"8px",padding:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div><div style={{fontWeight:600,fontSize:"14px",color:C.text}}>{grp.name}</div><div style={{fontSize:"12px",color:C.textMuted}}>{grp.contactName||"No contact"}</div></div>
            <button style={btnD} onClick={()=>del(grp.id)}>Delete</button>
          </div>
          {grp.notes&&<div style={{fontSize:"12px",color:C.textMid,marginTop:"6px"}}>{grp.notes}</div>}
          <div style={{marginTop:"10px"}}><div style={{fontSize:"11px",color:C.textMuted,marginBottom:"5px",fontWeight:500}}>MEMBER LLCs ({members.length})</div>
            {members.length===0?<div style={{fontSize:"12px",color:C.textMuted}}>No LLCs assigned yet</div>:members.map(l=>
              <div key={l.id} style={{display:"flex",alignItems:"center",gap:"6px",padding:"3px 0"}}><span style={badge(l.active?"green":"gray")}>{l.state||"—"}</span><span style={{fontSize:"12px",color:C.text}}>{l.name}</span></div>
            )}
          </div>
        </div>;})}
      </div>
    }
  </div>;}

// ══════════════════════════════════════════════════════
// LLCS
// ══════════════════════════════════════════════════════
function LLCsPage({data,onSave,showToast}){
  const blank={name:"",state:"",owner:"",email:"",model:"owner",ar:30,or:70,groupId:"",mgmtFeeType:"pct_rev",mgmtFeeValue:8};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const[editId,setEditId]=useState(null);
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.name||!form.owner){showToast("LLC name and owner required","error");return;}
    if(editId){onSave("llcs",data.llcs.map(l=>l.id===editId?{...l,...form,ar:+form.ar,or:100-+form.ar,mgmtFeeValue:+form.mgmtFeeValue}:l));setEditId(null);setForm(blank);setShow(false);showToast("LLC updated");}
    else{onSave("llcs",[...data.llcs,{...form,id:uid(),ar:+form.ar,or:100-+form.ar,mgmtFeeValue:+form.mgmtFeeValue,active:true}]);setForm(blank);setShow(false);showToast("LLC added");}
  };
  const startEdit=l=>{setForm({name:l.name,state:l.state||"",owner:l.owner||"",email:l.email||"",model:l.model,ar:l.ar,or:l.or,groupId:l.groupId||"",mgmtFeeType:l.mgmtFeeType,mgmtFeeValue:l.mgmtFeeValue});setEditId(l.id);setShow(true);};
  const cancel=()=>{setEditId(null);setForm(blank);setShow(false);};
  const del=id=>{onSave("llcs",data.llcs.filter(l=>l.id!==id));showToast("LLC removed");};
  const toggle=id=>onSave("llcs",data.llcs.map(l=>l.id===id?{...l,active:!l.active}:l));
  const feeLabel=(t,v)=>t==="fixed"?`${fmt$(v)}/mo`:t==="pct_rev"?`${v}% of rev`:t==="pct_profit"?`${v}% of profit`:"None";
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>LLC Entities</div><div style={{fontSize:"12px",color:C.textMuted}}>Click Edit to assign or change a portfolio group</div></div>
      <button style={btnP} onClick={()=>{cancel();setShow(s=>!s);}}>+ Add LLC</button>
    </div>
    {show&&<AddBox onCancel={cancel} onSave={save} saveLabel={editId?"Update LLC":"Save LLC"}>
      {editId&&<div style={{padding:"6px 10px",background:"#e0e7ff",borderRadius:"6px",fontSize:"12px",fontWeight:600,color:C.indigoText}}>Editing: {form.name}</div>}
      <G2>
        <Field label="LLC Name *"><input style={inp} value={form.name} onChange={e=>f("name",e.target.value)} /></Field>
        <Field label="State"><input style={inp} value={form.state} onChange={e=>f("state",e.target.value)} placeholder="TX" /></Field>
        <Field label="Owner Name *"><input style={inp} value={form.owner} onChange={e=>f("owner",e.target.value)} /></Field>
        <Field label="Owner Email"><input style={inp} value={form.email} onChange={e=>f("email",e.target.value)} /></Field>
        <Field label="Portfolio Group"><select style={sel} value={form.groupId} onChange={e=>f("groupId",e.target.value)}><option value="">No group</option>{data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Investment Model"><select style={sel} value={form.model} onChange={e=>f("model",e.target.value)}><option value="owner">LLC Owner Invests</option><option value="ascentix">Ascentix Invests</option></select></Field>
        <Field label="Ascentix Equity %"><input style={inp} type="number" min={0} max={100} value={form.ar} onChange={e=>f("ar",+e.target.value)} /></Field>
        <Field label="Owner Equity % (auto)"><input style={{...inp,background:C.grayBg,color:C.textMid}} readOnly value={100-+form.ar} /></Field>
        <Field label="Management Fee Type"><select style={sel} value={form.mgmtFeeType} onChange={e=>f("mgmtFeeType",e.target.value)}><option value="pct_rev">% of Monthly Revenue</option><option value="fixed">Fixed Monthly Amount</option><option value="pct_profit">% of Operating Profit</option><option value="none">No Management Fee</option></select></Field>
        {form.mgmtFeeType!=="none"&&<Field label={form.mgmtFeeType==="fixed"?"Monthly Fee (USD)":"Percentage %"}><input style={inp} type="number" value={form.mgmtFeeValue} onChange={e=>f("mgmtFeeValue",e.target.value)} /></Field>}
      </G2>
    </AddBox>}
    {data.llcs.length===0?<Empty msg="No LLCs yet."/>:
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{["LLC","St","Group","Owner","Model","Equity A:O","Mgmt Fee","Status",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{data.llcs.map(l=>{const grp=data.groups.find(g=>g.id===l.groupId);return <tr key={l.id}>
          <td style={{...td,fontWeight:500,maxWidth:"130px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.name}</td>
          <td style={td}><span style={badge("gray")}>{l.state||"—"}</span></td>
          <td style={{...td,fontSize:"12px",color:C.textMid}}>{grp?.name||"—"}</td>
          <td style={{...td,fontSize:"12px"}}>{l.owner||"—"}</td>
          <td style={td}><span style={badge(l.model==="ascentix"?"indigo":"green")}>{l.model==="ascentix"?"Ascentix":"Owner"}</span></td>
          <td style={{...td,fontFamily:"monospace",fontSize:"12px"}}>{l.ar}%:{l.or}%</td>
          <td style={{...td,color:C.purple,fontSize:"12px"}}>{feeLabel(l.mgmtFeeType,l.mgmtFeeValue)}</td>
          <td style={td}><span style={badge(l.active?"green":"gray")}>{l.active?"Active":"Inactive"}</span></td>
          <td style={{...td,display:"flex",gap:"4px"}}>
            <button style={{...btnS,color:C.indigo,borderColor:C.indigoBorder}} onClick={()=>startEdit(l)}>Edit</button>
            <button style={btnS} onClick={()=>toggle(l.id)}>{l.active?"Deactivate":"Activate"}</button>
            <button style={btnD} onClick={()=>del(l.id)}>✕</button>
          </td>
        </tr>;})}
        </tbody>
      </table>
    }
  </div>;}

// ══════════════════════════════════════════════════════
// JOBS
// ══════════════════════════════════════════════════════
function JobsPage({data,onSave,showToast}){
  const blankJ={llcId:"",client:"",cRef:"",iRef:"",date:"",amount:""};
  const blankV={name:"",vRef:""};const blankP={date:"",amount:"",desc:"",method:"ACH"};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blankJ);
  const [expanded,setExpanded]=useState(null);const[addV,setAddV]=useState(null);const[vForm,setVForm]=useState(blankV);
  const [addP,setAddP]=useState(null);const[pForm,setPForm]=useState(blankP);const[fLLC,setFLLC]=useState("");
  const fj=(k,v)=>setForm(p=>({...p,[k]:v}));
  const addJob=()=>{if(!form.llcId||!form.iRef||!form.amount){showToast("LLC, Invoice Ref, Amount required","error");return;}onSave("jobs",[...data.jobs,{...form,id:uid(),amount:+form.amount,vendors:[]}]);setForm(blankJ);setShow(false);showToast("Job recorded");};
  const delJob=id=>{onSave("jobs",data.jobs.filter(j=>j.id!==id));};
  const addVendor=jid=>{if(!vForm.name){showToast("Vendor name required","error");return;}onSave("jobs",data.jobs.map(j=>j.id===jid?{...j,vendors:[...(j.vendors||[]),{...vForm,id:uid(),payments:[]}]}:j));setVForm(blankV);setAddV(null);showToast("Vendor added");};
  const delVendor=(jid,vid)=>onSave("jobs",data.jobs.map(j=>j.id===jid?{...j,vendors:j.vendors.filter(v=>v.id!==vid)}:j));
  const addPayment=(jid,vid)=>{if(!pForm.amount){showToast("Amount required","error");return;}onSave("jobs",data.jobs.map(j=>j.id===jid?{...j,vendors:j.vendors.map(v=>v.id===vid?{...v,payments:[...v.payments,{...pForm,id:uid(),amount:+pForm.amount}]}:v)}:j));setPForm(blankP);setAddP(null);showToast("Payment recorded");};
  const delPayment=(jid,vid,pid)=>onSave("jobs",data.jobs.map(j=>j.id===jid?{...j,vendors:j.vendors.map(v=>v.id===vid?{...v,payments:v.payments.filter(p=>p.id!==pid)}:v)}:j));
  const sorted=[...data.jobs].filter(j=>!fLLC||j.llcId===fLLC).sort((a,b)=>b.date.localeCompare(a.date));
  const mBadge=m=>({ACH:"blue",Check:"gray",Wire:"indigo",Zelle:"teal",Cash:"green","Credit Card":"amber",Other:"gray"}[m]||"gray");
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Jobs & Revenue</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ New Job</button>
    </div>
    <div style={{marginBottom:"14px"}}><select style={{...sel,maxWidth:"260px"}} value={fLLC} onChange={e=>setFLLC(e.target.value)}><option value="">All LLCs</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={addJob} saveLabel="Save Job">
      <G2>
        <Field label="LLC *"><select style={sel} value={form.llcId} onChange={e=>fj("llcId",e.target.value)}><option value="">Select LLC...</option>{data.llcs.filter(l=>l.active).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Service Date"><input style={inp} type="date" value={form.date} onChange={e=>fj("date",e.target.value)} /></Field>
        <Field label="Client Name"><input style={inp} value={form.client} onChange={e=>fj("client",e.target.value)} /></Field>
        <Field label="Client Ref"><input style={inp} value={form.cRef} onChange={e=>fj("cRef",e.target.value)} /></Field>
        <Field label="Invoice Ref # *"><input style={inp} value={form.iRef} onChange={e=>fj("iRef",e.target.value)} /></Field>
        <Field label="Invoice Amount (USD) *"><input style={inp} type="number" value={form.amount} onChange={e=>fj("amount",e.target.value)} /></Field>
      </G2>
    </AddBox>}
    {sorted.length===0?<Empty msg="No job entries yet."/>:sorted.map(j=>{
      const llc=data.llcs.find(l=>l.id===j.llcId);
      const vendors=j.vendors||[];const totalPaid=jobTotalPaid(j);const balance=j.amount-totalPaid;
      const open=expanded===j.id;const rcv=jobAmtRcv(j.id,data.receipts);const st=arStatus(j,data.receipts);
      return <div key={j.id} style={{border:`1px solid ${open?C.indigoBorder:C.border}`,borderRadius:"8px",marginBottom:"10px",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"12px 14px",cursor:"pointer",background:open?C.indigoBg:C.card}} onClick={()=>setExpanded(open?null:j.id)}>
          <div style={{flex:"0 0 88px",fontSize:"12px",color:C.textMid}}>{fmtDate(j.date)}</div>
          <div style={{flex:"0 0 120px",fontSize:"12px",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{llc?.name||"—"}</div>
          <div style={{flex:"0 0 100px",fontSize:"11px",fontFamily:"monospace",color:C.textMuted}}>{j.iRef}</div>
          <div style={{flex:1,fontSize:"12px",color:C.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{j.client||"—"}</div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"12px"}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Invoice</div><div style={{fontWeight:600,color:C.green}}>{fmt$(j.amount)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Received</div><div style={{fontWeight:600,color:rcv>0?C.blue:C.textMuted}}>{rcv>0?fmt$(rcv):"—"}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Balance</div><div style={{fontWeight:700,color:balance<0?C.red:C.text}}>{fmt$(balance)}</div></div>
            <span style={{...badge(st==="paid"?"green":st==="partial"?"amber":"red"),fontSize:"10px"}}>{st==="paid"?"✓ Paid":st==="partial"?"Partial":"Unpaid"}</span>
            <button style={{...btnD,padding:"4px 8px"}} onClick={e=>{e.stopPropagation();delJob(j.id);}}>✕</button>
          </div>
        </div>
        {open&&<div style={{borderTop:`1px solid ${C.indigoBorder}`,background:"#f8f9ff",padding:"16px"}}>
          {vendors.map((v,vi)=>{const vP=vendorTotalPaid(v);const isAP=addP===v.id;return <div key={v.id} style={{border:`1px solid ${C.border}`,borderRadius:"7px",marginBottom:"10px",background:C.card}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",borderBottom:v.payments.length>0||isAP?`1px solid ${C.border}`:"none"}}>
              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <div style={{width:"22px",height:"22px",borderRadius:"50%",background:C.indigoBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,color:C.indigoText}}>{vi+1}</div>
                <div><div style={{fontWeight:600,fontSize:"13px"}}>{v.name}</div>{v.vRef&&<div style={{fontSize:"11px",color:C.textMuted}}>{v.vRef}</div>}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Paid</div><div style={{fontWeight:600,color:vP>0?C.red:C.textMuted}}>{vP>0?fmt$(vP):"—"}</div></div>
                <button style={{...btnP,padding:"4px 10px",fontSize:"12px"}} onClick={()=>{setAddP(isAP?null:v.id);setPForm(blankP);}}>+ Payment</button>
                <button style={{...btnD,padding:"4px 8px"}} onClick={()=>delVendor(j.id,v.id)}>✕</button>
              </div>
            </div>
            {isAP&&<div style={{padding:"12px",background:C.indigoBg}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr auto",gap:"8px",alignItems:"flex-end"}}>
                <Field label="Date"><input style={inp} type="date" value={pForm.date} onChange={e=>setPForm(p=>({...p,date:e.target.value}))} /></Field>
                <Field label="Amount *"><input style={inp} type="number" value={pForm.amount} onChange={e=>setPForm(p=>({...p,amount:e.target.value}))} /></Field>
                <Field label="Method"><select style={sel} value={pForm.method} onChange={e=>setPForm(p=>({...p,method:e.target.value}))}>{PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</select></Field>
                <Field label="Description"><input style={inp} value={pForm.desc} onChange={e=>setPForm(p=>({...p,desc:e.target.value}))} /></Field>
                <div style={{display:"flex",gap:"4px",paddingBottom:"1px"}}><button style={btnP} onClick={()=>addPayment(j.id,v.id)}>Save</button><button style={btnS} onClick={()=>setAddP(null)}>✕</button></div>
              </div>
            </div>}
            {v.payments.length>0&&<table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
              <thead><tr>{["#","Date","Desc","Method","Amount",""].map(h=><th key={h} style={{...th,fontSize:"11px",background:"#f0f4ff"}}>{h}</th>)}</tr></thead>
              <tbody>{v.payments.map((p,pi)=><tr key={p.id}><td style={{...td,width:"28px",color:C.textMuted}}>{pi+1}</td><td style={{...td,whiteSpace:"nowrap"}}>{fmtDate(p.date)}</td><td style={{...td,color:C.textMid}}>{p.desc||"—"}</td><td style={td}><span style={badge(mBadge(p.method))}>{p.method}</span></td><td style={{...td,fontWeight:600,color:C.red}}>{fmt$(p.amount)}</td><td style={td}><button style={{...btnD,padding:"2px 6px"}} onClick={()=>delPayment(j.id,v.id,p.id)}>✕</button></td></tr>)}</tbody>
            </table>}
          </div>;})}
          {addV===j.id?<div style={{border:`1px solid ${C.indigoBorder}`,borderRadius:"7px",padding:"12px",background:C.card,marginBottom:"6px"}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:"8px",alignItems:"flex-end"}}>
              <Field label="Vendor Name *"><input style={inp} value={vForm.name} onChange={e=>setVForm(p=>({...p,name:e.target.value}))} /></Field>
              <Field label="Vendor Ref"><input style={inp} value={vForm.vRef} onChange={e=>setVForm(p=>({...p,vRef:e.target.value}))} /></Field>
              <div style={{display:"flex",gap:"4px",paddingBottom:"1px"}}><button style={btnP} onClick={()=>addVendor(j.id)}>Add</button><button style={btnS} onClick={()=>setAddV(null)}>Cancel</button></div>
            </div>
          </div>:<button style={{...btnS,color:C.indigo,borderColor:C.indigoBorder}} onClick={()=>{setAddV(j.id);setVForm(blankV);}}>+ Add Vendor</button>}
        </div>}
      </div>;
    })}
  </div>;}

// ══════════════════════════════════════════════════════
// EXPENSES
// ══════════════════════════════════════════════════════
function InsurancePage({data,onSave,showToast}){
  const blank={llcId:"",provider:"",policy:"",total:"",advance:"",monthly:"",months:12,start:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{if(!form.llcId||!form.provider||!form.total){showToast("LLC, Provider, Total required","error");return;}onSave("ins",[...data.ins,{...form,id:uid(),total:+form.total,advance:+form.advance,monthly:+form.monthly,months:+form.months}]);setForm(blank);setShow(false);showToast("Policy added");};
  const del=id=>onSave("ins",data.ins.filter(i=>i.id!==id));
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Insurance Policies</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ Add Policy</button>
    </div>
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Save Policy">
      <G2><Field label="LLC *"><select style={sel} value={form.llcId} onChange={e=>f("llcId",e.target.value)}><option value="">Select...</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Provider *"><input style={inp} value={form.provider} onChange={e=>f("provider",e.target.value)} /></Field><Field label="Policy No."><input style={inp} value={form.policy} onChange={e=>f("policy",e.target.value)} /></Field><Field label="Start Date"><input style={inp} type="date" value={form.start} onChange={e=>f("start",e.target.value)} /></Field><Field label="Total Premium"><input style={inp} type="number" value={form.total} onChange={e=>f("total",e.target.value)} /></Field><Field label="Advance Paid"><input style={inp} type="number" value={form.advance} onChange={e=>f("advance",e.target.value)} /></Field><Field label="Monthly Installment"><input style={inp} type="number" value={form.monthly} onChange={e=>f("monthly",e.target.value)} /></Field><Field label="No. of Months"><input style={inp} type="number" value={form.months} onChange={e=>f("months",e.target.value)} /></Field></G2>
    </AddBox>}
    {data.ins.length===0?<Empty msg="No policies."/>:data.ins.map(ins=>{const llc=data.llcs.find(l=>l.id===ins.llcId);const start=new Date(ins.start+"T00:00:00");const months=Array.from({length:ins.months},(_,i)=>new Date(start.getFullYear(),start.getMonth()+i+1,1).toLocaleDateString("en-US",{month:"short",year:"2-digit"}));return <div key={ins.id} style={{border:`1px solid ${C.border}`,borderRadius:"8px",padding:"14px",marginBottom:"10px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}><div><div style={{fontWeight:500}}>{llc?.name}</div><div style={{fontSize:"12px",color:C.textMid}}>{ins.provider} · {ins.policy}</div></div><div style={{display:"flex",gap:"10px",alignItems:"center"}}><div style={{fontWeight:600}}>{fmt$(ins.total)}</div><button style={btnD} onClick={()=>del(ins.id)}>Delete</button></div></div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>{months.map((m,i)=><span key={i} style={{background:C.indigoBg,color:C.indigoText,borderRadius:"4px",padding:"2px 7px",fontSize:"11px"}}>{m}</span>)}</div>
    </div>;})}
  </div>;}

function USAExpPage({data,onSave,showToast}){
  const blank={llcId:"",cat:"CPA",amount:"",date:"",desc:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{if(!form.llcId||!form.amount){showToast("LLC and amount required","error");return;}onSave("usaExp",[...data.usaExp,{...form,id:uid(),amount:+form.amount}]);setForm(blank);setShow(false);showToast("Added");};
  const del=id=>onSave("usaExp",data.usaExp.filter(e=>e.id!==id));
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>USA Operational Expenses</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ Add</button>
    </div>
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Save">
      <G3><Field label="LLC *"><select style={sel} value={form.llcId} onChange={e=>f("llcId",e.target.value)}><option value="">Select...</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Category"><select style={sel} value={form.cat} onChange={e=>f("cat",e.target.value)}>{["CPA","LLC Formation","Software","Other"].map(c=><option key={c} value={c}>{c}</option>)}</select></Field><Field label="Amount (USD) *"><input style={inp} type="number" value={form.amount} onChange={e=>f("amount",e.target.value)} /></Field><Field label="Date"><input style={inp} type="date" value={form.date} onChange={e=>f("date",e.target.value)} /></Field></G3>
      <Field label="Description"><input style={inp} value={form.desc} onChange={e=>f("desc",e.target.value)} /></Field>
    </AddBox>}
    {data.usaExp.length===0?<Empty msg="No USA expenses yet."/>:<table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}><thead><tr>{["Date","LLC","Category","Amount","Description",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{[...data.usaExp].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{const llc=data.llcs.find(l=>l.id===e.llcId);return <tr key={e.id}><td style={td}>{fmtDate(e.date)}</td><td style={td}>{llc?.name}</td><td style={td}><span style={badge("blue")}>{e.cat}</span></td><td style={{...td,color:C.red,fontWeight:500}}>{fmt$(e.amount)}</td><td style={{...td,color:C.textMid}}>{e.desc}</td><td style={td}><button style={btnD} onClick={()=>del(e.id)}>✕</button></td></tr>;})}</tbody></table>}
  </div>;}

function BDExpPage({data,onSave,showToast}){
  const blank={cat:"Salary",amount:"",date:"",desc:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{if(!form.amount){showToast("Amount required","error");return;}onSave("bdExp",[...data.bdExp,{...form,id:uid(),amount:+form.amount}]);setForm(blank);setShow(false);showToast("Added");};
  const del=id=>onSave("bdExp",data.bdExp.filter(e=>e.id!==id));
  const total=data.bdExp.reduce((s,e)=>s+e.amount,0);const xRate=data.settings.xRate||110;
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px"}}>
      <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Bangladesh Ops — Ascentix</div><div style={{fontSize:"12px",color:C.textMuted}}>Total: {fmtBDT(total)} ≈ {fmt$(total/xRate)}</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ Add</button>
    </div>
    <div style={{height:"1px",background:C.border,margin:"12px 0"}} />
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Save">
      <G3><Field label="Category"><select style={sel} value={form.cat} onChange={e=>f("cat",e.target.value)}>{["Salary","Rent","Utility","Travel","Bonus","Website","Misc"].map(c=><option key={c} value={c}>{c}</option>)}</select></Field><Field label="Amount (BDT) *"><input style={inp} type="number" value={form.amount} onChange={e=>f("amount",e.target.value)} /></Field><Field label="Date"><input style={inp} type="date" value={form.date} onChange={e=>f("date",e.target.value)} /></Field></G3>
      <Field label="Description"><input style={inp} value={form.desc} onChange={e=>f("desc",e.target.value)} /></Field>
    </AddBox>}
    {data.bdExp.length===0?<Empty msg="No BD expenses yet."/>:<table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}><thead><tr>{["Date","Category","BDT","≈ USD","Description",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{[...data.bdExp].sort((a,b)=>b.date.localeCompare(a.date)).map(e=><tr key={e.id}><td style={td}>{fmtDate(e.date)}</td><td style={td}><span style={badge("amber")}>{e.cat}</span></td><td style={{...td,fontWeight:500}}>{fmtBDT(e.amount)}</td><td style={{...td,color:C.red}}>{fmt$(e.amount/xRate)}</td><td style={{...td,color:C.textMid}}>{e.desc}</td><td style={td}><button style={btnD} onClick={()=>del(e.id)}>✕</button></td></tr>)}<tr style={{background:C.grayBg}}><td style={th} colSpan={2}>Total</td><td style={{...th,color:C.amber}}>{fmtBDT(total)}</td><td style={{...th,color:C.red}}>{fmt$(total/xRate)}</td><td colSpan={2}/></tr></tbody></table>}
  </div>;}

function ExpensesPage(props){
  const [tab,setTab]=useState("ins");
  return <div>
    <div style={{display:"flex",gap:0,marginBottom:"20px",borderBottom:`1px solid ${C.border}`}}>
      {[{id:"ins",label:"Insurance"},{id:"usa",label:"USA Operational"},{id:"bd",label:"Bangladesh (Ascentix)"}].map(t=>
        <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 18px",border:"none",borderBottom:`2px solid ${tab===t.id?C.indigo:"transparent"}`,background:"transparent",cursor:"pointer",fontSize:"13px",fontWeight:tab===t.id?600:400,color:tab===t.id?C.indigo:C.textMid,marginBottom:"-1px"}}>{t.label}</button>
      )}
    </div>
    {tab==="ins"&&<InsurancePage {...props}/>}{tab==="usa"&&<USAExpPage {...props}/>}{tab==="bd"&&<BDExpPage {...props}/>}
  </div>;}

// ══════════════════════════════════════════════════════
// WORKING CAPITAL
// ══════════════════════════════════════════════════════
function CapitalPage({data,onSave,showToast}){
  const blank={src:"ascentix",investor:"",llcId:"",amount:"",date:"",type:"investment",desc:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{if(!form.investor||!form.amount){showToast("Investor name & amount required","error");return;}onSave("capital",[...data.capital,{...form,id:uid(),amount:+form.amount,llcId:form.llcId||null}]);setForm(blank);setShow(false);showToast("Recorded");};
  const del=id=>onSave("capital",data.capital.filter(c=>c.id!==id));
  const axIn=data.capital.filter(c=>c.src==="ascentix"&&c.type==="investment").reduce((s,c)=>s+c.amount,0);
  const owIn=data.capital.filter(c=>c.src==="llc_owner"&&c.type==="investment").reduce((s,c)=>s+c.amount,0);
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Ascentix Partners",v:fmt$(axIn),c:C.indigo},{l:"LLC Owners",v:fmt$(owIn),c:C.green},{l:"Total Deployed",v:fmt$(axIn+owIn),c:C.blue}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"12px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"20px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
        <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Working Capital Ledger</div></div>
        <button style={btnP} onClick={()=>setShow(!show)}>+ Record</button>
      </div>
      {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Save">
        <G2><Field label="Source"><select style={sel} value={form.src} onChange={e=>f("src",e.target.value)}><option value="ascentix">Ascentix Partner</option><option value="llc_owner">LLC Owner</option></select></Field><Field label="Type"><select style={sel} value={form.type} onChange={e=>f("type",e.target.value)}><option value="investment">Investment</option><option value="withdrawal">Withdrawal</option></select></Field><Field label="Investor Name *"><input style={inp} value={form.investor} onChange={e=>f("investor",e.target.value)} /></Field><Field label="Date"><input style={inp} type="date" value={form.date} onChange={e=>f("date",e.target.value)} /></Field>{form.src==="llc_owner"&&<Field label="Associated LLC"><select style={sel} value={form.llcId} onChange={e=>f("llcId",e.target.value)}><option value="">Select...</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}<Field label="Amount (USD) *"><input style={inp} type="number" value={form.amount} onChange={e=>f("amount",e.target.value)} /></Field></G2>
        <Field label="Description"><input style={inp} value={form.desc} onChange={e=>f("desc",e.target.value)} /></Field>
      </AddBox>}
      {data.capital.length===0?<Empty msg="No capital entries yet."/>:<table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}><thead><tr>{["Date","Source","Investor","LLC","Type","Amount","Description",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{[...data.capital].sort((a,b)=>b.date.localeCompare(a.date)).map(c=>{const llc=c.llcId?data.llcs.find(l=>l.id===c.llcId):null;return <tr key={c.id}><td style={td}>{fmtDate(c.date)}</td><td style={td}><span style={badge(c.src==="ascentix"?"indigo":"green")}>{c.src==="ascentix"?"Ascentix":"LLC Owner"}</span></td><td style={{...td,fontWeight:500}}>{c.investor}</td><td style={{...td,fontSize:"12px",color:C.textMid}}>{llc?.name||"—"}</td><td style={td}><span style={badge(c.type==="investment"?"blue":"amber")}>{c.type}</span></td><td style={{...td,fontWeight:600,color:c.type==="investment"?C.green:C.red}}>{c.type==="withdrawal"?"−":""}{fmt$(c.amount)}</td><td style={{...td,color:C.textMid,maxWidth:"160px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.desc}</td><td style={td}><button style={btnD} onClick={()=>del(c.id)}>✕</button></td></tr>;})}
      </tbody></table>}
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// CLIENT RECEIPTS
// ══════════════════════════════════════════════════════
function ClientReceiptsPage({data,onSave,showToast}){
  const blankR={llcId:"",client:"",date:"",totalAmount:"",method:"ACH",ref:"",desc:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blankR);const[allocs,setAllocs]=useState({});const[filterLLC,setFilterLLC]=useState("");const[viewR,setViewR]=useState(null);
  const fr=(k,v)=>setForm(p=>({...p,[k]:v}));
  const eligible=form.llcId?data.jobs.filter(j=>j.llcId===form.llcId&&j.amount>0):[];
  const totAlloc=Object.values(allocs).reduce((s,v)=>s+(+v||0),0);
  const remaining=(+form.totalAmount||0)-totAlloc;
  const saveR=()=>{
    if(!form.llcId||!form.date||!form.totalAmount){showToast("LLC, Date, Amount required","error");return;}
    const al=Object.entries(allocs).filter(([,v])=>+v>0).map(([jobId,v])=>({jobId,amount:+v}));
    if(al.length===0){showToast("Allocate to at least one invoice","error");return;}
    if(Math.abs(remaining)>0.01){showToast(`Unallocated: ${fmt$(remaining)}`,"error");return;}
    onSave("receipts",[...data.receipts,{...form,id:uid(),totalAmount:+form.totalAmount,allocations:al}]);
    setForm(blankR);setAllocs({});setShow(false);showToast("Receipt recorded");
  };
  const delR=id=>onSave("receipts",data.receipts.filter(r=>r.id!==id));
  const totalInv=data.jobs.reduce((s,j)=>s+j.amount,0);
  const totalRcv=data.jobs.reduce((s,j)=>s+jobAmtRcv(j.id,data.receipts),0);
  const mBadge=m=>({ACH:"blue",Check:"gray",Wire:"indigo",Zelle:"teal",Cash:"green","Credit Card":"amber",Other:"gray"}[m]||"gray");
  const filtered=[...data.receipts].filter(r=>!filterLLC||r.llcId===filterLLC).sort((a,b)=>b.date.localeCompare(a.date));
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Total Invoiced",v:fmt$(totalInv),c:C.text},{l:"Total Received",v:fmt$(totalRcv),c:C.green},{l:"Outstanding",v:fmt$(Math.max(0,totalInv-totalRcv)),c:C.red},{l:"Collection Rate",v:`${totalInv>0?((totalRcv/totalInv)*100).toFixed(1):0}%`,c:C.indigo}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"12px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"20px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
        <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Client Receipts</div></div>
        <button style={btnP} onClick={()=>{setShow(!show);setAllocs({});}}>+ Record Receipt</button>
      </div>
      <div style={{marginBottom:"14px"}}><select style={{...sel,maxWidth:"260px"}} value={filterLLC} onChange={e=>setFilterLLC(e.target.value)}><option value="">All LLCs</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
      {show&&<div style={{background:C.indigoBg,border:`1px solid ${C.indigoBorder}`,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
        <G2><Field label="LLC *"><select style={sel} value={form.llcId} onChange={e=>{fr("llcId",e.target.value);setAllocs({});}}><option value="">Select LLC...</option>{data.llcs.filter(l=>l.active).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Client"><input style={inp} value={form.client} onChange={e=>fr("client",e.target.value)} /></Field><Field label="Payment Date *"><input style={inp} type="date" value={form.date} onChange={e=>fr("date",e.target.value)} /></Field><Field label="Total Amount (USD) *"><input style={inp} type="number" value={form.totalAmount} onChange={e=>{fr("totalAmount",e.target.value);setAllocs({});}} /></Field><Field label="Method"><select style={sel} value={form.method} onChange={e=>fr("method",e.target.value)}>{PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</select></Field><Field label="Reference"><input style={inp} value={form.ref} onChange={e=>fr("ref",e.target.value)} /></Field></G2>
        <div style={{marginTop:"10px"}}><Field label="Description"><input style={inp} value={form.desc} onChange={e=>fr("desc",e.target.value)} /></Field></div>
        {form.llcId&&+form.totalAmount>0&&<div style={{marginTop:"14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:"8px"}}>
            <div style={{fontSize:"12px",fontWeight:600,color:C.indigoText}}>Allocate to Invoices</div>
            <div style={{fontSize:"12px",color:remaining<-0.01?C.red:remaining>0.01?C.amber:C.green}}>{remaining>0.01?`${fmt$(remaining)} unallocated`:remaining<-0.01?`Over by ${fmt$(Math.abs(remaining))}`:"✓ Fully allocated"}</div>
          </div>
          {eligible.length===0?<div style={{fontSize:"13px",color:C.textMuted}}>No invoices for this LLC.</div>:<table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}><thead><tr>{["Invoice Ref","Client","Invoiced","Received","Allocate"].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead><tbody>{eligible.map(j=>{const rcv=jobAmtRcv(j.id,data.receipts);const owed=Math.max(0,j.amount-rcv);const st=arStatus(j,data.receipts);return <tr key={j.id}><td style={{...td,fontFamily:"monospace",fontSize:"11px"}}>{j.iRef}</td><td style={td}>{j.client||"—"}</td><td style={{...td,color:C.green,fontWeight:500}}>{fmt$(j.amount)}</td><td style={{...td,color:C.blue}}>{rcv>0?fmt$(rcv):"—"}</td><td style={{...td,width:"120px"}}>{st==="paid"?<span style={{fontSize:"11px",color:C.textMuted}}>Paid</span>:<input style={{...inp,padding:"4px 8px",fontSize:"12px"}} type="number" placeholder="0.00" value={allocs[j.id]||""} onChange={e=>setAllocs(p=>({...p,[j.id]:e.target.value}))} />}</td></tr>;})}
          </tbody></table>}
        </div>}
        <div style={{display:"flex",gap:"8px",marginTop:"14px"}}><button style={btnP} onClick={saveR}>Save Receipt</button><button style={btnS} onClick={()=>{setShow(false);setAllocs({});}}>Cancel</button></div>
      </div>}
      {filtered.length===0?<Empty msg="No receipts yet."/>:filtered.map(r=>{const llc=data.llcs.find(l=>l.id===r.llcId);const isOpen=viewR===r.id;return <div key={r.id} style={{border:`1px solid ${isOpen?C.indigoBorder:C.border}`,borderRadius:"8px",marginBottom:"10px",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 14px",cursor:"pointer",background:isOpen?C.indigoBg:C.card}} onClick={()=>setViewR(isOpen?null:r.id)}>
          <div style={{flex:"0 0 88px",fontSize:"12px",color:C.textMid}}>{fmtDate(r.date)}</div>
          <div style={{flex:"0 0 130px",fontSize:"12px",color:C.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{llc?.name||"—"}</div>
          <div style={{flex:1,fontWeight:500,fontSize:"13px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.client||"—"}</div>
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:"12px"}}>
            <span style={badge(mBadge(r.method))}>{r.method}</span>
            <div style={{fontWeight:700,fontSize:"14px",color:C.green}}>{fmt$(r.totalAmount)}</div>
            <div style={{display:"flex",gap:"4px"}}><button style={{...btnS,padding:"4px 8px"}} onClick={e=>{e.stopPropagation();setViewR(isOpen?null:r.id);}}>{isOpen?"▲":"▼"}</button><button style={{...btnD,padding:"4px 8px"}} onClick={e=>{e.stopPropagation();delR(r.id);}}>✕</button></div>
          </div>
        </div>
        {isOpen&&<div style={{borderTop:`1px solid ${C.indigoBorder}`,background:"#f8f9ff",padding:"14px 16px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}><thead><tr>{["Invoice Ref","Client","Invoiced","Allocated","Balance"].map(h=><th key={h} style={{...th,fontSize:"11px",background:"#eef2ff"}}>{h}</th>)}</tr></thead><tbody>{r.allocations.map((a,ai)=>{const job=data.jobs.find(j=>j.id===a.jobId);if(!job)return null;const totalRcv=jobAmtRcv(job.id,data.receipts);const bal=job.amount-totalRcv;return <tr key={ai}><td style={{...td,fontFamily:"monospace",fontSize:"11px"}}>{job.iRef}</td><td style={td}>{job.client||"—"}</td><td style={{...td,color:C.green,fontWeight:500}}>{fmt$(job.amount)}</td><td style={{...td,fontWeight:600,color:C.blue}}>{fmt$(a.amount)}</td><td style={td}><span style={badge(bal<=0?"green":bal<job.amount?"amber":"red")}>{bal<=0?"Paid":fmt$(bal)+" due"}</span></td></tr>;})}
          </tbody></table>
        </div>}
      </div>;})}
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// LLC PAYMENTS
// ══════════════════════════════════════════════════════
function LLCPaymentsPage({data,onSave,showToast,currentUser,viewLlcId}){
  const isAdmin=currentUser.role==="admin";
  const myLlcId=isAdmin?(viewLlcId||null):currentUser.llcId;
  const blank={type:"Monthly Management Fee",amount:"",date:"",method:"ACH",ref:"",desc:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{if(!form.amount||!form.date){showToast("Date and amount required","error");return;}onSave("llcPayments",[...data.llcPayments,{...form,id:uid(),llcId:isAdmin?myLlcId:currentUser.llcId,amount:+form.amount,recordedBy:currentUser.id,doc:null}]);setForm(blank);setShow(false);showToast("Payment recorded");};
  const del=id=>onSave("llcPayments",data.llcPayments.filter(p=>p.id!==id));
  const filtered=[...data.llcPayments].filter(p=>!myLlcId||p.llcId===myLlcId).sort((a,b)=>b.date.localeCompare(a.date));
  const typeBadge=t=>t==="Monthly Management Fee"?"purple":t==="Service Fee"?"blue":"indigo";
  const totals=PAY_TYPES.reduce((acc,t)=>({...acc,[t]:filtered.filter(p=>p.type===t).reduce((s,p)=>s+p.amount,0)}),{});
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:"12px",marginBottom:"16px"}}>
      {PAY_TYPES.map(t=><div key={t} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{t}</div><div style={{fontSize:"20px",fontWeight:700,color:C.purple,marginTop:"4px"}}>{fmt$(totals[t])}</div></div>)}
    </div>
    <div style={card}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
        <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>{isAdmin?"LLC → Ascentix Payments":"My Payments to Ascentix"}</div></div>
        {!isAdmin&&<button style={btnP} onClick={()=>setShow(!show)}>+ Record Payment</button>}
      </div>
      {show&&!isAdmin&&<div style={{background:C.indigoBg,border:`1px solid ${C.indigoBorder}`,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
        <G2><Field label="Payment Type *"><select style={sel} value={form.type} onChange={e=>f("type",e.target.value)}>{PAY_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></Field><Field label="Date *"><input style={inp} type="date" value={form.date} onChange={e=>f("date",e.target.value)} /></Field><Field label="Amount (USD) *"><input style={inp} type="number" value={form.amount} onChange={e=>f("amount",e.target.value)} /></Field><Field label="Method"><select style={sel} value={form.method} onChange={e=>f("method",e.target.value)}>{PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}</select></Field><Field label="Reference"><input style={inp} value={form.ref} onChange={e=>f("ref",e.target.value)} /></Field></G2>
        <div style={{marginTop:"10px"}}><Field label="Description"><input style={inp} value={form.desc} onChange={e=>f("desc",e.target.value)} /></Field></div>
        <div style={{display:"flex",gap:"8px",marginTop:"14px"}}><button style={btnP} onClick={save}>Save Payment</button><button style={btnS} onClick={()=>setShow(false)}>Cancel</button></div>
      </div>}
      {filtered.length===0?<Empty msg="No payments recorded yet."/>:<table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{[isAdmin&&"LLC","Date","Type","Amount","Method","Reference",""].filter(Boolean).map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{filtered.map(p=>{const llc=data.llcs.find(l=>l.id===p.llcId);return <tr key={p.id}>{isAdmin&&<td style={{...td,maxWidth:"130px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{llc?.name||"—"}</td>}<td style={{...td,whiteSpace:"nowrap"}}>{fmtDate(p.date)}</td><td style={td}><span style={badge(typeBadge(p.type))}>{p.type}</span></td><td style={{...td,fontWeight:700,color:C.green}}>{fmt$(p.amount)}</td><td style={td}><span style={badge("gray")}>{p.method}</span></td><td style={{...td,fontFamily:"monospace",fontSize:"11px",color:C.textMid}}>{p.ref||"—"}</td><td style={td}><button style={btnD} onClick={()=>del(p.id)}>✕</button></td></tr>;})}
        </tbody>
        <tfoot><tr style={{background:C.grayBg}}>{isAdmin&&<td style={th}/>}<td style={th} colSpan={2}>Total</td><td style={{...th,color:C.green}}>{fmt$(filtered.reduce((s,p)=>s+p.amount,0))}</td><td colSpan={isAdmin?3:2}/></tr></tfoot>
      </table>}
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════
function ReportsPage({data,onSave}){
  const now=new Date();
  const [month,setMonth]=useState(now.getMonth()+1);const[year,setYear]=useState(now.getFullYear());const[tab,setTab]=useState("llc");const[report,setReport]=useState(null);
  const generate=()=>{
    const ym=`${year}-${String(month).padStart(2,"0")}`;const xRate=data.settings.xRate||110;
    const llcPLs=data.llcs.map(llc=>({llc,grp:data.groups.find(g=>g.id===llc.groupId)||null,pl:calcLLCPL(llc,data.jobs,data.ins,data.usaExp,ym)}));
    const bdBDT=data.bdExp.filter(e=>e.date.startsWith(ym)).reduce((s,e)=>s+e.amount,0);
    const bdUSD=+(bdBDT/xRate).toFixed(2);
    const totalMgmt=+llcPLs.reduce((s,{pl})=>s+pl.mgmtFee,0).toFixed(2);
    const totalEq=+llcPLs.reduce((s,{pl})=>s+pl.ascentixEquityShare,0).toFixed(2);
    const axNet=+(totalMgmt+totalEq-bdUSD).toFixed(2);
    const groupPLs=data.groups.map(grp=>{const members=llcPLs.filter(r=>r.llc.groupId===grp.id);return{grp,members,revenue:members.reduce((s,r)=>s+r.pl.revenue,0),totalExp:members.reduce((s,r)=>s+r.pl.totalExpenses,0),operatingProfit:members.reduce((s,r)=>s+r.pl.operatingProfit,0),ownerShare:members.reduce((s,r)=>s+r.pl.ownerShare,0),ascentixEquityShare:members.reduce((s,r)=>s+r.pl.ascentixEquityShare,0),mgmtFee:members.reduce((s,r)=>s+r.pl.mgmtFee,0)};});
    setReport({month,year,ym,llcPLs,groupPLs,bdBDT,bdUSD,xRate,totalMgmt,totalEq,axNet});
  };
  return <div>
    <div style={card}>
      <div style={{fontSize:"15px",fontWeight:600,color:C.text,marginBottom:"14px"}}>Monthly P&L Report Generator</div>
      <div style={{display:"flex",gap:"12px",alignItems:"flex-end",flexWrap:"wrap"}}>
        <Field label="Month"><select style={{...sel,width:"150px"}} value={month} onChange={e=>setMonth(+e.target.value)}>{MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Year"><select style={{...sel,width:"100px"}} value={year} onChange={e=>setYear(+e.target.value)}>{[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}</select></Field>
        <button style={{...btnP,height:"36px"}} onClick={generate}>Generate Report</button>
        {report&&<span style={{...badge("green"),padding:"5px 12px",fontSize:"12px",alignSelf:"flex-end"}}>✓ {fmtMonth(report.year,report.month)}</span>}
      </div>
      <div style={{height:"1px",background:C.border,margin:"12px 0"}} />
      <div style={{display:"flex",gap:"12px",alignItems:"flex-end",flexWrap:"wrap"}}>
        <Field label="BDT/USD Rate"><input style={{...inp,maxWidth:"130px"}} type="number" value={data.settings.xRate} onChange={e=>onSave("settings",{...data.settings,xRate:+e.target.value})} /></Field>
        <Field label="Report Email"><input style={{...inp,minWidth:"280px"}} value={data.settings.reportEmail} onChange={e=>onSave("settings",{...data.settings,reportEmail:e.target.value})} /></Field>
      </div>
    </div>
    {report&&<div>
      <div style={{...card,borderLeft:`4px solid ${C.indigo}`}}><div style={{fontSize:"17px",fontWeight:700}}>{fmtMonth(report.year,report.month)} — Monthly P&L</div><div style={{fontSize:"12px",color:C.textMuted,marginTop:"2px"}}>{data.llcs.length} LLC entities · {data.groups.length} portfolio groups</div></div>
      <div style={{display:"flex",gap:0,marginBottom:"16px",borderBottom:`1px solid ${C.border}`}}>
        {[{id:"llc",label:"LLC Entities"},{id:"group",label:"Portfolio Groups"},{id:"ascentix",label:"Ascentix Entity"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 18px",border:"none",borderBottom:`2px solid ${tab===t.id?C.indigo:"transparent"}`,background:"transparent",cursor:"pointer",fontSize:"13px",fontWeight:tab===t.id?600:400,color:tab===t.id?C.indigo:C.textMid,marginBottom:"-1px"}}>{t.label}</button>
        )}
      </div>
      {tab==="llc"&&report.llcPLs.map(({llc,grp,pl})=><div key={llc.id} style={card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}}>
          <div><div style={{fontSize:"15px",fontWeight:700}}>{llc.name}</div><div style={{fontSize:"12px",color:C.textMuted}}>{llc.state||"—"} · {llc.owner||"—"}{grp?` · ${grp.name}`:""}</div></div>
          <div style={{display:"flex",gap:"6px"}}><span style={badge(llc.model==="ascentix"?"indigo":"green")}>{llc.model==="ascentix"?"Ascentix":"Owner"} Funded</span><span style={badge("purple")}>A:{llc.ar}% O:{llc.or}%</span></div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px"}}>
          <div>
            <PLRow label="Revenue" val={fmt$(pl.revenue)} bold color={C.green} />
            <PLRow label="Less: Job/Vendor Costs" val={`(${fmt$(pl.jobCosts)})`} indent={1} color={C.red} />
            {pl.insInstallment>0&&<PLRow label="Less: Insurance" val={`(${fmt$(pl.insInstallment)})`} indent={1} color={C.red} />}
            {pl.usaOps>0&&<PLRow label="Less: USA Ops" val={`(${fmt$(pl.usaOps)})`} indent={1} color={C.red} />}
            <PLRow label="Less: Management Fee" val={`(${fmt$(pl.mgmtFee)})`} indent={1} color={C.purple} />
            <PLRow label="Operating Profit" val={fmt$(pl.operatingProfit)} bold separator color={pl.operatingProfit<0?C.red:C.text} />
          </div>
          <div>
            <PLRow label={`${llc.owner||"Owner"} (${llc.or}%)`} val={fmt$(pl.ownerShare)} bold color={C.teal} separator />
            <PLRow label={`Ascentix Equity (${llc.ar}%)`} val={fmt$(pl.ascentixEquityShare)} bold color={C.indigo} />
            <div style={{marginTop:"10px",padding:"10px 12px",background:C.purpleBg,borderRadius:"6px"}}>
              <div style={{fontSize:"11px",color:C.purpleText,fontWeight:600,marginBottom:"4px"}}>Ascentix income from this LLC</div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:C.textMid}}><span>Management fee</span><span>{fmt$(pl.mgmtFee)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"12px",color:C.textMid}}><span>Equity share</span><span>{fmt$(pl.ascentixEquityShare)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:"13px",fontWeight:700,color:C.purple,marginTop:"4px",borderTop:`1px solid #d8b4fe`,paddingTop:"4px"}}><span>Total</span><span>{fmt$(pl.mgmtFee+pl.ascentixEquityShare)}</span></div>
            </div>
          </div>
        </div>
      </div>)}
      {tab==="group"&&(report.groupPLs.length===0?<Empty msg="No groups defined."/>:report.groupPLs.map(({grp,members,revenue,totalExp,operatingProfit,ownerShare,ascentixEquityShare,mgmtFee})=><div key={grp.id} style={card}>
        <div style={{fontSize:"15px",fontWeight:700,marginBottom:"16px"}}>{grp.name} — Consolidated</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px",marginBottom:"16px"}}>
          <div><PLRow label="Total Revenue" val={fmt$(revenue)} bold color={C.green} /><PLRow label="Less: All Expenses" val={`(${fmt$(totalExp)})`} indent={1} color={C.red} /><PLRow label="Group Operating Profit" val={fmt$(operatingProfit)} bold separator color={operatingProfit<0?C.red:C.text} /><PLRow label="Total Owner Distribution" val={fmt$(ownerShare)} bold color={C.teal} /><PLRow label="Total Ascentix Equity" val={fmt$(ascentixEquityShare)} bold color={C.indigo} /></div>
          <div><PLRow label="Management Fees" val={fmt$(mgmtFee)} color={C.purple} /><PLRow label="Equity Shares" val={fmt$(ascentixEquityShare)} color={C.indigo} /><PLRow label="Total Ascentix Income" val={fmt$(mgmtFee+ascentixEquityShare)} bold separator color={C.indigo} /></div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}><thead><tr>{["LLC","Revenue","Expenses","Mgmt Fee","Profit","Owner","Ascentix"].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead><tbody>{members.map(({llc,pl})=><tr key={llc.id}><td style={{...td,fontWeight:500}}>{llc.name}</td><td style={{...td,color:C.green}}>{fmt$(pl.revenue)}</td><td style={{...td,color:C.red}}>{fmt$(pl.totalExpenses)}</td><td style={{...td,color:C.purple}}>{fmt$(pl.mgmtFee)}</td><td style={{...td,color:pl.operatingProfit<0?C.red:C.text,fontWeight:500}}>{fmt$(pl.operatingProfit)}</td><td style={{...td,color:C.teal}}>{fmt$(pl.ownerShare)}</td><td style={{...td,color:C.indigo}}>{fmt$(pl.ascentixEquityShare)}</td></tr>)}</tbody></table>
      </div>))}
      {tab==="ascentix"&&<div style={{...card,borderLeft:`4px solid ${C.indigo}`}}>
        <div style={{fontSize:"15px",fontWeight:700,marginBottom:"16px"}}>Ascentix Entity P&L · {fmtMonth(report.year,report.month)}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"24px"}}>
          <div>
            <PLRow label="Management Fees from LLCs" val={fmt$(report.totalMgmt)} bold color={C.purple} />
            {report.llcPLs.filter(({pl})=>pl.mgmtFee>0).map(({llc,pl})=><PLRow key={llc.id} label={llc.name} val={fmt$(pl.mgmtFee)} indent={1} />)}
            <PLRow label="Equity Profit Shares" val={fmt$(report.totalEq)} bold color={C.indigo} />
            {report.llcPLs.filter(({pl})=>pl.ascentixEquityShare!==0).map(({llc,pl})=><PLRow key={llc.id} label={llc.name} val={fmt$(pl.ascentixEquityShare)} indent={1} note={`${llc.ar}%`} />)}
            <PLRow label="Total Income" val={fmt$(report.totalMgmt+report.totalEq)} bold separator color={C.green} />
          </div>
          <div>
            {["Salary","Rent","Utility","Travel","Bonus","Website","Misc"].map(cat=>{const tot=data.bdExp.filter(e=>e.date.startsWith(report.ym)&&e.cat===cat).reduce((s,e)=>s+e.amount,0);if(!tot)return null;return <PLRow key={cat} label={cat} val={`(${fmt$(tot/report.xRate)})`} indent={1} note={fmtBDT(tot)} color={C.red} />;}).filter(Boolean)}
            <PLRow label="Total BD Expenses" val={`(${fmt$(report.bdUSD)})`} bold separator color={C.red} note={fmtBDT(report.bdBDT)} />
            <div style={{marginTop:"12px"}} />
            <PLRow label="Net Ascentix Profit" val={fmt$(report.axNet)} bold separator color={report.axNet>=0?C.green:C.red} />
          </div>
        </div>
      </div>}
    </div>}
  </div>;}

// ══════════════════════════════════════════════════════
// PAYROLL
// ══════════════════════════════════════════════════════
function EmployeesTab({data,onSave,showToast}){
  const blank={name:"",designation:"",dept:"Operations",email:"",phone:"",joinDate:"",basicSalary:"",houseRent:"",medical:"",transport:"",pfRate:10,pfEmployerRate:10,bankAccount:"",bankName:"",nid:"",bonusEligible:true,bonusSharePct:20,status:"active"};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const[editId,setEditId]=useState(null);
  const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.name||!form.basicSalary){showToast("Name and basic salary required","error");return;}
    const rec={...form,id:editId||uid(),basicSalary:+form.basicSalary,houseRent:+form.houseRent||0,medical:+form.medical||0,transport:+form.transport||0,pfRate:+form.pfRate,pfEmployerRate:+form.pfEmployerRate,bonusSharePct:+form.bonusSharePct||0,bonusEligible:!!form.bonusEligible};
    if(editId) onSave("employees",data.employees.map(e=>e.id===editId?rec:e));
    else onSave("employees",[...data.employees,rec]);
    setForm(blank);setEditId(null);setShow(false);showToast(editId?"Updated":"Employee added");
  };
  const startEdit=emp=>{setForm({...emp,basicSalary:String(emp.basicSalary),houseRent:String(emp.houseRent||0),medical:String(emp.medical||0),transport:String(emp.transport||0),pfRate:String(emp.pfRate||10),pfEmployerRate:String(emp.pfEmployerRate||10),bonusSharePct:String(emp.bonusSharePct||0)});setEditId(emp.id);setShow(true);};
  const toggleStatus=id=>onSave("employees",data.employees.map(e=>e.id===id?{...e,status:e.status==="active"?"inactive":"active"}:e));
  const active=data.employees.filter(e=>e.status==="active");
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Active",v:active.length,c:C.indigo},{l:"Monthly Gross",v:fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).gross,0)),c:C.text},{l:"Monthly Net",v:fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).netSalary,0)),c:C.green},{l:"PF Liability",v:fmtBDT(active.reduce((s,e)=>s+(calcPayslip(e).pfEmployee+calcPayslip(e).pfEmployer),0)),c:C.amber}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"12px 14px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"18px",fontWeight:700,color:s.c,marginTop:"3px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
      <div style={{fontSize:"14px",fontWeight:600}}>Employee Roster</div>
      <button style={btnP} onClick={()=>{setForm(blank);setEditId(null);setShow(!show);}}>+ Add Employee</button>
    </div>
    {show&&<div style={{background:C.indigoBg,border:`1px solid ${C.indigoBorder}`,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
      <div style={{fontSize:"13px",fontWeight:600,color:C.indigoText,marginBottom:"12px"}}>{editId?"Edit Employee":"New Employee"}</div>
      <G2><Field label="Full Name *"><input style={inp} value={form.name} onChange={e=>f("name",e.target.value)} /></Field><Field label="Designation"><input style={inp} value={form.designation} onChange={e=>f("designation",e.target.value)} /></Field><Field label="Department"><select style={sel} value={form.dept} onChange={e=>f("dept",e.target.value)}>{DEPTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Field><Field label="Join Date"><input style={inp} type="date" value={form.joinDate} onChange={e=>f("joinDate",e.target.value)} /></Field><Field label="Email"><input style={inp} value={form.email} onChange={e=>f("email",e.target.value)} /></Field><Field label="Phone"><input style={inp} value={form.phone} onChange={e=>f("phone",e.target.value)} /></Field><Field label="NID"><input style={inp} value={form.nid} onChange={e=>f("nid",e.target.value)} /></Field><Field label="Bank Name"><input style={inp} value={form.bankName} onChange={e=>f("bankName",e.target.value)} /></Field><Field label="Bank Account"><input style={inp} value={form.bankAccount} onChange={e=>f("bankAccount",e.target.value)} /></Field></G2>
      <div style={{height:"1px",background:C.indigoBorder,margin:"14px 0"}} />
      <G3><Field label="Basic Salary *"><input style={inp} type="number" value={form.basicSalary} onChange={e=>f("basicSalary",e.target.value)} /></Field><Field label="House Rent"><input style={inp} type="number" value={form.houseRent} onChange={e=>f("houseRent",e.target.value)} /></Field><Field label="Medical"><input style={inp} type="number" value={form.medical} onChange={e=>f("medical",e.target.value)} /></Field><Field label="Transport"><input style={inp} type="number" value={form.transport} onChange={e=>f("transport",e.target.value)} /></Field><Field label="Employee PF %"><input style={inp} type="number" value={form.pfRate} onChange={e=>f("pfRate",e.target.value)} /></Field><Field label="Employer PF %"><input style={inp} type="number" value={form.pfEmployerRate} onChange={e=>f("pfEmployerRate",e.target.value)} /></Field></G3>
      {+form.basicSalary>0&&(()=>{const ps=calcPayslip({...form,basicSalary:+form.basicSalary,houseRent:+form.houseRent||0,medical:+form.medical||0,transport:+form.transport||0,pfRate:+form.pfRate,pfEmployerRate:+form.pfEmployerRate});return <div style={{marginTop:"10px",background:"#e0e7ff",borderRadius:"6px",padding:"10px 12px",fontSize:"12px"}}><b style={{color:C.indigoText}}>Preview: </b><span style={{color:C.textMid}}>Gross {fmtBDT(ps.gross)} · PF {fmtBDT(ps.pfEmployee)} · Tax {fmtBDT(ps.incomeTax)} · </span><b style={{color:C.indigo}}>Net {fmtBDT(ps.netSalary)}</b></div>;})()}
      <div style={{height:"1px",background:C.indigoBorder,margin:"14px 0"}} />
      <G2><Field label="Bonus Eligible"><select style={sel} value={form.bonusEligible?"yes":"no"} onChange={e=>f("bonusEligible",e.target.value==="yes")}><option value="yes">Yes</option><option value="no">No</option></select></Field>{form.bonusEligible&&<Field label="Pool Share %"><input style={inp} type="number" value={form.bonusSharePct} onChange={e=>f("bonusSharePct",e.target.value)} /></Field>}</G2>
      <div style={{display:"flex",gap:"8px",marginTop:"14px"}}><button style={btnP} onClick={save}>{editId?"Update":"Save Employee"}</button><button style={btnS} onClick={()=>{setShow(false);setEditId(null);}}>Cancel</button></div>
    </div>}
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
      <thead><tr>{["Employee","Dept","Gross/mo","PF(Emp)","Tax","Net Salary","Bonus","Status",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{data.employees.map(emp=>{const ps=calcPayslip(emp);return <tr key={emp.id} style={{opacity:emp.status==="active"?1:0.5}}>
        <td style={{...td,fontWeight:500}}><div>{emp.name}</div><div style={{fontSize:"11px",color:C.textMuted}}>{emp.designation}</div></td>
        <td style={td}><span style={badge("gray")}>{emp.dept}</span></td>
        <td style={td}>{fmtBDT(ps.gross)}</td><td style={{...td,color:C.amber}}>{fmtBDT(ps.pfEmployee)}</td><td style={{...td,color:C.red}}>{fmtBDT(ps.incomeTax)}</td>
        <td style={{...td,fontWeight:700,color:C.green}}>{fmtBDT(ps.netSalary)}</td>
        <td style={td}>{emp.bonusEligible?<span style={badge("purple")}>{emp.bonusSharePct}%</span>:<span style={{fontSize:"11px",color:C.textMuted}}>—</span>}</td>
        <td style={td}><span style={badge(emp.status==="active"?"green":"gray")}>{emp.status}</span></td>
        <td style={{...td,display:"flex",gap:"4px"}}><button style={btnS} onClick={()=>startEdit(emp)}>Edit</button><button style={btnS} onClick={()=>toggleStatus(emp.id)}>{emp.status==="active"?"Deactivate":"Activate"}</button></td>
      </tr>;})}
      </tbody>
      <tfoot><tr style={{background:C.grayBg}}><td style={th} colSpan={2}>Totals (active)</td><td style={th}>{fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).gross,0))}</td><td style={{...th,color:C.amber}}>{fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).pfEmployee,0))}</td><td style={{...th,color:C.red}}>{fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).incomeTax,0))}</td><td style={{...th,color:C.green}}>{fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).netSalary,0))}</td><td colSpan={3}/></tr></tfoot>
    </table>
  </div>;}

function MonthlyPayrollTab({data,onSave,showToast}){
  const now=new Date();
  const [month,setMonth]=useState(now.getMonth()+1);const[year,setYear]=useState(now.getFullYear());const[adjMap,setAdjMap]=useState({});const[payDate,setPayDate]=useState("");const[payMethod,setPayMethod]=useState("Bank Transfer");
  const existing=data.payroll.filter(p=>p.month===month&&p.year===year);const generated=existing.length>0;
  const activeEmps=data.employees.filter(e=>e.status==="active");
  const previewRows=activeEmps.map(emp=>{const ps=calcPayslip(emp);const adj=adjMap[emp.id]||{};const extraPay=+(adj.extraPay||0);const extraDeduct=+(adj.extraDeduct||0);const gross=ps.gross+extraPay;const totalDeductions=ps.pfEmployee+ps.incomeTax+extraDeduct;const netSalary=gross-totalDeductions;return{emp,ps,extraPay,extraDeduct,adj,gross,totalDeductions,netSalary};});
  const genPayroll=()=>{if(generated){showToast("Already generated","error");return;}const records=previewRows.map(({emp,ps,extraPay,extraDeduct,gross,totalDeductions,netSalary,adj})=>({id:uid(),empId:emp.id,month,year,basicSalary:ps.basicSalary,houseRent:ps.houseRent,medical:ps.medical,transport:ps.transport,gross,pfEmployee:ps.pfEmployee,pfEmployer:ps.pfEmployer,incomeTax:ps.incomeTax,extraPay,extraDeduct,totalDeductions,netSalary,status:"draft",paymentDate:payDate||null,method:payMethod,notes:adj.note||""}));onSave("payroll",[...data.payroll,...records]);showToast(`Payroll generated — ${records.length} employees`);};
  const markPaid=id=>{onSave("payroll",data.payroll.map(p=>p.id===id?{...p,status:"paid",paymentDate:payDate||new Date().toISOString().slice(0,10)}:p));showToast("Marked as paid");};
  const markAll=()=>{onSave("payroll",data.payroll.map(p=>(p.month===month&&p.year===year&&p.status==="draft")?{...p,status:"paid",paymentDate:payDate||new Date().toISOString().slice(0,10)}:p));showToast("All marked paid");};
  const delPayroll=()=>{onSave("payroll",data.payroll.filter(p=>!(p.month===month&&p.year===year)));showToast("Payroll deleted");};
  const setAdj=(empId,k,v)=>setAdjMap(p=>({...p,[empId]:{...p[empId],[k]:v}}));
  return <div>
    <div style={{display:"flex",gap:"12px",alignItems:"flex-end",flexWrap:"wrap",marginBottom:"16px",padding:"14px",background:C.grayBg,borderRadius:"8px"}}>
      <Field label="Month"><select style={{...sel,width:"140px"}} value={month} onChange={e=>setMonth(+e.target.value)}>{MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}</select></Field>
      <Field label="Year"><select style={{...sel,width:"90px"}} value={year} onChange={e=>setYear(+e.target.value)}>{[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}</select></Field>
      <Field label="Payment Date"><input style={{...inp,width:"140px"}} type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} /></Field>
      <Field label="Method"><select style={{...sel,width:"150px"}} value={payMethod} onChange={e=>setPayMethod(e.target.value)}>{PMETH.map(m=><option key={m} value={m}>{m}</option>)}</select></Field>
      <div style={{display:"flex",gap:"6px",paddingBottom:"1px"}}>
        {!generated&&<button style={btnP} onClick={genPayroll}>Generate Payroll</button>}
        {generated&&<button style={{...btnP,background:C.green}} onClick={markAll}>✓ Mark All Paid</button>}
        {generated&&<button style={btnD} onClick={delPayroll}>Delete Month</button>}
      </div>
    </div>
    {generated?<table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
      <thead><tr>{["Employee","Gross","PF(Emp)","PF(ER)","Tax","Net Salary","Status","Pay Date",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{existing.map(p=>{const emp=data.employees.find(e=>e.id===p.empId);return <tr key={p.id}>
        <td style={{...td,fontWeight:500}}><div>{emp?.name||"—"}</div><div style={{fontSize:"11px",color:C.textMuted}}>{emp?.designation}</div></td>
        <td style={td}>{fmtBDT(p.gross)}</td><td style={{...td,color:C.amber}}>{fmtBDT(p.pfEmployee)}</td><td style={{...td,color:C.amber}}>{fmtBDT(p.pfEmployer)}</td><td style={{...td,color:C.red}}>{fmtBDT(p.incomeTax)}</td>
        <td style={{...td,fontWeight:700,color:C.green}}>{fmtBDT(p.netSalary)}</td>
        <td style={td}><span style={badge(p.status==="paid"?"green":"amber")}>{p.status}</span></td>
        <td style={{...td,fontSize:"12px"}}>{fmtDate(p.paymentDate)}</td>
        <td style={td}>{p.status==="draft"&&<button style={{...btnP,padding:"3px 10px",fontSize:"12px"}} onClick={()=>markPaid(p.id)}>Pay</button>}</td>
      </tr>;})}
      </tbody>
    </table>:<div>
      <div style={{fontSize:"13px",fontWeight:500,marginBottom:"8px"}}>Preview — {MONTHS[month-1]} {year}</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
        <thead><tr>{["Employee","Gross","Extra Pay","Extra Deduct","PF","Tax","Net","Note"].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead>
        <tbody>{previewRows.map(({emp,ps,netSalary})=><tr key={emp.id}>
          <td style={{...td,fontWeight:500}}>{emp.name}</td><td style={td}>{fmtBDT(ps.gross)}</td>
          <td style={{...td,padding:"6px 8px"}}><input style={{...inp,padding:"3px 6px",fontSize:"11px",width:"80px"}} type="number" placeholder="0" value={adjMap[emp.id]?.extraPay||""} onChange={e=>setAdj(emp.id,"extraPay",e.target.value)} /></td>
          <td style={{...td,padding:"6px 8px"}}><input style={{...inp,padding:"3px 6px",fontSize:"11px",width:"80px"}} type="number" placeholder="0" value={adjMap[emp.id]?.extraDeduct||""} onChange={e=>setAdj(emp.id,"extraDeduct",e.target.value)} /></td>
          <td style={{...td,color:C.amber}}>{fmtBDT(ps.pfEmployee)}</td><td style={{...td,color:C.red}}>{fmtBDT(ps.incomeTax)}</td>
          <td style={{...td,fontWeight:700,color:C.green}}>{fmtBDT(netSalary)}</td>
          <td style={{...td,padding:"6px 8px"}}><input style={{...inp,padding:"3px 6px",fontSize:"11px",width:"100px"}} placeholder="Note..." value={adjMap[emp.id]?.note||""} onChange={e=>setAdj(emp.id,"note",e.target.value)} /></td>
        </tr>)}
        </tbody>
      </table>
    </div>}
  </div>;}

function BonusTab({data,onSave,showToast}){
  const now=new Date();
  const [selMonth,setSelMonth]=useState(now.getMonth()+1);const[selYear,setSelYear]=useState(now.getFullYear());
  const [bForm,setBForm]=useState({llcId:"",poolPct:5,notes:""});const[distMap,setDistMap]=useState({});const[show,setShow]=useState(false);
  const bf=(k,v)=>setBForm(p=>({...p,[k]:v}));
  const ym=`${selYear}-${String(selMonth).padStart(2,"0")}`;
  const llcPL=bForm.llcId?calcLLCPL(data.llcs.find(l=>l.id===bForm.llcId)||{},data.jobs,data.ins,data.usaExp,ym):null;
  const profit=llcPL?.operatingProfit||0;const poolAmt=+(profit*(+bForm.poolPct/100)).toFixed(2);const xRate=data.settings.xRate||110;const poolBDT=+(poolAmt*xRate).toFixed(0);
  const eligible=data.employees.filter(e=>e.status==="active"&&e.bonusEligible);
  const totShare=eligible.reduce((s,e)=>s+(e.bonusSharePct||0),0);
  const autoDist=()=>{const m={};eligible.forEach(e=>{m[e.id]=+(poolBDT*(e.bonusSharePct||0)/Math.max(totShare,1)).toFixed(0);});setDistMap(m);};
  const eqDist=()=>{const each=Math.floor(poolBDT/Math.max(eligible.length,1));const m={};eligible.forEach(e=>{m[e.id]=each;});setDistMap(m);};
  const totDist=Object.values(distMap).reduce((s,v)=>s+(+v||0),0);
  const saveBonus=()=>{
    if(!bForm.llcId){showToast("Select an LLC","error");return;}
    if(Object.keys(distMap).length===0){showToast("Distribute the pool first","error");return;}
    const distributions=Object.entries(distMap).filter(([,v])=>+v>0).map(([empId,amount])=>{const emp=data.employees.find(e=>e.id===empId);return{empId,amount:+amount,sharePct:emp?.bonusSharePct||0,status:"pending",paidDate:null};});
    onSave("bonusPool",[...data.bonusPool,{id:uid(),llcId:bForm.llcId,period:ym,llcProfitUSD:profit,poolPct:+bForm.poolPct,poolAmountUSD:poolAmt,poolAmountBDT:poolBDT,xRate,status:"approved",notes:bForm.notes,distributions,createdAt:new Date().toISOString().slice(0,10)}]);
    setShow(false);setDistMap({});setBForm({...bForm,notes:""});showToast("Bonus pool created");
  };
  const markDistPaid=(bpId,empId)=>{onSave("bonusPool",data.bonusPool.map(bp=>bp.id===bpId?{...bp,distributions:bp.distributions.map(d=>d.empId===empId?{...d,status:"paid",paidDate:new Date().toISOString().slice(0,10)}:d)}:bp));};
  const markAllPaid=id=>{onSave("bonusPool",data.bonusPool.map(bp=>bp.id===id?{...bp,status:"paid",distributions:bp.distributions.map(d=>({...d,status:"paid",paidDate:d.paidDate||new Date().toISOString().slice(0,10)}))}:bp));};
  const delBP=id=>onSave("bonusPool",data.bonusPool.filter(b=>b.id!==id));
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
      <div><div style={{fontSize:"14px",fontWeight:600}}>Performance Bonus Pools</div><div style={{fontSize:"12px",color:C.textMuted}}>% of LLC profit → BDT pool → distributed to eligible employees</div></div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ New Bonus Pool</button>
    </div>
    {show&&<div style={{background:C.indigoBg,border:`1px solid ${C.indigoBorder}`,borderRadius:"8px",padding:"16px",marginBottom:"16px"}}>
      <G3><Field label="Source LLC *"><select style={sel} value={bForm.llcId} onChange={e=>bf("llcId",e.target.value)}><option value="">Select LLC...</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field><Field label="Month"><select style={sel} value={selMonth} onChange={e=>setSelMonth(+e.target.value)}>{MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}</select></Field><Field label="Year"><select style={sel} value={selYear} onChange={e=>setSelYear(+e.target.value)}>{[2024,2025,2026].map(y=><option key={y} value={y}>{y}</option>)}</select></Field></G3>
      {bForm.llcId&&llcPL&&<div style={{margin:"12px 0",padding:"10px 14px",background:C.card,borderRadius:"6px",display:"flex",gap:"20px",alignItems:"center"}}>
        <div><div style={{fontSize:"11px",color:C.textMuted}}>LLC Operating Profit</div><div style={{fontWeight:700,fontSize:"16px",color:profit>=0?C.green:C.red}}>{fmt$(profit)}</div></div>
        <Field label={`Pool % (${bForm.poolPct}%)`}><input style={{...inp,width:"100px"}} type="number" min={0} max={100} value={bForm.poolPct} onChange={e=>bf("poolPct",e.target.value)} /></Field>
        <div><div style={{fontSize:"11px",color:C.textMuted}}>Pool (USD)</div><div style={{fontWeight:700,color:C.indigo}}>{fmt$(poolAmt)}</div></div>
        <div><div style={{fontSize:"11px",color:C.textMuted}}>Pool (BDT)</div><div style={{fontWeight:700,color:C.purple}}>{fmtBDT(poolBDT)}</div></div>
      </div>}
      {bForm.llcId&&poolBDT>0&&<div style={{marginTop:"12px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"8px"}}>
          <div style={{fontSize:"12px",fontWeight:600,color:C.indigoText}}>Distribute to Employees</div>
          <div style={{display:"flex",gap:"6px"}}><button style={{...btnS,fontSize:"11px"}} onClick={autoDist}>Auto (by share %)</button><button style={{...btnS,fontSize:"11px"}} onClick={eqDist}>Equal split</button></div>
        </div>
        <div style={{fontSize:"12px",color:totDist>poolBDT?C.red:C.green,marginBottom:"8px"}}>{fmtBDT(totDist)} of {fmtBDT(poolBDT)} distributed</div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px",marginBottom:"10px"}}><thead><tr>{["Employee","Default %","Bonus (BDT)"].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead><tbody>{eligible.map(emp=><tr key={emp.id}><td style={{...td,fontWeight:500}}>{emp.name}</td><td style={td}><span style={badge("purple")}>{emp.bonusSharePct}%</span></td><td style={{...td,padding:"6px 8px"}}><input style={{...inp,padding:"4px 8px",fontSize:"12px",width:"120px"}} type="number" placeholder="0" value={distMap[emp.id]||""} onChange={e=>setDistMap(p=>({...p,[emp.id]:e.target.value}))} /></td></tr>)}</tbody></table>
        <Field label="Notes"><input style={inp} value={bForm.notes} onChange={e=>bf("notes",e.target.value)} /></Field>
      </div>}
      <div style={{display:"flex",gap:"8px",marginTop:"14px"}}><button style={btnP} onClick={saveBonus}>Create Bonus Pool</button><button style={btnS} onClick={()=>{setShow(false);setDistMap({});}}>Cancel</button></div>
    </div>}
    {[...data.bonusPool].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).map(bp=>{
      const llc=data.llcs.find(l=>l.id===bp.llcId);const[py,pm]=(bp.period||"-").split("-").map(Number);const paidCnt=bp.distributions.filter(d=>d.status==="paid").length;
      return <div key={bp.id} style={{border:`1px solid ${C.border}`,borderRadius:"8px",marginBottom:"12px",overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",background:C.grayBg,borderBottom:`1px solid ${C.border}`}}>
          <div><div style={{fontWeight:600,fontSize:"14px"}}>{llc?.name} — {py&&pm?fmtMonth(py,pm):bp.period}</div><div style={{fontSize:"12px",color:C.textMuted}}>Profit: {fmt$(bp.llcProfitUSD)} · Pool: {bp.poolPct}% = {fmt$(bp.poolAmountUSD)} ({fmtBDT(bp.poolAmountBDT)}) · {paidCnt}/{bp.distributions.length} paid</div></div>
          <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
            <span style={badge(bp.status==="approved"?"green":"amber")}>{bp.status}</span>
            {bp.status==="approved"&&<button style={{...btnS,color:C.green,borderColor:"#6ee7b7",fontSize:"11px"}} onClick={()=>markAllPaid(bp.id)}>Pay All</button>}
            <button style={btnD} onClick={()=>delBP(bp.id)}>Delete</button>
          </div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}><thead><tr>{["Employee","Bonus (BDT)","Status","Paid Date",""].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead><tbody>{bp.distributions.map((d,di)=>{const emp=data.employees.find(e=>e.id===d.empId);return <tr key={di}><td style={{...td,fontWeight:500}}>{emp?.name||"—"}</td><td style={{...td,fontWeight:600,color:C.purple}}>{fmtBDT(d.amount)}</td><td style={td}><span style={badge(d.status==="paid"?"green":"amber")}>{d.status}</span></td><td style={td}>{fmtDate(d.paidDate)}</td><td style={td}>{d.status==="pending"&&bp.status==="approved"&&<button style={{...btnP,padding:"3px 10px",fontSize:"11px"}} onClick={()=>markDistPaid(bp.id,d.empId)}>Mark Paid</button>}</td></tr>;})}
          <tr style={{background:C.grayBg}}><td style={th} colSpan={2}>Total</td><td style={{...th,color:C.purple}}>{fmtBDT(bp.distributions.reduce((s,d)=>s+d.amount,0))}</td><td colSpan={2}/></tr>
        </tbody></table>
      </div>;
    })}
    {data.bonusPool.length===0&&<Empty msg="No bonus pools yet."/>}
  </div>;}

function PayrollPage({data,onSave,showToast,currentUser}){
  const [tab,setTab]=useState("employees");
  const props={data,onSave,showToast,currentUser};
  const now=new Date();
  const monthPayroll=data.payroll.filter(p=>p.month===now.getMonth()+1&&p.year===now.getFullYear());
  const pendingBonus=data.bonusPool.reduce((s,bp)=>s+bp.distributions.filter(d=>d.status==="pending").reduce((s2,d)=>s2+d.amount,0),0);
  const active=data.employees.filter(e=>e.status==="active");
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Active Employees",v:active.length,c:C.indigo},{l:"Monthly Gross",v:fmtBDT(active.reduce((s,e)=>s+calcPayslip(e).gross,0)),c:C.indigo},{l:"This Month Net",v:monthPayroll.length>0?fmtBDT(monthPayroll.reduce((s,p)=>s+p.netSalary,0)):"Not generated",c:monthPayroll.length>0?C.green:C.textMuted},{l:"Pending Bonus",v:fmtBDT(pendingBonus),c:pendingBonus>0?C.amber:C.textMuted}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"18px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={card}>
      <div style={{display:"flex",gap:0,marginBottom:"20px",borderBottom:`1px solid ${C.border}`,marginLeft:"-20px",marginRight:"-20px",paddingLeft:"20px"}}>
        {[{id:"employees",label:"Employees"},{id:"payroll",label:"Monthly Payroll"},{id:"bonus",label:"Performance Bonus"}].map(t=>
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"9px 18px",border:"none",borderBottom:`2px solid ${tab===t.id?C.indigo:"transparent"}`,background:"transparent",cursor:"pointer",fontSize:"13px",fontWeight:tab===t.id?600:400,color:tab===t.id?C.indigo:C.textMid,marginBottom:"-1px"}}>{t.label}</button>
        )}
      </div>
      {tab==="employees"&&<EmployeesTab {...props}/>}
      {tab==="payroll"&&<MonthlyPayrollTab {...props}/>}
      {tab==="bonus"&&<BonusTab {...props}/>}
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════
function UserManagementPage({data,onSave,showToast}){
  const blank={name:"",username:"",password:"",role:"group_owner",llcId:"",groupId:"",email:""};
  const [show,setShow]=useState(false);const[form,setForm]=useState(blank);const f=(k,v)=>setForm(p=>({...p,[k]:v}));
  const add=()=>{
    if(!form.name||!form.username||!form.password){showToast("Name, username and password required","error");return;}
    if(form.role==="llc_owner"&&!form.llcId){showToast("Select an LLC","error");return;}
    if(form.role==="group_owner"&&!form.groupId){showToast("Select a Portfolio Group","error");return;}
    if(data.users.some(u=>u.username===form.username)){showToast("Username already exists","error");return;}
    onSave("users",[...data.users,{...form,id:uid(),llcId:form.llcId||null,groupId:form.groupId||null}]);
    setForm(blank);setShow(false);showToast("User created");
  };
  const del=id=>{if(id==="usr1"){showToast("Cannot delete admin account","error");return;}onSave("users",data.users.filter(u=>u.id!==id));showToast("User deleted");};
  const roleColor=r=>r==="admin"?"indigo":r==="group_owner"?"teal":"green";
  const roleLabel=r=>r==="admin"?"Admin":r==="group_owner"?"Group Owner":"LLC Owner";
  return <div style={card}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
      <div>
        <div style={{fontSize:"15px",fontWeight:600,color:C.text}}>User Management</div>
        <div style={{fontSize:"12px",color:C.textMuted,marginTop:"2px"}}>Create logins for group and LLC owners · share <b>ascentix-51271.web.app</b> with each user</div>
      </div>
      <button style={btnP} onClick={()=>setShow(!show)}>+ Add User</button>
    </div>
    {show&&<AddBox onCancel={()=>setShow(false)} onSave={add} saveLabel="Create User">
      <G2>
        <Field label="Full Name *"><input style={inp} value={form.name} onChange={e=>f("name",e.target.value)} placeholder="John Mitchell" /></Field>
        <Field label="Username *"><input style={inp} value={form.username} onChange={e=>f("username",e.target.value.toLowerCase().replace(/\s/g,".").replace(/[^a-z0-9.]/g,""))} placeholder="john.mitchell" /></Field>
        <Field label="Password *"><input style={inp} value={form.password} onChange={e=>f("password",e.target.value)} /></Field>
        <Field label="Role"><select style={sel} value={form.role} onChange={e=>f("role",e.target.value)}><option value="group_owner">Portfolio Group Owner</option><option value="llc_owner">LLC Owner</option><option value="admin">Admin</option></select></Field>
        {form.role==="group_owner"&&<Field label="Assign to Portfolio Group *"><select style={sel} value={form.groupId} onChange={e=>f("groupId",e.target.value)}><option value="">Select group...</option>{data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>}
        {form.role==="llc_owner"&&<Field label="Assign to LLC *"><select style={sel} value={form.llcId} onChange={e=>f("llcId",e.target.value)}><option value="">Select LLC...</option>{data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>}
        <Field label="Email (optional)"><input style={inp} value={form.email} onChange={e=>f("email",e.target.value)} /></Field>
      </G2>
      {form.role==="group_owner"&&form.groupId&&<div style={{padding:"10px 12px",background:C.tealBg,borderRadius:"6px",fontSize:"12px",color:C.tealText}}>This user will see all LLCs under <b>{data.groups.find(g=>g.id===form.groupId)?.name}</b>: {data.llcs.filter(l=>l.groupId===form.groupId).map(l=>l.name).join(", ")||"No LLCs assigned yet"}</div>}
    </AddBox>}
    <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
      <thead><tr>{["Name","Username","Role","Assigned To",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{data.users.map(u=>{const grp=u.groupId?data.groups.find(g=>g.id===u.groupId):null;const llc=u.llcId?data.llcs.find(l=>l.id===u.llcId):null;return <tr key={u.id}>
        <td style={{...td,fontWeight:500}}>{u.name}</td>
        <td style={{...td,fontFamily:"monospace",fontSize:"12px"}}>{u.username}</td>
        <td style={td}><span style={badge(roleColor(u.role))}>{roleLabel(u.role)}</span></td>
        <td style={{...td,fontSize:"12px",color:C.textMid}}>{grp?.name||llc?.name||"— All access —"}</td>
        <td style={td}>{u.id!=="usr1"&&<button style={btnD} onClick={()=>del(u.id)}>Delete</button>}</td>
      </tr>;})}
      </tbody>
    </table>
    <div style={{marginTop:"16px",padding:"12px 14px",background:C.indigoBg,borderRadius:"8px",fontSize:"12px",color:C.indigoText}}>
      <b>Login URL:</b> https://ascentix-51271.web.app — share with each user along with their username and password.
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// GROUP OWNER VIEWS
// ══════════════════════════════════════════════════════
function GroupOwnerDashboard({data,currentUser}){
  const grp=data.groups.find(g=>g.id===currentUser.groupId);
  if(!grp) return <Empty msg="No portfolio group assigned." />;
  const myLLCs=data.llcs.filter(l=>l.groupId===grp.id);
  const now=new Date();const ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const pls=myLLCs.map(llc=>({llc,pl:calcLLCPL(llc,data.jobs,data.ins,data.usaExp,ym)}));
  const totalRev=pls.reduce((s,{pl})=>s+pl.revenue,0);const totalProfit=pls.reduce((s,{pl})=>s+pl.operatingProfit,0);const totalOwner=pls.reduce((s,{pl})=>s+pl.ownerShare,0);
  const myJobs=data.jobs.filter(j=>myLLCs.some(l=>l.id===j.llcId));
  const totalInv=myJobs.reduce((s,j)=>s+j.amount,0);const totalRcv=myJobs.reduce((s,j)=>s+jobAmtRcv(j.id,data.receipts),0);
  return <div>
    <div style={{marginBottom:"20px"}}><div style={{fontSize:"20px",fontWeight:700}}>{grp.name}</div><div style={{fontSize:"13px",color:C.textMuted}}>{myLLCs.length} LLC{myLLCs.length!==1?"s":""} · {fmtMonth(now.getFullYear(),now.getMonth()+1)}</div></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Group Revenue",v:fmt$(totalRev),c:C.green},{l:"Operating Profit",v:fmt$(totalProfit),c:totalProfit>=0?C.text:C.red},{l:"Owner Distribution",v:fmt$(totalOwner),c:C.teal},{l:"Outstanding",v:fmt$(Math.max(0,totalInv-totalRcv)),c:totalInv>totalRcv?C.amber:C.green}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"20px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={card}>
      <div style={{fontSize:"14px",fontWeight:600,marginBottom:"12px"}}>LLC Breakdown — This Month</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{["LLC","Revenue","Direct Costs","Mgmt Fee","Operating Profit","Your Share"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{pls.map(({llc,pl})=><tr key={llc.id}><td style={{...td,fontWeight:500}}>{llc.name}</td><td style={{...td,color:C.green,fontWeight:500}}>{fmt$(pl.revenue)}</td><td style={{...td,color:C.red}}>{fmt$(pl.jobCosts+pl.insInstallment+pl.usaOps)}</td><td style={{...td,color:C.purple}}>{fmt$(pl.mgmtFee)}</td><td style={{...td,fontWeight:600,color:pl.operatingProfit<0?C.red:C.text}}>{fmt$(pl.operatingProfit)}</td><td style={{...td,fontWeight:600,color:C.teal}}>{fmt$(pl.ownerShare)}</td></tr>)}</tbody>
        <tfoot><tr style={{background:C.grayBg}}><td style={th}>Total</td><td style={{...th,color:C.green}}>{fmt$(totalRev)}</td><td style={th}>{fmt$(pls.reduce((s,{pl})=>s+pl.jobCosts+pl.insInstallment+pl.usaOps,0))}</td><td style={{...th,color:C.purple}}>{fmt$(pls.reduce((s,{pl})=>s+pl.mgmtFee,0))}</td><td style={{...th,color:totalProfit<0?C.red:C.text}}>{fmt$(totalProfit)}</td><td style={{...th,color:C.teal}}>{fmt$(totalOwner)}</td></tr></tfoot>
      </table>
    </div>
    <div style={card}>
      <div style={{fontSize:"14px",fontWeight:600,marginBottom:"12px"}}>Recent Work Orders</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{["Date","LLC","Invoice Ref","Client","Invoiced","Received","Status"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{[...myJobs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10).map(j=>{const llc=data.llcs.find(l=>l.id===j.llcId);const rcv=jobAmtRcv(j.id,data.receipts);const st=arStatus(j,data.receipts);return <tr key={j.id}><td style={td}>{fmtDate(j.date)}</td><td style={{...td,fontSize:"12px",color:C.textMid}}>{llc?.name||"—"}</td><td style={{...td,fontFamily:"monospace",fontSize:"12px"}}>{j.iRef}</td><td style={td}>{j.client||"—"}</td><td style={{...td,color:C.green,fontWeight:500}}>{fmt$(j.amount)}</td><td style={{...td,color:C.blue}}>{rcv>0?fmt$(rcv):"—"}</td><td style={td}><span style={badge(st==="paid"?"green":st==="partial"?"amber":"red")}>{st==="paid"?"✓ Paid":st==="partial"?"Partial":"Unpaid"}</span></td></tr>;})}
        </tbody>
      </table>
    </div>
  </div>;}

// ══════════════════════════════════════════════════════
// LLC OWNER VIEWS
// ══════════════════════════════════════════════════════
function LLCOwnerDashboard({data,currentUser}){
  const llc=data.llcs.find(l=>l.id===currentUser.llcId);
  if(!llc) return <Empty msg="No LLC assigned to this account." />;
  const now=new Date();const ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const pl=calcLLCPL(llc,data.jobs,data.ins,data.usaExp,ym);
  const myJobs=data.jobs.filter(j=>j.llcId===llc.id);
  const totalRcv=myJobs.reduce((s,j)=>s+jobAmtRcv(j.id,data.receipts),0);
  const totalInv=myJobs.reduce((s,j)=>s+j.amount,0);
  const myPayments=data.llcPayments.filter(p=>p.llcId===llc.id);
  return <div>
    <div style={{marginBottom:"20px"}}><div style={{fontSize:"20px",fontWeight:700}}>{llc.name}</div><div style={{fontSize:"13px",color:C.textMuted}}>{llc.state||"—"} · Owner: {llc.owner||"—"} · {fmtMonth(now.getFullYear(),now.getMonth()+1)}</div></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"16px"}}>
      {[{l:"Revenue",v:fmt$(pl.revenue),c:C.green},{l:"Operating Profit",v:fmt$(pl.operatingProfit),c:pl.operatingProfit>=0?C.text:C.red},{l:`Your Share (${llc.or}%)`,v:fmt$(pl.ownerShare),c:C.teal},{l:"Outstanding",v:fmt$(Math.max(0,totalInv-totalRcv)),c:totalInv>totalRcv?C.amber:C.green}].map((s,i)=>
        <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"10px",padding:"14px 16px"}}><div style={{fontSize:"11px",color:C.textMuted}}>{s.l}</div><div style={{fontSize:"20px",fontWeight:700,color:s.c,marginTop:"4px"}}>{s.v}</div></div>
      )}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"16px",marginBottom:"16px"}}>
      <div style={card}>
        <div style={{fontSize:"14px",fontWeight:600,marginBottom:"12px"}}>This Month — P&L</div>
        <PLRow label="Revenue" val={fmt$(pl.revenue)} bold color={C.green} />
        <PLRow label="Job / Vendor Costs" val={`(${fmt$(pl.jobCosts)})`} indent={1} color={C.red} />
        <PLRow label="Management Fee" val={`(${fmt$(pl.mgmtFee)})`} indent={1} color={C.purple} />
        <PLRow label="Operating Profit" val={fmt$(pl.operatingProfit)} bold separator color={pl.operatingProfit<0?C.red:C.text} />
        <PLRow label={`Your Share (${llc.or}%)`} val={fmt$(pl.ownerShare)} bold color={C.teal} />
      </div>
      <div style={card}>
        <div style={{fontSize:"14px",fontWeight:600,marginBottom:"12px"}}>Payments to Ascentix</div>
        {myPayments.length===0?<Empty msg="No payments recorded."/>:PAY_TYPES.map(t=>{const tot=myPayments.filter(p=>p.type===t).reduce((s,p)=>s+p.amount,0);if(!tot)return null;return <PLRow key={t} label={t} val={fmt$(tot)} color={C.purple}/>;}).filter(Boolean)}
        {myPayments.length>0&&<PLRow label="Total Paid" val={fmt$(myPayments.reduce((s,p)=>s+p.amount,0))} bold separator color={C.indigo}/>}
      </div>
    </div>
    <div style={card}>
      <div style={{fontSize:"14px",fontWeight:600,marginBottom:"12px"}}>Recent Work Orders</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"13px"}}>
        <thead><tr>{["Date","Invoice Ref","Client","Invoiced","Received","Status"].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{[...myJobs].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6).map(j=>{const rcv=jobAmtRcv(j.id,data.receipts);const st=arStatus(j,data.receipts);return <tr key={j.id}><td style={td}>{fmtDate(j.date)}</td><td style={{...td,fontFamily:"monospace",fontSize:"12px"}}>{j.iRef}</td><td style={td}>{j.client||"—"}</td><td style={{...td,color:C.green,fontWeight:500}}>{fmt$(j.amount)}</td><td style={{...td,color:C.blue}}>{rcv>0?fmt$(rcv):"—"}</td><td style={td}><span style={badge(st==="paid"?"green":st==="partial"?"amber":"red")}>{st==="paid"?"✓ Paid":st==="partial"?"Partial":"Unpaid"}</span></td></tr>;})}
        </tbody>
      </table>
    </div>
  </div>;}

function LLCOwnerJobsView({data,currentUser}){
  const myJobs=[...data.jobs].filter(j=>j.llcId===currentUser.llcId).sort((a,b)=>b.date.localeCompare(a.date));
  const [expanded,setExpanded]=useState(null);
  return <div style={card}>
    <div style={{fontSize:"15px",fontWeight:600,marginBottom:"14px"}}>Work Orders</div>
    {myJobs.length===0?<Empty msg="No work orders yet."/>:myJobs.map(j=>{
      const vendors=j.vendors||[];const totalPaid=jobTotalPaid(j);const rcv=jobAmtRcv(j.id,data.receipts);const open=expanded===j.id;const st=arStatus(j,data.receipts);
      return <div key={j.id} style={{border:`1px solid ${open?C.indigoBorder:C.border}`,borderRadius:"8px",marginBottom:"10px",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px",padding:"12px 14px",cursor:"pointer",background:open?C.indigoBg:C.card}} onClick={()=>setExpanded(open?null:j.id)}>
          <div style={{flex:"0 0 88px",fontSize:"12px",color:C.textMid}}>{fmtDate(j.date)}</div>
          <div style={{fontFamily:"monospace",fontSize:"12px",flex:"0 0 110px"}}>{j.iRef}</div>
          <div style={{flex:1,fontSize:"13px"}}>{j.client||"—"}</div>
          <div style={{display:"flex",gap:"12px",alignItems:"center"}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Invoice</div><div style={{fontWeight:600,color:C.green}}>{fmt$(j.amount)}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Received</div><div style={{fontWeight:600,color:rcv>0?C.blue:C.textMuted}}>{rcv>0?fmt$(rcv):"—"}</div></div>
            <span style={badge(st==="paid"?"green":st==="partial"?"amber":"red")}>{st==="paid"?"✓ Paid":st==="partial"?"Partial":"Unpaid"}</span>
            <button style={{...btnS,padding:"3px 8px"}} onClick={e=>{e.stopPropagation();setExpanded(open?null:j.id);}}>{open?"▲":"▼"}</button>
          </div>
        </div>
        {open&&<div style={{borderTop:`1px solid ${C.indigoBorder}`,background:"#f8f9ff",padding:"14px 16px"}}>
          {vendors.length===0?<div style={{fontSize:"13px",color:C.textMuted}}>No vendors.</div>:vendors.map(v=><div key={v.id} style={{marginBottom:"8px",border:`1px solid ${C.border}`,borderRadius:"6px",overflow:"hidden",background:C.card}}>
            <div style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",background:C.grayBg}}><span style={{fontWeight:500}}>{v.name}</span><span style={{fontWeight:600,color:C.red}}>{fmt$(vendorTotalPaid(v))}</span></div>
            {v.payments.map(p=><div key={p.id} style={{display:"flex",gap:"12px",padding:"6px 12px",borderTop:`1px solid ${C.bg}`,fontSize:"12px"}}><span style={{color:C.textMuted,width:"80px"}}>{fmtDate(p.date)}</span><span style={{flex:1,color:C.textMid}}>{p.desc||"—"}</span><span style={{fontWeight:600,color:C.red}}>{fmt$(p.amount)}</span></div>)}
          </div>)}
        </div>}
      </div>;
    })}
  </div>;}

// ══════════════════════════════════════════════════════
// BANK STATEMENT ANALYSER
// ══════════════════════════════════════════════════════
const STMT_CATS=[
  {id:"client_receipt",label:"Client Receipt",color:"green",desc:"Money received from clients"},
  {id:"vendor_payment",label:"Vendor Payment",color:"red",desc:"Payment to vendor/contractor"},
  {id:"insurance_payment",label:"Insurance Payment",color:"amber",desc:"Insurance premium"},
  {id:"usa_expense",label:"USA Operational Expense",color:"blue",desc:"CPA, software, formation fees"},
  {id:"ascentix_payment",label:"Payment to Ascentix",color:"purple",desc:"Management fee or profit share"},
  {id:"ignore",label:"Ignore",color:"gray",desc:"Bank fee, transfer, non-business"},
];

function BankStatementPage({data,onSave,showToast}){
  const [llcId,setLlcId]=useState("");
  const [file,setFile]=useState(null);
  const [analyzing,setAnalyzing]=useState(false);
  const [results,setResults]=useState(null);
  const [approved,setApproved]=useState({});
  const [editMap,setEditMap]=useState({});
  const [saved,setSaved]=useState(false);

  const readFile=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});

  const analyze=async()=>{
    if(!llcId){showToast("Select an LLC first","error");return;}
    if(!file){showToast("Upload a bank statement","error");return;}
    setAnalyzing(true);setResults(null);
    try{
      const b64=await readFile(file);
      const llc=data.llcs.find(l=>l.id===llcId);
      const isPDF=file.type==="application/pdf";
      const contentBlock=isPDF
        ?{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}
        :{type:"image",source:{type:"base64",media_type:file.type,data:b64}};

      const prompt=`You are an accountant analysing a bank statement for ${llc.name} (a US property management LLC).

Analyse every transaction and categorise it. Return ONLY valid JSON — no markdown, no explanation:

{
  "summary": "Statement period and overview e.g. April 2025 — 12 credits totalling $8,400 / 7 debits totalling $3,200",
  "transactions": [
    {
      "id": "t1",
      "date": "YYYY-MM-DD",
      "description": "Transaction description from statement",
      "amount": 1500.00,
      "flow": "credit",
      "category": "client_receipt",
      "client": "Client or payer name if identifiable",
      "vendor": "Vendor or payee name if identifiable",
      "method": "ACH or Check or Wire or Zelle or Cash or Other",
      "expenseCat": "CPA or LLC Formation or Software or Other — only if category is usa_expense",
      "paymentType": "Monthly Management Fee or Service Fee or Profit Sharing — only if category is ascentix_payment",
      "ref": "Reference number from statement if visible",
      "notes": "Any useful notes"
    }
  ]
}

Categories to use:
- client_receipt: credits from clients paying invoices
- vendor_payment: debits to vendors, contractors, plumbers, electricians etc.
- insurance_payment: insurance premium payments
- usa_expense: CPA fees, software subscriptions, LLC formation, other operational costs
- ascentix_payment: management fees or profit sharing paid to Ascentix
- ignore: bank fees, internal transfers, tax payments, unidentifiable

Be thorough — extract every transaction on the statement.`;

      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:4000,
          messages:[{role:"user",content:[contentBlock,{type:"text",text:prompt}]}]
        })
      });
      const rd=await resp.json();
      const raw=rd.content.map(c=>c.text||"").join("");
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);

      // Ensure IDs are unique
      parsed.transactions.forEach((t,i)=>{if(!t.id)t.id=`t${i+1}`;});

      setResults(parsed);
      // Default: approve all non-ignore
      const ap={};parsed.transactions.forEach(t=>{ap[t.id]=t.category!=="ignore";});
      setApproved(ap);
      setEditMap({});setSaved(false);
    }catch(e){
      console.error(e);
      showToast("Analysis failed — check the file and try again","error");
    }
    setAnalyzing(false);
  };

  const setEdit=(id,k,v)=>setEditMap(p=>({...p,[id]:{...p[id],[k]:v}}));
  const getField=(t,k)=>editMap[t.id]?.[k]!==undefined?editMap[t.id][k]:t[k];

  const saveAll=()=>{
    const toSave=results.transactions.filter(t=>approved[t.id]&&getField(t,"category")!=="ignore");
    if(toSave.length===0){showToast("No entries selected to save","error");return;}

    let receipts=[...data.receipts];
    let usaExp=[...data.usaExp];
    let llcPayments=[...data.llcPayments];
    let ins=[...data.ins];

    toSave.forEach(t=>{
      const cat=getField(t,"category");
      const date=getField(t,"date");
      const amount=+getField(t,"amount")||0;
      const desc=getField(t,"description");
      const method=getField(t,"method")||"ACH";
      const ref=getField(t,"ref")||`STMT-${date}`;

      if(cat==="client_receipt"){
        receipts.push({id:uid(),llcId,client:getField(t,"client")||desc,date,totalAmount:amount,method,ref,desc,allocations:[]});
      } else if(cat==="vendor_payment"||cat==="insurance_payment"){
        usaExp.push({id:uid(),llcId,cat:cat==="insurance_payment"?"Other":"Other",amount,date,desc:`${getField(t,"vendor")||desc}`});
      } else if(cat==="usa_expense"){
        usaExp.push({id:uid(),llcId,cat:getField(t,"expenseCat")||"Other",amount,date,desc});
      } else if(cat==="ascentix_payment"){
        llcPayments.push({id:uid(),llcId,type:getField(t,"paymentType")||"Monthly Management Fee",amount,date,method,ref,desc,recordedBy:"bank_statement_import",doc:null});
      }
    });

    onSave("receipts",receipts);
    onSave("usaExp",usaExp);
    onSave("llcPayments",llcPayments);
    setSaved(true);
    showToast(`✓ ${toSave.length} entries saved to the system`);
  };

  const llc=data.llcs.find(l=>l.id===llcId);
  const approvedCount=results?results.transactions.filter(t=>approved[t.id]&&getField(t,"category")!=="ignore").length:0;

  return <div>
    {/* Upload card */}
    <div style={card}>
      <div style={{fontSize:"15px",fontWeight:600,color:C.text,marginBottom:"4px"}}>Bank Statement Analyser</div>
      <div style={{fontSize:"12px",color:C.textMuted,marginBottom:"16px"}}>Upload a bank statement (PDF or image) · Claude will extract and categorise every transaction · you review before saving</div>
      <G3>
        <Field label="LLC *">
          <select style={sel} value={llcId} onChange={e=>{setLlcId(e.target.value);setResults(null);setSaved(false);}}>
            <option value="">Select LLC...</option>
            {data.llcs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="Bank Statement (PDF or image) *">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{fontSize:"12px",padding:"6px 0"}}
            onChange={e=>{setFile(e.target.files[0]||null);setResults(null);setSaved(false);}} />
          {file&&<div style={{fontSize:"11px",color:C.green,marginTop:"3px"}}>✓ {file.name} ({(file.size/1024).toFixed(0)}KB)</div>}
        </Field>
        <Field label=" ">
          <button style={{...btnP,height:"38px",marginTop:"4px"}} onClick={analyze} disabled={analyzing||!llcId||!file}>
            {analyzing?"🔍 Analysing...":"🔍 Analyse with Claude"}
          </button>
        </Field>
      </G3>
      {analyzing&&<div style={{marginTop:"16px",padding:"14px",background:C.indigoBg,borderRadius:"8px",fontSize:"13px",color:C.indigoText,display:"flex",alignItems:"center",gap:"10px"}}>
        <div style={{width:"16px",height:"16px",border:`2px solid ${C.indigo}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}} />
        Claude is reading and analysing your bank statement...
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>}
    </div>

    {/* Results */}
    {results&&<div>
      {/* Summary */}
      <div style={{...card,borderLeft:`4px solid ${C.indigo}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontSize:"15px",fontWeight:700,color:C.text}}>{llc?.name} — Statement Analysis</div>
            <div style={{fontSize:"13px",color:C.textMuted,marginTop:"4px"}}>{results.summary}</div>
          </div>
          <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Transactions found</div><div style={{fontSize:"20px",fontWeight:700,color:C.indigo}}>{results.transactions.length}</div></div>
            <div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:C.textMuted}}>Selected to save</div><div style={{fontSize:"20px",fontWeight:700,color:C.green}}>{approvedCount}</div></div>
          </div>
        </div>
        {/* Category summary */}
        <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginTop:"12px"}}>
          {STMT_CATS.filter(c=>c.id!=="ignore").map(c=>{
            const cnt=results.transactions.filter(t=>t.category===c.id).length;
            if(!cnt)return null;
            return <div key={c.id} style={{...badge(c.color),padding:"4px 10px",fontSize:"12px"}}>{c.label}: {cnt}</div>;
          })}
          {results.transactions.filter(t=>t.category==="ignore").length>0&&
            <div style={{...badge("gray"),padding:"4px 10px",fontSize:"12px"}}>Ignored: {results.transactions.filter(t=>t.category==="ignore").length}</div>
          }
        </div>
      </div>

      {/* Transaction review table */}
      <div style={card}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"14px"}}>
          <div><div style={{fontSize:"15px",fontWeight:600,color:C.text}}>Review Entries</div><div style={{fontSize:"12px",color:C.textMuted}}>Edit categories or details if needed · uncheck entries you don't want to save</div></div>
          <div style={{display:"flex",gap:"8px"}}>
            <button style={btnS} onClick={()=>{const ap={};results.transactions.forEach(t=>{ap[t.id]=true;});setApproved(ap);}}>Select All</button>
            <button style={btnS} onClick={()=>{const ap={};results.transactions.forEach(t=>{ap[t.id]=false;});setApproved(ap);}}>Deselect All</button>
          </div>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:"12px"}}>
          <thead><tr>{["✓","Date","Description","Amount","Flow","Category","Client/Vendor","Method"].map(h=><th key={h} style={{...th,fontSize:"11px"}}>{h}</th>)}</tr></thead>
          <tbody>
            {results.transactions.map(t=>{
              const cat=getField(t,"category");
              const catInfo=STMT_CATS.find(c=>c.id===cat)||STMT_CATS[5];
              const isApproved=approved[t.id];
              const flow=t.flow||"credit";
              return <tr key={t.id} style={{opacity:isApproved?1:0.45,background:isApproved?"transparent":"#fafafa"}}>
                <td style={{...td,width:"36px",textAlign:"center"}}>
                  <input type="checkbox" checked={!!isApproved} onChange={e=>setApproved(p=>({...p,[t.id]:e.target.checked}))} />
                </td>
                <td style={{...td,whiteSpace:"nowrap",fontSize:"11px"}}>{fmtDate(getField(t,"date"))}</td>
                <td style={{...td,maxWidth:"180px"}}>
                  <div style={{fontSize:"12px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{getField(t,"description")}</div>
                  {getField(t,"ref")&&<div style={{fontSize:"10px",color:C.textMuted,fontFamily:"monospace"}}>{getField(t,"ref")}</div>}
                </td>
                <td style={{...td,fontWeight:600,color:flow==="credit"?C.green:C.red,whiteSpace:"nowrap"}}>
                  {flow==="credit"?"+":"-"}{fmt$(+getField(t,"amount")||0)}
                </td>
                <td style={td}><span style={badge(flow==="credit"?"green":"red")}>{flow}</span></td>
                <td style={{...td,minWidth:"160px"}}>
                  <select style={{...sel,padding:"3px 6px",fontSize:"11px"}} value={cat}
                    onChange={e=>setEdit(t.id,"category",e.target.value)}>
                    {STMT_CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </td>
                <td style={{...td,minWidth:"130px"}}>
                  <input style={{...inp,padding:"3px 6px",fontSize:"11px"}}
                    value={cat==="client_receipt"?getField(t,"client")||"":getField(t,"vendor")||""}
                    placeholder={cat==="client_receipt"?"Client name...":"Vendor name..."}
                    onChange={e=>setEdit(t.id,cat==="client_receipt"?"client":"vendor",e.target.value)} />
                </td>
                <td style={{...td,minWidth:"100px"}}>
                  <select style={{...sel,padding:"3px 6px",fontSize:"11px"}} value={getField(t,"method")||"ACH"}
                    onChange={e=>setEdit(t.id,"method",e.target.value)}>
                    {PAY_METHODS.map(m=><option key={m} value={m}>{m}</option>)}
                  </select>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>

      {/* Save bar */}
      {!saved&&<div style={{...card,background:"#f0fdf4",borderColor:"#6ee7b7",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontSize:"14px",fontWeight:600,color:C.greenText}}>{approvedCount} entries ready to save</div>
          <div style={{fontSize:"12px",color:C.green,marginTop:"2px"}}>Client receipts → Receipts · Vendor/insurance/USA expenses → USA Expenses · Ascentix payments → LLC Payments</div>
        </div>
        <button style={{...btnP,background:C.green,padding:"10px 24px",fontSize:"14px"}} onClick={saveAll}>
          ✓ Save {approvedCount} Entries to System
        </button>
      </div>}
      {saved&&<div style={{...card,background:"#f0fdf4",borderColor:"#6ee7b7",textAlign:"center",padding:"20px"}}>
        <div style={{fontSize:"16px",fontWeight:700,color:C.green,marginBottom:"6px"}}>✓ Entries saved successfully!</div>
        <div style={{fontSize:"13px",color:C.textMuted,marginBottom:"12px"}}>All approved transactions have been added to the system. Note: client receipts have been saved without invoice allocation — go to Client Receipts to allocate them to specific invoices.</div>
        <button style={btnP} onClick={()=>{setResults(null);setFile(null);setSaved(false);}}>Upload Another Statement</button>
      </div>}
    </div>}
  </div>;
}
function LoginPage({onLogin,toast}){
  const [un,setUn]=useState("");const[pw,setPw]=useState("");const[showPw,setShowPw]=useState(false);
  return <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,-apple-system,sans-serif",padding:"20px"}}>
    <div style={{width:"100%",maxWidth:"400px"}}>
      <div style={{textAlign:"center",marginBottom:"32px"}}>
        <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:"48px",height:"48px",background:C.indigo,borderRadius:"12px",marginBottom:"12px"}}><span style={{color:"#fff",fontSize:"22px",fontWeight:700}}>A</span></div>
        <div style={{fontSize:"22px",fontWeight:700,color:C.text}}>Ascentix</div>
        <div style={{fontSize:"13px",color:C.textMuted}}>Business Management System</div>
      </div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:"12px",padding:"28px"}}>
        <div style={{fontSize:"15px",fontWeight:600,marginBottom:"20px"}}>Sign in</div>
        <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
          <Field label="Username"><input style={inp} value={un} onChange={e=>setUn(e.target.value)} placeholder="admin" onKeyDown={e=>e.key==="Enter"&&onLogin(un,pw)} autoFocus /></Field>
          <Field label="Password">
            <div style={{position:"relative"}}>
              <input style={{...inp,paddingRight:"40px"}} type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onLogin(un,pw)} />
              <button onClick={()=>setShowPw(!showPw)} style={{position:"absolute",right:"8px",top:"50%",transform:"translateY(-50%)",border:"none",background:"transparent",cursor:"pointer",color:C.textMuted,fontSize:"12px",padding:"2px 4px"}}>{showPw?"Hide":"Show"}</button>
            </div>
          </Field>
          <button style={{...btnP,width:"100%",padding:"10px",fontSize:"14px"}} onClick={()=>onLogin(un,pw)}>Sign In</button>
        </div>
      </div>
    </div>
    <Toast toast={toast}/>
  </div>;}

// ══════════════════════════════════════════════════════
// AI ASSISTANT — Natural Language Data Entry
// ══════════════════════════════════════════════════════
const EXAMPLE_COMMANDS=[
  "Add a portfolio group called Oakwood and create Oakwood Property LLC in Texas under it with 30% Ascentix equity",
  "Create an LLC called Sunrise Realty in Florida under ZIC group with fixed management fee of $400/month",
  "Add a job for Pineview Property Care LLC, client is Green Valley Homes, invoice INV-2025-001 for $1,200 dated today",
  "Record a vendor payment of $350 to ABC Plumbing for job INV-2025-001 via ACH",
  "Add a BD expense of ৳45000 for office rent in May 2025",
  "Create a user john.smith with password pass123 as LLC owner for Pineview Property Care LLC",
  "Add working capital of $15000 from LLC owner John Smith for Pineview Property Care LLC",
];

function AIAssistantPage({data,onSave,showToast}){
  const [input,setInput]=useState("");
  const [loading,setLoading]=useState(false);
  const [history,setHistory]=useState([]);
  const inputRef=useRef(null);

  const buildCtx=d=>({
    groups:d.groups.map(g=>({id:g.id,name:g.name})),
    llcs:d.llcs.map(l=>({id:l.id,name:l.name,state:l.state,groupId:l.groupId})),
    users:d.users.map(u=>({id:u.id,username:u.username,role:u.role,name:u.name,llcId:u.llcId,groupId:u.groupId})),
    jobs:d.jobs.slice(-10).map(j=>({id:j.id,llcId:j.llcId,iRef:j.iRef,client:j.client,amount:j.amount,date:j.date})),
    settings:d.settings,
  });

  const systemPrompt=ctx=>`You are an AI data entry assistant for Ascentix. Interpret the command and return ONLY valid JSON (no markdown):
{
  "understood":"Plain English confirmation",
  "operations":[
    {"type":"create_group","data":{"name":"","contactName":"","email":"","phone":"","notes":""}},
    {"type":"create_llc","data":{"name":"","state":"","owner":"","email":"","model":"owner","ar":30,"or":70,"groupId":"","mgmtFeeType":"pct_rev","mgmtFeeValue":8,"active":true}},
    {"type":"create_job","data":{"llcId":"","client":"","cRef":"","iRef":"","date":"","amount":0,"vendors":[]}},
    {"type":"add_vendor_payment","data":{"jobId":"","vendorName":"","vRef":"","paymentDate":"","paymentAmount":0,"paymentDesc":"","paymentMethod":"ACH"}},
    {"type":"create_user","data":{"name":"","username":"","password":"","role":"llc_owner","llcId":"","groupId":"","email":""}},
    {"type":"add_bd_expense","data":{"cat":"Salary","amount":0,"date":"","desc":""}},
    {"type":"add_usa_expense","data":{"llcId":"","cat":"Other","amount":0,"date":"","desc":""}},
    {"type":"add_capital","data":{"src":"llc_owner","investor":"","llcId":"","amount":0,"date":"","type":"investment","desc":""}},
    {"type":"add_employee","data":{"name":"","designation":"","dept":"Operations","email":"","basicSalary":0,"houseRent":0,"medical":0,"transport":0,"pfRate":10,"pfEmployerRate":10,"bonusEligible":true,"bonusSharePct":20,"status":"active"}}
  ],
  "warnings":[]
}
Current data: ${JSON.stringify(ctx)}
Today: ${new Date().toISOString().slice(0,10)}
Rules: match groupId/llcId by name from current data. State abbreviations: Virginia=VA, Florida=FL, Texas=TX, California=CA. Only include needed operations.`;

  const send=async()=>{
    if(!input.trim())return;
    const cmd=input.trim();setInput("");setLoading(true);
    setHistory(h=>[...h,{role:"user",content:cmd,time:new Date().toLocaleTimeString()}]);
    try{
      const resp=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2000,system:systemPrompt(buildCtx(data)),messages:[{role:"user",content:cmd}]})});
      const rd=await resp.json();
      const raw=rd.content?.map(c=>c.text||"").join("")||"";
      const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
      setHistory(h=>[...h,{role:"assistant",content:parsed.understood,operations:parsed.operations,warnings:parsed.warnings||[],time:new Date().toLocaleTimeString()}]);
    }catch(e){setHistory(h=>[...h,{role:"error",content:"Could not process that command. Please try rephrasing.",time:new Date().toLocaleTimeString()}]);}
    setLoading(false);setTimeout(()=>inputRef.current?.focus(),100);
  };

  const applyOps=ops=>{
    if(!ops||ops.length===0){showToast("No operations to apply","error");return;}
    let ng=[...data.groups],nl=[...data.llcs],nj=[...data.jobs],nu=[...data.users],nb=[...data.bdExp],nue=[...data.usaExp],nc=[...data.capital],ne=[...data.employees];
    let count=0;
    ops.forEach(op=>{
      const d=op.data;
      const resolveLLC=name=>{if(!name)return null;const m=nl.find(l=>l.id===name||l.name.toLowerCase().includes(name.toLowerCase()));return m?m.id:name;};
      const resolveGroup=name=>{if(!name)return null;const m=ng.find(g=>g.id===name||g.name.toLowerCase().includes(name.toLowerCase()));return m?m.id:name;};
      if(op.type==="create_group"){ng.push({...d,id:uid()});count++;}
      else if(op.type==="create_llc"){nl.push({...d,id:uid(),groupId:resolveGroup(d.groupId),ar:+d.ar||30,or:+d.or||70,mgmtFeeValue:+d.mgmtFeeValue||8});count++;}
      else if(op.type==="create_job"){nj.push({...d,id:uid(),llcId:resolveLLC(d.llcId),amount:+d.amount||0,vendors:d.vendors||[]});count++;}
      else if(op.type==="add_vendor_payment"){const ji=nj.findIndex(j=>j.id===d.jobId||j.iRef===d.jobId);if(ji>=0){const job={...nj[ji],vendors:[...(nj[ji].vendors||[])]};let vi=job.vendors.findIndex(v=>v.name.toLowerCase()===(d.vendorName||"").toLowerCase());if(vi<0){job.vendors.push({id:uid(),name:d.vendorName||"Vendor",vRef:d.vRef||"",payments:[]});vi=job.vendors.length-1;}job.vendors[vi]={...job.vendors[vi],payments:[...job.vendors[vi].payments,{id:uid(),date:d.paymentDate||new Date().toISOString().slice(0,10),amount:+d.paymentAmount||0,desc:d.paymentDesc||"",method:d.paymentMethod||"ACH"}]};nj[ji]=job;count++;}}
      else if(op.type==="create_user"){if(!nu.find(u=>u.username===d.username)){nu.push({...d,id:uid(),llcId:resolveLLC(d.llcId),groupId:resolveGroup(d.groupId)});count++;}}
      else if(op.type==="add_bd_expense"){nb.push({...d,id:uid(),amount:+d.amount||0});count++;}
      else if(op.type==="add_usa_expense"){nue.push({...d,id:uid(),llcId:resolveLLC(d.llcId),amount:+d.amount||0});count++;}
      else if(op.type==="add_capital"){nc.push({...d,id:uid(),llcId:resolveLLC(d.llcId)||null,amount:+d.amount||0});count++;}
      else if(op.type==="add_employee"){ne.push({...d,id:uid(),basicSalary:+d.basicSalary||0,houseRent:+d.houseRent||0,medical:+d.medical||0,transport:+d.transport||0});count++;}
    });
    onSave("groups",ng);onSave("llcs",nl);onSave("jobs",nj);onSave("users",nu);
    onSave("bdExp",nb);onSave("usaExp",nue);onSave("capital",nc);onSave("employees",ne);
    showToast(`✓ ${count} item${count!==1?"s":""} saved to Firebase`);
    setHistory(h=>[...h,{role:"system",content:`✓ ${count} item${count!==1?"s":""} saved to Firebase`,time:new Date().toLocaleTimeString()}]);
  };

  const opColor=t=>({create_group:"teal",create_llc:"indigo",create_job:"green",add_vendor_payment:"red",create_user:"blue",add_bd_expense:"amber",add_usa_expense:"amber",add_capital:"purple",add_employee:"gray"}[t]||"gray");
  const opLabel=t=>({create_group:"Create Group",create_llc:"Create LLC",create_job:"Create Job",add_vendor_payment:"Add Vendor Payment",create_user:"Create User",add_bd_expense:"Add BD Expense",add_usa_expense:"Add USA Expense",add_capital:"Add Capital",add_employee:"Add Employee"}[t]||t);

  return <div>
    <div style={{...card,borderLeft:`4px solid ${C.indigo}`}}>
      <div style={{fontSize:"15px",fontWeight:700,color:C.text,marginBottom:"4px"}}>✦ AI Data Entry Assistant</div>
      <div style={{fontSize:"13px",color:C.textMuted,marginBottom:"12px"}}>Type any command in plain English → Claude understands → saves to Firebase → syncs everywhere instantly</div>
      <div style={{fontSize:"12px",color:C.textMid,fontWeight:500,marginBottom:"6px"}}>Examples — click to use:</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:"6px"}}>
        {EXAMPLE_COMMANDS.map((ex,i)=><button key={i} style={{...btnS,fontSize:"11px",textAlign:"left",padding:"4px 10px",color:C.indigoText,borderColor:C.indigoBorder,background:C.indigoBg}} onClick={()=>setInput(ex)}>{ex}</button>)}
      </div>
    </div>
    {history.length>0&&<div style={{...card,maxHeight:"420px",overflowY:"auto"}}>
      {history.map((msg,i)=><div key={i} style={{marginBottom:"14px"}}>
        {msg.role==="user"&&<div style={{display:"flex",gap:"10px",alignItems:"flex-start"}}>
          <div style={{width:"28px",height:"28px",borderRadius:"50%",background:C.indigo,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"10px",fontWeight:700,flexShrink:0}}>You</div>
          <div style={{flex:1}}><div style={{fontSize:"11px",color:C.textMuted,marginBottom:"3px"}}>{msg.time}</div><div style={{background:C.indigoBg,padding:"10px 14px",borderRadius:"8px",fontSize:"13px",color:C.indigoText}}>{msg.content}</div></div>
        </div>}
        {msg.role==="assistant"&&<div style={{display:"flex",gap:"10px",alignItems:"flex-start"}}>
          <div style={{width:"28px",height:"28px",borderRadius:"50%",background:C.green,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:"10px",fontWeight:700,flexShrink:0}}>AI</div>
          <div style={{flex:1}}>
            <div style={{fontSize:"11px",color:C.textMuted,marginBottom:"3px"}}>{msg.time}</div>
            <div style={{background:"#f0fdf4",border:`1px solid #6ee7b7`,padding:"10px 14px",borderRadius:"8px",fontSize:"13px",color:C.greenText,marginBottom:"8px"}}>{msg.content}</div>
            {msg.operations&&msg.operations.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"8px"}}>{msg.operations.map((op,oi)=><span key={oi} style={{...badge(opColor(op.type)),padding:"3px 10px",fontSize:"11px"}}>{opLabel(op.type)}: {op.data.name||op.data.iRef||op.data.username||op.data.desc||""}</span>)}</div>}
            {msg.warnings&&msg.warnings.length>0&&<div style={{padding:"6px 10px",background:C.amberBg,borderRadius:"6px",fontSize:"11px",color:C.amberText,marginBottom:"8px"}}>⚠ {msg.warnings.join(" · ")}</div>}
            <button style={{...btnP,padding:"6px 16px",fontSize:"12px"}} onClick={()=>applyOps(msg.operations)}>✓ Save to Firebase</button>
          </div>
        </div>}
        {msg.role==="system"&&<div style={{textAlign:"center",padding:"6px",fontSize:"12px",color:C.green,background:"#f0fdf4",borderRadius:"6px"}}>✓ {msg.content}</div>}
        {msg.role==="error"&&<div style={{textAlign:"center",padding:"6px",fontSize:"12px",color:C.red,background:C.redBg,borderRadius:"6px"}}>✕ {msg.content}</div>}
      </div>)}
      {loading&&<div style={{display:"flex",gap:"10px",alignItems:"center",padding:"10px",color:C.textMuted,fontSize:"13px"}}>
        <div style={{width:"16px",height:"16px",border:`2px solid ${C.indigo}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
        Claude is processing...
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>}
    </div>}
    <div style={{...card,position:"sticky",bottom:"0"}}>
      <div style={{display:"flex",gap:"10px",alignItems:"flex-end"}}>
        <div style={{flex:1}}>
          <textarea ref={inputRef} style={{...inp,resize:"vertical",minHeight:"60px",fontFamily:"inherit"}} placeholder='e.g. "Add portfolio group ZIC and create Pineview Property Care LLC in Virginia under it"' value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} />
          <div style={{fontSize:"11px",color:C.textMuted,marginTop:"4px"}}>Enter to send · Shift+Enter for new line</div>
        </div>
        <button style={{...btnP,padding:"12px 20px",fontSize:"14px",height:"60px",flexShrink:0}} onClick={send} disabled={loading||!input.trim()}>{loading?"...":"Send →"}</button>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// APP SHELLS
// ══════════════════════════════════════════════════════
const ADMIN_NAV=[
  {id:"dashboard",label:"Overview",icon:"▦"},
  {id:"groups",label:"Portfolio Groups",icon:"◈",section:"Entities"},
  {id:"llcs",label:"LLC Entities",icon:"▤"},
  {id:"jobs",label:"Jobs & Revenue",icon:"◎",section:"Operations"},
  {id:"receipts",label:"Client Receipts",icon:"◑"},
  {id:"llcpayments",label:"LLC → Ascentix Payments",icon:"◷"},
  {id:"expenses",label:"Expenses",icon:"▷"},
  {id:"payroll",label:"Payroll",icon:"◉"},
  {id:"capital",label:"Working Capital",icon:"◫"},
  {id:"reports",label:"Reports",icon:"⊞"},
  {id:"users",label:"User Management",icon:"◉",section:"Admin"},
  {id:"bankstatement",label:"Bank Statement Import",icon:"📄"},
  {id:"assistant",label:"AI Data Entry",icon:"✦"},
];
const GROUP_NAV=[{id:"dashboard",label:"Dashboard",icon:"▦"},{id:"receipts",label:"Client Receipts",icon:"◑"},{id:"payments",label:"Payments to Ascentix",icon:"◷"}];
const LLC_NAV=[{id:"dashboard",label:"Dashboard",icon:"▦"},{id:"jobs",label:"Work Orders",icon:"◎"},{id:"receipts",label:"Client Receipts",icon:"◑"},{id:"payments",label:"Payments to Ascentix",icon:"◷"}];

function AdminApp({data,onSave,showToast,currentUser,onLogout,toast}){
  const [nav,setNav]=useState("dashboard");
  const props={data,onSave,showToast,currentUser};
  const pages={dashboard:<Dashboard {...props}/>,groups:<GroupsPage {...props}/>,llcs:<LLCsPage {...props}/>,jobs:<JobsPage {...props}/>,receipts:<ClientReceiptsPage {...props}/>,llcpayments:<LLCPaymentsPage {...props} viewLlcId={null}/>,expenses:<ExpensesPage {...props}/>,payroll:<PayrollPage {...props}/>,capital:<CapitalPage {...props}/>,    reports:<ReportsPage {...props}/>,users:<UserManagementPage {...props}/>,bankstatement:<BankStatementPage {...props}/>,assistant:<AIAssistantPage {...props}/>};
  let currentSection=null;
  return <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",fontSize:"14px",lineHeight:1.5}}>
    <nav style={{width:"210px",borderRight:`1px solid ${C.border}`,background:C.card,display:"flex",flexDirection:"column",flexShrink:0,padding:"14px 10px"}}>
      <div style={{padding:"8px 8px 14px",borderBottom:`1px solid ${C.border}`,marginBottom:"8px"}}><div style={{fontWeight:700,fontSize:"15px"}}>Ascentix</div><div style={{fontSize:"11px",color:C.textMuted}}>Admin · {currentUser.name}</div></div>
      {ADMIN_NAV.map(n=>{const el=[];if(n.section){el.push(<SectionLabel key={`sl-${n.id}`}>{n.section}</SectionLabel>);}el.push(<NavBtn key={n.id} n={n} nav={nav} setNav={setNav}/>);return el;}).flat()}
      <div style={{marginTop:"auto",borderTop:`1px solid ${C.border}`,paddingTop:"10px"}}>
        <div style={{padding:"4px 10px",fontSize:"11px",color:C.textMuted}}>৳{data.settings.xRate}/USD</div>
        <button style={{...btnS,margin:"6px 10px 4px",fontSize:"12px"}} onClick={onLogout}>Sign out</button>
      </div>
    </nav>
    <div style={{flex:1,overflow:"auto",minWidth:0}}><div style={{padding:"22px 24px",maxWidth:"1100px"}}>{pages[nav]}</div></div>
    <Toast toast={toast}/>
  </div>;}

function GroupOwnerApp({data,onSave,showToast,currentUser,onLogout,toast}){
  const [nav,setNav]=useState("dashboard");
  const props={data,onSave,showToast,currentUser};
  const grp=data.groups.find(g=>g.id===currentUser.groupId);
  const myLLCIds=data.llcs.filter(l=>l.groupId===currentUser.groupId).map(l=>l.id);
  const gData={...data,jobs:data.jobs.filter(j=>myLLCIds.includes(j.llcId)),receipts:data.receipts.filter(r=>myLLCIds.includes(r.llcId)),llcPayments:data.llcPayments.filter(p=>myLLCIds.includes(p.llcId))};
  const gProps={...props,data:gData};
  const pages={dashboard:<GroupOwnerDashboard data={data} currentUser={currentUser}/>,receipts:<ClientReceiptsPage {...gProps}/>,payments:<LLCPaymentsPage {...gProps} viewLlcId={null}/>};
  return <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",fontSize:"14px",lineHeight:1.5}}>
    <nav style={{width:"196px",borderRight:`1px solid ${C.border}`,background:C.card,display:"flex",flexDirection:"column",flexShrink:0,padding:"14px 10px"}}>
      <div style={{padding:"8px 8px 14px",borderBottom:`1px solid ${C.border}`,marginBottom:"10px"}}><div style={{fontWeight:700,fontSize:"14px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{grp?.name||"My Portfolio"}</div><div style={{fontSize:"11px",color:C.textMuted}}>{currentUser.name}</div></div>
      {GROUP_NAV.map(n=><NavBtn key={n.id} n={n} nav={nav} setNav={setNav}/>)}
      <div style={{marginTop:"auto",borderTop:`1px solid ${C.border}`,paddingTop:"10px"}}><button style={{...btnS,margin:"6px 10px 4px",fontSize:"12px"}} onClick={onLogout}>Sign out</button></div>
    </nav>
    <div style={{flex:1,overflow:"auto",minWidth:0}}><div style={{padding:"22px 24px",maxWidth:"1100px"}}>{pages[nav]}</div></div>
    <Toast toast={toast}/>
  </div>;}

function LLCOwnerApp({data,onSave,showToast,currentUser,onLogout,toast}){
  const [nav,setNav]=useState("dashboard");
  const props={data,onSave,showToast,currentUser};
  const llc=data.llcs.find(l=>l.id===currentUser.llcId);
  const pages={dashboard:<LLCOwnerDashboard {...props}/>,jobs:<LLCOwnerJobsView {...props}/>,receipts:<ClientReceiptsPage {...props}/>,payments:<LLCPaymentsPage {...props}/>};
  return <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif",fontSize:"14px",lineHeight:1.5}}>
    <nav style={{width:"196px",borderRight:`1px solid ${C.border}`,background:C.card,display:"flex",flexDirection:"column",flexShrink:0,padding:"14px 10px"}}>
      <div style={{padding:"8px 8px 14px",borderBottom:`1px solid ${C.border}`,marginBottom:"10px"}}><div style={{fontWeight:700,fontSize:"14px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{llc?.name||"My Account"}</div><div style={{fontSize:"11px",color:C.textMuted}}>{currentUser.name}</div></div>
      {LLC_NAV.map(n=><NavBtn key={n.id} n={n} nav={nav} setNav={setNav}/>)}
      <div style={{marginTop:"auto",borderTop:`1px solid ${C.border}`,paddingTop:"10px"}}><button style={{...btnS,margin:"6px 10px 4px",fontSize:"12px"}} onClick={onLogout}>Sign out</button></div>
    </nav>
    <div style={{flex:1,overflow:"auto",minWidth:0}}><div style={{padding:"22px 24px",maxWidth:"1100px"}}>{pages[nav]}</div></div>
    <Toast toast={toast}/>
  </div>;}

// ══════════════════════════════════════════════════════
// ROOT
// ══════════════════════════════════════════════════════
export default function App(){
  const [data,setData]=useState(null);const[currentUser,setCurrentUser]=useState(null);const[toast,setToast]=useState(null);
  useEffect(()=>{dbLoad().then(d=>setData(d));},[]);
  const onSave=(key,val)=>{const nd={...data,[key]:val};setData(nd);dbSave(nd);};
  const showToast=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),3500);};
  const handleLogin=(un,pw)=>{
    // Hardcoded admin bypass — always works regardless of Firebase
    if(un==="admin"&&pw==="admin123"){
      setCurrentUser({id:"usr1",username:"admin",password:"admin123",role:"admin",name:"Ascentix Admin",email:"admin@ascentix.com.bd",llcId:null,groupId:null});
      return;
    }
    const users=data?.users||[];
    const u=users.find(u=>u.username===un&&u.password===pw);
    if(!u){showToast("Invalid username or password","error");return;}
    setCurrentUser(u);
  };
  const handleLogout=()=>setCurrentUser(null);
  if(!data) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,fontFamily:"system-ui,-apple-system,sans-serif"}}><div style={{textAlign:"center"}}><div style={{fontSize:"18px",fontWeight:600,color:C.text,marginBottom:"8px"}}>Ascentix</div><div style={{fontSize:"13px",color:C.textMuted}}>Loading...</div></div></div>;
  if(!currentUser) return <LoginPage onLogin={handleLogin} toast={toast}/>;
  const props={data,onSave,showToast,currentUser,onLogout:handleLogout,toast};
  if(currentUser.role==="admin") return <AdminApp {...props}/>;
  if(currentUser.role==="group_owner") return <GroupOwnerApp {...props}/>;
  return <LLCOwnerApp {...props}/>;
}
