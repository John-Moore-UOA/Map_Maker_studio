// Terrain modules. Each: {id,name,kind,params,prep(env,p)->data, draw(ctx,env,p,data), svg(env,p,data)}
// env: {info, pxPerM, pxPerMm, toPx([e,n])->[x,y], mm([xmm,ymm])->[x,y], W,H (paper px), map:{x,y,w,h}, bbox, zmin,zmax, paperColor}
// Geometry is prepared in metres (or paper mm when item.paper) so one prep serves preview and export.

// ---------- helpers ----------
const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=c=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const RAMPS={
  terrain:[[0,'#2e7846'],[.08,'#78aa5a'],[.25,'#d7d282'],[.5,'#be8c50'],[.75,'#966e5a'],[1,'#f5f5f5']],
  grey:[[0,'#111111'],[1,'#f2f2f2']],
  greyInv:[[0,'#f2f2f2'],[1,'#111111']],
  sepia:[[0,'#3b2a1a'],[.5,'#a67c52'],[1,'#f3e9d2']],
  ocean:[[0,'#061a2b'],[.4,'#0f4c75'],[.7,'#3282b8'],[1,'#bbe1fa']],
  magma:[[0,'#000004'],[.25,'#3b0f70'],[.5,'#8c2981'],[.75,'#de4968'],[.9,'#fe9f6d'],[1,'#fcfdbf']],
  viridis:[[0,'#440154'],[.25,'#3b528b'],[.5,'#21918c'],[.75,'#5ec962'],[1,'#fde725']],
  clinical:[[0,'#0b0d10'],[.5,'#1f6f6a'],[1,'#2dd4bf']],
  blueprint:[[0,'#0b2a5b'],[1,'#dbe7ff']],
  custom:null
};
function rampFn(name,lo,hi){
  const stops=(name==='custom'||!RAMPS[name])?[[0,lo||'#000'],[1,hi||'#fff']]:RAMPS[name];
  const cs=stops.map(([t,c])=>[t,hex2rgb(c)]);
  return t=>{ t=Math.max(0,Math.min(1,t)); let i=0; while(i<cs.length-2&&t>cs[i+1][0])i++; const [t0,a]=cs[i],[t1,b]=cs[i+1],u=(t-t0)/(t1-t0||1); return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+(b[2]-a[2])*u]; };
}
const rampOpts=Object.keys(RAMPS);
const BLENDS=['source-over','multiply','screen','overlay','soft-light','hard-light','darken','lighten','difference','color-burn','color-dodge'];
const BLEND_SVG={'source-over':'normal'};

// raster helper: fn(i,out) sets out[0..3]
async function makeRaster(env, fill){
  const {w,h}=env.info, cv=new OffscreenCanvas(w,h), cx=cv.getContext('2d'), img=cx.createImageData(w,h), d=img.data, px=[0,0,0,0];
  for(let i=0;i<w*h;i++){ px[3]=0; fill(i,px); d[i*4]=px[0];d[i*4+1]=px[1];d[i*4+2]=px[2];d[i*4+3]=px[3]; }
  cx.putImageData(img,0,0); return {canvas:cv};
}
function gridRect(env){ const {info}=env, [x,y]=env.toPx([info.e0,info.ntop]); return [x,y,info.w*info.res*env.pxPerM,info.h*info.res*env.pxPerM]; }
function drawRaster(ctx,env,p,data){ const [x,y,w,h]=gridRect(env); ctx.imageSmoothingEnabled=!p.pixelate; ctx.drawImage(data.canvas,x,y,w,h); }
async function svgRaster(env,p,data){ const [x,y,w,h]=gridRect(env); const blob=await data.canvas.convertToBlob(); const url=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob);});
  return `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none" href="${url}" style="image-rendering:${p.pixelate?'pixelated':'auto'}"/>`; }

