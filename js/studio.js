// MapMaker Studio: phases, paper geometry, layer stack, compositing, export
const Studio = { phase:1, layers:[], paper:null, lastGeo:null, prepCache:new Map(), outside:'paper', dim:.75, paperColor:'#0b0d10', view:{s:1,x:0,y:0} };
const PAPER_MM={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],SQ:[300,300]};
let uid=1;

// ---------- phases ----------
function setPhase(n){
  if(n>=2&&nodes.length<3) return;
  Studio.phase=n;
  document.querySelectorAll('#top .phase').forEach(b=>b.classList.toggle('on',+b.dataset.ph===n));
  document.querySelectorAll('#side .ph').forEach(d=>d.style.display=+d.dataset.ph===n?'':'none');
  $('map').style.display=n===1?'':'none'; $('paperWrap').style.display=n===1?'none':'block';
  if(n===1) setTimeout(()=>map.invalidateSize(),0);
  if(n>=2){ computePaper(); fitView(); if(!Studio.layers.length) applyPreset(PRESETS[0]); else scheduleRender(); }
  if(n===3){ const p=Studio.paper, dpi=+$('dpi').value; $('dpiHint').textContent=`${Math.round(p.Wmm/25.4*dpi)} × ${Math.round(p.Hmm/25.4*dpi)} px · ${p.Wmm}×${p.Hmm} mm`; }
}
document.querySelectorAll('#top .phase').forEach(b=>b.onclick=()=>setPhase(+b.dataset.ph));
$('toCompose').onclick=()=>setPhase(2); $('toExport').onclick=()=>setPhase(3);
$('dpi').onchange=()=>setPhase(3);

onShapeChange=()=>{
  const ok=nodes.length>=3; $('toCompose').disabled=!ok; document.querySelectorAll('#top .phase').forEach(b=>{ if(+b.dataset.ph>1) b.disabled=!ok; });
  if(!ok){ $('kvArea').textContent='no area'; return; }
  const b=pathBBox(), w=b.e1-b.e0, h=b.n1-b.n0; $('kvArea').textContent=`${(w/1000).toFixed(2)} × ${(h/1000).toFixed(2)} km`;
  const r=autoRes(b); $('resHint').textContent=`Auto resolution ≈ ${r} m (${Math.round(w/r)} × ${Math.round(h/r)} cells)`;
  Studio.prepCache.clear();
};
function autoRes(b){ const cells=((b.e1-b.e0)*(b.n1-b.n0)); return Math.max(1,Math.ceil(Math.sqrt(cells/2.5e6))); }
['paperSize','paperOri','paperMargin','resSel'].forEach(id=>$(id).onchange=()=>{ Studio.prepCache.clear(); });

// ---------- paper geometry ----------
function computePaper(){
  const b=pathBBox(), aw=b.e1-b.e0, ah=b.n1-b.n0, margin=+$('paperMargin').value||0, size=$('paperSize').value, ori=$('paperOri').value;
  let Wmm,Hmm;
  if(size==='FIT'){ const L=300; if(aw>=ah){Wmm=L;Hmm=Math.round(L*ah/aw);} else {Hmm=L;Wmm=Math.round(L*aw/ah);} Wmm+=2*margin; Hmm+=2*margin; }
  else { let [a,c]=PAPER_MM[size]; const land = ori==='L' || (ori==='auto' && aw>ah); [Wmm,Hmm]= land?[c,a]:[a,c]; }
  const mw=Wmm-2*margin, mh=Hmm-2*margin, mmPerM=Math.min(mw/aw,mh/ah);
  // expand bbox to fill the map area (keeps aspect), centred on the area
  const fullW=mw/mmPerM, fullH=mh/mmPerM, ce=(b.e0+b.e1)/2, cn=(b.n0+b.n1)/2;
  const bbox={e0:ce-fullW/2,e1:ce+fullW/2,n0:cn-fullH/2,n1:cn+fullH/2};
  const res= $('resSel').value==='auto'? autoRes(bbox) : +$('resSel').value;
  const prev=Studio.paper;
  Studio.paper={Wmm,Hmm,marginMm:margin,mmPerM,bbox,res,areaPath:sampledPath()};
  const key=JSON.stringify([bbox,res]);
  if(!prev||prev.key!==key){ Grid.setArea(bbox,res); Studio.prepCache.clear(); }
  Studio.paper.key=key;
}
function makeEnv(pxPerMm){
  const p=Studio.paper, W=Math.round(p.Wmm*pxPerMm), H=Math.round(p.Hmm*pxPerMm), pxPerM=p.mmPerM*pxPerMm, m=p.marginMm*pxPerMm;
  return { W,H,Wmm:p.Wmm,Hmm:p.Hmm,marginMm:p.marginMm,pxPerMm,pxPerM,bbox:p.bbox,areaPath:p.areaPath,paperColor:Studio.paperColor,
    toPx:([e,n])=>[m+(e-p.bbox.e0)*pxPerM, m+(p.bbox.n1-n)*pxPerM], mm:([x,y])=>[x*pxPerMm,y*pxPerMm], map:{x:m,y:m,w:W-2*m,h:H-2*m} };
}

