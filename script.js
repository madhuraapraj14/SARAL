let places = [];
let products = [];

// ---------- account: Flask backend session ----------
const API_BASE = '';
const authScreen=document.getElementById('authScreen'),site=document.getElementById('site');
const welcomeUser=document.getElementById('welcomeUser'); let currentUser=null;
async function api(path,options={}){const response=await fetch(`${API_BASE}/api${path}`,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const payload=await response.json().catch(()=>({message:'Unexpected server response.'}));if(!response.ok)throw new Error(payload.message||'Request failed.');return payload;}
function showSite(){if(!currentUser)return;authScreen.classList.add('hidden');site.classList.remove('hidden');welcomeUser.textContent=`Hi, ${currentUser.name.split(' ')[0]}`;setTimeout(()=>{if(map)map.invalidateSize()},150)}
function showAuth(){currentUser=null;site.classList.add('hidden');authScreen.classList.remove('hidden')}
async function restoreSession(){try{const data=await api('/auth/me');currentUser=data.user;showSite()}catch{showAuth()}} restoreSession();
document.querySelectorAll('.auth-tab').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');document.getElementById('loginForm').classList.toggle('hidden',tab.dataset.auth!=='login');document.getElementById('signupForm').classList.toggle('hidden',tab.dataset.auth!=='signup')}));
document.getElementById('signupForm').addEventListener('submit',async e=>{e.preventDefault();const message=document.getElementById('signupMessage');message.textContent='';const name=document.getElementById('signupName').value.trim(),email=document.getElementById('signupEmail').value.trim().toLowerCase(),password=document.getElementById('signupPassword').value;try{const data=await api('/auth/signup',{method:'POST',body:JSON.stringify({name,email,password})});currentUser=data.user;showSite();e.target.reset()}catch(err){message.textContent=err.message}});
document.getElementById('loginForm').addEventListener('submit',async e=>{e.preventDefault();const message=document.getElementById('loginMessage');message.textContent='';const email=document.getElementById('loginEmail').value.trim().toLowerCase(),password=document.getElementById('loginPassword').value;try{const data=await api('/auth/login',{method:'POST',body:JSON.stringify({email,password})});currentUser=data.user;showSite();e.target.reset()}catch(err){message.textContent=err.message}});
document.getElementById('logoutBtn').addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST',body:JSON.stringify({})})}catch{}showAuth();window.scrollTo(0,0)});

// ---------- navigation ----------
const menuBtn=document.getElementById('menuBtn'),navLinks=document.getElementById('navLinks');menuBtn.addEventListener('click',()=>navLinks.classList.toggle('open'));navLinks.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>navLinks.classList.remove('open')));

