(() => {
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,String(v))}catch(e){}}};
// sound: unlock the AudioContext on the first gesture (iOS), remember mute across sessions
const muteBtn = document.getElementById('mute');
function setMuted(b){ Sound.setMuted(b); store.set('noodleMuted', b?'1':'0'); muteBtn.textContent = b ? '🔇' : '🔊'; }
setMuted(store.get('noodleMuted')==='1');
muteBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.unlock(); setMuted(!Sound.muted); Sound.play('tap'); });
// every gesture (re)unlocks: iOS suspends/interrupts the context whenever the app is backgrounded
addEventListener('pointerdown', ()=>Sound.unlock()); addEventListener('touchstart', ()=>Sound.unlock(), {passive:true}); addEventListener('keydown', ()=>Sound.unlock());
addEventListener('keydown', e=>{ if(e.code==='KeyM' && !e.repeat) setMuted(!Sound.muted); });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') Sound.wake(); });
addEventListener('error', e=>{ const d=document.createElement('div'); d.style.cssText='position:fixed;top:60px;left:10px;right:10px;background:#900;color:#fff;padding:10px;font:12px monospace;z-index:99;white-space:pre-wrap'; d.textContent='Error: '+e.message+' @'+e.lineno; document.body.appendChild(d); });
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const cv = document.getElementById('c'); let ctx = cv.getContext('2d');
function ctxSwap(g){ ctx=g; }
const lenEl = document.getElementById('len'), bestEl = document.getElementById('best');
let lastLen = 10;
function lenPop(){ lenEl.classList.remove('pop'); void lenEl.offsetWidth; lenEl.classList.add('pop'); }
// active power-up pills in the HUD; rebuilt only when the set changes, bars updated every 6 ticks
const buffsEl = document.getElementById('buffs'); let buffKeys = '';
function renderBuffs(force){
  const act = effects.active(), keys = act.map(a=>a.kind).join(',');
  if (force || keys !== buffKeys){ buffKeys = keys; buffsEl.innerHTML = act.map(a=>`<span class="buff" style="--c:${Items.POWERUPS[a.kind].c}"><i>${Items.POWERUPS[a.kind].glyph}</i><b class="bar"></b></span>`).join(''); }
  if (force || tick%6===0){ const bars = buffsEl.querySelectorAll('.bar'); act.forEach((a,i)=>{ if (bars[i]) bars[i].style.width = Math.round(a.frac*100)+'%'; }); }
}
const overlay = document.getElementById('overlay'), boostBtn = document.getElementById('boost');
let W, H, DPR;
function resize(){ DPR = Math.min(devicePixelRatio||1, 1.5); W = innerWidth; H = innerHeight; cv.width = W*DPR; cv.height = H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0); }
addEventListener('resize', resize); resize();