// ---------- layer stack ----------
function defaults(mod){ const o={}; for(const [k,,d] of mod.params) o[k]=d; return o; }
function addLayer(id,over={},opts={}){ const mod=MODULES[id]; const l={uid:uid++,id,p:{...defaults(mod),...over},opacity:opts.opacity??1,blend:opts.blend??mod.blend,on:true,open:false}; Studio.layers.push(l); return l; }
function applyPreset(ps){
  Studio.layers=[]; Studio.paperColor=ps.paper; $('paperColor').value=ps.paper; Studio.outside=ps.outside; $('outsideMode').value=ps.outside;
  ps.layers.forEach(l=>addLayer(l.id,l.p,l)); renderStack(); scheduleRender();
}
const presetsDiv=$('presets');
PRESETS.forEach(ps=>{ const b=document.createElement('button'); b.className='preset'; b.innerHTML=`<div class="sw">${ps.sw.map(c=>`<i style="background:${c}"></i>`).join('')}</div><span>${ps.name}</span>`; b.onclick=()=>applyPreset(ps); presetsDiv.appendChild(b); });
Object.values(MODULES).forEach(m=>$('addSel').add(new Option(m.name,m.id)));
$('addBtn').onclick=()=>{ const l=addLayer($('addSel').value); l.open=true; renderStack(); scheduleRender(); };
$('paperColor').oninput=e=>{ Studio.paperColor=e.target.value; Studio.prepCache.clear(); scheduleRender(); };
$('outsideMode').onchange=e=>{ Studio.outside=e.target.value; scheduleRender(); };
$('dimAmt').oninput=e=>{ Studio.dim=+e.target.value; scheduleRender(); };

