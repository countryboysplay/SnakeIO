(() => {
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,String(v))}catch(e){}}};
// sound: unlock the AudioContext on the first gesture (iOS), remember mute across sessions
const muteBtn = document.getElementById('mute');
function setMuted(b){ Sound.setMuted(b); store.set('noodleMuted', b?'1':'0'); muteBtn.textContent = b ? '🔇' : '🔊'; }
setMuted(store.get('noodleMuted')==='1');
muteBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.unlock(); setMuted(!Sound.muted); Sound.play('tap'); });
const unlockOnce = ()=>{ Sound.unlock(); removeEventListener('pointerdown', unlockOnce); removeEventListener('touchstart', unlockOnce); removeEventListener('keydown', unlockOnce); };
addEventListener('pointerdown', unlockOnce); addEventListener('touchstart', unlockOnce, {passive:true}); addEventListener('keydown', unlockOnce);
addEventListener('keydown', e=>{ if(e.code==='KeyM') setMuted(!Sound.muted); });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') Sound.unlock(); });
addEventListener('error', e=>{ const d=document.createElement('div'); d.style.cssText='position:fixed;top:60px;left:10px;right:10px;background:#900;color:#fff;padding:10px;font:12px monospace;z-index:99;white-space:pre-wrap'; d.textContent='Error: '+e.message+' @'+e.lineno; document.body.appendChild(d); });
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const cv = document.getElementById('c'); let ctx = cv.getContext('2d');
function ctxSwap(g){ ctx=g; }
const lenEl = document.getElementById('len'), bestEl = document.getElementById('best');
let lastLen = 10;
function lenPop(){ lenEl.classList.remove('pop'); void lenEl.offsetWidth; lenEl.classList.add('pop'); }
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
let round = 0, maxRound = +store.get('noodleRound') || 0, king = null, gameWon = false;
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
  overlay.classList.add('show');
  boostBtn.style.display='none';
  Sound.music('menu');
}
function hideOverlay(){ overlay.classList.remove('show'); boostBtn.style.display='flex'; }

let worms = [], food = [], player, running = false, steer = null, boosting = false, cam = {x:0,y:0}, tick = 0;
let playerHitWall = false;

function rnd(a,b){ return a + Math.random()*(b-a); }
function mkFood(x,y,v){ if(food.length>900) return; food.push({x, y, v: v||1, c: PALETTE[Math.random()*PALETTE.length|0], r: 3+(v||1)*1.5}); }
function mkWorm(isPlayer, len){
  const a = rnd(0, Math.PI*2), r = rnd(200, ARENA-200);
  const R=ROUNDS[round]; if(len==null) len = isPlayer ? 10 : Math.round(rnd(R.rivalLen[0],R.rivalLen[1]));
  const s = { x: Math.cos(a)*r, y: Math.sin(a)*r, ang: rnd(0,Math.PI*2), len, pts: [], c: isPlayer ? skinOf(skinId).c : PALETTE[Math.random()*PALETTE.length|0], skin: isPlayer ? skinOf(skinId) : null, ai: !isPlayer, turnT: 0, dead:false };
  for (let i=0;i<s.len;i++) s.pts.push({x:s.x - Math.cos(s.ang)*i*SEG, y:s.y - Math.sin(s.ang)*i*SEG});
  return s;
}
function reset(){
  FX.clear(); playerHitWall = false;
  worms = []; food = [];
  player = mkWorm(true); player.x = 0; player.y = 0; player.pts = player.pts.map((p,i)=>({x:-Math.cos(player.ang)*i*SEG, y:-Math.sin(player.ang)*i*SEG}));
  worms.push(player);
  const R=ROUNDS[round]; king=null;
  for (let i=0;i<R.rivals;i++) worms.push(mkWorm(false));
  if (R.king){ king = mkWorm(false, KING_LEN); king.c='#ffd23f'; king.skin={c:'#ffd23f',c2:'#7a3e00',type:'bands'}; king.isKing=true; worms.push(king); }
  goalEl.textContent = R.king ? ' — eat the King' : ' / '+R.target+' and biggest';
  roundNumEl.textContent = round+1; roundNameEl.textContent = R.name;
  for (let i=0;i<350;i++){ const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*(ARENA-30); mkFood(Math.cos(a)*r, Math.sin(a)*r); }
  lastLen = player.len; lenEl.textContent = player.len;
}
function kill(s, by){
  s.dead = true;
  for (let i=0;i<s.pts.length;i+=2){ const p=s.pts[i]; mkFood(p.x+rnd(-4,4), p.y+rnd(-4,4), 2); }
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
    if (!s.isKing) setTimeout(()=>{ if(!running) return; const i=worms.indexOf(s); if(i>-1) worms[i]=mkWorm(false); }, 1500);
  }
}
function radius(s){ return 5 + Math.min(10, s.len/25); }