// ---------- data-backed heritage map ----------
let map = null;
const mapList=document.getElementById('mapList'),markers=[];let currentFilter='All';
function markerColor(type){return type==='Culture'?'#506f91':'#a84e3b'}
function createMarkerIcon(type){return L.divIcon({className:'saral-marker-wrap',html:`<span class="saral-marker" style="background:${markerColor(type)}"></span>`,iconSize:[22,22],iconAnchor:[11,11]})}
let selectedHeritagePlace = null;
const transportResults = document.getElementById('transportResults');
function escapeHTML(value){return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function showNearbyTransport(place){
 selectedHeritagePlace=place;
 const panel=document.getElementById('transportPanel');
 panel.classList.add('is-active');
 transportResults.innerHTML='<p class="empty-result">Finding nearby public transport…</p>';
 const mapsUrl=`https://www.google.com/maps/search/public+transport/@${place.coords[0]},${place.coords[1]},15z`;
 try{
  const data=await api(`/transport?lat=${encodeURIComponent(place.coords[0])}&lon=${encodeURIComponent(place.coords[1])}&radius=3000`);
  const stops=Array.isArray(data.stops)?data.stops:[];
  if(!stops.length){transportResults.innerHTML=`<p class="empty-result">${escapeHTML(data.message||'No nearby stops were returned by the map data service.')}</p><a class="transport-map-link" href="${data.fallback_url||mapsUrl}" target="_blank" rel="noopener">Find nearby public transport in Google Maps ↗</a><p class="transport-note">Stop availability depends on mapped data. Live arrivals are not provided.</p>`;return;}
  transportResults.innerHTML=`<p class="transport-note">Within ${Math.round((data.radius_m||3000)/1000)} km · ${data.count} mapped results</p>`+stops.map(stop=>`<article class="transport-stop"><span class="transport-type">${escapeHTML(stop.type)}</span><strong>${escapeHTML(stop.name)}</strong><small>${stop.distance_m<1000?`${stop.distance_m} m`:`${(stop.distance_m/1000).toFixed(1)} km`} away${stop.tags?.operator?` · ${escapeHTML(stop.tags.operator)}`:''}</small><a href="https://www.google.com/maps/dir/?api=1&origin=${place.coords[0]},${place.coords[1]}&destination=${stop.lat},${stop.lon}&travelmode=walking" target="_blank" rel="noopener">Walking directions ↗</a></article>`).join('')+`<p class="transport-note">${escapeHTML(data.note||'Mapped stops only; schedules may not be available.')}</p><a class="transport-map-link" href="${mapsUrl}" target="_blank" rel="noopener">Explore all nearby transport in Google Maps ↗</a>`;
 }catch(err){transportResults.innerHTML=`<p class="empty-result">Nearby transport data is temporarily unavailable.</p><a class="transport-map-link" href="${mapsUrl}" target="_blank" rel="noopener">Find public transport in Google Maps ↗</a><p class="transport-note">Live arrivals and schedules are not included.</p>`;}
}
function renderMapList(search=''){
 mapList.innerHTML='';const filtered=places.filter(p=>(currentFilter==='All'||p.category===currentFilter)&&`${p.name} ${p.type} ${p.description} ${p.area||''}`.toLowerCase().includes(search.toLowerCase()));
 filtered.forEach(place=>{const item=document.createElement('button');item.className='map-item';item.innerHTML=`<strong>${place.name}</strong><span>${place.type}</span><small>${place.description}</small>`;item.addEventListener('click',()=>{const found=markers.find(m=>m.place.name===place.name);if(!found||!map)return;map.setView(place.coords,15);found.marker.openPopup();document.querySelectorAll('.map-item').forEach(x=>x.classList.remove('active'));item.classList.add('active');showNearbyTransport(place)});mapList.appendChild(item)});
 if(!filtered.length)mapList.innerHTML='<p class="empty-result">No matching places.</p>';
}
async function loadHeritage(){
 try{
  const data=await api('/heritage');
  places=Array.isArray(data.places)?data.places:[];
  // Render the list and story cards even if the external map library is blocked.
  renderMapList(document.getElementById('mapSearch').value||'');
  const placeGrid=document.getElementById('placeGrid');placeGrid.innerHTML='';
  places.forEach(place=>{const card=document.createElement('article');card.className='place-card';card.innerHTML=`<div class="place-image"><img src="${place.image}" alt="${place.name}" loading="lazy" onerror="this.onerror=null;this.src='/images/heritage-fallback.svg'"><span class="photo-credit">Photo: ${place.photoCredit||'Source to be verified'}</span></div><div class="place-body"><span class="card-tag">${place.type}</span><h3>${place.name}</h3><p>${place.description}</p><button class="place-map-btn" type="button">Show on map →</button></div>`;card.querySelector('button').addEventListener('click',()=>{document.getElementById('map-section').scrollIntoView({behavior:'smooth'});setTimeout(()=>{const found=markers.find(m=>m.place.name===place.name);if(found&&map){map.setView(place.coords,15);found.marker.openPopup();showNearbyTransport(place)}},350)});placeGrid.appendChild(card)});
  if(!places.length) throw new Error('The heritage API returned zero places. Check data/heritage_sites.csv.');
  if(typeof L==='undefined'){
   document.getElementById('map').innerHTML='<div style="padding:24px;font-size:13px;color:#506f91">The map library could not load. Check your internet connection and refresh; your place list is still available.</div>';
   return;
  }
  map=L.map('map',{scrollWheelZoom:true}).setView([19.275,72.82],11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
  places.forEach(place=>{const marker=L.marker(place.coords,{icon:createMarkerIcon(place.type)}).addTo(map);marker.bindPopup(`<div class="map-popup"><strong>${place.name}</strong><span>${place.type} · ${place.area||''}</span><p>${place.description}</p><a href="https://www.google.com/maps/search/?api=1&query=${place.coords[0]},${place.coords[1]}" target="_blank" rel="noopener">Open in Google Maps ↗</a><br><button type="button" class="popup-transport-btn" data-place="${place.id}">Find nearby transport</button></div>`);marker.on('popupopen',()=>{const btn=document.querySelector('.popup-transport-btn');if(btn)btn.addEventListener('click',()=>{showNearbyTransport(place);document.getElementById('transportPanel').scrollIntoView({behavior:'smooth',block:'nearest'})},{once:true})});markers.push({place,marker})});
  renderMapList(document.getElementById('mapSearch').value||'');
  const count=document.createElement('p');count.className='shop-note';count.textContent=`Explore ${places.length} mapped heritage and cultural locations. Check site access and details locally before visiting.`;placeGrid.before(count);
  setTimeout(()=>map.invalidateSize(),100);
 }catch(err){
  const message=String(err && err.message ? err.message : err);
  mapList.innerHTML='<p class="empty-result">Could not load heritage places. Check the server terminal for details, then refresh.</p>';
  document.getElementById('map').textContent='Heritage data could not load: '+message+'. Run app.py from this extracted project folder and confirm data/heritage_sites.csv exists.';
  console.error('SARAL heritage loading error:',err)
 }
}
loadHeritage();document.getElementById('mapSearch').addEventListener('input',e=>renderMapList(e.target.value));document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');currentFilter=b.dataset.filter;renderMapList(document.getElementById('mapSearch').value)}));

// ---------- data-backed handmade shop ----------
const shopGrid=document.getElementById('shopGrid');let bag=[];
async function loadProducts(){try{const data=await api('/products');products=data.products||[];shopGrid.innerHTML='';products.forEach(product=>{const card=document.createElement('article');card.className='product-card';card.innerHTML=`<div class="product-image"><img src="${product.image}" alt="${product.name}" loading="lazy" onerror="this.onerror=null;this.src='/images/craft-fallback.svg'"></div><div class="product-body"><span class="card-tag">HANDMADE · ${product.craft||'CRAFT'}</span><h3>${product.name}</h3><p class="product-maker">${product.maker}</p><div class="price-row"><span class="price">₹${product.price.toLocaleString('en-IN')}</span><button class="add-btn">ADD TO BAG</button></div></div>`;card.querySelector('.price-row .add-btn').addEventListener('click',()=>addToBag(product));shopGrid.appendChild(card)})}catch(err){shopGrid.innerHTML='<p class="empty-result">Could not load products. Please restart the SARAL server.</p>';console.error(err)}}
function addToBag(product){bag.push(product);updateBag();showToast(`${product.name} added to your bag`)}function removeFromBag(i){bag.splice(i,1);updateBag()}
function updateBag(){document.getElementById('bagCount').textContent=bag.length;const items=document.getElementById('bagItems');items.innerHTML='';if(!bag.length)items.innerHTML='<p class="empty-result">Your bag is empty.</p>';bag.forEach((p,i)=>{const item=document.createElement('div');item.className='bag-item';item.innerHTML=`<img src="${p.image}" alt="" onerror="this.onerror=null;this.src='/images/craft-fallback.svg'"><div><strong>${p.name}</strong><span>₹${p.price.toLocaleString('en-IN')}</span><button class="bag-remove">Remove</button></div>`;item.querySelector('.bag-remove').addEventListener('click',()=>removeFromBag(i));items.appendChild(item)});document.getElementById('bagTotal').textContent=`₹${bag.reduce((s,p)=>s+p.price,0).toLocaleString('en-IN')}`}
const bagDrawer=document.getElementById('bagDrawer'),bagOverlay=document.getElementById('bagOverlay');function openBag(){bagDrawer.classList.add('open');bagOverlay.classList.add('open')}function closeBag(){bagDrawer.classList.remove('open');bagOverlay.classList.remove('open')};document.getElementById('bagBtn').addEventListener('click',openBag);document.getElementById('closeBag').addEventListener('click',closeBag);bagOverlay.addEventListener('click',closeBag);document.getElementById('checkoutBtn').addEventListener('click',async()=>{if(!bag.length){showToast('Your bag is empty.');return}try{const result=await api('/orders',{method:'POST',body:JSON.stringify({items:bag.map(p=>({product_id:p.id,quantity:1}))})});bag=[];updateBag();closeBag();showToast(`Order ${result.order_id} placed successfully.`)}catch(err){showToast(err.message||'Please log in and try again.')}});loadProducts();updateBag();
// A small community-pulse panel uses only recorded demo orders; it does not claim verified artisan payouts.
async function loadImpactPanel(){try{const data=await api('/impact');const section=document.createElement('section');section.className='section container';section.id='saralImpact';section.innerHTML=`<div class="section-heading"><div><span class="section-number">08</span><h2>SARAL Community Pulse</h2></div><p>Transparent figures from orders recorded in this demo.</p></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:20px 0"><div style="padding:20px;border:1px solid #e4e0d7;border-radius:14px;background:#fff"><small>Orders recorded</small><h3 style="font-size:28px;margin:8px 0">${data.orders}</h3></div><div style="padding:20px;border:1px solid #e4e0d7;border-radius:14px;background:#fff"><small>Items purchased</small><h3 style="font-size:28px;margin:8px 0">${data.items}</h3></div><div style="padding:20px;border:1px solid #e4e0d7;border-radius:14px;background:#fff"><small>Gross demo order value</small><h3 style="font-size:28px;margin:8px 0">₹${Number(data.gross_order_value_inr).toLocaleString('en-IN')}</h3></div></div><p style="font-size:12px;color:#68777a">${data.note} Figures are local demo database records, not independently verified community impact.</p>`;const shop=document.getElementById('shop');shop.before(section)}catch(e){console.warn('Impact panel unavailable',e)}}
loadImpactPanel();
const toast=document.getElementById('toast');function showToast(msg){toast.textContent=msg;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),2300)}updateBag();