function renderStack(){
  const st=$('stack'); st.innerHTML='';
  [...Studio.layers].reverse().forEach(l=>{
    const mod=MODULES[l.id], d=document.createElement('div'); d.className='layer'+(l.on?'':' off')+(l.open?' open':'');
    d.innerHTML=`<div class="hd"><input type="checkbox" ${l.on?'checked':''} title="visible"><span class="nm">${mod.name}</span><span class="ty">${mod.kind}</span><button title="up">▲</button><button title="down">▼</button><button title="duplicate">⧉</button><button title="remove" style="color:var(--danger)">✕</button></div><div class="bd"></div>`;
    const [hd,bd]=d.children, [cb,,,up,dn,dup,rm]=hd.children;
    cb.onchange=e=>{ l.on=cb.checked; d.classList.toggle('off',!l.on); scheduleRender(); }; cb.onclick=e=>e.stopPropagation();
    hd.onclick=e=>{ if(e.target.tagName==='BUTTON'||e.target.tagName==='INPUT') return; l.open=!l.open; d.classList.toggle('open',l.open); };
    const i=Studio.layers.indexOf(l);
    up.onclick=()=>{ if(i<Studio.layers.length-1){ [Studio.layers[i],Studio.layers[i+1]]=[Studio.layers[i+1],Studio.layers[i]]; renderStack(); scheduleRender(); } };
    dn.onclick=()=>{ if(i>0){ [Studio.layers[i],Studio.layers[i-1]]=[Studio.layers[i-1],Studio.layers[i]]; renderStack(); scheduleRender(); } };
    dup.onclick=()=>{ Studio.layers.splice(i+1,0,{...l,uid:uid++,p:{...l.p}}); renderStack(); scheduleRender(); };
    rm.onclick=()=>{ Studio.layers.splice(i,1); renderStack(); scheduleRender(); };
    // common controls
    bd.appendChild(row('Opacity', slider(l.opacity,0,1,.01,v=>{l.opacity=v;scheduleRender();})));
    bd.appendChild(row('Blend', select(l.blend,BLENDS,v=>{l.blend=v;scheduleRender();})));
    for(const spec of mod.params){
      const [k,label,def,step,type]=spec; let ctl;
      const set=v=>{ l.p[k]=v; scheduleRender(); };
      if(type==='text'){ ctl=document.createElement('input'); ctl.type='text'; ctl.value=l.p[k]; ctl.oninput=()=>set(ctl.value); ctl.style.width='150px'; }
      else if(Array.isArray(step)) ctl=select(l.p[k],step,set);
      else if(typeof def==='boolean'){ ctl=document.createElement('input'); ctl.type='checkbox'; ctl.checked=l.p[k]; ctl.onchange=()=>set(ctl.checked); }
      else if(typeof def==='string'){ ctl=document.createElement('input'); ctl.type='color'; ctl.value=l.p[k]; ctl.oninput=()=>set(ctl.value); }
      else { ctl=document.createElement('input'); ctl.type='number'; ctl.value=l.p[k]; ctl.step=step; ctl.onchange=()=>set(+ctl.value); }
      bd.appendChild(row(label,ctl));
    }
    st.appendChild(d);
  });
}
function row(label,ctl){ const d=document.createElement('div'); d.className='row'; const lb=document.createElement('label'); lb.textContent=label; d.append(lb,ctl); return d; }
function slider(v,a,b,s,cb){ const i=document.createElement('input'); i.type='range'; i.min=a; i.max=b; i.step=s; i.value=v; i.oninput=()=>cb(+i.value); return i; }
function select(v,opts,cb){ const s=document.createElement('select'); s.style.width='130px'; opts.forEach(o=>s.add(new Option(o,o))); s.value=v; s.onchange=()=>cb(s.value); return s; }

