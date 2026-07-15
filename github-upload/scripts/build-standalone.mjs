// Builds a single self-contained index.html (no server, no build, no token).
// Reads the current demo fixtures and inlines them into a vanilla-JS app that
// uses MapLibre + Supercluster from CDN. Output: standalone/index.html
//
//   node scripts/build-standalone.mjs

import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, "data");
const outDir = path.join(root, "standalone");

const read = async (f) => JSON.parse(await fs.readFile(path.join(dataDir, f), "utf8"));

const locations = await read("locations.json");
const projectsRaw = await read("projects.json");
const reviews = await read("reviews.json");

// Slim the projects to just what the standalone UI needs (keeps the file small).
const projects = projectsRaw.map((p) => ({
  id: p.id,
  address: p.address,
  lat: p.lat,
  lng: p.lng,
  locationId: p.locationId,
  tags: p.tags,
  photoCount: p.photoCount,
  optedOut: p.optedOut,
}));

const slimReviews = reviews.map((r) => ({
  id: r.id,
  locationId: r.locationId,
  rating: r.rating,
  authorName: r.authorName,
  text: r.text,
  postedAt: r.postedAt,
}));

const DATA = { locations, projects, reviews: slimReviews };

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Zintex Project Map</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
<style>
  :root { --brand:#1a5fd0; --brand-600:#1a5fd0; --brand-700:#164ea8; --ink:#0f172a; }
  * { box-sizing:border-box; }
  html,body { height:100%; margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--ink); }
  #app { display:flex; flex-direction:column; height:100dvh; }
  header { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.04); z-index:20; }
  .logo { display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; }
  .logo .z { width:28px;height:28px;border-radius:6px;background:var(--brand);color:#fff;display:grid;place-items:center;font-weight:700;font-size:13px; }
  header button, header a { font:inherit; font-size:12px; font-weight:500; border:1px solid #e2e8f0; background:#fff; border-radius:6px; padding:6px 12px; color:#475569; cursor:pointer; text-decoration:none; }
  header .primary { background:var(--brand-600); color:#fff; border-color:var(--brand-600); }
  header .search { flex:1; min-width:120px; display:flex; gap:4px; align-items:center; }
  header input { flex:1; min-width:0; font:inherit; font-size:14px; border:1px solid #e2e8f0; border-radius:6px; padding:6px 12px; }
  .body { position:relative; display:flex; flex:1; min-height:0; }
  aside { width:320px; background:#fff; border-right:1px solid #e2e8f0; display:flex; flex-direction:column; }
  .aside-head { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #e2e8f0; }
  .aside-head h2 { margin:0; font-size:13px; color:#334155; }
  .badge { background:#eef6ff; color:var(--brand-700); font-size:12px; font-weight:600; border-radius:999px; padding:2px 10px; }
  #list { flex:1; overflow-y:auto; }
  .row { display:flex; gap:12px; align-items:center; padding:12px 16px; border-bottom:1px solid #f1f5f9; cursor:pointer; text-align:left; width:100%; background:none; border-left:none; border-right:none; border-top:none; font:inherit; }
  .row:hover { background:#f8fafc; }
  .row.sel { background:#eef6ff; }
  .row .cam { color:#cbd5e1; flex-shrink:0; }
  .row .cam.has { color:#16a34a; }
  .row .addr { flex:1; min-width:0; }
  .row .addr .a { font-size:14px; color:#334155; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .row .addr .t { font-size:12px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
  .loadmore { padding:12px; border-top:1px solid #e2e8f0; }
  .loadmore button { width:100%; font:inherit; font-size:14px; padding:8px; border:1px solid #e2e8f0; border-radius:6px; background:#fff; color:#475569; cursor:pointer; }
  #map { flex:1; min-width:0; }
  .panel { position:fixed; top:0; height:100%; width:340px; max-width:90vw; background:#fff; box-shadow:0 0 40px rgba(0,0,0,.15); z-index:40; transform:translateX(0); transition:transform .2s; display:flex; flex-direction:column; }
  .panel.left { left:0; } .panel.left.hidden { transform:translateX(-100%); }
  .panel.right { right:0; width:384px; } .panel.right.hidden { transform:translateX(100%); }
  .panel-head { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid #e2e8f0; }
  .panel-head h2 { margin:0; font-size:13px; color:#334155; }
  .panel-body { flex:1; overflow-y:auto; padding:16px; }
  .overlay { position:fixed; inset:0; background:rgba(0,0,0,.2); z-index:30; }
  .sec-title { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:#94a3b8; margin:0 0 8px; }
  .check { display:flex; align-items:center; gap:8px; font-size:14px; color:#334155; padding:3px 0; cursor:pointer; }
  .modal-bg { position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:50; display:grid; place-items:center; padding:16px; }
  .modal { background:#fff; border-radius:12px; width:100%; max-width:420px; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.3); }
  .modal-head { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; padding:16px; border-bottom:1px solid #f1f5f9; }
  .modal-head h2 { margin:0; font-size:14px; }
  .icon-btn { border:none; background:none; cursor:pointer; color:#94a3b8; font-size:16px; padding:4px 6px; border-radius:6px; }
  .icon-btn:hover { background:#f1f5f9; }
  .gallery { position:relative; }
  .gallery img { width:100%; height:224px; object-fit:cover; border-radius:8px; background:#f1f5f9; }
  .gallery .nav { position:absolute; top:50%; transform:translateY(-50%); background:rgba(0,0,0,.5); color:#fff; border:none; border-radius:999px; width:28px;height:28px; cursor:pointer; font-size:16px; }
  .gallery .prev { left:8px; } .gallery .next { right:8px; }
  .gallery .count { position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,.6); color:#fff; font-size:12px; padding:2px 8px; border-radius:4px; }
  .nophoto { height:160px; display:grid; place-items:center; background:#f1f5f9; color:#94a3b8; font-size:14px; border-radius:8px; }
  .pills { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .pill { background:#eef6ff; color:var(--brand-700); font-size:12px; font-weight:500; padding:4px 10px; border-radius:999px; }
  form.lead { display:flex; flex-direction:column; gap:10px; margin-top:16px; }
  form.lead input, form.lead textarea { font:inherit; font-size:14px; border:1px solid #e2e8f0; border-radius:6px; padding:8px 12px; width:100%; }
  form.lead button { background:var(--brand-600); color:#fff; border:none; border-radius:6px; padding:10px; font:inherit; font-size:14px; font-weight:600; cursor:pointer; }
  .review { border-bottom:1px solid #f1f5f9; padding-bottom:16px; margin-bottom:16px; }
  .review .top { display:flex; align-items:center; gap:8px; }
  .review .av { width:32px;height:32px;border-radius:999px;background:#d9ebff;color:var(--brand-700);display:grid;place-items:center;font-weight:600;font-size:13px; }
  .review .who { flex:1; min-width:0; } .review .who .n { font-size:14px; font-weight:500; color:#334155; } .review .who .m { font-size:12px; color:#94a3b8; }
  .stars { color:#f59e0b; font-size:13px; letter-spacing:1px; }
  .foot-note { font-size:11px; color:#cbd5e1; text-align:center; margin-top:12px; }
  .btn-clear { display:flex; gap:8px; padding:12px 16px; border-top:1px solid #e2e8f0; }
  .btn-clear button { flex:1; font:inherit; font-size:14px; padding:8px; border-radius:6px; cursor:pointer; border:1px solid #e2e8f0; background:#fff; color:#475569; }
  .btn-clear .apply { background:var(--brand-600); color:#fff; border-color:var(--brand-600); }
  @media (max-width:768px){ aside{ display:none; } }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="logo"><span class="z">Z</span><span>Zintex Project Map</span></div>
    <button id="btn-filters">View Services</button>
    <div class="search">
      <input id="search" placeholder="Search city or address…" />
      <button class="primary" id="btn-search">Search</button>
    </div>
    <button id="btn-reviews">Reviews</button>
    <a href="#" id="btn-optout">Opt-Out</a>
  </header>
  <div class="body">
    <aside>
      <div class="aside-head"><h2>Projects</h2><span class="badge" id="total">Total 0</span></div>
      <div id="list"></div>
      <div class="loadmore"><button id="loadmore">Load more</button></div>
    </aside>
    <div id="map"></div>
  </div>
</div>

<div id="panels"></div>

<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/supercluster@8.0.1/dist/supercluster.min.js"></script>
<script>
const DATA = __DATA__;
const SERVICE_TAGS = ["Baths","Windows","Roofing","Siding","Doors","Kitchens","Gutters"];
const PAGE = 50;
const state = { tags:[], locationIds:[], search:"", selectedId:null, offset:0 };
const locName = Object.fromEntries(DATA.locations.map(l=>[l.id,l.name]));

function photoUrls(p){ return Array.from({length:p.photoCount},(_,j)=>"https://picsum.photos/seed/"+p.id+"-"+j+"/900/675"); }
function matches(p){
  if(p.optedOut) return false;
  if(state.tags.length && !state.tags.some(t=>p.tags.includes(t))) return false;
  if(state.locationIds.length && !state.locationIds.includes(p.locationId)) return false;
  if(state.search){ const s=state.search.toLowerCase(); if(!p.address.toLowerCase().includes(s)) return false; }
  return true;
}
function filtered(){ return DATA.projects.filter(matches); }
function starStr(n){ return "★".repeat(Math.round(n)) + "☆".repeat(5-Math.round(n)); }

/* ---------- Map ---------- */
const map = new maplibregl.Map({
  container:"map",
  style:{ version:8, glyphs:"https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources:{ osm:{ type:"raster", tiles:["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png","https://b.tile.openstreetmap.org/{z}/{x}/{y}.png","https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize:256, attribution:"© OpenStreetMap contributors" } },
    layers:[{ id:"osm", type:"raster", source:"osm" }] },
  center:[-94.5,33.8], zoom:4.4
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),"top-right");
let cluster = null;
function rebuild(){
  cluster = new Supercluster({radius:60,maxZoom:16});
  cluster.load(filtered().map(p=>({type:"Feature",properties:{pinId:p.id,hasPhotos:p.photoCount>0},geometry:{type:"Point",coordinates:[p.lng,p.lat]}})));
}
function renderMap(){
  if(!cluster || !map.getSource("pins")) return;
  const b=map.getBounds();
  const feats=cluster.getClusters([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],Math.round(map.getZoom()));
  map.getSource("pins").setData({type:"FeatureCollection",features:feats});
}
map.on("load",()=>{
  map.resize();
  map.addSource("pins",{type:"geojson",data:{type:"FeatureCollection",features:[]}});
  map.addLayer({id:"clusters",type:"circle",source:"pins",filter:["has","point_count"],paint:{"circle-color":"#1f6feb","circle-opacity":.85,"circle-radius":["step",["get","point_count"],16,25,22,100,30,750,40],"circle-stroke-width":3,"circle-stroke-color":"#fff"}});
  map.addLayer({id:"cluster-count",type:"symbol",source:"pins",filter:["has","point_count"],layout:{"text-field":["get","point_count_abbreviated"],"text-font":["Noto Sans Regular"],"text-size":12},paint:{"text-color":"#fff"}});
  map.addLayer({id:"unclustered",type:"circle",source:"pins",filter:["!",["has","point_count"]],paint:{"circle-color":["case",["get","hasPhotos"],"#16a34a","#94a3b8"],"circle-radius":7,"circle-stroke-width":2,"circle-stroke-color":"#fff"}});
  map.on("click","clusters",(e)=>{ const f=map.queryRenderedFeatures(e.point,{layers:["clusters"]})[0]; const z=cluster.getClusterExpansionZoom(f.properties.cluster_id); map.easeTo({center:f.geometry.coordinates,zoom:Math.min(z,16)}); });
  map.on("click","unclustered",(e)=>openModal(e.features[0].properties.pinId));
  ["clusters","unclustered"].forEach(l=>{ map.on("mouseenter",l,()=>map.getCanvas().style.cursor="pointer"); map.on("mouseleave",l,()=>map.getCanvas().style.cursor=""); });
  map.on("moveend",renderMap);
  rebuild(); renderMap();
});

/* ---------- Sidebar ---------- */
function camIcon(has){ return '<svg class="cam '+(has?'has':'')+'" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>'; }
function renderList(reset){
  const all=filtered();
  document.getElementById("total").textContent="Total "+all.length.toLocaleString();
  if(reset) state.offset=0;
  const list=document.getElementById("list");
  if(reset) list.innerHTML="";
  const slice=all.slice(state.offset, state.offset+PAGE);
  slice.forEach(p=>{
    const row=document.createElement("button");
    row.className="row"+(state.selectedId===p.id?" sel":"");
    row.innerHTML=camIcon(p.photoCount>0)+'<span class="addr"><span class="a">'+p.address+'</span><span class="t">'+(p.tags.join(" · ")||"—")+'</span></span>';
    row.onclick=()=>openModal(p.id);
    list.appendChild(row);
  });
  state.offset+=slice.length;
  document.getElementById("loadmore").style.display = state.offset<all.length ? "block":"none";
}

/* ---------- Modal ---------- */
function openModal(id){
  const p=DATA.projects.find(x=>x.id===id);
  if(!p||p.optedOut) return;
  state.selectedId=id;
  map.flyTo({center:[p.lng,p.lat],zoom:13});
  const photos=photoUrls(p); let idx=0;
  const wrap=document.createElement("div"); wrap.className="modal-bg";
  function draw(){
    wrap.innerHTML='<div class="modal"><div class="modal-head"><h2>'+p.address+'</h2><button class="icon-btn" id="mx">✕</button></div><div style="padding:16px">'+
      (photos.length?('<div class="gallery"><img src="'+photos[idx]+'"/>'+(photos.length>1?'<button class="nav prev">‹</button><button class="nav next">›</button><span class="count">'+(idx+1)+' of '+photos.length+'</span>':'')+'</div>'):'<div class="nophoto">No photos for this project</div>')+
      '<p class="sec-title" style="margin-top:16px">Work Details</p><div class="pills">'+(p.tags.length?p.tags.map(t=>'<span class="pill">'+t+'</span>').join(''):'<span style="font-size:12px;color:#94a3b8">No service tags</span>')+'</div>'+
      '<p style="font-size:12px;color:#94a3b8;margin-top:8px">Serviced by our '+(locName[p.locationId]||"")+' branch</p>'+
      '<form class="lead"><input placeholder="Your name" required/><input placeholder="Phone" required/><input type="email" placeholder="Email" required/><textarea rows="2" placeholder="How can we help? (optional)"></textarea><button type="submit">Click here to get in touch with us!</button></form>'+
      '</div></div>';
    wrap.querySelector("#mx").onclick=close;
    if(photos.length>1){ wrap.querySelector(".prev").onclick=(e)=>{e.stopPropagation();idx=(idx-1+photos.length)%photos.length;draw();}; wrap.querySelector(".next").onclick=(e)=>{e.stopPropagation();idx=(idx+1)%photos.length;draw();}; }
    wrap.querySelector("form").onsubmit=(e)=>{ e.preventDefault(); e.target.innerHTML='<div style="background:#f0fdf4;color:#166534;padding:16px;border-radius:8px;text-align:center;font-size:14px">Thanks! A Zintex representative will reach out shortly.</div>'; };
  }
  function close(){ wrap.remove(); state.selectedId=null; }
  wrap.onclick=(e)=>{ if(e.target===wrap) close(); };
  draw();
  document.getElementById("panels").appendChild(wrap);
}

/* ---------- Panels (filters / reviews) ---------- */
function openFilters(){
  const ov=document.createElement("div"); ov.className="overlay";
  const pn=document.createElement("div"); pn.className="panel left";
  pn.innerHTML='<div class="panel-head"><h2>View Services</h2><button class="icon-btn" id="fx">✕</button></div><div class="panel-body">'+
    '<p class="sec-title">Services</p>'+SERVICE_TAGS.map(t=>'<label class="check"><input type="checkbox" data-tag="'+t+'" '+(state.tags.includes(t)?"checked":"")+'/> '+t+'</label>').join('')+
    '<p class="sec-title" style="margin-top:20px">Our Locations</p>'+DATA.locations.map(l=>'<label class="check"><input type="checkbox" data-loc="'+l.id+'" '+(state.locationIds.includes(l.id)?"checked":"")+'/> '+l.name+'</label>').join('')+
    '</div><div class="btn-clear"><button id="fclear">Clear</button><button class="apply" id="fapply">Apply</button></div>';
  function closeP(){ ov.remove(); pn.remove(); }
  ov.onclick=closeP; pn.querySelector("#fx").onclick=closeP; pn.querySelector("#fapply").onclick=closeP;
  pn.querySelector("#fclear").onclick=()=>{ state.tags=[]; state.locationIds=[]; pn.querySelectorAll("input").forEach(i=>i.checked=false); apply(); };
  pn.querySelectorAll("input").forEach(i=>i.onchange=()=>{
    const tag=i.getAttribute("data-tag"), loc=i.getAttribute("data-loc");
    if(tag){ state.tags = i.checked ? [...state.tags,tag] : state.tags.filter(t=>t!==tag); }
    if(loc){ state.locationIds = i.checked ? [...state.locationIds,loc] : state.locationIds.filter(l=>l!==loc); }
    apply();
  });
  document.getElementById("panels").append(ov,pn);
}
function openReviews(){
  const rv=DATA.reviews; const avg=rv.reduce((s,r)=>s+r.rating,0)/rv.length;
  const ov=document.createElement("div"); ov.className="overlay";
  const pn=document.createElement("div"); pn.className="panel right";
  pn.innerHTML='<div class="panel-head"><div><h2>Reviews</h2><div class="stars">'+starStr(avg)+' <span style="color:#94a3b8;font-size:12px">'+avg.toFixed(1)+' · '+rv.length.toLocaleString()+' reviews</span></div></div><button class="icon-btn" id="rx">✕</button></div>'+
    '<div class="panel-body">'+rv.slice(0,100).map(r=>'<div class="review"><div class="top"><div class="av">'+r.authorName.charAt(0)+'</div><div class="who"><div class="n">'+r.authorName+'</div><div class="m">'+(locName[r.locationId]||"")+'</div></div><div class="stars">'+starStr(r.rating)+'</div></div><p style="font-size:14px;color:#475569;margin:8px 0 0">'+r.text+'</p></div>').join('')+
    '<p class="foot-note">Demo data. Production pulls from Google Business Profile per branch.</p></div>';
  function closeP(){ ov.remove(); pn.remove(); }
  ov.onclick=closeP; pn.querySelector("#rx").onclick=closeP;
  document.getElementById("panels").append(ov,pn);
}

/* ---------- Wire up ---------- */
function apply(){ rebuild(); renderMap(); renderList(true); }
document.getElementById("btn-filters").onclick=openFilters;
document.getElementById("btn-reviews").onclick=openReviews;
document.getElementById("loadmore").onclick=()=>renderList(false);
document.getElementById("btn-search").onclick=()=>{ state.search=document.getElementById("search").value; apply();
  const f=filtered(); if(f.length){ let a=[180,90,-180,-90]; f.forEach(p=>{a[0]=Math.min(a[0],p.lng);a[1]=Math.min(a[1],p.lat);a[2]=Math.max(a[2],p.lng);a[3]=Math.max(a[3],p.lat);}); map.fitBounds([[a[0],a[1]],[a[2],a[3]]],{padding:60,maxZoom:13}); } };
document.getElementById("search").addEventListener("keydown",(e)=>{ if(e.key==="Enter") document.getElementById("btn-search").click(); });
document.getElementById("btn-optout").onclick=(e)=>{ e.preventDefault(); alert("Opt-out: in the full app this records a suppression and hides the property. This standalone file has no backend, so wire it to your form/CRM when hosting."); };
renderList(true);
</script>
</body>
</html>`;

await fs.mkdir(outDir, { recursive: true });
const finalHtml = html.replace("__DATA__", JSON.stringify(DATA));
await fs.writeFile(path.join(outDir, "index.html"), finalHtml);

const kb = Math.round(Buffer.byteLength(finalHtml) / 1024);
console.log(`Wrote standalone/index.html (${kb} KB)`);
console.log(`  ${projects.length} projects · ${locations.length} branches · ${slimReviews.length} reviews embedded`);
