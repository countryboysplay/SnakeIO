(() => {
const store={get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},set:(k,v)=>{try{localStorage.setItem(k,String(v))}catch(e){}}};
const json=(k,d)=>{ try{ const v=JSON.parse(store.get(k)); return v==null ? d : v; }catch(e){ return d; } };
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
const lenEl = document.getElementById('len'), bestEl = document.getElementById('best'), scoreEl = document.getElementById('score'), timerEl = document.getElementById('timer');
const bossEl = document.getElementById('boss'), bossHpEl = document.getElementById('bossHp');
let lastLen = 10, lastScore = -1;
function lenPop(){ lenEl.classList.remove('pop'); void lenEl.offsetWidth; lenEl.classList.add('pop'); }
// active power-up pills in the HUD; rebuilt only when the set changes, bars updated every 6 ticks
const buffsEl = document.getElementById('buffs'); let buffKeys = '';
function renderBuffs(force){
  const act = effects.active(), keys = act.map(a=>a.kind).join(',');
  if (force || keys !== buffKeys){ buffKeys = keys; buffsEl.innerHTML = act.map(a=>`<span class="buff" style="--c:${Items.POWERUPS[a.kind].c}"><i>${Items.POWERUPS[a.kind].glyph}</i><b class="bar" style="width:${Math.round(a.frac*100)}%"></b></span>`).join(''); }
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
// lifetime stats that drive cosmetic unlocks; medals[i] is the best medal won on round i
const stats = Object.assign({ bestStreak:0, nearMisses:0, deaths:0, dailies:0, kingBeaten:false, endlessBest:0 }, json('noodleStats', {}));
const medals = json('noodleMedals', []);
function saveStats(){ store.set('noodleStats', JSON.stringify(stats)); }
function statView(){ return { ...stats, best, eaten, medals: medals.filter(Boolean).length, golds: medals.filter(m=>m==='gold').length }; }
const style = { hat: store.get('noodleHat') || 'none', trail: store.get('noodleTrail') || 'none', pop: store.get('noodlePop') || 'splat' };
// PACE scales targets, rival sizes and the King so richer food + power-ups don't make rounds shorter
// (spec §4). window.NOODLE_PACE lets tools/balance-sim.mjs sweep values without editing this file.
const PACE = window.NOODLE_PACE || 1.5;
// par: frames for a gold medal ≈ the balance sim's median food-only frames to target (tools/balance-sim.mjs, 30 runs;
// the King's is a 90 s guess the sim doesn't measure); hz: hazards; mix: rival personality mix
const ROUNDS = [
  {target:40,  rivals:8,  rivalLen:[10,25],  name:'Hatchling', par:2000},
  {target:80,  rivals:10, rivalLen:[15,45],  name:'Hunter',    par:2850},
  {target:130, rivals:12, rivalLen:[20,70],  name:'Predator',  par:1950},
  {target:200, rivals:14, rivalLen:[30,110], name:'Apex',      par:2550},
  {target:0,   rivals:10, rivalLen:[30,90],  name:'The Pit King', king:true, par:5400},
].map((r,i) => ({ ...r, hz: Rules.HAZARDS[i], mix: i, target: Math.round(r.target*PACE), rivalLen: r.rivalLen.map(n => Math.round(n*PACE)) }));
const KING_LEN = Math.round(320*PACE), KING_HP = 3;
const L = n => Math.round(n*PACE);   // any other length-denominated tuning value (skin unlocks) scales the same way
const ENDLESS = { target:0, rivals:12, rivalLen:[L(20),L(70)], name:'Endless', endless:true, hz:{mud:2, logs:1, shrink:1}, mix:4 };
// modes: 'rounds' (the five-round run), 'daily' (seeded 3-minute challenge), 'endless' (unlocked by the King)
let mode = 'rounds', daily = Rules.dailyFor(Rules.dateKey());
function dailyCfg(){
  const m = daily.mod.id;
  return { target:0, rivals: m==='tiny' ? 14 : 12, rivalLen: m==='giants' ? [L(60),L(150)] : [L(15),L(60)], name:'Daily · '+daily.mod.name, daily:true,
    hz:{mud:2, logs: m==='tiny' ? 0 : 1, shrink:1}, mix:3, arena: m==='tiny' ? 1300 : ARENA };
}
// the current run's config, resolved once per reset() (dailyCfg builds fresh objects, and cfg() is read every tick)
let runCfg = null;
function cfg(){ return runCfg || (runCfg = mode==='daily' ? dailyCfg() : mode==='endless' ? ENDLESS : ROUNDS[round]); }
const dmod = () => mode==='daily' ? daily.mod.id : null;
const noBites = () => dmod()==='ghosts';
function dailyBest(){ const d = json('noodleDaily', null); return d && d.key===daily.key ? d.best : 0; }
let round = 0, maxRound = +store.get('noodleRound') || 0, king = null;
const goalEl=document.getElementById('goal'), roundNumEl=document.getElementById('roundNum'), roundNameEl=document.getElementById('roundName');
function buildRoundPicker(){
  const box=document.getElementById('rounds'); if(!box) return; box.innerHTML='';
  ROUNDS.forEach((r,i)=>{ const b=document.createElement('button'); b.className='rd'+(i===round?' sel':'')+(i>maxRound?' lock':''); b.textContent=r.king?'👑':i+1;
    if (medals[i]){ const m=document.createElement('i'); m.className='md'; m.textContent=Rules.MEDAL_GLYPH[medals[i]]; b.appendChild(m); }
    b.onclick=()=>{ if(i>maxRound) return; Sound.play('tap'); round=i; buildRoundPicker(); }; box.appendChild(b); });
}
const SKINS = [
  {id:'lime',   name:'Lime',     c:'#c9f24a', type:'solid',  need:()=>true,        label:'free'},
  {id:'coral',  name:'Coral',    c:'#ff5d4a', type:'solid',  need:()=>best>=L(30),    label:'reach length '+L(30)},
  {id:'sky',    name:'Sky bands',c:'#5cc8ff', c2:'#1b1330', type:'bands', need:()=>eaten>=3, label:'eat 3 worms'},
  {id:'bee',    name:'Bumble',   c:'#ffd23f', c2:'#1b1330', type:'bands', need:()=>best>=L(60),    label:'reach length '+L(60)},
  {id:'spots',  name:'Cheetah',  c:'#ffb347', c2:'#7a3e00', type:'spots', need:()=>eaten>=10,label:'eat 10 worms'},
  {id:'candy',  name:'Candy',    c:'#ff7ad9', c2:'#fff', type:'bands', need:()=>best>=L(100), label:'reach length '+L(100)},
  {id:'rainbow',name:'Rainbow',  c:'#fff', type:'rainbow', need:()=>eaten>=25, label:'eat 25 worms'},
  {id:'ghost',  name:'Ghost',    c:'#e9e4ff', type:'glow',  need:()=>best>=L(200), label:'reach length '+L(200)},
];
function skinOf(id){ return SKINS.find(k=>k.id===id) || SKINS[0]; }
function cosOf(kind, id){ const list=Rules.COSMETICS[kind]; return list.find(c=>c.id===id) || list[0]; }
// every unlockable as {key, name}: skins plus hats, trails and pops
function unlockedKeys(){
  const s = statView(), out = SKINS.filter(k=>k.need()).map(k=>({ key:'skin:'+k.id, name:k.name }));
  for (const [kind, list] of Object.entries(Rules.COSMETICS)) for (const c of list) if (c.need(s)) out.push({ key: kind+':'+c.id, name: c.name+' '+kind });
  return out;
}
function hue(i){ return `hsl(${(i*9)%360},90%,60%)`; }
// draw a worm: tapered segmented body from tail to head
function shade(hex,amt){ const n=parseInt(hex.slice(1),16); let r=(n>>16)+amt,g=((n>>8)&255)+amt,b=(n&255)+amt; r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b)); return '#'+((r<<16)|(g<<8)|b).toString(16).padStart(6,'0'); }
function paintBody(pts, r, skin, boost, ang, hx, hy, squash, alpha=1){
  const n=pts.length; if(n<2) return;
  if (boost){
    // speed lines fanning out behind the head
    const bx = hx - Math.cos(ang)*r*1.5, by = hy - Math.sin(ang)*r*1.5;
    ctx.strokeStyle = skin.c; ctx.lineWidth = 2;
    for (let k=0;k<5;k++){
      const a = ang + Math.PI + (k-2)*0.22 + rnd(-0.05,0.05), L = r*(2+Math.random()*3);
      ctx.globalAlpha = 0.5*(1-Math.abs(k-2)/3)*alpha;
      ctx.beginPath(); ctx.moveTo(bx,by); ctx.lineTo(bx+Math.cos(a)*L, by+Math.sin(a)*L); ctx.stroke();
    }
    ctx.globalAlpha = (.18 + .1*Math.sin(tick/3))*alpha;
    ctx.fillStyle = skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = alpha;
  } else if (skin.type==='glow'){
    ctx.globalAlpha=.25*alpha; ctx.fillStyle=skin.c; for(let i=n-1;i>=0;i-=2){ ctx.beginPath(); ctx.arc(pts[i].x,pts[i].y,r*1.7,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=alpha;
  }
  if (skin.type==='glow') ctx.globalAlpha=.85*alpha;
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
  ctx.globalAlpha=alpha;
  // clitellum (the thicker saddle worms have) a little way behind the head
  if (n>16){ const p=pts[12]; ctx.fillStyle=shade(skin.type==='rainbow'?'#ff9a6a':skin.c,35); ctx.beginPath(); ctx.arc(p.x,p.y,r*1.05,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='rgba(0,0,0,.25)'; ctx.lineWidth=1.5; ctx.stroke(); }
  // mouth
  const h=pts[0]; ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.lineWidth=Math.max(1.5,r*.18); ctx.beginPath(); ctx.arc(h.x+Math.cos(ang)*r*.55,h.y+Math.sin(ang)*r*.55,r*.32,ang-1.1,ang+1.1); ctx.stroke();
}
// style picker on the menu screens: tabs for skins, hats, trails and death pops
let styleTab = 'skin';
function buildStylePicker(){
  const box=document.getElementById('style'); if(!box) return; box.innerHTML='';
  const tabs=document.createElement('div'); tabs.className='tabs';
  for (const [k,label] of [['skin','Skins'],['hat','Hats'],['trail','Trails'],['pop','Pops']]){
    const b=document.createElement('button'); b.className='tab'+(k===styleTab?' sel':''); b.textContent=label;
    b.onclick=()=>{ Sound.play('tap'); styleTab=k; buildStylePicker(); }; tabs.appendChild(b);
  }
  box.appendChild(tabs);
  const grid=document.createElement('div'); grid.id='skins'; box.appendChild(grid);
  if (styleTab==='skin') buildSkinPicker(grid); else buildCosmeticPicker(grid, styleTab);
}
function buildSkinPicker(box){
  for (const k of SKINS){
    const ok=k.need(); const d=document.createElement('div'); d.className='sk'+(ok?'':' lock')+(k.id===skinId?' sel':'');
    const c=document.createElement('canvas'); c.width=128; c.height=128; d.appendChild(c);
    const g=c.getContext('2d');
    // preview: draw a wiggly body
    const pts=[]; for(let i=0;i<40;i++) pts.push({x:20+i*2.3, y:64+Math.sin(i/5)*22});
    const realCtx=ctx; ctxSwap(g); paintBody(pts,11,k,false,0,0,0); ctxSwap(realCtx);
    if(!ok){ const n=document.createElement('div'); n.className='need'; n.textContent=k.label; d.appendChild(n); }
    d.onclick=()=>{ if(!ok) return; Sound.play('tap'); skinId=k.id; store.set('noodleSkin',skinId); buildStylePicker(); };
    box.appendChild(d);
  }
}
function buildCosmeticPicker(box, kind){
  const s = statView(), keyOf = { hat:'noodleHat', trail:'noodleTrail', pop:'noodlePop' };
  for (const c of Rules.COSMETICS[kind]){
    const ok=c.need(s); const d=document.createElement('div'); d.className='sk cos'+(ok?'':' lock')+(c.id===style[kind]?' sel':'');
    const g=document.createElement('i'); g.textContent=c.glyph || '—'; d.appendChild(g);
    const n=document.createElement('div'); n.className='need'; n.textContent= ok ? c.name : c.label; d.appendChild(n);
    d.onclick=()=>{ if(!ok) return; Sound.play('tap'); style[kind]=c.id; store.set(keyOf[kind], c.id); buildStylePicker(); };
    box.appendChild(d);
  }
}
// overlay screens — one template per screen, one place that shows/hides
const fmtTime = f => { const s=Math.max(0,Math.ceil(f/60)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
const newlyLine = newly => newly.length ? `<br><b style="color:var(--lime)">Unlocked: ${newly.map(k=>k.name).join(', ')}</b>` : '';
function titleScreen(){
  if (!daily.pinned) daily = Rules.dailyFor(Rules.dateKey());   // the page may have been open since yesterday
  const lockE = !stats.kingBeaten, db = dailyBest();
  return `<div class="col main"><h1>Noodle Pit<span>eat, grow, don't get bonked</span></h1>
  <p>Bite smaller worms head-on to eat them. Make <b>any</b> worm run into your side and it pops, however big it is. Take down the Pit King.</p>
  <p class="sub">Joystick steers · hold BOOST to speed up (costs length) · grab ⚡🛡👻🧲 power-ups</p>
  <button id="start" data-mode="rounds">Play</button>
  <div class="modes"><button id="daily" class="alt" data-mode="daily">📅 Daily: ${daily.mod.name}<small>${daily.mod.desc}${db?' · today\'s best '+db:''}</small></button>
  <button id="endless" class="alt${lockE?' lock':''}" data-mode="endless">♾ Endless<small>${lockE?'beat the Pit King to unlock':'best '+stats.endlessBest}</small></button></div>
  ${standalone ? '' : '<p class="sub" style="margin-top:18px">To install: tap Share, then Add to Home Screen.</p>'}</div>
  <div class="col side"><div id="rounds"></div><div id="style"></div></div>`;
}
function resultLine(frames, par, bonus){ return `Time ${fmtTime(frames)} (gold ${fmtTime(par)}) · kills ${runKills} · best streak ${streak.best}<br>time bonus +${bonus}`; }
function roundClearScreen(res){
  const prev = ROUNDS[round-1], next = ROUNDS[round];
  return `<div class="col main"><h1>Round cleared<span>${prev.name} → ${next.name}</span></h1><div class="medal">${Rules.MEDAL_GLYPH[res.medal]}</div><div class="score" data-count="${score}">0</div>
  <p>${resultLine(res.frames, res.par, res.bonus)}${newlyLine(res.newly)}</p>
  <p class="sub">${next.king ? 'Final round: the Pit King. Dodge his head and make him run into your side. Three bonks and he\'s done.' : 'Next: reach length '+next.target+' as the biggest worm. Rivals start bigger, and the pit gets meaner.'}</p>
  <button id="start">Next round</button><p><button id="menu" class="ghostBtn">Menu</button></p></div><div class="col side"><div id="style"></div></div>`;
}
function winScreen(res){
  return `<div class="col main"><h1>You rule the pit<span>the King is eaten</span></h1><div class="medal">${Rules.MEDAL_GLYPH[res.medal]}</div><div class="score" data-count="${score}">0</div>
  <p>${resultLine(res.frames, res.par, res.bonus)}${newlyLine(res.newly)}<br>Endless mode is open. Replay rounds for gold medals.</p>
  <button id="start">Play again</button>
  <div class="modes"><button id="endless" class="alt" data-mode="endless">♾ Play Endless</button></div><p><button id="menu" class="ghostBtn">Menu</button></p></div><div class="col side"><div id="rounds"></div><div id="style"></div></div>`;
}
function deathLine(){
  const d = deathInfo || {};
  const by = d.wall ? 'the wall got you' : d.log ? 'the spike log got you' : d.killer ? (d.killer.isKing ? 'by the Pit King' : 'by a '+(Rules.PERSONAS[d.killer.persona]||{name:'worm'}).name.toLowerCase()) : 'you grew to';
  return { by, rank: d.rank ? `#${d.rank} biggest of ${d.total}` : '' };
}
function gameOverScreen(newly){
  const d = deathLine();
  if (mode==='daily') return `<div class="col main"><h1>${deathInfo && deathInfo.timeUp ? 'Time!' : 'Eaten'}<span>${daily.mod.name} · ${daily.key}</span></h1><div class="score" data-count="${score}">0</div>
  <p>Length ${player.len} · kills ${runKills} · best streak ${streak.best}<br>Today's best ${dailyBest()}${newlyLine(newly)}</p>
  <button id="start">Try again</button><p><button id="menu" class="ghostBtn">Menu</button></p></div><div class="col side"><div id="style"></div></div>`;
  if (mode==='endless') return `<div class="col main"><h1>Eaten<span>${d.by}</span></h1><div class="score" data-count="${score}">0</div>
  <p>Survived ${fmtTime(tick-runStart)} · length ${player.len} · kills ${runKills}<br>Endless best ${stats.endlessBest}${newlyLine(newly)}</p>
  <button id="start">Again</button><p><button id="menu" class="ghostBtn">Menu</button></p></div><div class="col side"><div id="style"></div></div>`;
  return `<div class="col main"><h1>Eaten<span>${d.by}</span></h1><div class="score" data-count="${player.len}">0</div>
  <p>${d.rank ? 'You were '+d.rank+' · ' : ''}score ${score}<br>Best ${best} · worms eaten ${eaten}${newlyLine(newly)}</p>
  <button id="start">Retry round ${round+1}</button><p><button id="menu" class="ghostBtn">Menu</button></p></div><div class="col side"><div id="rounds"></div><div id="style"></div></div>`;
}
function countUp(el, to){
  const t0 = performance.now(), dur = 400;
  const f = ()=>{ const k = Math.min(1,(performance.now()-t0)/dur); el.textContent = Math.round(to*(1-Math.pow(1-k,3))); if (k<1) requestAnimationFrame(f); };
  f();
}
function showOverlay(html){
  overlay.innerHTML = html;
  buildRoundPicker(); buildStylePicker();
  const sc = overlay.querySelector('.score'); if (sc) countUp(sc, +sc.dataset.count);
  for (const id of ['start','daily','endless']){ const b = overlay.querySelector('#'+id); if (!b) continue;
    b.onclick = ()=>{ if (id==='endless' && !stats.kingBeaten) return; if (b.dataset.mode) mode = b.dataset.mode; start(); }; }
  const mb = overlay.querySelector('#menu'); if (mb) mb.onclick = ()=>{ Sound.play('tap'); toMenu(); };
  overlay.classList.add('show'); overlay.inert = false;
  boostBtn.style.display='none'; pauseBtn.hidden = true; stick.style.visibility='hidden';
  Sound.music('menu');
}
function hideOverlay(){
  // inert + blur so the just-clicked Play button can't be re-triggered by Space/Enter during play
  overlay.classList.remove('show'); overlay.inert = true;
  const a = document.activeElement; if (a && a.blur) a.blur();
  boostBtn.style.display='flex'; pauseBtn.hidden = false; stick.style.visibility='';
}

// pause: freeze the run without ending it; auto-pause when the tab is hidden
const pauseBtn = document.getElementById('pause');
let paused = false;
function pauseScreen(){
  return `<div class="col main"><h1>Paused<span>${mode==='rounds' ? 'Round '+(round+1)+' · ' : ''}${cfg().name}</span></h1>
  <p>Length ${player.len} · score ${score}</p>
  <button id="resume">Resume</button>
  <p><button id="quit" class="ghostBtn">Quit to menu</button></p></div>`;
}
function pause(){
  if (!running || paused) return;
  paused = true; running = false; boosting = false; player.boost = 0; player.fast = false; Sound.boost(false);
  showOverlay(pauseScreen());
  overlay.querySelector('#resume').onclick = ()=>{ Sound.play('tap'); resume(); };
  overlay.querySelector('#quit').onclick = ()=>{ Sound.play('tap'); quitToMenu(); };
}
function resume(){
  if (!paused) return;
  paused = false; running = true;
  hideOverlay();
  Sound.unlock(); Sound.music(cfg().king ? 'king' : 'play');
}
function quitToMenu(){
  paused = false; running = false; Sound.boost(false);
  saveBest(); saveStats();
  toMenu();
}
function toMenu(){ deathT = 0; mode = 'rounds'; reset(); showOverlay(titleScreen()); }
pauseBtn.addEventListener('pointerdown', e=>{ e.preventDefault(); Sound.unlock(); Sound.play('tap'); pause(); });
addEventListener('keydown', e=>{ if((e.code==='Escape' || e.code==='KeyP') && !e.repeat){ if (paused) resume(); else pause(); } });
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden' && running) pause(); });

let worms = [], food = [], player, running = false, steer = null, boosting = false, cam = {x:0,y:0}, tick = 0;
let playerHitWall = false, godMode = false;
// run state: score, streaks, the arena and its hazards, slow-mo and the death camera
let score = 0, runKills = 0, runStart = 0, winAt = 0, slowmo = 0, deathT = 0, deathFocus = null, deathInfo = null, pendingNewly = [];
let nemesisSave = null, nearCool = 0, minionAt = 0, lastTimerS = -1;
const streak = Rules.createStreak();
let baseR = ARENA, arenaR = ARENA, mud = [], logs = [], frenzy = null, nextFrenzyAt = 0;

// power-ups: one pickup on the arena at a time, player-only effects on a frame clock
let pickups = [], nextPickupAt = 0;
const effects = Items.createEffects();
function schedulePickup(){ nextPickupAt = tick + rnd(Items.PICKUP.interval[0], Items.PICKUP.interval[1]); }
function spawnPickup(kind, x, y){
  if (x==null){ for (let t=0;t<10;t++){ const a=rnd(0,Math.PI*2), r=rnd(200,arenaR-200); x=Math.cos(a)*r; y=Math.sin(a)*r; if (Math.hypot(x-player.x,y-player.y)>=Items.PICKUP.minDist) break; } }
  pickups.push({ x, y, kind: kind || Items.pickPowerup(), born: tick });
}
// the shield absorbs one fatal hit: bounce, shed 10% length, pull back inside the arena, and phase out
// for ~0.75 s so the worm you're overlapping can't bite again on the very next frame
function shieldSave(){
  effects.consume('shield'); playerHitWall = false;
  if (!effects.has('ghost')) effects.add('ghost', 45);
  player.ang += Math.PI; player.len = Math.max(6, Math.floor(player.len*0.9));
  const d = Math.hypot(player.x,player.y); if (d > arenaR-20){ player.x *= (arenaR-20)/d; player.y *= (arenaR-20)/d; }
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
const foodTarget = () => dmod()==='apples' ? 140 : 280;
function spawnFood(){ const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*(arenaR-30); mkFood(Math.cos(a)*r, Math.sin(a)*r, dmod()==='apples' ? 'apple' : Items.pickFood(Math.random, appleCount)); }
function eatFood(i){ const f=food[i]; if (f.kind==='apple') appleCount--; food.splice(i,1); return f; }
// endless mode: rivals that (re)spawn later in the run start bigger, up to 2.5×
const endlessScale = () => mode==='endless' ? Math.min(2.5, 1 + (tick-runStart)/3600*0.25) : 1;
function mkWorm(isPlayer, len, o={}){
  const a = rnd(0, Math.PI*2), r = rnd(200, Math.max(260, arenaR-200));
  const R=cfg(); if(len==null) len = isPlayer ? 10 : Math.round(rnd(R.rivalLen[0],R.rivalLen[1])*endlessScale());
  const persona = isPlayer ? null : (o.persona || Rules.pickPersona(R.mix));
  const c = isPlayer ? skinOf(skinId).c : (o.c || PALETTE[Math.random()*PALETTE.length|0]);
  const s = { x: Math.cos(a)*r, y: Math.sin(a)*r, ang: rnd(0,Math.PI*2), len, pts: [], c, skin: isPlayer ? skinOf(skinId) : (o.skin || null), ai: !isPlayer, persona, turnT: 0, dead:false, orbit: Math.random()<.5 ? 1 : -1 };
  if (persona==='coiler' && !s.skin) s.skin = { c, c2:'#1b1330', type:'bands' };   // coilers read as banded constrictors
  for (let i=0;i<s.len;i++) s.pts.push({x:s.x - Math.cos(s.ang)*i*SEG, y:s.y - Math.sin(s.ang)*i*SEG});
  return s;
}
// a rival's body is laid out in a straight line from its head, so a long one can land across the player:
// re-roll until no part of it is within 180 px of the player's head, and its head isn't on a spike log
function mkRival(len, o){
  let s;
  for (let t=0;t<12;t++){ s = mkWorm(false, len, o); if ((!player || s.pts.every(p=>(p.x-player.x)**2+(p.y-player.y)**2 > 180*180)) && !logs.some(g=>Rules.segDist2(s.x,s.y,g.x,g.y,g.a,Rules.LOG.len/2) < 80*80)) break; }
  return s;
}
// the daily challenge lays out the arena from a date seed, so everyone gets the same start. Math.random is
// swapped for the duration of buildArena (synchronous, no FX/sound inside) so every spawn helper picks up the seed
// without threading a rand argument through them all; it is restored even if building throws.
function withSeed(seed, fn){ const r = Math.random; Math.random = Rules.mulberry32(seed); try { fn(); } finally { Math.random = r; } }
function buildArena(){
  const R=cfg(), hz=R.hz;
  baseR = R.arena || ARENA; arenaR = baseR;
  const inner = baseR*hz.shrink - 250;
  mud = []; for (let i=0;i<hz.mud;i++){ const a=rnd(0,Math.PI*2), r=rnd(350, inner); mud.push({ x:Math.cos(a)*r, y:Math.sin(a)*r, r: Rules.MUD.r*rnd(.8,1.2), ph: rnd(0,6) }); }
  logs = []; for (let i=0;i<hz.logs;i++){ const a=rnd(0,Math.PI*2), r=rnd(Rules.LOG.len*0.5+350, Math.max(Rules.LOG.len*0.5+400, inner-Rules.LOG.len*0.5)); logs.push({ x:Math.cos(a)*r, y:Math.sin(a)*r, a: rnd(0,Math.PI), spin: Rules.LOG.spin*(Math.random()<.5?1:-1) }); }
  player = mkWorm(true); player.x = 0; player.y = 0; player.pts = player.pts.map((p,i)=>({x:-Math.cos(player.ang)*i*SEG, y:-Math.sin(player.ang)*i*SEG}));
  worms.push(player);
  king=null;
  for (let i=0;i<R.rivals;i++) worms.push(mkRival());
  if (R.king){ king = mkRival(KING_LEN, { persona:'king', c:'#ffd23f', skin:{c:'#ffd23f',c2:'#7a3e00',type:'bands'} }); Object.assign(king, { isKing:true, hp:KING_HP, stun:0, boostCd:180, immuneUntil:0 }); worms.push(king); }
  for (let i=0;i<260*foodTarget()/280;i++) spawnFood();
}
function reset(){
  FX.clear(); playerHitWall = false;
  worms = []; food = []; appleCount = 0;
  pickups = []; effects.clear(); nextPickupAt = tick + Items.PICKUP.first; renderBuffs(true);
  runCfg = null; const R=cfg();
  if (mode==='daily') withSeed(daily.seed, buildArena); else buildArena();
  // the worm that ate you last time comes back wearing its crown
  if (nemesisSave && !R.king){ const n = mkRival(Math.max(nemesisSave.len, R.rivalLen[0]), nemesisSave); n.nemesis = true; worms.push(n); }
  score = 0; lastScore = -1; runKills = 0; streak.reset(); runStart = tick; winAt = 0; slowmo = 0; deathT = 0; deathFocus = null; deathInfo = null;
  frenzy = null; nextFrenzyAt = tick + Rules.FRENZY.first; minionAt = tick + 600; nearCool = 0; lastTimerS = -1;
  goalEl.textContent = R.king ? ' — bonk the King' : R.target ? ' / '+R.target+' and biggest' : R.daily ? ' — '+daily.mod.name : ' — survive'; goalEl.classList.remove('met');
  roundNumEl.textContent = mode==='rounds' ? round+1 : mode==='daily' ? '📅' : '♾'; roundNameEl.textContent = mode==='rounds' ? R.name : R.name.replace('Daily · ','');
  timerEl.hidden = mode!=='daily'; timerEl.textContent = fmtTime(Rules.DAILY_FRAMES);
  bossEl.hidden = !king; renderBoss();
  lastLen = player.len; lenEl.textContent = player.len; scoreEl.textContent = 0;
}
function renderBoss(){
  if (!king) return;
  bossHpEl.innerHTML = Array.from({length:KING_HP}, (_,i)=>`<i class="${i<king.hp?'on':''}"></i>`).join('');
}
function kill(s, by, cause){
  if (s===player && (godMode || winAt)){ playerHitWall = false; const d=Math.hypot(s.x,s.y); if (d>arenaR-20){ s.x*=(arenaR-20)/d; s.y*=(arenaR-20)/d; } return; }
  if (s===player && effects.has('shield')){ shieldSave(); return; }
  s.dead = true;
  for (let i=0;i<s.pts.length;i+=2){ const p=s.pts[i]; mkFood(p.x+rnd(-4,4), p.y+rnd(-4,4), 'chunk', s.c); }
  FX.burst(s.x, s.y, Math.min(24, 12 + (s.len/12|0)), s.c, { speed: 3.5, life: 36, r: 3 });
  if (s === player){
    FX.shake(14, 27); FX.flash('rgba(255,93,74,.35)', 3);
    deathPop();
    const total = worms.filter(o=>!o.dead).length + 1, rank = 1 + worms.filter(o=>!o.dead && o.len>player.len).length;
    deathInfo = { killer: by, rank, total, wall: playerHitWall, log: cause==='log' };
    if (by && !by.dead){
      by.taunt = { text: Rules.TAUNTS[Math.random()*Rules.TAUNTS.length|0], until: tick + 240 };
      if (!by.isKing){ by.nemesis = true; nemesisSave = { len: by.len, c: by.c, skin: by.skin, persona: by.persona }; }
    }
    deathFocus = by && !by.dead ? by : null;
    gameOver();
  } else {
    if (by === player){
      FX.burst(player.x, player.y, 8, '#c9f24a', { speed: 5, life: 20, r: 2 });
      FX.shake(Math.min(10, 3 + s.len/20), 15); FX.flash('rgba(255,255,255,.18)', 2);
      if (s.isKing) FX.shake(18, 36);
    }
    if (s.isKing && !winAt) winAt = tick + 50;   // the win is locked in now; the overlay waits out the slow-mo beat
    if (!s.isKing && !s.minion) s.respawnAt = tick + 90;   // on the tick clock so a pause can't swallow the respawn
  }
}
// the player's death effect, picked in the style menu
function deathPop(){
  const x=player.x, y=player.y;
  switch (style.pop){
    case 'confetti': for (const c of PALETTE) FX.burst(x, y, 8, c, { speed: 6, life: 50, r: 2.5 }); break;
    case 'fireworks': for (let k=0;k<3;k++){ const a=rnd(0,Math.PI*2), d=rnd(30,70); FX.burst(x+Math.cos(a)*d, y+Math.sin(a)*d, 18, PALETTE[k*2], { speed: 5, life: 45, r: 2.2 }); } break;
    case 'ghost': FX.text(x, y-10, '👻', '#fff', { size: 34, vy: -1.1, life: 90 }); break;
  }
}
function radius(s){ return 5 + Math.min(10, s.len/25); }

// ---- scoring moments ----
function addScore(n){ score += n; }
function playerKill(v){
  eaten++; store.set('noodleEaten',eaten); runKills++;
  const n = streak.hit(tick); if (n > stats.bestStreak) stats.bestStreak = n;   // saved at run end (endRun/roundWin)
  const bonus = L(Rules.streakBonus(n)), pts = Rules.killPoints(v.len, n);
  player.len += bonus; addScore(pts);
  Sound.play('eatWorm', v.len);
  FX.text(v.x, v.y-18, '+'+pts, '#c9f24a', { size: 15 });
  if (v.nemesis){ addScore(Rules.POINTS.revenge); nemesisSave = null; FX.banner('REVENGE!', '#ff5d4a', 110, '+'+Rules.POINTS.revenge); Sound.play('revenge'); }
  else if (n >= 2){ FX.banner(Rules.streakName(n), n>=4 ? '#ff7ad9' : n===3 ? '#ffb347' : '#5cc8ff', 90, '+'+bonus+' length'); Sound.play('streak', n); }
  if (v.len >= L(40) || v.isKing) slowmo = v.isKing ? 50 : 24;   // a big kill gets a beat of slow motion
}
function nearMiss(o){
  if (tick < nearCool || tick < (o.nearAt||0)) return;
  nearCool = tick + 45; o.nearAt = tick + 180;
  stats.nearMisses++;
  player.len += 1; addScore(Rules.POINTS.nearMiss);
  FX.text(player.x, player.y-22, 'Close!', '#5cc8ff', { size: 16 }); Sound.play('nearMiss');
}
// the King bounced off your side (or a hazard): he loses a life, sheds length as grubs, gets dizzy and turns away
// byPlayer is false when a hazard (wall, spike log) did it
function kingBonk(k, byPlayer = true){
  if (!byPlayer && k.hp <= 1){ k.immuneUntil = tick + 80; k.ang += Math.PI; k.stun = 30; return; }   // the last life is yours to take
  k.hp--; k.immuneUntil = tick + 80; k.stun = 60; k.ang += Math.PI;
  if (byPlayer && !effects.has('ghost')) effects.add('ghost', 40);   // you're tangled up with him: a moment to get clear
  const drop = Math.floor(k.len*0.15); k.len -= drop;
  for (let i=0;i<drop/5;i++){ const a=rnd(0,Math.PI*2), d=rnd(20,90); mkFood(k.x+Math.cos(a)*d, k.y+Math.sin(a)*d, 'grub'); }
  FX.shake(16,30); FX.flash('rgba(255,210,63,.3)',3); FX.burst(k.x,k.y,30,'#ffd23f',{speed:5,life:30,r:3}); Sound.play('bonk');
  if (byPlayer) addScore(Rules.POINTS.bonk);
  FX.text(k.x, k.y-30, 'BONK!', '#ffd23f', { size: 24 });
  if (k.hp <= 0){ playerKill(k); kill(k, player); }
  else FX.banner(k.hp===2 ? 'THE KING IS FURIOUS' : 'THE KING IS DESPERATE', '#ffd23f', 110, k.hp===2 ? 'he charges, drops bait and calls minions' : 'he circles you, then lunges');
  renderBoss();
}
// s's head touched o's body; headOn when the touched point is near o's head
function contact(s, o, headOn){
  const out = Rules.resolveContact(s.len, o.len, headOn, { biterKing: !!s.isKing, bodyPlayer: o===player });
  if (out==='bonk'){ kingBonk(s); return; }
  const victim = out==='biter' ? s : o, killer = victim===s ? o : s;
  if (victim===player){ if (winAt) return; if (effects.has('shield')){ shieldSave(); return; } }   // no bite in either direction; nothing can undo a King kill
  if (killer===s && (headOn || s.isKing)) s.len += Math.ceil(victim.len/2);   // a head-on bite swallows half the loser
  if (killer===player) playerKill(victim);
  kill(victim, killer);
}

// ---- rival brains ----
// turn away from a point, toward whichever side it isn't on
function dodge(s, p){ const cross = Math.cos(s.ang)*(p.y-s.y) - Math.sin(s.ang)*(p.x-s.x); return s.ang + (cross>0 ? -1.4 : 1.4); }
function bestFood(s, thief){
  let bestD=1e18, f=null;
  for (let i=0;i<food.length;i+=3){ const fd=food[i], v = thief && fd.kind==='chunk' ? fd.v*5 : fd.v, d=((fd.x-s.x)**2+(fd.y-s.y)**2)/v; if(d<bestD){bestD=d;f=fd;} }
  return { f, d: bestD };
}
function aiSteer(s){
  if (s.isKing) return kingSteer(s);
  s.turnT--;
  s.boost = Math.max(0,(s.boost||0)-1); if (!s.boost && Math.random()<.006) s.boost = 30;
  const P = s.persona, pAlive = !player.dead, ghostP = effects.has('ghost');
  const { f, d: fd } = bestFood(s, P==='thief');
  let target = f ? Math.atan2(f.y-s.y, f.x-s.x) : s.ang;
  if (frenzy && frenzy.live && P!=='coward'){ const d=Math.hypot(frenzy.x-s.x, frenzy.y-s.y); if (d<1400 && d>Rules.FRENZY.r*0.5) target = Math.atan2(frenzy.y-s.y, frenzy.x-s.x); }
  const pdx = player.x-s.x, pdy = player.y-s.y, pd = Math.hypot(pdx,pdy);
  s.fleeing = false;
  if (P==='hunter' && pAlive && !ghostP && pd < Rules.PERSONAS.hunter.range){
    // aim where the player is going, to cut across their path
    const lead = Math.min(140, pd*0.5);
    target = Math.atan2(player.y+Math.sin(player.ang)*lead - s.y, player.x+Math.cos(player.ang)*lead - s.x);
    if (pd < 320 && !s.boost && Math.random()<.03) s.boost = 25;
  } else if (P==='coward' && pAlive && pd < Rules.PERSONAS.coward.range && player.len > s.len*0.5){
    target = Math.atan2(-pdy,-pdx); s.fleeing = true;
    if (pd < 180 && !s.boost && Math.random()<.05) s.boost = 20;
  } else if (P==='coiler'){
    // circle the nearest smaller worm so it runs into our side
    let prey=null, pdist=Rules.PERSONAS.coiler.range;
    for (const o of worms){ if (o===s||o.dead||o.len>=s.len*0.9||(o===player&&ghostP)) continue; const d=Math.hypot(o.x-s.x,o.y-s.y); if (d<pdist){ pdist=d; prey=o; } }
    if (prey){ const a = Math.atan2(s.y-prey.y, s.x-prey.x) + 0.6*s.orbit, R = Math.max(50, Math.min(160, s.len*0.5));
      target = Math.atan2(prey.y+Math.sin(a)*R - s.y, prey.x+Math.cos(a)*R - s.x); }
  } else if (P==='thief' && fd > 300*300){
    // nothing worth grabbing nearby: shadow the biggest worm in range and wait for it to pop
    let big=null; for (const o of worms){ if (o===s||o.dead||o.len<=s.len) continue; if (Math.hypot(o.x-s.x,o.y-s.y)<Rules.PERSONAS.thief.range && (!big||o.len>big.len)) big=o; }
    if (big){ const p = big.pts[big.pts.length*0.6|0] || big; target = Math.atan2(p.y+60*s.orbit - s.y, p.x+60*s.orbit - s.x); }
  }
  if (P!=='coiler' && !s.fleeing){
    // everyone takes a bite at a much smaller head that wanders close
    for (const o of worms){ if (o===s||o.dead||(o===player&&ghostP)||noBites()) continue; if (o.len < s.len*0.8 && (o.x-s.x)**2+(o.y-s.y)**2 < 250*250){ target = Math.atan2(o.y-s.y, o.x-s.x); break; } }
  }
  if (s.turnT<=0){ s.turnT = 40+Math.random()*60; if(Math.random()<.2) target += rnd(-1,1); }
  return avoid(s, target);
}
// the overrides every brain shares: keep off the wall, out of every body (smaller heads excepted) and away from spike logs
function avoid(s, target){
  if (Math.hypot(s.x,s.y) > arenaR-150) target = Math.atan2(-s.y,-s.x);
  const look = s.boost ? 95 : 60, lx = s.x+Math.cos(s.ang)*look, ly = s.y+Math.sin(s.ang)*look, sr = radius(s);
  if (!noBites()) outer: for (const o of worms){
    if (o===s||o.dead||(o===player&&effects.has('ghost'))) continue;
    const orr = radius(o), hz = (orr*Rules.HEAD_ZONE)**2, small = o.len < s.len, lim = (orr+sr+10)**2;
    for (let i=0;i<o.pts.length;i+=3){ const p=o.pts[i];
      if (small && (p.x-o.x)**2+(p.y-o.y)**2 < hz) continue;
      if ((p.x-lx)**2+(p.y-ly)**2 < lim){ target = dodge(s, p); break outer; } }
  }
  for (const g of logs){ if (Rules.segDist2(lx,ly,g.x,g.y,g.a,Rules.LOG.len/2) < 50*50) target = dodge(s, g); }
  return target;
}
// the Pit King: three lives, one behaviour per life
function kingSteer(s){
  const phase = KING_HP - s.hp;
  s.boost = Math.max(0,(s.boost||0)-1); s.boostCd--;
  if (s.stun > 0){ s.stun--; s.boost = 0; return s.ang + 0.3; }   // dizzy: spin in place
  let target = s.ang;
  const dx=player.x-s.x, dy=player.y-s.y, d=Math.hypot(dx,dy), toP=Math.atan2(dy,dx);
  let minion=null, md=900; if (d>600) for (const o of worms){ if (!o.minion||o.dead) continue; const m=Math.hypot(o.x-s.x,o.y-s.y); if (m<md){ md=m; minion=o; } }
  const aligned = Math.abs(Math.atan2(Math.sin(toP-s.ang), Math.cos(toP-s.ang))) < 0.35;
  if (player.dead) { const {f} = bestFood(s); if (f) target = Math.atan2(f.y-s.y, f.x-s.x); }
  else if (s.len <= player.len && d < 500) target = Math.atan2(-dy,-dx);          // outgrown: run
  else if (minion) target = Math.atan2(minion.y-s.y, minion.x-s.x);               // snack on a minion while you're far away
  else if (phase===2 && d < 520){
    // coil: orbit the player tighter and tighter, then lunge
    const a = Math.atan2(s.y-player.y, s.x-player.x) + 0.55*s.orbit;
    target = Math.atan2(player.y+Math.sin(a)*210 - s.y, player.x+Math.cos(a)*210 - s.x);
    if (s.boostCd<=0 && d<320){ target = toP; s.boost = 40; s.boostCd = 220; }
  } else if (d < 900){
    const lead = phase ? 90 : 40;
    target = Math.atan2(player.y+Math.sin(player.ang)*lead - s.y, player.x+Math.cos(player.ang)*lead - s.x);
    if (s.boostCd<=0 && aligned && d < (phase ? 420 : 320)){ s.boost = phase ? 50 : 35; s.boostCd = phase ? 150 : 260; }
  } else { const {f} = bestFood(s); if (f) target = Math.atan2(f.y-s.y, f.x-s.x); }
  if (Math.hypot(s.x,s.y) > arenaR-150) target = Math.atan2(-s.y,-s.x);
  const lx = s.x+Math.cos(s.ang)*80, ly = s.y+Math.sin(s.ang)*80;
  for (const g of logs){ if (Rules.segDist2(lx,ly,g.x,g.y,g.a,Rules.LOG.len/2) < 60*60) target = dodge(s, g); }
  return target;
}

// ---- arena: shrink, mud, spike logs, feeding frenzies, minions ----
function updateArena(){
  const R=cfg();
  if (R.hz.shrink < 1){
    arenaR = Rules.arenaRadius(baseR, R.hz.shrink, tick-runStart);
    if (tick%30===0){
      for (let i=food.length-1;i>=0;i--){ const f=food[i]; if (f.x*f.x+f.y*f.y > (arenaR-10)**2) eatFood(i); }
      for (let i=pickups.length-1;i>=0;i--){ const p=pickups[i]; if (Math.hypot(p.x,p.y) > arenaR-20){ pickups.splice(i,1); schedulePickup(); } }
    }
  }
  for (const g of logs) g.a += g.spin;
  const F = Rules.FRENZY;
  if (!frenzy && tick >= nextFrenzyAt){
    const a=rnd(0,Math.PI*2), r=rnd(300, arenaR*0.6);
    frenzy = { x:Math.cos(a)*r, y:Math.sin(a)*r, at: tick+F.warn, end: tick+F.warn+F.dur, live:false, count:0 };
    if (!player.dead){ FX.banner('FEEDING FRENZY', '#ffd23f', 120, 'follow the arrow'); Sound.play('frenzy'); }
  }
  if (frenzy){
    if (tick >= frenzy.at) frenzy.live = true;
    if (frenzy.live && tick%F.rate===0 && frenzy.count < F.maxFood){
      const a=rnd(0,Math.PI*2), r=Math.sqrt(Math.random())*F.r; let k = Rules.frenzyKind();
      if (k==='apple' && appleCount >= Items.FOOD.apple.max) k = 'grub';
      mkFood(frenzy.x+Math.cos(a)*r, frenzy.y+Math.sin(a)*r, k); frenzy.count++;
    }
    if (tick >= frenzy.end){ frenzy = null; nextFrenzyAt = tick + rnd(F.every[0], F.every[1]); }
  }
  if (king && !king.dead && king.hp < KING_HP && tick >= minionAt){
    minionAt = tick + (king.hp===1 ? 360 : 480);
    if (worms.filter(o=>o.minion && !o.dead).length < 3){
      const m = mkWorm(false, L(12), { persona:'grazer', c:'#ffe680' }); m.minion = true;
      m.x = king.x - Math.cos(king.ang)*120; m.y = king.y - Math.sin(king.ang)*120; m.pts = m.pts.map((p,i)=>({ x:m.x-Math.cos(m.ang)*i*SEG, y:m.y-Math.sin(m.ang)*i*SEG }));
      worms.push(m);
    }
  }
}
const hitsLog = s => { const rr=(radius(s)+Rules.LOG.w)**2; return logs.some(g => Rules.segDist2(s.x,s.y,g.x,g.y,g.a,Rules.LOG.len/2) < rr); };
const inMud = s => mud.some(m => (s.x-m.x)**2+(s.y-m.y)**2 < m.r*m.r);
function trail(){
  if (style.trail==='none' || player.dead || tick%4) return;
  const p = player.pts[Math.min(8, player.pts.length-1)];
  switch (style.trail){
    case 'sparkle': FX.burst(p.x, p.y, 1, Math.random()<.5 ? '#fff' : '#fff275', { speed: 1.2, life: 22, r: 1.6 }); break;
    case 'bubbles': if (tick%8===0) FX.burst(p.x, p.y, 1, 'rgba(92,200,255,.6)', { speed: 0.5, life: 40, r: 4 }); break;
    case 'hearts':  if (tick%12===0) FX.text(p.x, p.y, '♥', '#ff7ad9', { size: 12, life: 40, vy: -0.4 }); break;
    case 'fire':    FX.burst(p.x, p.y, 2, Math.random()<.5 ? '#ff5d4a' : '#ffb347', { speed: 1.5, life: 18, r: 2.2 }); break;
  }
}

function update(){
  tick++;
  if (worms.some(w=>w.dead && w.minion)) worms = worms.filter(w=>!(w.dead && w.minion));
  for (let i=0;i<worms.length;i++){ const s=worms[i]; if (s.dead && s.respawnAt!=null && tick>=s.respawnAt) worms[i]=mkRival(); }
  updateArena();
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
  if (food.length < foodTarget() && tick%4===0) spawnFood();
  const speedMul = dmod()==='turbo' ? 1.5 : 1;
  for (const s of worms){
    if (s.dead) continue;
    let target;
    if (s.ai){
      target = aiSteer(s);
    } else {
      target = steer==null ? s.ang : steer;
      // "fast" = boosting or the speed buff; camera, hum, banner and speed lines all key off it
      const wasFast = !!s.fast; s.boost = boosting && s.len>6 ? 1 : 0; s.fast = !!(s.boost || effects.has('speed'));
      if (s.fast !== wasFast) Sound.boost(s.fast);
    }
    let d = target - s.ang; d = Math.atan2(Math.sin(d), Math.cos(d));
    s.ang += Math.max(-0.11, Math.min(0.11, d));
    s.turn = Math.abs(Math.max(-0.11, Math.min(0.11, d)))/0.11;
    const speedBuff = s===player && effects.has('speed'), fast = s.ai ? !!s.boost : !!s.fast;
    let sp = BASE_SPEED * speedMul * (fast ? 2.2 : 1);
    if (inMud(s)) sp *= Rules.MUD.slow;
    if (s.isKing && s.stun>0) sp *= 0.4;
    if (s.boost && !speedBuff && !s.isKing && tick%10===0 && s.len>6){ s.len--; const t=s.pts[s.pts.length-1]; mkFood(t.x,t.y,'crumb'); }
    // a charging King leaves a trail of berries to bait you in
    if (s.isKing && s.boost && s.hp < KING_HP && tick%8===0){ const t=s.pts[s.pts.length-1]; mkFood(t.x,t.y,'berry'); }
    s.x += Math.cos(s.ang)*sp; s.y += Math.sin(s.ang)*sp;
    // the wall and spike logs pop whatever runs into them (a ghosted player phases through logs);
    // the King only gets bonked by them, so luring him into a hazard costs him a life instead of ending the fight
    const dWall = Math.hypot(s.x,s.y), onLog = !(s===player && effects.has('ghost')) && hitsLog(s);
    if (s.isKing && (dWall > arenaR || onLog)){
      if (dWall > arenaR-20){ s.x *= (arenaR-30)/dWall; s.y *= (arenaR-30)/dWall; }
      if (tick >= s.immuneUntil){ kingBonk(s, false); if (s.dead) continue; } else if (onLog) s.ang += 0.2;
    }
    else if (dWall > arenaR){ if (s===player) playerHitWall = true; kill(s, null); continue; }
    else if (onLog){ kill(s, null, 'log'); if (s.dead) continue; }
    s.pts.unshift({x:s.x,y:s.y});
    const maxPts = Math.min(Math.round(600*PACE), Math.floor(s.len * 1.6));
    while (s.pts.length > maxPts) s.pts.pop();
    // eat
    const r = radius(s)+6;
    for (let i=food.length-1;i>=0;i--){ const f=food[i]; if((f.x-s.x)**2+(f.y-s.y)**2 < r*r){ s.len += f.v; if (s===player){ addScore(f.v*Rules.POINTS.food); FX.burst(f.x, f.y, 3 + (f.v/2|0), f.c, { speed: 1.8 + f.v*0.15, life: 15, r: 1.8 }); Sound.play('eat', f.v); if (f.kind==='apple') Sound.play('apple'); } eatFood(i); } }
  }
  trail();
  // collisions (head into other body); a ghosted player is skipped both ways — checked per pair, not cached,
  // because a shield save mid-loop grants ghost and the reverse pair (rival head → player body) must see it
  if (!noBites()) for (const s of worms){
    if (s.dead) continue;
    const r = radius(s), isP = s===player;
    for (const o of worms){
      // the balance sim's god mode skips player contacts both ways, so it measures growth from food and
      // rival-vs-rival deaths only (an invincible player would otherwise farm every rival that rams it)
      if (o===s||o.dead||((isP||o===player)&&(effects.has('ghost')||godMode))) continue;
      if (s.isKing && o===player && tick < s.immuneUntil) continue;
      const orr = radius(o), rr=(r+orr)*(r+orr), near = isP ? (r+orr+12)**2 : 0, hz=(orr*Rules.HEAD_ZONE)**2;
      let hit=null, close=false;
      for (let i=0;i<o.pts.length;i+=2){ const p=o.pts[i], d2=(p.x-s.x)**2+(p.y-s.y)**2;
        if (d2<rr){ hit=p; break; }
        // a close call: skimming past a body that would have killed you
        if (d2<near && (o.len>s.len || (p.x-o.x)**2+(p.y-o.y)**2 >= hz)) close=true; }
      if (!hit){ if (close) nearMiss(o); continue; }
      contact(s, o, Rules.isHeadOn(hit.x-o.x, hit.y-o.y, orr));
      if (s.dead) break;
    }
  }
  // round goal
  const R=cfg();
  goalEl.classList.toggle('met', !!R.target && player.len>=R.target);
  if (!player.dead && running){
    if (R.king){ if (king && king.dead && !winAt) winAt = tick + 50; if (winAt && tick>=winAt) roundWin(); }
    else if (R.target && player.len>=R.target && worms.every(o=>o.dead||o===player||o.len<player.len)) roundWin();
    if (R.daily){
      const left = Rules.DAILY_FRAMES - (tick-runStart), s = Math.ceil(left/60);
      if (s !== lastTimerS){ lastTimerS = s; timerEl.textContent = fmtTime(left); timerEl.classList.toggle('low', s<=10); if (s<=10 && s>0) Sound.play('tick'); }
      if (left <= 0) timeUp();
    }
  }
  if (!player.dead){   // after a death the loop drives the camera (death cam)
    const camK = player.fast ? 0.18 : 0.12;
    cam.x += (player.x-cam.x)*camK; cam.y += (player.y-cam.y)*camK;
  }
  FX.update();
  if (player.len !== lastLen){ if (player.len > lastLen) lenPop(); lastLen = player.len; lenEl.textContent = player.len; }
  if (score !== lastScore){ lastScore = score; scoreEl.textContent = score; }
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
const onScreen = (x,y,m) => Math.abs(x-cam.x) < W/2+m && Math.abs(y-cam.y) < H/2+m;
function drawHazards(){
  for (const m of mud){ if (!onScreen(m.x,m.y,m.r)) continue;
    ctx.fillStyle='rgba(92,58,30,.55)'; ctx.beginPath(); ctx.arc(m.x,m.y,m.r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(60,36,18,.6)'; for (let k=0;k<5;k++){ const a=m.ph+k*1.3, d=m.r*(.25+.12*k); ctx.beginPath(); ctx.arc(m.x+Math.cos(a)*d, m.y+Math.sin(a)*d, m.r*.18, 0, Math.PI*2); ctx.fill(); }
    // slow bubbles
    const b=(tick/40+m.ph)%1; ctx.strokeStyle=`rgba(160,120,80,${.5*(1-b)})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(m.x+Math.cos(m.ph*3)*m.r*.4, m.y+Math.sin(m.ph*3)*m.r*.4, 4+b*8, 0, Math.PI*2); ctx.stroke();
  }
  const h = Rules.LOG.len/2;
  for (const g of logs){ if (!onScreen(g.x,g.y,h)) continue;
    const dx=Math.cos(g.a), dy=Math.sin(g.a), nx=-dy, ny=dx;
    ctx.lineCap='round';
    ctx.strokeStyle='#5a3418'; ctx.lineWidth=Rules.LOG.w*2+4; ctx.beginPath(); ctx.moveTo(g.x-dx*h,g.y-dy*h); ctx.lineTo(g.x+dx*h,g.y+dy*h); ctx.stroke();
    ctx.strokeStyle='#8a5a2b'; ctx.lineWidth=Rules.LOG.w*2-2; ctx.stroke();
    ctx.fillStyle='#e9e4ff';
    for (let t=-h+12;t<=h-12;t+=24) for (const sgn of [1,-1]){ const bx=g.x+dx*t, by=g.y+dy*t, o=Rules.LOG.w+1;
      ctx.beginPath(); ctx.moveTo(bx+nx*o*sgn-dx*5, by+ny*o*sgn-dy*5); ctx.lineTo(bx+nx*(o+9)*sgn, by+ny*(o+9)*sgn); ctx.lineTo(bx+nx*o*sgn+dx*5, by+ny*o*sgn+dy*5); ctx.fill(); }
    ctx.fillStyle='#3a2210'; ctx.beginPath(); ctx.arc(g.x,g.y,5,0,Math.PI*2); ctx.fill();
    ctx.lineCap='butt';
  }
  if (frenzy){
    const pulse = 1 + .05*Math.sin(tick/5), R = Rules.FRENZY.r*pulse;
    ctx.globalAlpha = frenzy.live ? .9 : .4 + .4*((tick>>3)&1);
    ctx.strokeStyle='#ffd23f'; ctx.lineWidth=4; ctx.setLineDash?.([18,14]); ctx.lineDashOffset = -tick;
    ctx.beginPath(); ctx.arc(frenzy.x,frenzy.y,R,0,Math.PI*2); ctx.stroke(); ctx.setLineDash?.([]);
    ctx.globalAlpha=.08; ctx.fillStyle='#ffd23f'; ctx.fill(); ctx.globalAlpha=1;
  }
}
// eyes and personality tells: hunters scowl, cowards sweat, thieves wear a mask; hats and labels on top
function drawFace(s, r){
  const P=s.persona, fx=Math.cos(s.ang), fy=Math.sin(s.ang), sx=Math.cos(s.ang+Math.PI/2), sy=Math.sin(s.ang+Math.PI/2);
  const ex=sx*r*.5, ey=sy*r*.5, ox=fx*r*.35, oy=fy*r*.35;
  if (P==='thief'){ ctx.strokeStyle='rgba(20,12,30,.9)'; ctx.lineCap='round'; ctx.lineWidth=r*.62; ctx.beginPath(); ctx.moveTo(s.x+ex*1.5+ox,s.y+ey*1.5+oy); ctx.lineTo(s.x-ex*1.5+ox,s.y-ey*1.5+oy); ctx.stroke(); ctx.lineCap='butt'; }
  const er = r*(P==='coward' ? .4 : .34);
  ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(s.x+ex+ox,s.y+ey+oy,er,0,Math.PI*2); ctx.arc(s.x-ex+ox,s.y-ey+oy,er,0,Math.PI*2); ctx.fill();
  let look = 0; if (s===player && steer!=null){ let d=steer-s.ang; d=Math.atan2(Math.sin(d),Math.cos(d)); look = Math.max(-1,Math.min(1,d/1.2)); }
  const px = Math.cos(s.ang+look*0.6)*r*.1, py = Math.sin(s.ang+look*0.6)*r*.1, pr = r*(P==='coward' ? .1 : .17);
  ctx.fillStyle='#1b1330';
  ctx.beginPath(); ctx.arc(s.x+ex+ox*1.6+px,s.y+ey+oy*1.6+py,pr,0,Math.PI*2); ctx.arc(s.x-ex+ox*1.6+px,s.y-ey+oy*1.6+py,pr,0,Math.PI*2); ctx.fill();
  if (P==='hunter' || s.isKing){
    // angry brows slanting down toward the middle
    ctx.strokeStyle='#1b1330'; ctx.lineWidth=Math.max(2,r*.2); ctx.lineCap='round';
    for (const k of [1,-1]){ const cx=s.x+k*ex+ox, cy=s.y+k*ey+oy;
      ctx.beginPath(); ctx.moveTo(cx+k*sx*r*.35+fx*r*.3, cy+k*sy*r*.35+fy*r*.3); ctx.lineTo(cx-k*sx*r*.2+fx*r*.5, cy-k*sy*r*.2+fy*r*.5); ctx.stroke(); }
    ctx.lineCap='butt';
  }
  if (P==='coward' && s.fleeing){ ctx.fillStyle='#8fd8ff'; ctx.beginPath(); ctx.arc(s.x+sx*r*1.05-fx*r*.2, s.y+sy*r*1.05-fy*r*.2, r*.22, 0, Math.PI*2); ctx.fill(); }
  if (s.isKing && s.stun>0){ ctx.font=`${Math.round(r*.9)}px sans-serif`; ctx.textAlign='center'; for (let k=0;k<3;k++){ const a=tick/8+k*2.1; ctx.fillText('⭐', s.x+Math.cos(a)*r*1.4, s.y-r*1.2+Math.sin(a)*r*.5); } }
  const hat = s===player ? cosOf('hat', style.hat).glyph : '';
  if (hat){ ctx.font=`${Math.round(r*1.7)}px sans-serif`; ctx.textAlign='center'; ctx.fillText(hat, s.x, s.y-r*.55); }
  ctx.font='bold 12px sans-serif'; ctx.textAlign='center';
  ctx.fillStyle = s.nemesis ? '#ff5d4a' : 'rgba(255,255,255,.85)';
  ctx.fillText((s.isKing?'👑 ':s.nemesis?'💢 ':'')+s.len, s.x, s.y-r-6-(hat ? r*1.2 : 0));
  if (s.taunt && tick < s.taunt.until){
    const t=s.taunt.text; ctx.font='bold 13px sans-serif'; const w=(ctx.measureText(t).width||t.length*7)+14, bx=s.x+r+6, by=s.y-r-34;
    ctx.fillStyle='#fbf3e4'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx,by,w,22,8) : ctx.rect(bx,by,w,22); ctx.fill();
    ctx.beginPath(); ctx.moveTo(bx+6,by+22); ctx.lineTo(bx-2,by+30); ctx.lineTo(bx+14,by+22); ctx.fill();
    ctx.fillStyle='#1b1330'; ctx.textAlign='left'; ctx.fillText(t, bx+7, by+16); ctx.textAlign='center';
  }
}
// screen-edge arrow toward something off-screen (frenzy zone, the King)
function edgeArrow(x, y, color, label){
  const sx=x-cam.x+W/2, sy=y-cam.y+H/2; if (sx>0 && sx<W && sy>0 && sy<H) return;
  // clamp to a box that keeps clear of the HUD on top and the joystick/boost button at the bottom
  const top=110, bot=H-170, cx=W/2, cy=(top+bot)/2, a=Math.atan2(sy-cy, sx-cx), c=Math.cos(a), s=Math.sin(a);
  const k=Math.min((W/2-40)/Math.max(1e-6,Math.abs(c)), (bot-top)/2/Math.max(1e-6,Math.abs(s))), px=cx+c*k, py=cy+s*k;
  ctx.save(); ctx.translate(px,py); ctx.rotate(a); ctx.globalAlpha=.6+.3*Math.sin(tick/6);
  ctx.fillStyle=color; ctx.beginPath(); ctx.moveTo(16,0); ctx.lineTo(-8,-11); ctx.lineTo(-3,0); ctx.lineTo(-8,11); ctx.fill(); ctx.restore();
  ctx.globalAlpha=1; ctx.fillStyle=color; ctx.font='bold 11px sans-serif'; ctx.textAlign='center'; ctx.fillText(label, px-c*24, py-s*24+4);
}

function draw(){
  ctx.fillStyle = '#1b1330'; ctx.fillRect(0,0,W,H);
  const sh = FX.shakeOffset(); ctx.save(); ctx.translate(W/2-cam.x+sh.x, H/2-cam.y+sh.y);
  // soft soil vignette
  const vg=ctx.createRadialGradient(cam.x,cam.y,0,cam.x,cam.y,Math.max(W,H)*.7); vg.addColorStop(0,'#2b2040'); vg.addColorStop(1,'#1b1330');
  ctx.fillStyle=vg; ctx.fillRect(cam.x-W/2,cam.y-H/2,W,H);
  // arena edge; a closing wall pulses and leaves a ghost of where it started
  if (arenaR < baseR-1){ ctx.strokeStyle='rgba(255,93,74,.18)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,baseR,0,Math.PI*2); ctx.stroke(); }
  ctx.strokeStyle='#ff5d4a'; ctx.lineWidth = arenaR < baseR-1 ? 6+2*Math.sin(tick/8) : 6; ctx.beginPath(); ctx.arc(0,0,arenaR,0,Math.PI*2); ctx.stroke();
  drawHazards();
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
  // worms
  for (const s of worms){
    if (s.dead) continue;
    const r = radius(s);
    if (s!==player && s.pts.every(p=>Math.abs(p.x-cam.x)>W/2+40||Math.abs(p.y-cam.y)>H/2+40)) continue;
    const alpha = (s===player && effects.has('ghost')) || noBites() ? .5 : 1; ctx.globalAlpha = alpha;
    paintBody(s.pts, r, s.skin || {c:s.c,type:'solid'}, s.ai ? s.boost : s.fast, s.ang, s.x, s.y, s.turn, alpha);
    drawFace(s, r);
    if (s===player){
      ctx.globalAlpha=1;
      if (effects.has('shield')){ ctx.strokeStyle='rgba(201,242,74,.6)'; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(s.x,s.y,r*1.9,0,Math.PI*2); ctx.stroke(); }
      if (effects.has('magnet')){ ctx.strokeStyle='rgba(255,93,74,.12)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(s.x,s.y,140,0,Math.PI*2); ctx.stroke(); }
    }
    ctx.globalAlpha=1;
  }
  FX.drawWorld(ctx);
  ctx.restore();
  if (frenzy && !player.dead) edgeArrow(frenzy.x, frenzy.y, '#ffd23f', 'FRENZY');
  if (king && !king.dead && !player.dead) edgeArrow(king.x, king.y, '#ff5d4a', 'KING');
  FX.drawScreen(ctx, W, H);
  if (running && player.fast){ ctx.fillStyle='rgba(255,93,74,.9)'; ctx.font='bold 16px sans-serif'; ctx.textAlign='center'; ctx.fillText('BOOSTING', W/2, H-40); }
  const n = streak.count(tick);
  if (running && n >= 2){ ctx.fillStyle='#ffb347'; ctx.font='800 15px sans-serif'; ctx.textAlign='center'; ctx.fillText('STREAK ×'+n, W/2, H-62); }
}

// slow-mo runs the sim every other frame; after a death the world plays on at third speed while the
// camera drifts to whoever ate you, then the game-over screen comes up
let frameN = 0;
function loop(){
  frameN++;
  if (running){ if (slowmo>0){ slowmo--; if (frameN%2===0) update(); } else update(); }
  else if (deathT>0){
    deathT--; if (frameN%3===0) update();
    if (deathFocus){ cam.x += (deathFocus.x-cam.x)*0.08; cam.y += (deathFocus.y-cam.y)*0.08; }   // glide to the killer at full frame rate
    if (deathT===0) showOverlay(gameOverScreen(pendingNewly));
  }
  else FX.update();
  draw(); requestAnimationFrame(loop);
}
let unlockedBefore=new Set();
function newlyUnlocked(){ const n = unlockedKeys().filter(k=>!unlockedBefore.has(k.key)); if (n.length) Sound.play('unlock'); return n; }
function saveBest(){ if (player.len>best){ best=player.len; store.set('noodleBest',best); bestEl.textContent=best; } }
function roundWin(){
  running=false; Sound.boost(false); Sound.play('roundWin'); effects.clear(); renderBuffs(true);
  FX.flash('rgba(201,242,74,.30)', 3);
  FX.confetti(W/2, H*0.45, 60, PALETTE);
  saveBest();
  const R = ROUNDS[round], frames = tick - runStart, medal = Rules.medalFor(frames, R.par), bonus = Rules.timeBonus(frames, R.par);
  addScore(bonus); scoreEl.textContent = score;
  medals[round] = Rules.betterMedal(medals[round] || null, medal); store.set('noodleMedals', JSON.stringify(medals));
  if (R.king) stats.kingBeaten = true;
  saveStats();
  const res = { frames, par: R.par, medal, bonus, newly: newlyUnlocked() };
  const last = round===ROUNDS.length-1;
  if (!last){ maxRound=Math.max(maxRound, round+1); store.set('noodleRound',maxRound); round++; }
  bossEl.hidden = true;
  showOverlay(last ? winScreen(res) : roundClearScreen(res));
}
// end-of-run bookkeeping shared by deaths and the daily timer
function endRun(){
  running=false; Sound.boost(false); effects.clear(); renderBuffs(true);
  saveBest();
  if (mode==='endless' && score > stats.endlessBest) stats.endlessBest = score;
  if (mode==='daily' && score >= dailyBest()) store.set('noodleDaily', JSON.stringify({ key: daily.key, best: score }));
  saveStats();
  bossEl.hidden = true; timerEl.classList.remove('low');
}
function gameOver(){
  Sound.play(playerHitWall || (deathInfo && deathInfo.log) ? 'wall' : 'death');
  stats.deaths++; endRun();
  pendingNewly = newlyUnlocked();
  deathT = 80;
}
function timeUp(){
  endRun(); deathInfo = { timeUp: true };
  FX.banner('TIME!', '#c9f24a', 80); Sound.play('roundWin');
  showOverlay(gameOverScreen(newlyUnlocked()));
}
function start(){
  Sound.play('tap'); unlockedBefore=new Set(unlockedKeys().map(k=>k.key));
  if (mode==='daily'){ if (!daily.pinned) daily = Rules.dailyFor(Rules.dateKey()); stats.dailies++; saveStats(); }
  if (mode!=='rounds' || ROUNDS[round].king) nemesisSave = null;
  reset(); paused=false; running=true; Sound.unlock(); Sound.music(cfg().king ? 'king' : 'play'); steer=null; boosting=false; hideOverlay();
  if (mode==='daily') FX.banner(daily.mod.name.toUpperCase(), '#5cc8ff', 120, daily.mod.desc);
  else if (cfg().king) FX.banner('THE PIT KING', '#ffd23f', 120, 'make him run into your side');
}

// joystick in bottom-left: direction from stick center to finger
const stick=document.getElementById('stick'), knob=document.getElementById('knob');
let steerId=null;
function stickPos(t){ const r=stick.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; let dx=t.clientX-cx, dy=t.clientY-cy; const d=Math.hypot(dx,dy); if(d>6) steer=Math.atan2(dy,dx); const m=Math.min(d,r.width/2-24); const a=Math.atan2(dy,dx); knob.style.transform=`translate(${Math.cos(a)*m}px,${Math.sin(a)*m}px)`; }
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

// debug hook for the headless smoke tests and tools/balance-sim.mjs
window.NoodleDebug = {
  state: () => ({ worms, food, pickups, effects, player, round, tick, running, paused, mode, score, king, streak, frenzy, mud, logs, arenaR, deathT, stats, medals, style, daily,
    target: ROUNDS[round].king && mode==='rounds' ? KING_LEN : cfg().target }),
  steer: a => { steer = a; },
  spawnPickup: kind => spawnPickup(kind, player.x, player.y),
  setRound: i => { round = i; },
  setMode: m => { mode = m; },
  setGodMode: b => { godMode = !!b; },   // sim only: measure growth without the autopilot's deaths
  setDaily: (key, modId) => { daily = { ...Rules.dailyFor(key), pinned: true }; if (modId) daily.mod = Rules.DAILY_MODS.find(m=>m.id===modId); },
  startFrenzy: () => { nextFrenzyAt = tick; },
  skipTime: f => { runStart -= f; },   // fast-forward the run clock (daily timer, arena shrink)
};

reset(); showOverlay(titleScreen()); loop();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