// vector helper. data={lines:[{pts,stroke,width(mm),fill,dash,closed,paper}],texts:[{p,text,size(mm),color,font,anchor,angle,paper}]}
function toXY(env,it,pt){ return it.paper?env.mm(pt):env.toPx(pt); }
function drawVec(ctx,env,p,data){
  for(const it of data.lines){
    if(it.pts.length<2) continue;
    ctx.beginPath(); it.pts.forEach((q,i)=>{const [x,y]=toXY(env,it,q); i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); if(it.closed) ctx.closePath();
    if(it.fill){ ctx.fillStyle=it.fill; ctx.fill(); }
    if(it.stroke&&it.width>0){ ctx.strokeStyle=it.stroke; ctx.lineWidth=it.width*env.pxPerMm; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.setLineDash((it.dash||[]).map(v=>v*env.pxPerMm)); ctx.stroke(); ctx.setLineDash([]); }
  }
  for(const t of data.texts||[]){
    const [x,y]=toXY(env,t,t.p); ctx.save(); ctx.translate(x,y); ctx.rotate(t.angle||0);
    ctx.font=`${t.weight||400} ${t.size*env.pxPerMm}px ${t.font||'sans-serif'}`; ctx.fillStyle=t.color; ctx.textAlign=t.anchor||'center'; ctx.textBaseline=t.baseline||'middle';
    if(t.halo){ ctx.lineWidth=t.size*env.pxPerMm*.25; ctx.strokeStyle=t.halo; ctx.lineJoin='round'; ctx.strokeText(t.text,0,0); }
    ctx.fillText(t.text,0,0); ctx.restore();
  }
}
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
function svgVec(env,p,data){
  let s='';
  for(const it of data.lines){
    if(it.pts.length<2) continue;
    const d=it.pts.map((q,i)=>{const [x,y]=toXY(env,it,q);return (i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2);}).join('')+(it.closed?'Z':'');
    s+=`<path d="${d}" fill="${it.fill||'none'}" stroke="${it.stroke&&it.width>0?it.stroke:'none'}" stroke-width="${(it.width||0)*env.pxPerMm}" stroke-linejoin="round" stroke-linecap="round"${it.dash?` stroke-dasharray="${it.dash.map(v=>v*env.pxPerMm).join(' ')}"`:''}/>`;
  }
  for(const t of data.texts||[]){
    const [x,y]=toXY(env,t,t.p), an={left:'start',center:'middle',right:'end'}[t.anchor||'center'], bl={top:'hanging',middle:'central',bottom:'auto',alphabetic:'auto'}[t.baseline||'middle'];
    const attrs=`x="${x}" y="${y}" font-size="${t.size*env.pxPerMm}" font-family="${t.font||'sans-serif'}" font-weight="${t.weight||400}" text-anchor="${an}" dominant-baseline="${bl}"${t.angle?` transform="rotate(${t.angle*180/Math.PI} ${x} ${y})"`:''}`;
    if(t.halo) s+=`<text ${attrs} fill="none" stroke="${t.halo}" stroke-width="${t.size*env.pxPerMm*.25}" stroke-linejoin="round">${esc(t.text)}</text>`;
    s+=`<text ${attrs} fill="${t.color}">${esc(t.text)}</text>`;
  }
  return s;
}
const gridToEN=(env,x,y)=>[env.info.e0+x*env.info.res, env.info.ntop-y*env.info.res];
function smoothGrid(a,w,h,passes){ const t=new Float32Array(w*h);
  for(let k=0;k<passes;k++){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;t[i]=(a[i-(x>0)]+a[i]+a[i+(x<w-1)])/3;}
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;a[i]=(t[i-(y>0?w:0)]+t[i]+t[i+(y<h-1?w:0)])/3;}
  } return a; }
function filled(z,fillv){ const f=new Float64Array(z.length); for(let i=0;i<z.length;i++) f[i]=isNaN(z[i])?fillv:z[i]; return f; }
function hash2(x,y){ let h=(x*374761393+y*668265263)|0; h=(h^(h>>13))*1274126177; return ((h^(h>>16))>>>0)/4294967296; }
function valueNoise(x,y){ const xi=Math.floor(x),yi=Math.floor(y),u=x-xi,v=y-yi, s=t=>t*t*(3-2*t);
  const a=hash2(xi,yi),b=hash2(xi+1,yi),c=hash2(xi,yi+1),d=hash2(xi+1,yi+1); return a+(b-a)*s(u)+(c-a)*s(v)+(a-b-c+d)*s(u)*s(v); }

// param spec: [key,label,default,step] number | [key,label,'#hex'] color | [key,label,default,[opts]] select | [key,label,true/false] bool | [key,label,'text',null,'text']
const MODULES={};
function def(m){ MODULES[m.id]=m; }