const ARENA = 2200, SEG = 6, BASE_SPEED = 2.6, PALETTE = ['#ff5d4a','#5cc8ff','#ffb347','#e07bff','#7dffb0','#fff275'];
let best = +store.get('noodleBest') || 0; bestEl.textContent = best;
let eaten = +store.get('noodleEaten') || 0;
let skinId = store.get('noodleSkin') || 'lime';
const ROUNDS = [
  {target:40,  rivals:8,  rivalLen:[10,25],  name:'Hatchling'},
  {target:80,  rivals:10, rivalLen:[15,45],  name:'Hunter'},
  {target:130, rivals:12, rivalLen:[20,70],  name:'Predator'},
  {target:200, rivals:14, rivalLen:[30,110], name:'Apex'},
  {target:0,   rivals:10, rivalLen:[30,90],  name:'The Pit King', king:true},
];
const KING_LEN = 320;
let round = 0, maxRound = +store.get('noodleRound') || 0, king = null;
const goalEl=document.getElementById('goal'), roundNumEl=document.getElementById('roundNum'), roundNameEl=document.getElementById('roundName');
function buildRoundPicker(){
  const box=document.getElementById('rounds'); if(!box) return; box.innerHTML='';
  ROUNDS.forEach((r,i)=>{ const b=document.createElement('button'); b.className='rd'+(i===round?' sel':'')+(i>maxRound?' lock':''); b.textContent=r.king?'👑':i+1;
    b.onclick=()=>{ if(i>maxRound) return; Sound.play('tap'); round=i; buildRoundPicker(); }; box.appendChild(b); });
}
const SKINS = [
  {id:'lime',   name:'Lime',     c:'#c9f24a', type:'solid',  need:()=>true,        label:'free'},
  {id:'coral',  name:'Coral',    c:'#ff5d4a', type:'solid',  need:()=>best>=30,    label:'reach length 30'},
  {id:'sky',    name:'Sky bands',c:'#5cc8ff', c2:'#1b1330', type:'bands', need:()=>eaten>=3, label:'eat 3 worms'},
  {id:'bee',    name:'Bumble',   c:'#ffd23f', c2:'#1b1330', type:'bands', need:()=>best>=60,    label:'reach length 60'},
  {id:'spots',  name:'Cheetah',  c:'#ffb347', c2:'#7a3e00', type:'spots', need:()=>eaten>=10,label:'eat 10 worms'},
  {id:'candy',  name:'Candy',    c:'#ff7ad9', c2:'#fff', type:'bands', need:()=>best>=100, label:'reach length 100'},
  {id:'rainbow',name:'Rainbow',  c:'#fff', type:'rainbow', need:()=>eaten>=25, label:'eat 25 worms'},
  {id:'ghost',  name:'Ghost',    c:'#e9e4ff', type:'glow',  need:()=>best>=200, label:'reach length 200'},
];
function skinOf(id){ return SKINS.find(k=>k.id===id) || SKINS[0]; }
function hue(i){ return `hsl(${(i*9)%360},90%,60%)`; }
// draw a worm: tapered segmented body from tail to head
function shade(hex,amt){ const n=parseInt(hex.slice(1),16); let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt; r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b)); return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0'); }
function paintBody(pts, r, skin, boost, ang, hx, hy, squash){
  const n=pts.length; if(n<2) return;
  if (boost){
    // speed lines fanning out behind the head
    const bx = hx - Math.cos(ang)*r*1.5, by = hy - Math.sin(ang)*r*1.5;
    ctx.strokeStyle = skin.c; ctx.lineWidth = 2;
    for (let k=0;k<5;k++){
      const a = ang + Math.PI + (k-2)*0.22 + rnd(-0.05,0.05), L = r*(2+Math.random()*3);
      ctx.globalAlpha = 0.5*(1-Math.abs(k-2)/3);
      ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(a)*L, by+Math.sin(a)*L); ctx.stroke();
    }
    ctx.globalAlpha = .18 + .1*Math.sin(tick/3);
    ctx.fillStyle = skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (skin.type==='glow'){
    ctx.globalAlpha=.25; ctx.fillStyle=skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=1;
  }
  if (skin.type==='glow') ctx.globalAlpha=.85;
  const dark = skin.type==='rainbow' ? null : shade(skin.c,-70);
  for (let i=n-1;i>=0;i--){
    const t=i/n, ri = r*(0.35+0.65*Math.pow(1-t,0.6)) * (i<3?1.12+0.15*(squash||0):1);
    let col = skin.type==='rainbow' ? hue(i+tick/2) : (skin.type==='bands' && (i>>3)%2 ? skin.c2 : skin.c);
    const p=pts[i];
    // dark underside + body
    ctx.fillStyle = skin.type==='rainbow' ? '#3a2a10' : dark; ctx.beginPath(); ctx.arc(p.x,p.y+ri*.18,ri,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=col; ctx.beginPath(); ctx.arc(p.x,p.y,ri,0,Math.PI*2); ctx.fill();
    // segment ring
    if (i%3===0 && i>0){ ctx.strokeStyle='rgba(0,0,0,.28)'; ctx.lineWidth=Math.max(1,ri*.14); ctx.beginPath(); ctx.arc(p.x,p.y,ri*.92,0,Math.PI*2); ctx.stroke(); }
    // spots
    if (skin.type==='spots' && i%5===2){ ctx.fillStyle=skin.c2; ctx.beginPath(); ctx.arc(p.x+Math.cos(i)*ri*.35,p.y+Math.sin(i*1.7)*ri*.35,ri*.3,0,Math.PI*2); ctx.fill(); }
    // dorsal highlight
    ctx.fillStyle='rgba(255,255,255,.28)'; ctx.beginPath(); ctx.arc(p.x-ri*.25,p.y-ri*.35,ri*.3,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
  // clitellum (the thicker saddle worms have) a little way behind the head
  if (n>16){ const p=pts[12]; ctx.fillStyle=shade(skin.type==='rainbow'?'#ff9a6a':skin.c,35); ctx.beginPath(); ctx.arc(p.x,p.y,r*1.05,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=1.5; ctx.stroke(); }
  // mouth
  const h=pts[0]; ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.lineWidth=Math.max(1.5,r*.18); ctx.beginPath(); ctx.arc(h.x+Math.cos(ang)*r*.55,h.y+Math.sin(ang)*r*.55,r*.32,ang-1.1,ang+1.1); ctx.stroke();
}
function buildSkinPicker(){
  const box=document.getElementById('skins'); if(!box) return; box.innerHTML='';
  for (const k of SKINS){
    const ok=k.need(); const d=document.createElement('div'); d.className='sk'+(ok?'':' lock')+(k.id===skinId?' sel':'');
    const c=document.createElement('canvas'); c.width=128; c.height=128; d.appendChild(c);
    const g=c.getContext('2d');
    // preview: draw a wiggly body
    const pts=[]; for(let i=0;i<40;i++) pts.push({x:20+i*2.3, y:64+Math.sin(i/5)*22});
    const realCtx=ctx; ctxSwap(g); paintBody(pts,11,k,false,0,0,0); ctxSwap(realCtx);
    if(!ok){ const n=document.createElement('div'); n.className='need'; n.textContent=k.label; d.appendChild(n); }
    d.onclick=()=>{ if(!ok) return; Sound.play('tap'); skinId=k.id; store.set('noodleSkin',skinId); buildSkinPicker(); };
    box.appendChild(d);
  }
}
// overlay screens — one template per screen, one place that shows/hides
function titleScreen(){
  return `<h1>Noodle Pit<span>eat, grow, don't get bonked</span></h1>
  <div id="rounds"></div><div id="skins"></div>
  <p>Grow to each round's target as the biggest worm in the pit, then eat the Pit King.</p>
  <p class="sub">Joystick steers · hold BOOST to speed up (costs length) · bump smaller worms to eat them</p>
  <button id="start">Play</button>
  ${standalone ? '' : '<p class="sub" style="margin-top:18px">To install: tap Share, then Add to Home Screen.</p>'}`;
}
function roundClearScreen(){
  const prev = ROUNDS[round-1], next = ROUNDS[round];
  return `<h1>Round cleared<span>${prev.name} → ${next.name}</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>${next.king ? 'Final round: the Pit King is waiting. He\'s length '+KING_LEN+' — outgrow him, then eat him.' : 'Next: reach length '+next.target+' as the biggest worm. Rivals start bigger.'}</p>
  <div id="skins"></div><button id="start">Next round</button>`;
}
function winScreen(){
  return `<h1>You rule the pit<span>the King is eaten</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>Every round cleared. The pit is yours — keep playing to chase a new best and finish the skins.</p>
  <div id="skins"></div><button id="start">Play again</button>`;
}
function gameOverScreen(newly){
  return `<h1>Eaten<span>you grew to</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>Best ${best} · worms eaten ${eaten}${newly.length?`<br><b style="color:var(--lime)">New skin unlocked: ${newly.map(k=>k.name).join(', ')}</b>`:''}</p>
  <div id="rounds"></div><div id="skins"></div><button id="start">Retry round ${round+1}</button>`;
}
function countUp(el, to){
  const t0 = performance.now(), dur = 400;
  const f = ()=>{ const k = Math.min(1,(performance.now()-t0)/dur); el.textContent = Math.round(to*(1-Math.pow(1-k,3))); if (k<1) requestAnimationFrame(f); };
  f();
}
function showOverlay(html){
  overlay.innerHTML = html;
  buildRoundPicker(); buildSkinPicker();
  const sc = overlay.querySelector('.score'); if (sc) countUp(sc, +sc.dataset.count);
  const b = overlay.querySelector('#start'); if (b) b.onclick = start;
  overlay.classList.add('show'); overlay.inert = false;
  boostBtn.style.display='none'; pauseBtn.hidden = true;
  Sound.music('menu');
}
function hideOverlay(){
  // inert + blur so the just-clicked Play button can't be re-triggered by Space/Enter during play
  overlay.classList.remove('show'); overlay.inert = true;
  const a = document.activeElement; if (a && a.blur) a.blur();
  boostBtn.style.display='flex'; pauseBtn.hidden = false;
}

// pause: freeze the run without ending it; auto-pause when the tab is hidden
const pauseBtn = document.getElementById('pause');
let paused = false;
function pauseScreen(){
  return `<h1>Paused<span>Round ${round+1} · ${ROUNDS[round].name}</span></h1>
  <p>Length ${player.len}</p>
  <button id="resume">Resume</button>
  <p><button id="quit" style="background:transparent;color:var(--paper);border:2px solid rgba(255,255,255,.35);margin-top:8px">Quit to menu</button></p>`;
}
function pause(){
  if (!running || paused) return;
  paused = true; running = false; boosting = false; player.boost = 0; Sound.boost(false);
  showOverlay(pauseScreen());
  overlay.querySelector('#resume').onclick = ()=>{ Sound.play('tap'); resume(); };
  overlay.querySelector('#quit').onclick = ()=>{ Sound.play('tap'); quitToMenu(); };
}
function resume(){
  if (!paused) return;
  paused = false; running = true;
  hideOverlay();
  Sound.unlock(); Sound.music(ROUNDS[round].king ? 'king' : 'play');
}
function quitToMenu(){
  paused = false; running = false; Sound.boost(false);
  if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; }
  reset();
  showOverlay(titleScreen());
}
pauseBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.unlock(); Sound.play('tap'); pause(); });
addEventListener('keydown', e=>{ if((e.code==='Escape' || e.code==='KeyP') && !e.repeat){ if (paused) resume(); else pause(); } });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden' && running) pause(); });

let worms = [], food = [], player, running = false, steer = null, boosting = false, cam = {x:0,y:0}, tick = 0;
let playerHitWall = false, godMode = false;

// power-ups: one pickup on the arena at a time, player-only effects on a frame clock
let pickups = [], nextPickupAt = 0;
const effects = Items.createEffects();
function schedulePickup(){ nextPickupAt = tick + rnd(Items.PICKUP.interval[0], Items.PICKUP.interval[1]); }
function spawnPickup(kind, x, y){
  if (x==null){ for (let t=0;t<10;t++){ const a=rnd(0,Math.PI*2), r=rnd(200,ARENA-200); x=Math.cos(a)*r; y=Math.sin(a)*r; if (Math.hypot(x-player.x,y-player.y)>=Items.PICKUP.minDist) break; } }
  pickups.push({ x, y, kind: kind || Items.pickPowerup(), born: tick });
}
// the shield absorbs one fatal hit: bounce, shed 10% length, pull back inside the arena
function shieldSave(){
  effects.consume('shield'); playerHitWall = false;
  player.ang += Math.PI; player.len = Math.max(6, Math.floor(player.len*0.9));
  const d = Math.hypot(player.x,player.y); if (d > ARENA-20){ player.x *= (ARENA-20)/d; player.y *= (ARENA-20)/d; }
  FX.shake(8,12); FX.burst(player.x,player.y,24,'#c9f24a',{speed:4,life:24,r:2.5}); Sound.play('shieldHit');
}

function rnd(a,b){ return a + Math.random()*(b-a); }
// food comes in tiers (Items.FOOD); crumbs keep the palette colours, the rest have a fixed look
const FOOD_COLORS = { berry:'#c9457f', grub:'#f3e6a2', apple:'#ffd23f' };
let appleCount = 0;
function mkFood(x,y,kind,color){
  if(food.length>900) return;
  kind = kind || 'crumb'; const k = Items.FOOD[kind];
  if (kind==='apple') appleCount++;
  food.push({ x, y, kind, v: k.v, r: k.r, c: color || FOOD_COLORS[kind] || PALETTE[Math.random()*PALETTE.length|0], ph: Math.random()*Math.PI*2 });
}
function spawnFood(){ const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*(ARENA-30); mkFood(Math.cos(a)*r, Math.sin(a)*r, Items.pickFood(Math.random, appleCount)); }
function eatFood(i){ const f=food[i]; if (f.kind==='apple') appleCount--; food.splice(i,1); return f; }
function mkWorm(isPlayer, len){
  const a = rnd(0, Math.PI*2), r = rnd(200, ARENA-200);
  const R=ROUNDS[round]; if(len==null) len = isPlayer ? 10 : Math.round(rnd(R.rivalLen[0],R.rivalLen[1]));
  const s = { x: Math.cos(a)*r, y: Math.sin(a)*r, ang: rnd(0,Math.PI*2), len, pts: [], c: isPlayer ? skinOf(skinId).c : PALETTE[Math.random()*PALETTE.length|0], skin: isPlayer ? skinOf(skinId) : null, ai: !isPlayer, turnT: 0, dead:false };
  for (let i=0;i<s.len;i++) s.pts.push({x:s.x - Math.cos(s.ang)*i*SEG, y:s.y - Math.sin(s.ang)*i*SEG});
  return s;
}
function reset(){
  FX.clear(); playerHitWall = false;
  worms = []; food = []; appleCount = 0;
  pickups = []; effects.clear(); nextPickupAt = tick + Items.PICKUP.first; renderBuffs(true);
  player = mkWorm(true); player.x = 0; player.y = 0; player.pts = player.pts.map((p,i)=>({x:-Math.cos(player.ang)*i*SEG, y:-Math.sin(player.ang)*i*SEG}));
  worms.push(player);
  const R=ROUNDS[round]; king=null;
  for (let i=0;i<R.rivals;i++) worms.push(mkWorm(false));
  if (R.king){ king = mkWorm(false, KING_LEN); king.c='#ffd23f'; king.skin={c:'#ffd23f',c2:'#7a3e00',type:'bands'}; king.isKing=true; worms.push(king); }
  goalEl.textContent = R.king ? ' — eat the King' : ' / '+R.target+' and biggest'; goalEl.classList.remove('met');
  roundNumEl.textContent = round+1; roundNameEl.textContent = R.name;
  for (let i=0;i<260;i++) spawnFood();
  lastLen = player.len; lenEl.textContent = player.len;
}
function kill(s, by){
  if (s===player && godMode){ playerHitWall = false; const d=Math.hypot(s.x,s.y); if (d>ARENA-20){ s.x*=(ARENA-20)/d; s.y*=(ARENA-20)/d; } return; }
  if (s===player && effects.has('shield')){ shieldSave(); return; }
  s.dead = true;
  for (let i=0;i<s.pts.length;i+=2){ const p=s.pts[i]; mkFood(p.x+rnd(-4,4), p.y+rnd(-4,4), 'chunk', s.c); }
  FX.burst(s.x, s.y, Math.min(24, 12 + (s.len/12|0)), s.c, { speed: 3.5, life: 36, r: 3 });
  if (s === player){
    FX.shake(14, 27); FX.flash('rgba(255,93,74,.35)', 3);
    gameOver();
  } else {
    if (by === player){
      FX.burst(player.x, player.y, 8, '#c9f24a', { speed: 5, life: 20, r: 2 });
      FX.shake(Math.min(10, 3 + s.len/20), 15); FX.flash('rgba(255,255,255,.18)', 2);
      if (s.isKing) FX.shake(18, 36);
    }
    if (!s.isKing) s.respawnAt = tick + 90;   // on the tick clock so a pause can't swallow the respawn
  }
}
function radius(s){ return 5 + Math.min(10, s.len/25); }

function update(){
  tick++;
  for (let i=0;i<worms.length;i++){ const s=worms[i]; if (s.dead && s.respawnAt!=null && tick>=s.respawnAt) worms[i]=mkWorm(false); }
  // power-up pickups: spawn, expire, collect (player only)
  if (!pickups.length && tick >= nextPickupAt) spawnPickup();
  for (let i=pickups.length-1;i>=0;i--){ const p=pickups[i];
    if (tick - p.born >= Items.PICKUP.ttl){ pickups.splice(i,1); schedulePickup(); continue; }
    const rr = radius(player)+14;
    if (!player.dead && (p.x-player.x)**2+(p.y-player.y)**2 < rr*rr){
      const P = Items.POWERUPS[p.kind]; effects.add(p.kind, P.dur);
      FX.burst(p.x,p.y,14,P.c,{speed:4,life:30,r:2.5}); Sound.play('pickup'); pickups.splice(i,1); schedulePickup();
    }
  }
  for (const k of effects.tick()) Sound.play('buffEnd');
  if (effects.has('magnet')){ for (const f of food){ const dx=player.x-f.x, dy=player.y-f.y, d=Math.hypot(dx,dy); if (d<140 && d>1){ f.x += dx/d*4; f.y += dy/d*4; } } }
  // spawn food to keep arena stocked
  if (food.length < 280 && tick%4===0) spawnFood();
  for (const s of worms){
    if (s.dead) continue;
    let target;
    if (s.ai){
      s.turnT--;
      // richest-nearest food (distance² / value) + avoid other worms' bodies ahead
      let bestD=1e18, f=null;
      for (let i=0;i<food.length;i+=3){ const d=((food[i].x-s.x)**2+(food[i].y-s.y)**2)/food[i].v; if(d<bestD){bestD=d;f=food[i];} }
      target = f ? Math.atan2(f.y-s.y, f.x-s.x) : s.ang;
      if (Math.hypot(s.x,s.y) > ARENA-150) target = Math.atan2(-s.y,-s.x);
      const lx = s.x+Math.cos(s.ang)*60, ly = s.y+Math.sin(s.ang)*60;
      for (const o of worms){ if(o===s||o.dead) continue;
        const dd=(o.x-s.x)**2+(o.y-s.y)**2;
        if (o.len < s.len*0.8 && dd < 250*250){ target = Math.atan2(o.y-s.y, o.x-s.x); }
        else if (o.len >= s.len) for(let i=0;i<o.pts.length;i+=3){ const p=o.pts[i]; if((p.x-lx)**2+(p.y-ly)**2<1600){ target = s.ang + (Math.random()<.5?1:-1)*1.4; i=1e9; } } }
      if (s.turnT<=0){ s.turnT = 40+Math.random()*60; if(Math.random()<.2) target += rnd(-1,1); }
      if (s.isKing && !player.dead){ const dd=Math.hypot(player.x-s.x,player.y-s.y); if (s.len>player.len && dd<700) target = Math.atan2(player.y-s.y, player.x-s.x); else if (s.len<=player.len && dd<500) target = Math.atan2(s.y-player.y, s.x-player.x); }
      s.boost = Math.random()<.01 ? 30 : Math.max(0,(s.boost||0)-1);
    } else {
      target = steer==null ? s.ang : steer;
      const wasBoost = !!s.boost; s.boost = boosting && s.len>6 ? 1 : 0;
      if (!!s.boost !== wasBoost) Sound.boost(!!s.boost);
    }
    let d = target - s.ang; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.ang += Math.max(-0.11, Math.min(0.11, d));
    s.turn = Math.abs(Math.max(-0.11, Math.min(0.11, d)))/0.11;
    const speedBuff = s===player && effects.has('speed');
    const sp = BASE_SPEED * (s.boost || speedBuff ? 2.2 : 1);
    if (s.boost && !speedBuff && tick%10===0 && s.len>6){ s.len--; const t=s.pts[s.pts.length-1]; mkFood(t.x,t.y,'crumb'); }
    s.x += Math.cos(s.ang)*sp; s.y += Math.sin(s.ang)*sp;
    // arena wall
    if (Math.hypot(s.x,s.y) > ARENA){ if (s===player) playerHitWall = true; kill(s, null); continue; }
    s.pts.unshift({x:s.x,y:s.y});
    const maxPts = Math.min(600, Math.floor(s.len * 1.6));
    while (s.pts.length > maxPts) s.pts.pop();
    // eat
    const r = radius(s)+6;
    for (let i=food.length-1;i>=0;i--){ const f=food[i]; if((f.x-s.x)**2+(f.y-s.y)**2 < r*r){ s.len += f.v; if (s===player){ FX.burst(f.x, f.y, 3 + (f.v/2|0), f.c, { speed: 1.8 + f.v*0.15, life: 15, r: 1.8 }); Sound.play('eat', f.v); if (f.kind==='apple') Sound.play('apple'); } eatFood(i); } }
  }
  // collisions (head into other body); a ghosted player is skipped both ways
  const ghost = effects.has('ghost');
  for (const s of worms){
    if (s.dead) continue;
    const r = radius(s);
    for (const o of worms){
      if (o===s||o.dead||(ghost&&(s===player||o===player))) continue;
      const orr = radius(o), rr=(r+orr)*(r+orr);
      for (let i=0;i<o.pts.length;i+=2){ const p=o.pts[i]; if((p.x-s.x)**2+(p.y-s.y)**2<rr){
        if (s.len < o.len) kill(s, o);                    // ran into something bigger: you're done
        else { s.len += Math.ceil(o.len/2); if(s===player){ eaten++; store.set('noodleEaten',eaten); Sound.play('eatWorm', o.len); } kill(o, s); }   // bit something smaller: you eat it
        break; } }
      if (s.dead) break;
    }
  }
  // round goal
  const R=ROUNDS[round];
  goalEl.classList.toggle('met', !R.king && player.len>=R.target);
  if (!player.dead){
    if (R.king){ if (king && king.dead) roundWin(); }
    else if (player.len>=R.target && worms.every(o=>o.dead||o===player||o.len<player.len)) roundWin();
  }
  const camK = player.boost ? 0.18 : 0.12;
  cam.x += (player.x-cam.x)*camK; cam.y += (player.y-cam.y)*camK;
  FX.update();
  if (player.len !== lastLen){ if (player.len > lastLen) lenPop(); lastLen = player.len; lenEl.textContent = player.len; }
  renderBuffs();
}

function drawFood(f){
  switch (f.kind){
    case 'berry':
      ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#ff8fc2'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(f.x-f.r*.2,f.y-f.r*.2,f.r*.55,Math.PI*1.1,Math.PI*1.7); ctx.stroke();
      ctx.strokeStyle='#4a7a2a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(f.x,f.y-f.r); ctx.lineTo(f.x+2,f.y-f.r-4); ctx.stroke();
      break;
    case 'grub': {
      const a=Math.sin(tick/8+f.ph)*0.6, dx=Math.cos(a)*f.r*.7, dy=Math.sin(a)*f.r*.7;
      ctx.fillStyle=f.c; for (let k=-1;k<=1;k++){ ctx.beginPath(); ctx.arc(f.x+dx*k,f.y+dy*k,f.r*(k?.75:.85),0,Math.PI*2); ctx.fill(); }
      ctx.strokeStyle='rgba(120,90,20,.5)'; ctx.lineWidth=1.5; for (const k of [-0.5,0.5]){ ctx.beginPath(); ctx.arc(f.x+dx*k,f.y+dy*k,f.r*.7,0,Math.PI*2); ctx.stroke(); }
      break; }
    case 'apple': {
      ctx.globalAlpha=.25; ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r*2.2+Math.sin(tick/5+f.ph)*1.5,0,Math.PI*2); ctx.fill(); ctx.globalAlpha=1;
      ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,.5)'; ctx.beginPath(); ctx.arc(f.x-f.r*.3,f.y-f.r*.3,f.r*.3,0,Math.PI*2); ctx.fill();
      const sa=tick/40+f.ph, sx=f.x+f.r*1.3, sy=f.y-f.r*1.3; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath();
      for (let k=0;k<2;k++){ const b=sa+k*Math.PI/2; ctx.moveTo(sx-Math.cos(b)*4,sy-Math.sin(b)*4); ctx.lineTo(sx+Math.cos(b)*4,sy+Math.sin(b)*4); } ctx.stroke();
      break; }
    default: ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill();
  }
}