// ---------- rendering ----------
let renderTimer=null, rendering=false, pending=false;
function scheduleRender(){ clearTimeout(renderTimer); renderTimer=setTimeout(render,60); }
const busy=(t)=>{ $('sBusy').textContent=t||''; };
async function prepLayer(l, env){
  const mod=MODULES[l.id], key=JSON.stringify([l.id,l.p,Studio.paper.key,Studio.paperColor]);
  if(!Studio.prepCache.has(key)) Studio.prepCache.set(key, mod.prep(env,l.p).catch(e=>{ Studio.prepCache.delete(key); throw e; }));
  return Studio.prepCache.get(key);
}
async function composite(ctx, env, forSvg){
  const z=await Grid.fetch('dem'); const s=Grid.stats(z); env.zmin=s.mn; env.zmax=s.mx; env.info=Grid.info;
  const clip=new Path2D(); env.areaPath.forEach((q,i)=>{const [x,y]=env.toPx(q); i?clip.lineTo(x,y):clip.moveTo(x,y);}); clip.closePath();
  const svg=[]; let errs=[];
  const areaD=env.areaPath.map((q,i)=>{const [x,y]=env.toPx(q);return (i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);}).join('')+'Z';
  ctx.fillStyle=Studio.paperColor; ctx.fillRect(0,0,env.W,env.H);
  if(forSvg) svg.push(`<rect width="${env.W}" height="${env.H}" fill="${Studio.paperColor}"/><defs><clipPath id="area"><path d="${areaD}"/></clipPath></defs>`);
  const datas=await Promise.all(Studio.layers.map(l=>l.on?prepLayer(l,env).catch(e=>{errs.push(`${MODULES[l.id].name}: ${e.message}`);return null;}):null));
  for(let i=0;i<Studio.layers.length;i++){
    const l=Studio.layers[i], d=datas[i]; if(!l.on||!d) continue; const mod=MODULES[l.id];
    const doClip = !mod.noclip && Studio.outside==='paper';
    ctx.save(); ctx.globalAlpha=l.opacity; ctx.globalCompositeOperation=l.blend;
    if(doClip) ctx.clip(clip);
    if(!mod.noclip){ ctx.beginPath(); ctx.rect(env.map.x,env.map.y,env.map.w,env.map.h); ctx.clip(); }
    mod.draw(ctx,env,l.p,d); ctx.restore();
    if(forSvg){ const body=await mod.svg(env,l.p,d); const bm=BLEND_SVG[l.blend]||l.blend; svg.push(`<g opacity="${l.opacity}" style="mix-blend-mode:${bm}"${doClip?' clip-path="url(#area)"':''}>${body}</g>`); }
  }
  if(Studio.outside==='dim'){ const outer=new Path2D(); outer.rect(0,0,env.W,env.H); outer.addPath(clip);
    ctx.save(); ctx.clip(outer,'evenodd'); ctx.globalAlpha=Studio.dim; ctx.fillStyle=Studio.paperColor; ctx.fillRect(0,0,env.W,env.H); ctx.restore();
    if(forSvg) svg.push(`<path d="M0 0H${env.W}V${env.H}H0Z ${areaD}" fill="${Studio.paperColor}" fill-opacity="${Studio.dim}" fill-rule="evenodd"/>`);
    // redraw noclip layers on top of the dim so frame/outline stay crisp
    for(let i=0;i<Studio.layers.length;i++){ const l=Studio.layers[i], d=datas[i]; if(!l.on||!d||!MODULES[l.id].noclip||MODULES[l.id].kind!=='vector') continue; ctx.save(); ctx.globalAlpha=l.opacity; MODULES[l.id].draw(ctx,env,l.p,d); ctx.restore(); }
  }
  return {svg,errs};
}
async function render(){
  if(Studio.phase<2) return;
  if(rendering){ pending=true; return; } rendering=true; busy('rendering…');
  try{
    computePaper();
    const wrap=$('paperWrap'), fitPx=Math.min(wrap.clientWidth/Studio.paper.Wmm, wrap.clientHeight/Studio.paper.Hmm)*.92;
    const pxPerMm=fitPx*Math.max(1,Studio.view.s)*(window.devicePixelRatio||1);
    const env=makeEnv(pxPerMm), cv=$('paper'); cv.width=env.W; cv.height=env.H;
    const {errs}=await composite(cv.getContext('2d'),env,false);
    const p=Studio.paper; $('sInfo').textContent=`${p.Wmm}×${p.Hmm} mm · 1:${Math.round(1000/p.mmPerM)} · ${Grid.info.w}×${Grid.info.h} @ ${Grid.info.res} m`+(errs.length?'  ⚠ '+errs.join(' · '):'');
    layoutPaper();
  }catch(e){ $('sInfo').textContent='⚠ '+e.message; console.error(e); }
  busy(''); rendering=false; if(pending){ pending=false; render(); }
}
// preview pan/zoom
function fitView(){ Studio.view={s:1,x:0,y:0}; layoutPaper(); }
function layoutPaper(){ const wrap=$('paperWrap'), cv=$('paper'), fit=Math.min(wrap.clientWidth/Studio.paper.Wmm, wrap.clientHeight/Studio.paper.Hmm)*.92, s=fit*Studio.view.s;
  const w=Studio.paper.Wmm*s, h=Studio.paper.Hmm*s; cv.style.width=w+'px'; cv.style.height=h+'px'; cv.style.left=(wrap.clientWidth-w)/2+Studio.view.x+'px'; cv.style.top=(wrap.clientHeight-h)/2+Studio.view.y+'px'; }