// ---------- HILLSHADE ----------
def({ id:'hillshade', name:'Hillshade', kind:'raster', blend:'multiply',
  params:[['az','Light azimuth',315,5],['alt','Light altitude',45,1],['exag','Vertical exaggeration',1.5,.1],['multi','Multi-directional',true],['contrast','Contrast',1,.1],['lightC','Light colour','#ffffff'],['shadeC','Shadow colour','#000000'],['pixelate','Pixelate',false]],
  async prep(env,p){
    const {gx,gy}=await Grid.slopeAspect(), lc=hex2rgb(p.lightC), sc=hex2rgb(p.shadeC);
    const shade=(i,az,alt)=>{ const dzx=gx[i]*p.exag, dzy=gy[i]*p.exag; const sl=Math.atan(Math.hypot(dzx,dzy)); const asp=Math.atan2(-dzy,dzx); const azr=Math.PI/180*(90-az), altr=Math.PI/180*alt;
      return Math.sin(altr)*Math.cos(sl)+Math.cos(altr)*Math.sin(sl)*Math.cos(azr-asp+Math.PI); };
    return makeRaster(env,(i,o)=>{ if(isNaN(gx[i])) return;
      let v=p.multi? .5*shade(i,p.az,p.alt)+.25*shade(i,p.az-45,p.alt+10)+.25*shade(i,p.az+45,p.alt+10) : shade(i,p.az,p.alt);
      v=Math.max(0,Math.min(1,.5+(v-.5)*p.contrast)); o[0]=sc[0]+(lc[0]-sc[0])*v;o[1]=sc[1]+(lc[1]-sc[1])*v;o[2]=sc[2]+(lc[2]-sc[2])*v;o[3]=255; });
  }, draw:drawRaster, svg:svgRaster });

// ---------- HYPSOMETRIC TINT ----------
def({ id:'tint', name:'Elevation tint', kind:'raster', blend:'source-over',
  params:[['ramp','Ramp','terrain',rampOpts],['lo','Low colour','#0b0d10'],['hi','High colour','#2dd4bf'],['gamma','Gamma',1,.1],['steps','Steps (0=smooth)',0,1],['pixelate','Pixelate',false]],
  async prep(env,p){ const z=await Grid.fetch('dem'), f=rampFn(p.ramp,p.lo,p.hi), rng=env.zmax-env.zmin||1;
    return makeRaster(env,(i,o)=>{ const v=z[i]; if(isNaN(v)) return; let t=Math.pow((v-env.zmin)/rng,p.gamma); if(p.steps>0) t=Math.floor(t*p.steps)/p.steps; const c=f(t); o[0]=c[0];o[1]=c[1];o[2]=c[2];o[3]=255; }); },
  draw:drawRaster, svg:svgRaster });

// ---------- SLOPE ----------
def({ id:'slope', name:'Slope shading', kind:'raster', blend:'multiply',
  params:[['ramp','Ramp','greyInv',rampOpts],['lo','Flat colour','#ffffff'],['hi','Steep colour','#000000'],['maxDeg','Max slope (°)',45,1],['pixelate','Pixelate',false]],
  async prep(env,p){ const {gx,gy}=await Grid.slopeAspect(), f=rampFn(p.ramp,p.lo,p.hi);
    return makeRaster(env,(i,o)=>{ if(isNaN(gx[i])) return; const s=Math.atan(Math.hypot(gx[i],gy[i]))*180/Math.PI; const c=f(s/p.maxDeg); o[0]=c[0];o[1]=c[1];o[2]=c[2];o[3]=255; }); },
  draw:drawRaster, svg:svgRaster });

// ---------- ASPECT ----------
def({ id:'aspect', name:'Aspect', kind:'raster', blend:'source-over',
  params:[['sat','Saturation',.7,.05],['light','Lightness',.5,.05],['minSlope','Min slope (°)',2,.5],['sectors','Sectors (0=continuous)',0,1],['pixelate','Pixelate',false]],
  async prep(env,p){ const {gx,gy}=await Grid.slopeAspect();
    const hsl=(h,s,l)=>{ const k=n=>(n+h/30)%12, a=s*Math.min(l,1-l), f=n=>l-a*Math.max(-1,Math.min(k(n)-3,9-k(n),1)); return [255*f(0),255*f(8),255*f(4)]; };
    return makeRaster(env,(i,o)=>{ if(isNaN(gx[i])) return; const sl=Math.atan(Math.hypot(gx[i],gy[i]))*180/Math.PI; if(sl<p.minSlope) return;
      let a=(Math.atan2(gx[i],gy[i])*180/Math.PI+180)%360; if(p.sectors>0) a=Math.floor(a/(360/p.sectors))*(360/p.sectors); const c=hsl(a,p.sat,p.light); o[0]=c[0];o[1]=c[1];o[2]=c[2];o[3]=255; }); },
  draw:drawRaster, svg:svgRaster });

