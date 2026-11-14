// Grid fetching + caching. All grids share one georeference (info) for a given area+res.
const Grid = {
  cache: new Map(), info: null, area: null,
  key(kind, p){ return `${kind}|${p??''}|${JSON.stringify(this.area)}`; },
  setArea(bbox, res){ this.area={...bbox,res}; this.cache.clear(); this.info=null; },
  async fetch(kind='dem', p){
    const k=this.key(kind,p); if(this.cache.has(k)) return this.cache.get(k);
    const a=this.area, q=`e0=${a.e0}&n0=${a.n0}&e1=${a.e1}&n1=${a.n1}&res=${a.res}`;
    const url = kind==='dem' ? `/api/dem?${q}` : `/api/derive?kind=${kind}&${q}${p!=null?`&p=${p}`:''}`;
    const pr=(async()=>{
      const r=await fetch(url); const info=JSON.parse(r.headers.get('X-Grid')||'null');
      if(!info) throw new Error('Area is outside the LiDAR coverage');
      if(!this.info) this.info=info;
      return new Float32Array(await r.arrayBuffer());
    })();
    this.cache.set(k,pr); pr.catch(()=>this.cache.delete(k)); return pr;
  },
  // JS-side derivatives (cheap) from the DEM
  async slopeAspect(){
    const k=this.key('_sa'); if(this.cache.has(k)) return this.cache.get(k);
    const pr=(async()=>{
      const z=await this.fetch('dem'), {w,h,res}=this.info, gx=new Float32Array(w*h), gy=new Float32Array(w*h);
      const g=(x,y)=>{const v=z[Math.min(h-1,Math.max(0,y))*w+Math.min(w-1,Math.max(0,x))]; return isNaN(v)?null:v;};
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const c=g(x,y); if(c==null){gx[y*w+x]=NaN;gy[y*w+x]=NaN;continue;}
        const l=g(x-1,y)??c, r=g(x+1,y)??c, u=g(x,y-1)??c, d=g(x,y+1)??c;
        gx[y*w+x]=(r-l)/(2*res); gy[y*w+x]=(d-u)/(2*res);
      }
      return {gx,gy};
    })();
    this.cache.set(k,pr); return pr;
  },
  stats(z){ let mn=Infinity,mx=-Infinity; for(let i=0;i<z.length;i++){const v=z[i]; if(v===v){ if(v<mn)mn=v; if(v>mx)mx=v; }} return {mn,mx}; }
};
