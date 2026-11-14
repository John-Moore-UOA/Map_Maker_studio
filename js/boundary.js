// Bezier boundary editor (nodes stored in NZTM metres)
// node: {p:[e,n], hi:[dx,dy], ho:[dx,dy]}
let nodes=[], sel=-1, drawMode=null, suppressClick=false, shapeOpacity=1, polyDraft=null;
const shapeLayer = L.layerGroup(), editLayer = L.layerGroup().addTo(map);
let shapePoly=null, onShapeChange=()=>{};
const add=(a,b)=>[a[0]+b[0],a[1]+b[1]], sub=(a,b)=>[a[0]-b[0],a[1]-b[1]], mul=(a,s)=>[a[0]*s,a[1]*s], lerp=(a,b,t)=>add(a,mul(sub(b,a),t));
const isZero=h=>Math.abs(h[0])<1e-9&&Math.abs(h[1])<1e-9;
function seg(i){const a=nodes[i],b=nodes[(i+1)%nodes.length];return [a.p,add(a.p,a.ho),add(b.p,b.hi),b.p];}
function bez(s,t){const u=1-t;return [0,1].map(k=>u*u*u*s[0][k]+3*u*u*t*s[1][k]+3*u*t*t*s[2][k]+t*t*t*s[3][k]);}
function sampledPath(per=24){const out=[];for(let i=0;i<nodes.length;i++){const s=seg(i);const straight=isZero(nodes[i].ho)&&isZero(nodes[(i+1)%nodes.length].hi);const n=straight?8:per;for(let k=0;k<n;k++)out.push(bez(s,k/n));}return out;}
function pathBBox(){const p=sampledPath();const xs=p.map(q=>q[0]),ys=p.map(q=>q[1]);return {e0:Math.min(...xs),e1:Math.max(...xs),n0:Math.min(...ys),n1:Math.max(...ys)};}

function makeRect(a,b){const [x0,x1]=[Math.min(a[0],b[0]),Math.max(a[0],b[0])],[y0,y1]=[Math.min(a[1],b[1]),Math.max(a[1],b[1])];
  return [[x0,y1],[x1,y1],[x1,y0],[x0,y0]].map(p=>({p,hi:[0,0],ho:[0,0]}));}
function makeCircle(c,r){const k=0.5523*r, pts=[[0,1],[1,0],[0,-1],[-1,0]], tan=[[1,0],[0,-1],[-1,0],[0,1]];
  return pts.map(([dx,dy],i)=>({p:[c[0]+dx*r,c[1]+dy*r],ho:mul(tan[i],k),hi:mul(tan[i],-k)}));}