// ---------- CONTOURS ----------
function contourGeo(env,p,z){
  const {w,h}=env.info, {mn,mx}=Grid.stats(z), f=filled(z,mn-1000); smoothGrid(f,w,h,p.smooth|0);
  const th=[]; for(let v=Math.ceil(mn/p.interval)*p.interval; v<=mx; v+=p.interval) th.push(+v.toFixed(4));
  if(th.length>1500) throw new Error('Too many contour levels, increase interval');
  const valid=i=>!isNaN(z[i]);
  const ok=(x,y)=>valid(Math.min(h-1,Math.max(0,Math.floor(y)))*w+Math.min(w-1,Math.max(0,Math.floor(x))));
  const out=[];
  for(const c of d3.contours().size([w,h]).thresholds(th)(f)){
    const lines=[];
    for(const poly of c.coordinates) for(const ring of poly){ let run=[]; for(const pt of ring){ if(ok(pt[0],pt[1])) run.push(gridToEN(env,pt[0],pt[1])); else { if(run.length>1) lines.push(run); run=[]; } } if(run.length>1) lines.push(run); }
    if(lines.length) out.push({value:c.value, lines, isIdx: Math.abs(c.value/(p.interval*p.index)-Math.round(c.value/(p.interval*p.index)))<1e-6});
  }
  return out;
}
def({ id:'contours', name:'Contours', kind:'vector', blend:'source-over',
  params:[['interval','Interval (m)',5,.5],['index','Index every N',5,1],['smooth','Smoothing',2,1],['color','Colour','#2dd4bf'],['idxColor','Index colour','#2dd4bf'],['width','Width (mm)',.15,.05],['idxWidth','Index width (mm)',.4,.05],['labels','Index labels',true],['labelSize','Label size (mm)',2.2,.1],['font','Font','monospace',['monospace','sans-serif','serif']]],
  async prep(env,p){
    const z=await Grid.fetch('dem'), cs=contourGeo(env,p,z), lines=[], texts=[], feats=[];
    for(const c of cs){
      for(const l of c.lines){ lines.push({pts:l,stroke:c.isIdx?p.idxColor:p.color,width:c.isIdx?p.idxWidth:p.width});
        if(p.labels&&c.isIdx&&l.length>40){ const k=Math.floor(l.length/2), a=l[k-2], b=l[k+2]; let ang=-Math.atan2(b[1]-a[1],b[0]-a[0]); if(Math.abs(ang)>Math.PI/2) ang+=Math.PI;
          texts.push({p:l[k],text:`${c.value}`,size:p.labelSize,color:c.isIdx?p.idxColor:p.color,font:p.font,angle:ang,halo:env.paperColor}); } }
      feats.push({type:'Feature',properties:{elev:c.value,index:c.isIdx},geometry:{type:'MultiLineString',coordinates:c.lines.map(l=>l.map(q=>{const ll=toLL(q);return [ll.lng,ll.lat];}))}});
    }
    Studio.lastGeo={type:'FeatureCollection',features:feats};
    return {lines,texts,info:`${cs.length} levels`};
  }, draw:drawVec, svg:svgVec });

// ---------- ELEVATION BANDS (paper-cut) ----------
def({ id:'bands', name:'Elevation bands', kind:'vector', blend:'source-over',
  params:[['interval','Band height (m)',10,1],['smooth','Smoothing',3,1],['ramp','Ramp','clinical',rampOpts],['lo','Low colour','#0b0d10'],['hi','High colour','#2dd4bf'],['edge','Edge colour','#000000'],['edgeW','Edge width (mm)',.1,.05],['shadow','Drop shadow',true]],
  async prep(env,p){
    const z=await Grid.fetch('dem'), {w,h}=env.info, {mn,mx}=Grid.stats(z), f=filled(z,mn-1000); smoothGrid(f,w,h,p.smooth|0);
    const th=[]; for(let v=Math.floor(mn/p.interval)*p.interval; v<=mx; v+=p.interval) th.push(v);
    if(th.length>400) throw new Error('Too many bands, increase band height');
    const ramp=rampFn(p.ramp,p.lo,p.hi), lines=[], sh=p.shadow?env.info.res*1.2:0;
    const polys=d3.contours().size([w,h]).thresholds(th)(f);
    polys.forEach((c,k)=>{ const col=rgb2hex(ramp(k/Math.max(1,th.length-1)));
      for(const poly of c.coordinates){
        if(sh) poly.forEach(ring=>lines.push({pts:ring.map(q=>{const e=gridToEN(env,q[0],q[1]);return [e[0]+sh,e[1]-sh];}),fill:'rgba(0,0,0,.35)',closed:true}));
        poly.forEach((ring,ri)=>lines.push({pts:ring.map(q=>gridToEN(env,q[0],q[1])),fill:ri===0?col:env.paperColor,stroke:p.edge,width:p.edgeW,closed:true}));
      } });
    return {lines,texts:[]};
  }, draw:drawVec, svg:svgVec });