function update(){
  tick++;
  // spawn food to keep arena stocked
  if (food.length < 380 && tick%4===0){ const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*(ARENA-30); mkFood(Math.cos(a)*r, Math.sin(a)*r); }
  for (const s of worms){
    if (s.dead) continue;
    let target;
    if (s.ai){
      s.turnT--;
      // nearest food + avoid other worms' bodies ahead
      let bestD=1e9, f=null;
      for (let i=0;i<food.length;i+=3){ const d=(food[i].x-s.x)**2+(food[i].y-s.y)**2; if(d<bestD){bestD=d;f=food[i];} }
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
    const sp = BASE_SPEED * (s.boost ? 2.2 : 1);
    if (s.boost && tick%10===0 && s.len>6){ s.len--; const t=s.pts[s.pts.length-1]; mkFood(t.x,t.y,1); }
    s.x += Math.cos(s.ang)*sp; s.y += Math.sin(s.ang)*sp;
    // arena wall
    if (Math.hypot(s.x,s.y) > ARENA){ if (s===player) playerHitWall = true; kill(s, null); continue; }
    s.pts.unshift({x:s.x,y:s.y});
    const maxPts = Math.min(600, Math.floor(s.len * 1.6));
    while (s.pts.length > maxPts) s.pts.pop();
    // eat
    const r = radius(s)+6;
    for (let i=food.length-1;i>=0;i--){ const f=food[i]; if((f.x-s.x)**2+(f.y-s.y)**2 < r*r){ s.len += f.v; if (s===player){ FX.burst(f.x, f.y, 3, f.c, { speed: 1.8, life: 15, r: 1.8 }); Sound.play('eat', f.v); } food.splice(i,1); } }
  }
  // collisions (head into other body)
  for (const s of worms){
    if (s.dead) continue;
    const r = radius(s);
    for (const o of worms){
      if (o===s||o.dead) continue;
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
  if (!player.dead){
    if (R.king){ if (king && king.dead) roundWin(); }
    else if (player.len>=R.target && worms.every(o=>o.dead||o===player||o.len<player.len)) roundWin();
  }
  const camK = player.boost ? 0.18 : 0.12;
  cam.x += (player.x-cam.x)*camK; cam.y += (player.y-cam.y)*camK;
  FX.update();
  if (player.len !== lastLen){ if (player.len > lastLen) lenPop(); lastLen = player.len; lenEl.textContent = player.len; }
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
  for (const f of food){ if(Math.abs(f.x-cam.x)>W/2+20||Math.abs(f.y-cam.y)>H/2+20) continue; ctx.fillStyle=f.c; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,Math.PI*2); ctx.fill(); }
  FX.drawWorld(ctx);
  // worms
  for (const s of worms){
    if (s.dead) continue;
    const r = radius(s);
    if (s!==player && s.pts.every(p=>Math.abs(p.x-cam.x)>W/2+40||Math.abs(p.y-cam.y)>H/2+40)) continue;
    paintBody(s.pts, r, s.skin || {c:s.c,type:'solid'}, s.boost, s.ang, s.x, s.y, s.turn);
    // eyes
    const ex=Math.cos(s.ang+Math.PI/2)*r*.5, ey=Math.sin(s.ang+Math.PI/2)*r*.5, fx=Math.cos(s.ang)*r*.35, fy=Math.sin(s.ang)*r*.35;
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(s.x+ex+fx,s.y+ey+fy,r*.34,0,Math.PI*2); ctx.arc(s.x-ex+fx,s.y-ey+fy,r*.34,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.85)'; ctx.font='bold 12px sans-serif'; ctx.textAlign='center'; ctx.fillText((s.isKing?'👑 ':'')+s.len, s.x, s.y-r-6);
    let look = 0; if (s===player && steer!=null){ let d=steer-s.ang; d=Math.atan2(Math.sin(d),Math.cos(d)); look = Math.max(-1,Math.min(1,d/1.2)); }
    const px = Math.cos(s.ang+look*0.6)*r*.1, py = Math.sin(s.ang+look*0.6)*r*.1;
    ctx.fillStyle='#1b1330';
    ctx.beginPath(); ctx.arc(s.x+ex+fx*1.6+px,s.y+ey+fy*1.6+py,r*.17,0,Math.PI*2); ctx.arc(s.x-ex+fx*1.6+px,s.y-ey+fy*1.6+py,r*.17,0,Math.PI*2); ctx.fill();
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
  const R=ROUNDS[round], last = round===ROUNDS.length-1;
  if (!last){ maxRound=Math.max(maxRound, round+1); store.set('noodleRound',maxRound); round++; }
  showOverlay(last ? winScreen() : roundClearScreen());
}
function gameOver(){
  running=false; Sound.boost(false); Sound.play(playerHitWall ? 'wall' : 'death');
  if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; }
  const newly = SKINS.filter(k=>k.need() && !unlockedBefore.has(k.id)); if (newly.length) Sound.play('unlock');
  showOverlay(gameOverScreen(newly));
}
function start(){ Sound.play('tap'); unlockedBefore=new Set(SKINS.filter(k=>k.need()).map(k=>k.id)); reset(); running=true; Sound.unlock(); Sound.music(ROUNDS[round].king ? 'king' : 'play'); steer=null; boosting=false; hideOverlay(); }

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
addEventListener('keydown', e=>{ if(e.code==='Space') boosting=true; }); addEventListener('keyup', e=>{ if(e.code==='Space') boosting=false; });

reset(); showOverlay(titleScreen()); loop();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