function drawShape(){
  shapeLayer.clearLayers(); shapePoly=null;
  if(nodes.length>=3){
    shapePoly = L.polygon(sampledPath().map(toLL),{color:'#2dd4bf',weight:2,opacity:shapeOpacity,fillOpacity:.06*shapeOpacity,bubblingMouseEvents:false}).addTo(shapeLayer);
    shapePoly.on('mousedown', startMoveShape);
  }
  if(polyDraft&&polyDraft.length) L.polyline(polyDraft.map(toLL),{color:'#2dd4bf',weight:1.5,dashArray:'4 4'}).addTo(shapeLayer);
  onShapeChange();
}
function icon(cls){return L.divIcon({className:cls,iconSize:null});}
function autoHandles(i){const n=nodes.length,a=nodes[(i-1+n)%n].p,b=nodes[(i+1)%n].p;return mul(sub(b,a),1/6);}
function drawEdit(){
  editLayer.clearLayers();
  if(nodes.length<3 || (refState.shape&&!refState.shape.on)) return;
  const n=nodes.length;
  for(let i=0;i<n;i++){
    const m=L.marker(toLL(bez(seg(i),.5)),{icon:icon('mid'),bubblingMouseEvents:false,zIndexOffset:-100}).addTo(editLayer);
    m.on('click',e=>{L.DomEvent.stop(e);splitSeg(i);});
  }
  if(sel>=0 && sel<n){
    const nd=nodes[sel], dflt=autoHandles(sel);
    for(const key of ['hi','ho']){
      const ghost=isZero(nd[key]); const off=ghost?(key==='ho'?dflt:mul(dflt,-1)):nd[key];
      const hp=add(nd.p,off);
      L.polyline([toLL(nd.p),toLL(hp)],{color:'#3b82f6',weight:1,interactive:false}).addTo(editLayer);
      const hm=L.marker(toLL(hp),{icon:icon('handle'+(ghost?' ghost':'')),draggable:true,zIndexOffset:200}).addTo(editLayer);
      hm.on('drag',e=>{
        const v=sub(toEN(e.target.getLatLng()),nd.p); nd[key]=v;
        const other=key==='hi'?'ho':'hi';
        if(!e.originalEvent?.altKey){ const len=Math.hypot(...nd[other])||Math.hypot(...v); const L2=Math.hypot(...v)||1; nd[other]=mul(v,-len/L2); }
        drawShape();
      });
      hm.on('dragend',()=>drawEdit());
    }
  }
  nodes.forEach((nd,i)=>{
    const m=L.marker(toLL(nd.p),{icon:icon('anchor'+(i===sel?' sel':'')),draggable:true,zIndexOffset:300}).addTo(editLayer);
    m.on('dragstart',()=>{sel=i;});
    m.on('drag',e=>{nd.p=toEN(e.target.getLatLng());drawShape();});
    m.on('dragend',()=>drawEdit());
    m.on('click',e=>{L.DomEvent.stop(e);sel=i;drawEdit();});
    m.on('dblclick',e=>{L.DomEvent.stop(e);if(nodes.length>3){nodes.splice(i,1);sel=-1;drawShape();drawEdit();}});
    m.on('contextmenu',e=>{L.DomEvent.stop(e);
      if(isZero(nd.hi)&&isZero(nd.ho)){const d=autoHandles(i);nd.ho=d;nd.hi=mul(d,-1);}else{nd.hi=[0,0];nd.ho=[0,0];}
      sel=i;drawShape();drawEdit();});
  });
}
function splitSeg(i){
  const [p0,p1,p2,p3]=seg(i), a=lerp(p0,p1,.5), b=lerp(p1,p2,.5), c=lerp(p2,p3,.5), d=lerp(a,b,.5), e=lerp(b,c,.5), m=lerp(d,e,.5);
  const j=(i+1)%nodes.length;
  nodes[i].ho=sub(a,p0); nodes[j].hi=sub(c,p3);
  nodes.splice(i+1,0,{p:m,hi:sub(d,m),ho:sub(e,m)});
  sel=i+1; drawShape(); drawEdit();
}
function startMoveShape(e){
  if(drawMode) return;
  L.DomEvent.stop(e); map.dragging.disable();
  let last=toEN(e.latlng);
  const mv=ev=>{const p=toEN(ev.latlng),d=sub(p,last);last=p;nodes.forEach(n=>n.p=add(n.p,d));drawShape();};
  const up=()=>{map.off('mousemove',mv);map.off('mouseup',up);map.dragging.enable();suppressClick=true;drawEdit();};
  map.on('mousemove',mv); map.on('mouseup',up);
}
function setDraw(mode){
  drawMode = drawMode===mode?null:mode;
  for(const [id,m] of [['drawRect','rect'],['drawCircle','circle'],['drawPoly','poly']]) $(id).classList.toggle('on',drawMode===m);
  map.getContainer().classList.toggle('drawing',!!drawMode);
  if(drawMode!=='poly') polyDraft=null;
  (drawMode&&drawMode!=='poly')?map.dragging.disable():map.dragging.enable();
  if(drawMode==='poly'){polyDraft=[];nodes=[];sel=-1;drawEdit();}
  drawShape();
}
$('drawRect').onclick=()=>setDraw('rect'); $('drawCircle').onclick=()=>setDraw('circle'); $('drawPoly').onclick=()=>setDraw('poly');
$('clearShape').onclick=()=>{nodes=[];sel=-1;polyDraft=null;drawShape();drawEdit();};
map.on('mousedown',e=>{
  if(!drawMode||drawMode==='poly') return;
  const a=toEN(e.latlng);
  const mv=ev=>{const b=toEN(ev.latlng);nodes = drawMode==='rect'?makeRect(a,b):makeCircle(a,Math.max(1,Math.hypot(...sub(b,a))));drawShape();};
  const up=()=>{map.off('mousemove',mv);map.off('mouseup',up);suppressClick=true;setDraw(drawMode);sel=-1;drawEdit();};
  map.on('mousemove',mv); map.on('mouseup',up);
});
map.on('click', e=>{
  if(drawMode==='poly'){ polyDraft.push(toEN(e.latlng)); drawShape(); return; }
  if(!drawMode && !suppressClick) dropPin(e.latlng); suppressClick=false;
});
map.on('dblclick', e=>{
  if(drawMode!=='poly') return;
  L.DomEvent.stop(e);
  if(polyDraft.length>=3) nodes=polyDraft.map(p=>({p,hi:[0,0],ho:[0,0]}));
  polyDraft=null; drawMode='poly'; setDraw('poly'); sel=-1; drawShape(); drawEdit();
});
map.doubleClickZoom.disable();
shapeLayer.on('add',drawEdit); shapeLayer.on('remove',()=>editLayer.clearLayers());