// ---------- RIDGELINES / MESH ----------
def({ id:'ridgelines', name:'Ridgelines (2.5D)', kind:'vector', blend:'source-over',
  params:[['mode','Mode','fill',['fill','lines','mesh']],['dir','Direction','rows',['rows','columns']],['count','Line count',80,1],['relief','Relief (% of height)',25,1],['smooth','Smoothing',2,1],['color','Line colour','#e6e9ec'],['width','Width (mm)',.2,.05],['fill','Fill colour','#0b0d10'],['step','Sample step (px)',2,1]],
  async prep(env,p){
    const z=await Grid.fetch('dem'), {w,h}=env.info, {mn,mx}=Grid.stats(z), f=filled(z,mn); smoothGrid(f,w,h,p.smooth|0);
    const lines=[], rng=mx-mn||1, reliefM=(p.relief/100)*(env.bbox.n1-env.bbox.n0); // displacement expressed in metres northing
    const rows=p.dir==='rows', n=Math.max(2,p.count|0), nAcross=rows?h:w, nAlong=rows?w:h, step=Math.max(1,p.step|0);
    const mk=(k,flipAxis)=>{ const pos=Math.round(k*(nAcross-1)/(n-1)), pts=[];
      for(let j=0;j<nAlong;j+=step){ const x=rows?j:pos, y=rows?pos:j, v=f[y*w+x]; const en=gridToEN(env,x,y); const d=(v-mn)/rng*reliefM; pts.push([en[0],en[1]+d]); }
      return pts; };
    const baseY=env.bbox.n0-reliefM; // to close fill down to below the map
    if(p.mode==='mesh'||p.mode==='lines'){
      for(let k=0;k<n;k++) lines.push({pts:mk(k),stroke:p.color,width:p.width});
      if(p.mode==='mesh'){ const n2=Math.round(n*w/h); for(let k=0;k<n2;k++){ const pos=Math.round(k*(w-1)/(n2-1)), pts=[]; for(let y=0;y<h;y+=step){ const v=f[y*w+pos], en=gridToEN(env,pos,y); pts.push([en[0],en[1]+(v-mn)/rng*reliefM]); } lines.push({pts,stroke:p.color,width:p.width}); } }
    } else { // fill: draw far (top) rows first, each filled down to occlude those behind
      for(let k=0;k<n;k++){ const pts=mk(k); const first=pts[0], last=pts[pts.length-1];
        const poly=rows? pts.concat([[last[0],baseY],[first[0],baseY]]) : pts.concat([[env.bbox.e1+reliefM,last[1]],[env.bbox.e1+reliefM,first[1]]]);
        lines.push({pts:poly,fill:p.fill,closed:true}); lines.push({pts,stroke:p.color,width:p.width}); }
    }
    return {lines,texts:[]};
  }, draw:drawVec, svg:svgVec });