$('paperWrap').addEventListener('wheel',e=>{ e.preventDefault(); Studio.view.s=Math.max(.5,Math.min(8,Studio.view.s*(e.deltaY<0?1.15:1/1.15))); layoutPaper(); clearTimeout(renderTimer); renderTimer=setTimeout(render,250); },{passive:false});
(()=>{ let drag=null; const w=$('paperWrap'); w.onmousedown=e=>{drag=[e.clientX-Studio.view.x,e.clientY-Studio.view.y];}; window.addEventListener('mousemove',e=>{ if(drag){Studio.view.x=e.clientX-drag[0];Studio.view.y=e.clientY-drag[1];layoutPaper();} }); window.addEventListener('mouseup',()=>drag=null); w.ondblclick=()=>{fitView();scheduleRender();}; })();
window.addEventListener('resize',()=>{ if(Studio.phase>=2) scheduleRender(); });

// ---------- export ----------
const dl=(blob,name)=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); };
const fname=()=>((Studio.layers.find(l=>l.id==='frame')?.p.title||'terrain').toLowerCase().replace(/[^a-z0-9]+/g,'-'));
$('expPng').onclick=async()=>{
  busy('exporting PNG…');
  try{ const dpi=+$('dpi').value, env=makeEnv(dpi/25.4), cv=new OffscreenCanvas(env.W,env.H); await composite(cv.getContext('2d'),env,false); dl(await cv.convertToBlob({type:'image/png'}),`${fname()}-${dpi}dpi.png`); }
  catch(e){ $('sInfo').textContent='⚠ '+e.message; }
  busy('');
};
$('expSvg').onclick=async()=>{
  busy('exporting SVG…');
  try{ const env=makeEnv(96/25.4), cv=new OffscreenCanvas(env.W,env.H); const {svg}=await composite(cv.getContext('2d'),env,true);
    const s=`<svg xmlns="http://www.w3.org/2000/svg" width="${env.Wmm}mm" height="${env.Hmm}mm" viewBox="0 0 ${env.W} ${env.H}">${svg.join('\n')}</svg>`;
    dl(new Blob([s],{type:'image/svg+xml'}),`${fname()}.svg`); }
  catch(e){ $('sInfo').textContent='⚠ '+e.message; }
  busy('');
};
$('expGeo').onclick=()=>{ if(Studio.lastGeo) dl(new Blob([JSON.stringify(Studio.lastGeo)],{type:'application/geo+json'}),'contours.geojson'); else $('sInfo').textContent='Add a Contours layer first'; };
$('expJson').onclick=()=>{ const proj={nodes,paper:{size:$('paperSize').value,ori:$('paperOri').value,margin:$('paperMargin').value,res:$('resSel').value},paperColor:Studio.paperColor,outside:Studio.outside,dim:Studio.dim,layers:Studio.layers.map(l=>({id:l.id,p:l.p,opacity:l.opacity,blend:l.blend,on:l.on}))}; dl(new Blob([JSON.stringify(proj,null,1)],{type:'application/json'}),`${fname()}.terrain.json`); };
$('impJson').onclick=()=>$('impFile').click();
$('impFile').onchange=async e=>{ const f=e.target.files[0]; if(!f) return; const j=JSON.parse(await f.text());
  nodes=j.nodes; $('paperSize').value=j.paper.size; $('paperOri').value=j.paper.ori; $('paperMargin').value=j.paper.margin; $('resSel').value=j.paper.res;
  Studio.paperColor=j.paperColor; $('paperColor').value=j.paperColor; Studio.outside=j.outside; $('outsideMode').value=j.outside; Studio.dim=j.dim; $('dimAmt').value=j.dim;
  Studio.layers=[]; j.layers.forEach(l=>{ const L=addLayer(l.id,l.p,l); L.on=l.on; }); drawShape(); drawEdit(); renderStack(); Studio.prepCache.clear(); setPhase(2); e.target.value=''; };

// demo: #demo draws a shape and jumps to compose
if(location.hash.startsWith('#demo')){ setTimeout(()=>{ nodes=makeCircle(toEN(L.latLng(...HOME)),700); splitSeg(0); nodes[1].p=add(nodes[1].p,[300,200]); drawShape(); drawEdit(); map.fitBounds(shapePoly.getBounds()); setPhase(2);
  const ps=PRESETS.find(p=>p.name.toLowerCase()===decodeURIComponent(location.hash.slice(6)).toLowerCase()); if(ps) applyPreset(ps); },400); }
