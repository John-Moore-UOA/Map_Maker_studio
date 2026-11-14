// Projection + Leaflet map + reference layers + location lookup
proj4.defs('EPSG:2193','+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
const P = proj4('EPSG:4326','EPSG:2193');
const toEN = ll => P.forward([ll.lng, ll.lat]);
const toLL = en => { const [lng,lat] = P.inverse(en); return L.latLng(lat,lng); };
const $ = id => document.getElementById(id);

const HOME = [-37.6711742, 175.9177725];
const map = L.map('map', {zoomControl:true}).setView(HOME, 15);
const bases = {
  'Carto Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',{maxZoom:20,attribution:'© OSM © CARTO'}),
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}),
  'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{maxZoom:17,attribution:'© OpenTopoMap (CC-BY-SA), © OSM'}),
  'Satellite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
  'None': L.layerGroup()
};
let base = bases['Carto Dark'].addTo(map);
const bmSel = $('basemap');
Object.keys(bases).forEach(k=>bmSel.add(new Option(k,k)));
bmSel.onchange = () => { map.removeLayer(base); base = bases[bmSel.value].addTo(map); base.setOpacity?.(refState.base.op); base.bringToBack?.(); };

const refState = {};
function addLayerUI(key, label, layer, on, op, setOp){
  refState[key] = {layer, op, on};
  const d = document.createElement('div'); d.className='row';
  d.innerHTML = `<input type="checkbox" ${on?'checked':''}><label>${label}</label><input type="range" min="0" max="1" step="0.05" value="${op}">`;
  const [cb,,rg] = d.children;
  cb.onchange = () => { refState[key].on = cb.checked; const l = key==='base'?base:layer; cb.checked ? map.addLayer(l) : map.removeLayer(l); };
  rg.oninput = () => { refState[key].op = +rg.value; setOp(+rg.value); };
  $('layers').appendChild(d);
  if (on && layer && key!=='base') map.addLayer(layer);
  setOp(op);
}
let OVERLAY=null;
fetch('data/overlay.json').then(r=>r.json()).then(ov=>{
  OVERLAY=ov;
  const hs = L.imageOverlay('data/hillshade.png', ov.bounds, {interactive:false});
  const tint = L.imageOverlay('data/tint.png', ov.bounds, {interactive:false});
  addLayerUI('base','Basemap', null, true, 1, v=>base.setOpacity?.(v));
  addLayerUI('tint','Elevation tint', tint, false, .5, v=>tint.setOpacity(v));
  addLayerUI('hs','LiDAR hillshade', hs, true, .6, v=>hs.setOpacity(v));
  const n=ov.nztm, outline=L.layerGroup();
  const xs=[n.e0,1852000,1876000,n.e1], ys=[n.ntop,5838000,n.nbot], rows='BCD';
  const rectLL=(a,b,c,d)=>{const p=[];for(let i=0;i<=20;i++)p.push([a+(c-a)*i/20,b]);for(let i=0;i<=20;i++)p.push([c,b+(d-b)*i/20]);for(let i=0;i<=20;i++)p.push([c-(c-a)*i/20,d]);for(let i=0;i<=20;i++)p.push([a,d-(d-b)*i/20]);return p.map(toLL);};
  for(let r=0;r<2;r++)for(let c=0;c<3;c++){
    outline.addLayer(L.polygon(rectLL(xs[c],ys[r],xs[c+1],ys[r+1]),{color:'#8b5cf6',weight:1,dashArray:'4 4',fill:false,interactive:false}));
    outline.addLayer(L.marker(toLL([(xs[c]+xs[c+1])/2,(ys[r]+ys[r+1])/2]),{interactive:false,icon:L.divIcon({className:'',html:`<div class="tileLbl">${'B'+rows[r+1]+(35+c)}</div>`})}));
  }
  outline.addLayer(L.polygon(rectLL(xs[0],ys[0],xs[3],ys[2]),{color:'#8b5cf6',weight:2,fill:false,interactive:false}));
  addLayerUI('outline','LiDAR coverage', outline, true, 1, v=>outline.eachLayer(l=>l.setStyle?.({opacity:v})));
  addLayerUI('shape','Area of interest', shapeLayer, true, 1, v=>{ shapeOpacity=v; drawShape(); });
});

// ---------- lookup ----------
let elevTimer=null;
const getZ = en => fetch(`/api/elev?e=${en[0]}&n=${en[1]}`).then(r=>r.json()).then(j=>j.z);
map.on('mousemove', e=>{
  const en = toEN(e.latlng);
  $('sLL').textContent=`lat ${e.latlng.lat.toFixed(6)}  lng ${e.latlng.lng.toFixed(6)}`; $('sEN').textContent=`E ${en[0].toFixed(1)}  N ${en[1].toFixed(1)}`;
  clearTimeout(elevTimer); elevTimer=setTimeout(()=>getZ(en).then(z=>$('sZ').textContent = z==null?'elev —':`elev ${z.toFixed(2)} m`),80);
});
let pin=null;
function dropPin(ll){
  const en = toEN(ll);
  getZ(en).then(z=>{
    pin && map.removeLayer(pin);
    pin = L.marker(ll).addTo(map).bindPopup(`<b>${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</b><br>NZTM ${en[0].toFixed(1)} E, ${en[1].toFixed(1)} N<br>Elevation: ${z==null?'no data':z.toFixed(2)+' m'}`).openPopup();
  });
}
$('gotoBtn').onclick = () => {
  const n = $('goto').value.split(/[\s,]+/).filter(Boolean).map(Number);
  if (n.length<2 || n.some(isNaN)) return;
  const ll = Math.abs(n[0])>1000 ? toLL([n[0],n[1]]) : L.latLng(n[0],n[1]);
  map.setView(ll, Math.max(map.getZoom(),16)); dropPin(ll);
};
$('goto').onkeydown = e => e.key==='Enter' && $('gotoBtn').click();