// ---------- HACHURES ----------
def({ id:'hachures', name:'Hachures', kind:'vector', blend:'source-over',
  params:[['spacing','Spacing (mm)',1.2,.1],['len','Length scale',1,.1],['minSlope','Min slope (°)',3,.5],['color','Colour','#e6e9ec'],['width','Width (mm)',.12,.02],['jitter','Jitter',.5,.05],['weightBySlope','Thicker when steep',true]],
  async prep(env,p){
    const {gx,gy}=await Grid.slopeAspect(), {w,h,res}=env.info, lines=[];
    const spM=p.spacing*env.pxPerMm/env.pxPerM; // spacing in metres
    const stepC=Math.max(1,spM/res);
    for(let gy_=0;gy_<h;gy_+=stepC)for(let gx_=0;gx_<w;gx_+=stepC){
      const jx=(hash2(gx_|0,gy_|0)-.5)*p.jitter*stepC, jy=(hash2(gy_|0,gx_|0)-.5)*p.jitter*stepC;
      const x=Math.min(w-1,Math.max(0,Math.round(gx_+jx))), y=Math.min(h-1,Math.max(0,Math.round(gy_+jy))), i=y*w+x;
      if(isNaN(gx[i])) continue; const sl=Math.atan(Math.hypot(gx[i],gy[i]))*180/Math.PI; if(sl<p.minSlope) continue;
      const dx=-gx[i], dy=gy[i]; const L=Math.hypot(dx,dy)||1; const len=spM*p.len*Math.min(1.6,.4+sl/30); // downslope in map (east, north): gx is d/dx east; gy is d/drow (south+) so north component = +gy
      const en=gridToEN(env,x,y); lines.push({pts:[[en[0]-dx/L*len/2,en[1]-dy/L*len/2],[en[0]+dx/L*len/2,en[1]+dy/L*len/2]],stroke:p.color,width:p.weightBySlope?p.width*(.5+sl/30):p.width});
    }
    return {lines,texts:[]};
  }, draw:drawVec, svg:svgVec });

// ---------- STREAMS ----------
def({ id:'streams', name:'Streams (flow)', kind:'vector', blend:'source-over',
  params:[['thresh','Threshold log10(cells)',2.2,.1],['color','Colour','#3b82f6'],['minW','Min width (mm)',.1,.05],['maxW','Max width (mm)',.6,.05]],
  async prep(env,p){
    const [acc,z]=await Promise.all([Grid.fetch('flow'),Grid.fetch('dem')]), {w,h}=env.info, lines=[]; const {mx}=Grid.stats(acc);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){ const i=y*w+x, a=acc[i]; if(isNaN(a)||a<p.thresh) continue;
      let best=-1,bd=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){ if(!dx&&!dy) continue; const xx=x+dx,yy=y+dy; if(xx<0||yy<0||xx>=w||yy>=h) continue; const d=(z[i]-z[yy*w+xx])/Math.hypot(dx,dy); if(d>bd){bd=d;best=yy*w+xx;} }
      if(best<0) continue; const t=(a-p.thresh)/Math.max(.1,mx-p.thresh);
      lines.push({pts:[gridToEN(env,x+.5,y+.5),gridToEN(env,(best%w)+.5,Math.floor(best/w)+.5)],stroke:p.color,width:p.minW+(p.maxW-p.minW)*Math.sqrt(t)}); }
    return {lines,texts:[]};
  }, draw:drawVec, svg:svgVec });

// ---------- TPI ridges & valleys ----------
def({ id:'tpi', name:'Ridges & valleys (TPI)', kind:'raster', blend:'source-over',
  params:[['radius','Radius (m)',40,5],['thresh','Threshold (m)',1,.25],['ridgeC','Ridge colour','#f59e0b'],['valleyC','Valley colour','#3b82f6'],['soft','Soft edges',true],['pixelate','Pixelate',false]],
  async prep(env,p){ const t=await Grid.fetch('tpi',p.radius), rc=hex2rgb(p.ridgeC), vc=hex2rgb(p.valleyC);
    return makeRaster(env,(i,o)=>{ const v=t[i]; if(isNaN(v)||Math.abs(v)<p.thresh) return; const c=v>0?rc:vc; const a=p.soft?Math.min(1,(Math.abs(v)-p.thresh)/(p.thresh*3)):1; o[0]=c[0];o[1]=c[1];o[2]=c[2];o[3]=255*a; }); },
  draw:drawRaster, svg:svgRaster });

// ---------- CURVATURE ----------
def({ id:'curvature', name:'Curvature', kind:'raster', blend:'overlay',
  params:[['scale','Scale',.1,.01],['convexC','Convex colour','#ffffff'],['concaveC','Concave colour','#000000'],['pixelate','Pixelate',false]],
  async prep(env,p){ const c=await Grid.fetch('curvature'), a=hex2rgb(p.convexC), b=hex2rgb(p.concaveC);
    return makeRaster(env,(i,o)=>{ const v=c[i]; if(isNaN(v)) return; const t=Math.max(-1,Math.min(1,v/p.scale)); const col=t>0?a:b; o[0]=col[0];o[1]=col[1];o[2]=col[2];o[3]=255*Math.abs(t); }); },
  draw:drawRaster, svg:svgRaster });