function draw(){
  ctx.fillStyle = '#1b1330'; ctx.fillRect(0,0,W,H);
  const sh = FX.shakeOffset(); ctx.save(); ctx.translate(W/2-cam.x+sh.x, H/2-cam.y+sh.y);
  // soft soil vignette
  const vg=ctx.createRadialGradient(cam.x,cam.y,0,cam.x,cam.y,Math.max(W,H)*.7); vg.addColorStop(0,'#2b2040'); vg.addColorStop(1,'#1b1330');
  ctx.fillStyle=vg; ctx.fillRect(cam.x-W/2,cam.y-H/2,W,H);
  // arena edge
  ctx.strokeStyle='#ff5d4a'; ctx.lineWidth=6; ctx.beginPath(); ctx.arc(0,0,ARENA,0,Math.PI*2); ctx.stroke();
  // food
  for (const f of food){ if(Math.abs(f.x-cam.x)>W/2+20||Math.abs(f.y-cam.y)>H/2+20) continue; drawFood(f); }
  // power-up pickups: pulsing ring + glyph, blinking before they expire
  for (const p of pickups){
    if (Items.PICKUP.ttl-(tick-p.born) < Items.PICKUP.blinkAt && (tick>>3)&1) continue;
    if(Math.abs(p.x-cam.x)>W/2+30||Math.abs(p.y-cam.y)>H/2+30) continue;
    const P=Items.POWERUPS[p.kind], R=14+2*Math.sin(tick/6);
    ctx.fillStyle='rgba(27,19,48,.85)'; ctx.beginPath(); ctx.arc(p.x,p.y,R,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=P.c; ctx.lineWidth=3; ctx.stroke();
    ctx.font='16px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#fff'; ctx.fillText(P.glyph,p.x,p.y+1); ctx.textBaseline='alphabetic';
  }
  FX.drawWorld(ctx);
  // worms
  for (const s of worms){
    if (s.dead) continue;
    const r = radius(s);
    if (s!==player && s.pts.every(p=>Math.abs(p.x-cam.x)>W/2+40||Math.abs(p.y-cam.y)>H/2+40)) continue;
    if (s===player && effects.has('ghost')) ctx.globalAlpha=.5;
    paintBody(s.pts, r, s.skin || {c:s.c,type:'solid'}, s.boost || (s===player && effects.has('speed')), s.ang, s.x, s.y, s.turn);
    // eyes
    const ex=Math.cos(s.ang+Math.PI/2)*r*.5, ey=Math.sin(s.ang+Math.PI/2)*r*.5, fx=Math.cos(s.ang)*r*.35, fy=Math.sin(s.ang)*r*.35;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(s.x+ex+fx,s.y+ey+fy,r*.34,0,Math.PI*2); ctx.arc(s.x-ex+fx,s.y-ey+fy,r*.34,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText((s.isKing?'👑 ':'')+s.len, s.x, s.y-r-6);
    let look = 0; if (s===player && steer!=null){ let d=steer-s.ang; d=Math.atan2(Math.sin(d),Math.cos(d)); look = Math.max(-1,Math.min(1,d/1.2)); }
    const px = Math.cos(s.ang+look*0.6)*r*.1, py = Math.sin(s.ang+look*0.6)*r*.1;
    ctx.fillStyle='#1b1330';
    ctx.beginPath(); ctx.arc(s.x+ex+fx*1.6+px,s.y+ey+fy*1.6+py,r*.17,0,Math.PI*2); ctx.arc(s.x-ex+fx*1.6+px,s.y-ey+fy*1.6+py,r*.17,0,Math.PI*2); ctx.fill();
    if (s===player){
      ctx.globalAlpha=1;
      if (effects.has('shield')){ ctx.strokeStyle='rgba(201,242,74,.6)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(s.x,s.y,r*1.9,0,Math.PI*2); ctx.stroke(); }
      if (effects.has('magnet')){ ctx.strokeStyle='rgba(255,93,74,.12)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(s.x,s.y,140,0,Math.PI*2); ctx.stroke(); }
    }
  }
  ctx.restore();
  FX.drawScreen(ctx, W, H);
  if (running && player.boost){ ctx.fillStyle='rgba(255,93,74,.9)'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.fillText('BOOSTING', W/2, H-40); }
  // steering indicator
}

function loop(){ if(running) update(); else FX.update(); draw(); requestAnimationFrame(loop); }
let unlockedBefore=new Set();
function roundWin(){
  running=false; Sound.boost(false); Sound.play('roundWin');
  FX.flash('rgba(201,242,74,.30)', 3);
  FX.confetti(W/2, H*0.45, 60, PALETTE);
  if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; }
  const newly = SKINS.filter(k=>k.need() && !unlockedBefore.has(k.id)); if (newly.length) Sound.play('unlock');
  const last = round===ROUNDS.length-1;
  if (!last){ maxRound=Math.max(maxRound, round+1); store.set('noodleRound',maxRound); round++; }
  showOverlay(last ? winScreen() : roundClearScreen());
}
function gameOver(){
  running=false; Sound.boost(false); Sound.play(playerHitWall ? 'wall' : 'death');
  if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; }
  const newly = SKINS.filter(k=>k.need() && !unlockedBefore.has(k.id)); if (newly.length) Sound.play('unlock');
  showOverlay(gameOverScreen(newly));
}
function start(){ Sound.play('tap'); unlockedBefore=new Set(SKINS.filter(k=>k.need()).map(k=>k.id)); reset(); paused=false; running=true; Sound.unlock(); Sound.music(ROUNDS[round].king ? 'king' : 'play'); steer=null; boosting=false; hideOverlay(); }

// joystick in bottom-left: direction from stick center to finger
const stick=document.getElementById('stick'), knob=document.getElementById('knob');
let steerId=null;
function stickPos(t){ const r=stick.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; let dx=t.clientX-cx, dy=t.clientY-cy; const d=Math.hypot(dx,dy); if(d>6) steer=Math.atan2(dy,dx); const m=Math.min(d,r.width/2-32); const a=Math.atan2(dy,dx); knob.style.transform=`translate(${Math.cos(a)*m}px,${Math.sin(a)*m}px)`; }
stick.addEventListener('touchstart', e=>{ e.preventDefault(); if(steerId===null){ const t=e.changedTouches[0]; steerId=t.identifier; stickPos(t); } }, {passive:false});
stick.addEventListener('touchmove', e=>{ e.preventDefault(); for(const t of e.changedTouches) if(t.identifier===steerId) stickPos(t); }, {passive:false});
const endT=e=>{ for(const t of e.changedTouches) if(t.identifier===steerId){ steerId=null; knob.style.transform=''; } };
stick.addEventListener('touchend', endT); stick.addEventListener('touchcancel', endT);
stick.addEventListener('mousedown', e=>{ steerId='m'; stickPos(e); });
addEventListener('mousemove', e=>{ if(steerId==='m') stickPos(e); });
addEventListener('mouseup', ()=>{ if(steerId==='m'){ steerId=null; knob.style.transform=''; } });
cv.addEventListener('touchmove', e=>e.preventDefault(), {passive:false});
// boost button
const bOn=e=>{ e.preventDefault(); boosting=true; boostBtn.classList.add('on'); }, bOff=e=>{ boosting=false; boostBtn.classList.remove('on'); };
boostBtn.addEventListener('touchstart', bOn, {passive:false});
boostBtn.addEventListener('pointerdown', bOn); boostBtn.addEventListener('pointerup', bOff); boostBtn.addEventListener('pointercancel', bOff); boostBtn.addEventListener('pointerleave', bOff);
addEventListener('keydown', e=>{ if(e.code==='Space'){ e.preventDefault(); boosting=true; } }); addEventListener('keyup', e=>{ if(e.code==='Space') boosting=false; });

// read-only debug hook for the headless smoke tests and tools/balance-sim.mjs
window.NoodleDebug = {
  state: () => ({ worms, food, pickups, effects, player, round, tick, running, paused, target: ROUNDS[round].king ? KING_LEN : ROUNDS[round].target }),
  steer: a => { steer = a; },
  spawnPickup: kind => spawnPickup(kind, player.x, player.y),
  setRound: i => { round = i; },
  setGodMode: b => { godMode = !!b; },   // sim only: measure growth without the autopilot's deaths
};

reset(); showOverlay(titleScreen()); loop();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