// ---------- ROUGHNESS ----------
def({ id:'roughness', name:'Roughness', kind:'raster', blend:'source-over',
  params:[['radius','Radius (m)',10,1],['ramp','Ramp','magma',rampOpts],['lo','Low colour','#000000'],['hi','High colour','#ffffff'],['max','Max (m)',5,.5],['pixelate','Pixelate',false]],
  async prep(env,p){ const r=await Grid.fetch('roughness',p.radius), f=rampFn(p.ramp,p.lo,p.hi);
    return makeRaster(env,(i,o)=>{ const v=r[i]; if(isNaN(v)) return; const c=f(v/p.max); o[0]=c[0];o[1]=c[1];o[2]=c[2];o[3]=255; }); },
  draw:drawRaster, svg:svgRaster });

// ---------- GRATICULE ----------
def({ id:'grid', name:'NZTM grid', kind:'vector', blend:'source-over',
  params:[['spacing','Spacing (m)',500,50],['color','Colour','#7d8793'],['width','Width (mm)',.1,.05],['dash','Dashed',true],['labels','Labels',true],['labelSize','Label size (mm)',2,.1]],
  async prep(env,p){ const b=env.bbox, lines=[], texts=[], s=p.spacing;
    for(let e=Math.ceil(b.e0/s)*s;e<=b.e1;e+=s){ lines.push({pts:[[e,b.n0],[e,b.n1]],stroke:p.color,width:p.width,dash:p.dash?[1,1]:null}); if(p.labels) texts.push({p:[e,b.n1],text:`${e}`,size:p.labelSize,color:p.color,font:'monospace',baseline:'top',anchor:'left',angle:Math.PI/2}); }
    for(let n=Math.ceil(b.n0/s)*s;n<=b.n1;n+=s){ lines.push({pts:[[b.e0,n],[b.e1,n]],stroke:p.color,width:p.width,dash:p.dash?[1,1]:null}); if(p.labels) texts.push({p:[b.e0,n],text:`${n}`,size:p.labelSize,color:p.color,font:'monospace',anchor:'left',baseline:'bottom'}); }
    return {lines,texts}; }, draw:drawVec, svg:svgVec });

// ---------- OUTLINE ----------
def({ id:'outline', name:'Area outline', kind:'vector', blend:'source-over', noclip:true,
  params:[['color','Colour','#2dd4bf'],['width','Width (mm)',.5,.05],['dash','Dashed',false]],
  async prep(env,p){ return {lines:[{pts:env.areaPath,stroke:p.color,width:p.width,closed:true,dash:p.dash?[2,1.5]:null}],texts:[]}; }, draw:drawVec, svg:svgVec });

// ---------- PAPER TEXTURE ----------
def({ id:'texture', name:'Paper texture', kind:'raster', blend:'overlay', noclip:true,
  params:[['grain','Grain',.5,.05],['blotch','Blotches',.5,.05],['scale','Blotch scale',8,1],['color','Tone','#808080']],
  async prep(env,p){ const {w,h}=env.info, c=hex2rgb(p.color);
    return makeRaster(env,(i,o)=>{ const x=i%w,y=(i/w)|0; const g=(hash2(x,y)-.5)*p.grain, b=(valueNoise(x/p.scale,y/p.scale)-.5)*p.blotch+(valueNoise(x/p.scale/4,y/p.scale/4)-.5)*p.blotch*.5; const v=.5+g*.5+b; o[0]=c[0]*2*v;o[1]=c[1]*2*v;o[2]=c[2]*2*v;o[3]=255; }); },
  draw(ctx,env,p,data){ ctx.imageSmoothingEnabled=true; ctx.drawImage(data.canvas,0,0,env.W,env.H); },
  async svg(env,p,data){ const blob=await data.canvas.convertToBlob(); const url=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob);}); return `<image x="0" y="0" width="${env.W}" height="${env.H}" preserveAspectRatio="none" href="${url}"/>`; } });

// ---------- VIGNETTE ----------
def({ id:'vignette', name:'Vignette', kind:'raster', blend:'multiply', noclip:true,
  params:[['strength','Strength',.6,.05],['radius','Radius',.75,.05],['color','Colour','#000000']],
  async prep(env,p){ return {c:hex2rgb(p.color)}; },
  draw(ctx,env,p,d){ const g=ctx.createRadialGradient(env.W/2,env.H/2,Math.min(env.W,env.H)*p.radius*.5,env.W/2,env.H/2,Math.hypot(env.W,env.H)*.6); g.addColorStop(0,`rgba(${d.c},0)`); g.addColorStop(1,`rgba(${d.c},${p.strength})`); ctx.fillStyle=g; ctx.fillRect(0,0,env.W,env.H); },
  svg(env,p,d){ const id='vg'+Math.random().toString(36).slice(2); return `<defs><radialGradient id="${id}" cx="50%" cy="50%" r="${p.radius*60}%"><stop offset="0" stop-color="rgb(${d.c})" stop-opacity="0"/><stop offset="1" stop-color="rgb(${d.c})" stop-opacity="${p.strength}"/></radialGradient></defs><rect width="${env.W}" height="${env.H}" fill="url(#${id})"/>`; } });

// ---------- FRAME ----------
def({ id:'frame', name:'Frame & title', kind:'vector', blend:'source-over', noclip:true,
  params:[['title','Title','TERRAIN',null,'text'],['subtitle','Subtitle','Bay of Plenty · LINZ 1 m LiDAR',null,'text'],['font','Font','monospace',['monospace','serif','sans-serif']],['color','Colour','#d6dbe1'],['titleSize','Title size (mm)',9,.5],['border','Border (mm)',.4,.1],['inset','Border inset (mm)',4,.5],['scalebar','Scale bar',true],['north','North arrow',true],['coords','Coordinates',true],['pos','Title position','bottom-left',['bottom-left','bottom-center','top-left','top-center']]],
  async prep(env,p){
    const lines=[],texts=[], W=env.Wmm, H=env.Hmm, m=env.marginMm, i=p.inset;
    if(p.border>0) lines.push({paper:true,pts:[[i,i],[W-i,i],[W-i,H-i],[i,H-i]],closed:true,stroke:p.color,width:p.border});
    const top=p.pos.startsWith('top'), center=p.pos.endsWith('center'), x=center?W/2:m, y=top?m*.55:H-m*.55, anchor=center?'center':'left';
    texts.push({paper:true,p:[x,y-(p.titleSize*.35)],text:p.title,size:p.titleSize,color:p.color,font:p.font,weight:700,anchor,baseline:'middle'});
    if(p.subtitle) texts.push({paper:true,p:[x,y+p.titleSize*.5],text:p.subtitle,size:p.titleSize*.3,color:p.color,font:p.font,anchor,baseline:'middle'});
    if(p.coords){ const b=env.bbox, ll0=toLL([b.e0,b.n0]), ll1=toLL([b.e1,b.n1]);
      texts.push({paper:true,p:[W-m,top?m*.55:H-m*.55],text:`${ll1.lat.toFixed(4)}° ${ll0.lng.toFixed(4)}°  →  ${ll0.lat.toFixed(4)}° ${ll1.lng.toFixed(4)}°`,size:p.titleSize*.28,color:p.color,font:'monospace',anchor:'right',baseline:'middle'}); }
    if(p.scalebar){ // nice length in metres that is ~ 25% of map width
      const target=(env.bbox.e1-env.bbox.e0)*.25, pow=Math.pow(10,Math.floor(Math.log10(target))), nice=[1,2,5,10].map(k=>k*pow).reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a);
      const lenMm=nice*env.pxPerM/env.pxPerMm, x0=top?m:m, y0=top?H-m*.55:m*.55, yb=top?y0:y0;
      lines.push({paper:true,pts:[[x0,yb],[x0+lenMm,yb]],stroke:p.color,width:.35}); lines.push({paper:true,pts:[[x0,yb-1],[x0,yb+1]],stroke:p.color,width:.35}); lines.push({paper:true,pts:[[x0+lenMm,yb-1],[x0+lenMm,yb+1]],stroke:p.color,width:.35}); lines.push({paper:true,pts:[[x0+lenMm/2,yb-.6],[x0+lenMm/2,yb+.6]],stroke:p.color,width:.25});
      texts.push({paper:true,p:[x0+lenMm/2,yb-2.5],text:nice>=1000?`${nice/1000} km`:`${nice} m`,size:p.titleSize*.28,color:p.color,font:'monospace'}); }
    if(p.north){ const cx=W-m-4, cy=top?H-m*.55:m*.55; const s=3;
      lines.push({paper:true,pts:[[cx,cy-s*1.4],[cx+s*.5,cy+s*.6],[cx,cy+s*.2],[cx-s*.5,cy+s*.6]],closed:true,fill:p.color});
      texts.push({paper:true,p:[cx,cy-s*2.1],text:'N',size:p.titleSize*.3,color:p.color,font:p.font,weight:700}); }
    return {lines,texts};
  }, draw:drawVec, svg:svgVec });
