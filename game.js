/* =========================================================================
   THE HOLE — Le Chat Pêcheur
   Jeu incrémental basé sur la physique (Matter.js)
   Vue de côté 2.5D — gravité réelle pour la mécanique de lancer.
   ========================================================================= */

const { Engine, World, Bodies, Body, Composite, Events, Query, Vector } = Matter;

/* ---------------- Style graphique ---------------------------------------- */
// "px" = pixel-art (PNG + rendu en buffer basse résolution) | "svg" = cartoon
const STYLE = "px";
const PIXEL_ART = STYLE === "px";

/* ---------------- Monde virtuel (résolution fixe, mise à l'échelle) ------- */
const W = 1280, H = 720;
const DOCK_Y   = 472;            // surface supérieure du ponton
const WATER_Y  = 560;            // haut de la zone d'eau (pêche)
const SPAWN_X1 = 110, SPAWN_X2 = 320;   // zone de spawn (derrière le chat)
const CAT_X    = 400;
const HOLE_X   = 1135;           // centre du trou / seau
const CONV_X1  = 470, CONV_X2 = 1055;   // emprise du tapis roulant

/* ---------------- État du jeu -------------------------------------------- */
const DEFAULT_STATE = {
  money: 0,
  gold: 0,
  earnedThisRun: 0,
  totalCaught: 0,
  up: {},          // niveaux des améliorations
  perm: {},        // améliorations permanentes (écailles)
  seenHint: false,
};
let S = structuredClone(DEFAULT_STATE);

/* ---------------- Définition des améliorations --------------------------- */
// effect() lit le niveau via lvl(id). cost = base * mult^level.
const SHOP = [
  { phase:"Phase 1 — Le Manuel" },
  { id:"reel",  emoji:"🎣", name:"Moulinet Huilé", base:12,  mult:1.45, max:18,
    desc:l=>`Pêche plus rapide. Délai : ${(fishInterval()/1000).toFixed(2)}s`,
  },
  { id:"bait",  emoji:"🪱", name:"Appât Savoureux", base:18,  mult:1.6, max:45,
    desc:l=>`Valeur des poissons ×${fmt(baitMult())}`,
  },
  { id:"magnet",emoji:"🧲", name:"Aimant", base:200, mult:7, max:5,
    desc:l=>`Attrape ${grabCount()} poisson(s) à la fois`,
  },
  { id:"rake",  emoji:"🧹", name:"Râteau", base:100, mult:1, max:1,
    desc:l=>l===0?`Un râteau apparaît sur le ponton : attrape-le à la souris pour pousser les poissons vers le seau`
                 :`Râteau posé sur le ponton ✓`,
  },

  { phase:"Phase 2 — Semi-Automatique" },
  { id:"hole",  emoji:"🕳️", name:"Agrandir le Trou", base:2500, mult:10, max:5,
    desc:l=>l===0?`Niv 1 : débloque le Saumon (rare) • Niv 2 : le Globe (rare)`
                 :l===1?`Saumon débloqué (rare) • Niv 2 : débloque le Globe • valeur ×${holeMult().toFixed(1)}`
                       :`Trou +grand • valeur ×${holeMult().toFixed(1)} • niv ${l}`,
  },
  { id:"school", emoji:"🐟", name:"Banc de Saumons", base:6000, mult:2.1, max:6,
    desc:l=>lvl("hole")<1?`Nécessite « Agrandir le Trou »`
                         :`Apparition des Saumons : ${(saumonRate()*100).toFixed(1)}%`,
  },
  { id:"globebait", emoji:"🐡", name:"Leurre à Globes", base:40000, mult:2.4, max:6,
    desc:l=>lvl("hole")<2?`Nécessite le Trou niveau 2`
                         :`Apparition des Globes : ${(globeRate()*100).toFixed(1)}%`,
  },
  { id:"conveyor",emoji:"🛤️", name:"Tapis Roulant", base:4000, mult:1, max:1,
    desc:l=>l===0?`Pousse les poissons vers le trou tout seul`:`Tapis actif ✓`,
  },
  { id:"net",   emoji:"🪣", name:"Épuisette (actif)", base:7500, mult:1, max:1,
    desc:l=>l===0?`Compétence : fait pleuvoir 10 poissons`:`Compétence débloquée ✓`,
  },

  { phase:"Phase 3 — L'Usine" },
  { id:"auto",  emoji:"🤖", name:"Machine à Pêcher", base:60000, mult:1, max:1,
    desc:l=>l===0?`Pêche seule, 1 poisson / 3 s (gains hors-ligne !)`:`Pêche auto active ✓`,
  },
  { id:"autospeed", emoji:"⚡", name:"Survolteur de Machine", base:45000, mult:1.65, max:12,
    desc:l=>`Cadence de la machine. Délai : ${(autoInterval()/1000).toFixed(2)}s`,
  },
  { id:"boost", emoji:"⚙️", name:"Moteur de Tapis", base:9000, mult:2.2, max:10,
    desc:l=>`Force du tapis ×${convForceMult().toFixed(1)}`,
  },
  { id:"frenzy",emoji:"🔥", name:"Mult. Frénétique", base:200000, mult:1, max:1,
    desc:l=>l===0?`+10 poissons/s dans le trou ⇒ gains ×2 (5s)`:`Frénésie active ✓`,
  },

  { phase:"Phase 4 — Le Vortex" },
  { id:"vortex",emoji:"🌀", name:"Le Vortex", base:2500000, mult:1, max:1,
    desc:l=>l===0?`Le trou aspire les poissons alentour`:`Vortex actif ✓`,
  },
];

const PERM = [
  { id:"pmult", emoji:"✨", name:"Gains Éternels", base:3, mult:2.8, max:40,
    desc:l=>`Tous les gains ×${fmt(permMult())} (permanent)`,
  },
  { id:"pgold", emoji:"🐠", name:"Poissons Dorés", base:5, mult:3, max:10,
    desc:l=>`+1% de poissons dorés / palier → ${(goldenChance()*100).toFixed(0)}% (×100 valeur)`,
  },
  { id:"pstart",emoji:"💼", name:"Pécule de Départ", base:4, mult:2.6, max:12,
    desc:l=>`Commence chaque run avec ${fmt(startMoney())}$`,
  },
];

/* ---------------- Helpers de stats --------------------------------------- */
const lvl  = id => S.up[id]   || 0;
const plvl = id => S.perm[id] || 0;

function cost(def, level){ return Math.floor(def.base * Math.pow(def.mult, level)); }

function fishInterval(){ return Math.max(220, 3000 * Math.pow(0.85, lvl("reel"))); }
// La machine a sa PROPRE cadence : 3 s de base, améliorée uniquement par son
// survolteur (indépendante du Moulinet manuel).
function autoInterval(){ return Math.max(700, 3000 * Math.pow(0.82, lvl("autospeed"))); }
function baitMult(){ return Math.pow(1.5, lvl("bait")); }                 // ×1.5 par niveau
function holeMult(){ return 1 + lvl("hole") * 0.3; }                      // bonus de valeur
function grabCount(){ return [1,2,3,5,8,12][Math.min(lvl("magnet"),5)]; }
function convForceMult(){ return 1 + lvl("boost") * 0.8; }
function permMult(){ return Math.pow(1.45, plvl("pmult")); }
function goldenChance(){ return plvl("pgold") * 0.01; }   // +1% par palier (max 10%)
function startMoney(){ return plvl("pstart") * 500 * Math.pow(2.5, plvl("pstart")); }

// Taux d'apparition des gros poissons : TRÈS rares de base, montés par leur palier dédié.
function saumonRate(){ return lvl("hole")>=1 ? 0.03 + lvl("school")*0.035 : 0; }   // 3% → ~24%
function globeRate(){  return lvl("hole")>=2 ? 0.008 + lvl("globebait")*0.018 : 0; } // 0.8% → ~12%

function gainMult(){ return baitMult() * holeMult() * permMult() * (frenzyUntil > now() ? 2 : 1); }
function prestigeGain(){ return Math.floor(Math.sqrt(S.earnedThisRun / 4000000)); }

// valeur moyenne d'un poisson pêché (pondérée espèces + dorés) — pour les gains hors-ligne
function avgFishValue(){
  const g=globeRate(), s=saumonRate();
  const v = g*SPECIES.globe.value + s*SPECIES.saumon.value + (1-g-s)*SPECIES.sardine.value;
  return v * (1 + 99*goldenChance());
}
// revenu passif estimé ($/s) — nécessite Machine + Tapis
function passivePerSec(){
  if (!lvl("auto") || !lvl("conveyor")) return 0;
  return (1000/autoInterval()) * avgFishValue() * baitMult() * holeMult() * permMult();
}

/* ---------------- Espèces de poissons ------------------------------------ */
const SPECIES = {
  sardine: { name:"Sardine",  value:1,  w:46, h:22, density:0.0012, color:"#b8c6d1", belly:"#eef3f7" },
  saumon:  { name:"Saumon",   value:12, w:74, h:34, density:0.0020, color:"#ef7d5a", belly:"#ffd9c4" },
  globe:   { name:"Globe",    value:60, w:48, h:46, density:0.0006, color:"#ffd54a", belly:"#fff1b0" },
};
function rollSpecies(){
  const r = Math.random();
  const g = globeRate(), s = saumonRate();
  if (r < g)     return "globe";
  if (r < g + s) return "saumon";
  return "sardine";
}

/* ---------------- Audio 8-bit (WebAudio, sans fichier) ------------------- */
const Sound = (function(){
  let actx=null, master=null, muted=false;
  function ensure(){
    if(!actx){ const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return;
      actx=new AC(); master=actx.createGain(); master.gain.value=0.22; master.connect(actx.destination); }
    if(actx.state==="suspended") actx.resume();
  }
  function tone(freq,dur,type="square",vol=1,slideTo=null){
    ensure(); if(muted||!actx) return;
    const o=actx.createOscillator(), g=actx.createGain(), t=actx.currentTime;
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo,t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(vol,t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t+dur+0.02);
  }
  function noise(dur,vol=0.5){
    ensure(); if(muted||!actx) return;
    const n=Math.floor(actx.sampleRate*dur), buf=actx.createBuffer(1,n,actx.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
    const src=actx.createBufferSource(); src.buffer=buf;
    const f=actx.createBiquadFilter(); f.type="highpass"; f.frequency.value=700;
    const g=actx.createGain(); g.gain.value=vol;
    src.connect(f); f.connect(g); g.connect(master); src.start();
  }
  const seq=(notes,type,vol,gap)=>notes.forEach((f,i)=>setTimeout(()=>tone(f,0.16,type,vol),i*gap));
  return {
    score(combo){ tone(440 + Math.min(combo,40)*16, 0.10, "square", 0.45); },
    gold(){ seq([660,880,1320,1760],"triangle",0.5,55); },
    splash(){ noise(0.16,0.3); },
    buy(){ tone(540,0.07,"square",0.4); setTimeout(()=>tone(760,0.09,"square",0.4),70); },
    frenzy(){ seq([523,659,784,1046,1318],"square",0.5,70); },
    prestige(){ seq([392,523,659,784,1046,1318],"triangle",0.55,110); },
    resume(){ ensure(); },
    toggle(){ muted=!muted; return muted; },
    muted(){ return muted; },
  };
})();

/* ---------------- État feedback (combo / screen-shake) ------------------- */
let combo=0, lastScoreT=0;
const COMBO_WINDOW=1500;
const comboMult = () => 1 + Math.min(combo,40)*0.025;   // jusqu'à +100% en plein combo
let shake=0;

/* ========================================================================= *
   MOTEUR PHYSIQUE
 * ========================================================================= */
const engine = Engine.create();
engine.gravity.y = 1.0;
const world = engine.world;

// Collision categories
const CAT_FISH = 0x0001, CAT_SOLID = 0x0002;

function staticBox(x,y,w,h,opts={}){
  return Bodies.rectangle(x,y,w,h,Object.assign({
    isStatic:true, collisionFilter:{ category:CAT_SOLID }, render:{visible:false}
  },opts));
}

// Sol (ponton) + murs
const ground = staticBox(W/2, DOCK_Y+60, W+400, 120, { friction:0.6 });
const wallL  = staticBox(-30, H/2, 60, H*2);
const wallR  = staticBox(W+30, H/2, 60, H*2);
// petit rebord à gauche pour éviter que les poissons tombent dans l'eau
const ledge  = staticBox(SPAWN_X1-30, DOCK_Y-40, 24, 120);
Composite.add(world, [ground, wallL, wallR, ledge]);

// Dimensions du tonneau (partagées entre la physique et le rendu)
const BARREL_H0 = 150, BARREL_HSTEP = 16, BARREL_AR = 0.728;  // ratio largeur/hauteur du sprite
const barrelHeight = () => BARREL_H0 + lvl("hole")*BARREL_HSTEP;

// Le trou : capteur de score limité à l'OUVERTURE du tonneau (étroit, en haut)
let hole = makeHole();
function makeHole(){
  const hgt   = barrelHeight();
  const bw    = hgt * BARREL_AR;            // largeur du tonneau
  const top   = DOCK_Y + 18 - hgt;          // haut du tonneau
  const openW = bw * 0.52;                  // largeur de l'ouverture (pas les côtés)
  const openTop = top + hgt*0.12;           // juste sous le rebord
  const sensorH = (DOCK_Y) - openTop + 6;   // colonne de l'ouverture jusqu'au ponton
  const b = Bodies.rectangle(HOLE_X, openTop + sensorH/2, openW, sensorH, {
    isStatic:true, isSensor:true, label:"hole",
    collisionFilter:{ category:CAT_SOLID }, render:{visible:false}
  });
  b.holeW = bw;                             // largeur tonneau (pour le vortex)
  return b;
}
Composite.add(world, hole);

/* ---------------- Le Râteau (objet physique attrapable) ------------------ */
// Outil débloqué en Phase 1. Il repose sur le ponton ; on l'attrape à la
// souris pour POUSSER physiquement les poissons vers le seau.
let rake = null;
let rakeDrag = false;
const RAKE_HEAD_W = 96, RAKE_HEAD_H = 16;
function makeRake(){
  const r = Bodies.rectangle(CAT_X+150, DOCK_Y-40, RAKE_HEAD_W, RAKE_HEAD_H, {
    chamfer:{ radius:5 },
    density:0.02, friction:0.5, frictionAir:0.05, restitution:0.05,
    label:"rake",
    collisionFilter:{ category:CAT_SOLID, mask:CAT_FISH|CAT_SOLID },
  });
  return r;
}
// Synchronise la présence du râteau avec le niveau de l'amélioration.
function ensureRake(){
  if (lvl("rake") && !rake){ rake = makeRake(); Composite.add(world, rake); }
  else if (!lvl("rake") && rake){ Composite.remove(world, rake); rake=null; rakeDrag=false; }
  const btn=document.getElementById("rake-reset"); if (btn) btn.hidden = !lvl("rake");
}
// Détruit l'éventuel râteau actuel et en repose un neuf sur le ponton.
function respawnRake(){
  if (!lvl("rake")) return;
  if (rake){ Composite.remove(world, rake); rake=null; }
  rakeDrag=false;
  rake = makeRake(); Composite.add(world, rake);
}

const fishes = [];   // bodies actifs
const MAX_FISH = 140;

function spawnFish(x, y, speciesKey){
  if (fishes.length >= MAX_FISH){
    const old = fishes.find(f => !f.dragging);
    if (old) removeFish(old);
  }
  const sp = SPECIES[speciesKey];
  const golden = Math.random() < goldenChance();
  const f = Bodies.rectangle(x, y, sp.w, sp.h, {
    chamfer:{ radius: sp.h/2 },
    density: sp.density,
    friction:0.4, frictionAir:0.012, restitution:0.35,
    label:"fish",
    collisionFilter:{ category:CAT_FISH, mask:CAT_SOLID|CAT_FISH },
  });
  f.species = speciesKey;
  f.golden  = golden;
  f.baseValue = sp.value * (golden ? 100 : 1);
  f.flip = Math.random()<0.5 ? 1 : -1;
  f.wiggleT = Math.random()*1000;
  f.dragging = false;
  Body.setAngle(f, (Math.random()-0.5)*0.4);
  Body.setVelocity(f, { x:(Math.random()-0.5)*2, y:-1 });
  Body.setAngularVelocity(f, (Math.random()-0.5)*0.1);
  fishes.push(f);
  Composite.add(world, f);
  return f;
}

function removeFish(f){
  const i = fishes.indexOf(f);
  if (i>=0) fishes.splice(i,1);
  Composite.remove(world, f);
}

/* ---------------- Scoring (poisson dans le trou) ------------------------- */
let scoreTimes = [];   // timestamps pour le calcul du débit + frénésie
let moneyLog = [];     // {t, v} pour le calcul du $/s
function moneyPerSec(){
  const t = now()-1000;
  while (moneyLog.length && moneyLog[0].t < t) moneyLog.shift();
  const active = moneyLog.reduce((s,e)=>s+e.v, 0);
  return Math.max(active, passivePerSec());
}
let frenzyUntil = 0;

Events.on(engine, "collisionStart", ev => {
  for (const pair of ev.pairs){
    let fishB=null;
    if (pair.bodyA.label==="hole" && pair.bodyB.label==="fish") fishB=pair.bodyB;
    if (pair.bodyB.label==="hole" && pair.bodyA.label==="fish") fishB=pair.bodyA;
    if (fishB && !fishB.scored){
      fishB.scored = true;
      scoreFish(fishB);
    }
  }
});

function scoreFish(f){
  const t = now();
  // combo : enchaîner les prises rapproche le multiplicateur
  combo = (t - lastScoreT < COMBO_WINDOW) ? combo+1 : 1;
  lastScoreT = t;

  const value = f.baseValue * gainMult() * comboMult();
  S.money += value;
  S.earnedThisRun += value;
  S.totalCaught++;
  scoreTimes.push(t);
  moneyLog.push({t, v:value});

  // frénésie : >10 poissons / seconde
  const wasFrenzy = frenzyUntil > t;
  if (lvl("frenzy") && countRecent(1000) > 10){
    frenzyUntil = t + 5000;
    if (!wasFrenzy){ Sound.frenzy(); shake = 12; }
  }
  // juice
  shake = Math.min(16, shake + (f.golden?9:2.5) + combo*0.15);
  if (f.golden) Sound.gold(); else Sound.score(combo);

  spawnCoinBurst(f.position.x, f.position.y, f.golden);
  const barrelTop = DOCK_Y + 18 - barrelHeight();          // haut du tonneau
  spawnSplash(HOLE_X, barrelTop + 24, 0.8);                // plouf à l'ouverture
  floatText(f.position.x, f.position.y-20, "+"+fmt(value)+"$", f.golden?"#ffd54a":"#9ff0c0");
  removeFish(f);
  uiDirty = true;
}

function countRecent(ms){
  const t = now()-ms;
  return scoreTimes.filter(x=>x>t).length;
}

/* ---------------- Force du tapis & vortex (beforeUpdate) ----------------- */
Events.on(engine, "beforeUpdate", () => {
  for (const f of fishes){
    if (f.dragging) continue;

    // Tapis roulant
    if (lvl("conveyor") && f.position.x>CONV_X1 && f.position.x<CONV_X2
        && f.position.y > DOCK_Y-60){
      Body.applyForce(f, f.position,
        { x: 0.00010 * f.mass * convForceMult(), y: 0 });
    }

    // Vortex : aspiration vers le trou
    if (lvl("vortex")){
      const d = Vector.sub({x:HOLE_X,y:DOCK_Y-18}, f.position);
      const dist = Vector.magnitude(d) || 1;
      if (dist < 520){
        const pull = 0.00022 * f.mass * (1 - dist/520);
        Body.applyForce(f, f.position, { x:d.x/dist*pull, y:d.y/dist*pull });
      }
    }

    // Frétillement aléatoire au sol
    if (Math.abs(f.velocity.x)<0.4 && Math.abs(f.velocity.y)<0.4 && f.position.y>DOCK_Y-40){
      if (Math.random()<0.02){
        Body.applyForce(f, f.position, { x:(Math.random()-0.5)*0.004*f.mass, y:-0.006*f.mass });
        Body.setAngularVelocity(f, (Math.random()-0.5)*0.15);
      }
    }
  }
});

/* ========================================================================= *
   ENTRÉES (souris + tactile) — pêche, drag & throw
 * ========================================================================= */
const canvas = document.getElementById("game");
let pointer = { x:0, y:0, down:false };
let pointerHist = [];                 // pour calculer la vélocité du lancer
let fishingProgress = 0;              // 0..fishInterval
let isFishing = false;
let drag = { active:false, fish:[], offsets:[] };

function toWorld(e){
  const r = canvas.getBoundingClientRect();
  const cx = (e.touches?e.touches[0].clientX:e.clientX) - r.left;
  const cy = (e.touches?e.touches[0].clientY:e.clientY) - r.top;
  // inversion EXACTE de la transform de rendu (scale + letterbox ox/oy),
  // en tenant compte du ratio pixels CSS -> pixels canvas internes
  const sx = canvas.width  / r.width;   // px canvas par px CSS (axe x)
  const sy = canvas.height / r.height;
  return {
    x: (cx*sx - ox) / scale,
    y: (cy*sy - oy) / scale,
  };
}
const inWater = p => p.y > WATER_Y && p.x > 30 && p.x < W-30;

function onDown(e){
  e.preventDefault();
  Sound.resume();                 // débloque l'audio au 1er geste
  const p = toWorld(e);
  pointer.x=p.x; pointer.y=p.y; pointer.down=true;
  pointerHist = [{x:p.x,y:p.y,t:now()}];

  // 0) attraper le râteau près du curseur ? (prioritaire : c'est l'outil)
  //    zone de prise généreuse (tête + manche) pour rester agréable à saisir
  if (rake && Vector.magnitudeSquared(Vector.sub(rake.position, p)) < 64*64){
    rakeDrag = true;
    hideHint();
    return;
  }
  // 1) attraper un poisson sous le curseur ?
  const hit = Query.point(fishes, p)[0];
  if (hit){
    startDrag(hit, p);
    return;
  }
  // 2) sinon, pêcher si dans l'eau
  if (inWater(p)){
    isFishing = true;
    spawnSplash(p.x, Math.max(WATER_Y+6, p.y), 0.7);   // plouf du bouchon
    Sound.splash();
    hideHint();
  }
}

function onMove(e){
  if (!pointer.down) return;
  const p = toWorld(e);
  pointer.x=p.x; pointer.y=p.y;
  pointerHist.push({x:p.x,y:p.y,t:now()});
  if (pointerHist.length>8) pointerHist.shift();
}

function onUp(e){
  pointer.down=false;
  if (drag.active) endDrag();
  rakeDrag=false;          // le râteau redevient un objet physique posé
  isFishing=false;
}

function startDrag(fish, p){
  // aimant : attrape aussi les N-1 poissons les plus proches
  const n = grabCount();
  const sorted = fishes
    .filter(f=>!f.scored)
    .map(f=>({f, d:Vector.magnitudeSquared(Vector.sub(f.position,p))}))
    .sort((a,b)=>a.d-b.d)
    .slice(0,n)
    .map(o=>o.f);
  // s'assurer que le poisson cliqué est inclus
  if (!sorted.includes(fish)) sorted[0]=fish;

  drag.active=true; drag.fish=sorted; drag.offsets=[];
  sorted.forEach((f,i)=>{
    f.dragging=true;
    f.scored=false;
    drag.offsets.push(i===0 ? {x:0,y:0}
      : { x:(Math.random()-0.5)*40, y:-(i*36) });
  });
  hideHint();
}

function endDrag(){
  // vélocité = déplacement récent du pointeur converti en vitesse Matter
  const v = pointerVelocity();
  drag.fish.forEach(f=>{
    f.dragging=false;
    Body.setVelocity(f, { x: clamp(v.x,-45,45), y: clamp(v.y,-55,20) });
    Body.setAngularVelocity(f, clamp(v.x*0.01,-0.5,0.5));
  });
  drag = { active:false, fish:[], offsets:[] };
}

function pointerVelocity(){
  if (pointerHist.length<2) return {x:0,y:0};
  const a = pointerHist[0], b = pointerHist[pointerHist.length-1];
  const dt = Math.max(16, b.t-a.t);
  // px/ms -> px/step(16.6ms), boosté pour un lancer satisfaisant
  return { x:(b.x-a.x)/dt*16.6*1.15, y:(b.y-a.y)/dt*16.6*1.15 };
}

canvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);
canvas.addEventListener("touchstart", onDown, {passive:false});
window.addEventListener("touchmove", onMove, {passive:false});
window.addEventListener("touchend", onUp);

/* ========================================================================= *
   BOUCLE PRINCIPALE
 * ========================================================================= */
let last = now();
let autoTimer = 0;
let rateAccum = 0, rateShown = 0, rateCount = 0;

function loop(){
  const t = now();
  let dt = Math.min(50, t-last);
  last = t;

  // --- Pêche manuelle ---
  if (isFishing && pointer.down && inWater(pointer)){
    fishingProgress += dt;
    if (fishingProgress >= fishInterval()){
      fishingProgress = 0;
      doFish();
    }
  } else if (!isFishing){
    fishingProgress = Math.max(0, fishingProgress - dt*2);
  }

  // --- Pêche automatique (Machine) — cadence propre, indépendante du Moulinet ---
  if (lvl("auto")){
    autoTimer += dt;
    if (autoTimer >= autoInterval()){
      autoTimer = 0;
      doFish();
    }
  }

  // --- Râteau : suit le pointeur et pousse les poissons par collision ---
  if (rakeDrag && rake){
    // on borne la cible AU-DESSUS du ponton : impossible de l'enfoncer sous les planches
    const target = {
      x: clamp(pointer.x, 60, W-60),
      y: clamp(pointer.y, DOCK_Y-240, DOCK_Y+14),
    };
    const np = Vector.add(rake.position, Vector.mult(Vector.sub(target, rake.position), 0.45));
    Body.setVelocity(rake, Vector.sub(np, rake.position));   // vitesse = pour transmettre la poussée
    Body.setPosition(rake, np);
    Body.setAngle(rake, 0);
    Body.setAngularVelocity(rake, 0);
  }
  // filet de sécurité : si le râteau s'est perdu (hors écran), on le fait réapparaître
  if (rake && !rakeDrag && (rake.position.y > H+40 || rake.position.x < -60 || rake.position.x > W+60)){
    respawnRake();
  }

  // --- Drag : maintenir les poissons sur le pointeur ---
  if (drag.active){
    drag.fish.forEach((f,i)=>{
      const target = { x:pointer.x+drag.offsets[i].x, y:pointer.y+drag.offsets[i].y };
      const np = Vector.add(f.position, Vector.mult(Vector.sub(target,f.position), 0.5));
      Body.setPosition(f, np);
      Body.setVelocity(f, {x:0,y:0});
    });
  }

  // --- Physique ---
  Engine.update(engine, 1000/60);

  // poissons tombés dans l'eau (premier plan) -> éclaboussure + perdu
  for (let i=fishes.length-1;i>=0;i--){
    const f=fishes[i];
    if (!f.dragging && !f.splashed && f.position.y>WATER_Y && f.velocity.y>0
        && f.position.x>40 && f.position.x<W-40){
      f.splashed=true;
      spawnSplash(f.position.x, WATER_Y, 1.1);
      removeFish(f); continue;
    }
    if (f.position.y > H+120) removeFish(f);
  }

  // débit $/s
  rateAccum += dt;
  if (rateAccum >= 400){
    rateShown = moneyPerSec();
    rateAccum = 0;
    uiDirty = true;
  }

  // combo : retombe si plus de prise dans la fenêtre
  if (combo>0 && now()-lastScoreT > COMBO_WINDOW) combo=0;

  updateParticles(dt);
  render();
  if (uiDirty){ refreshHUD(); uiDirty=false; }

  requestAnimationFrame(loop);
}

function doFish(){
  const x = SPAWN_X1 + Math.random()*(SPAWN_X2-SPAWN_X1);
  spawnFish(x, DOCK_Y-180, rollSpecies());
}

/* ========================================================================= *
   RENDU (canvas custom, par-dessus la physique)
 * ========================================================================= */
const screenCtx = canvas.getContext("2d");
// Buffer basse résolution : toute la scène y est rendue puis agrandie en
// nearest-neighbor → sprites ET décor partagent la même grille de pixels.
const PW = 320, PH = 180, SBUF = PW / W;     // 320x180 = monde /4
const pcanvas = document.createElement("canvas");
pcanvas.width = PW; pcanvas.height = PH;
const pctx = pcanvas.getContext("2d");
let ctx = PIXEL_ART ? pctx : screenCtx;       // contexte de dessin "scène"
let DPR = 1, scale=1, ox=0, oy=0;
function resize(){
  const r = canvas.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio||1);
  canvas.width  = Math.max(1, Math.round(r.width*DPR));
  canvas.height = Math.max(1, Math.round(r.height*DPR));
  scale = Math.min(canvas.width/W, canvas.height/H);
  ox = (canvas.width  - W*scale)/2;
  oy = (canvas.height - H*scale)/2;
}
window.addEventListener("resize", resize);

/* ---------------- Chargement des sprites --------------------------------- */
const SPRITES = {};
function loadSprite(key, url){
  const img = new Image();
  img.onload = () => {
    SPRITES[key] = { img, w:img.naturalWidth||img.width, h:img.naturalHeight||img.height };
    if (key.startsWith("fish_")) SPRITES[key].gold = makeGolden(img);
  };
  img.src = url;
}
// teinte dorée pré-rendue (offscreen) pour les poissons dorés
function makeGolden(img){
  const w=img.naturalWidth||img.width, h=img.naturalHeight||img.height;
  const off=document.createElement("canvas"); off.width=w; off.height=h;
  const g=off.getContext("2d");
  g.drawImage(img,0,0);
  g.globalCompositeOperation="source-atop";
  const grad=g.createLinearGradient(0,0,0,h);
  grad.addColorStop(0,"rgba(255,236,150,.95)");
  grad.addColorStop(1,"rgba(230,160,20,.95)");
  g.fillStyle=grad; g.fillRect(0,0,w,h);
  g.globalCompositeOperation="source-over";
  return off;
}
// Sprites Gemini détourés (assets/art/)
ctx = screenCtx;   // rendu direct (plus de buffer basse résolution)
const ART = ["cat_idle","cat_cast","barrel","lantern","shadow_fish","post",
             "mountains","forest","plank","dock_side","fish_sardine","fish_saumon","fish_globe",
             "fish_gold","splash_0","splash_1","splash_2","splash_3"];
ART.forEach(k => loadSprite(k, "assets/art/" + k + ".png"));

let waveT = 0;
const PX = 4;                       // taille du "pixel" pour les particules
const q = v => Math.round(v/PX)*PX;
const HORIZON = 300;                // ligne d'eau lointaine (le lac s'étend jusque-là)

// dessine une image ancrée (ax,ay en 0..1) à une hauteur monde donnée
function drawSprite(key, x, y, h, ax=0.5, ay=1, flip=1){
  const s = SPRITES[key]; if (!s) return;
  const dh = h, dw = dh * s.w/s.h;
  ctx.save(); ctx.translate(x, y); if (flip<0) ctx.scale(-1,1);
  ctx.drawImage(s.img, -dw*ax, -dh*ay, dw, dh);
  ctx.restore();
  return { dw, dh };
}

// couche de fond répétée en tuiles SANS déformer le ratio (base en bas, hauteur h)
// une tuile sur deux est miroitée pour masquer la répétition
function drawLayer(key, baseY, h){
  const s=SPRITES[key]; if(!s) return;
  const tw=Math.round(h*s.w/s.h);
  for(let x=0,i=0; x<W; x+=tw,i++){
    ctx.save(); ctx.translate(x, baseY-h);
    if(i%2){ ctx.scale(-1,1); ctx.drawImage(s.img, -tw-1, 0, tw+1, h); }
    else   { ctx.drawImage(s.img, 0, 0, tw+1, h); }
    ctx.restore();
  }
}

function render(){
  waveT += 0.03;
  ctx = screenCtx;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // screen-shake : décalage du rendu uniquement (le mapping souris garde ox/oy)
  if (shake>0.3){ shake*=0.86; } else shake=0;
  const shx = shake ? (Math.random()*2-1)*shake*scale : 0;
  const shy = shake ? (Math.random()*2-1)*shake*scale : 0;
  ctx.setTransform(scale,0,0,scale, ox+shx, oy+shy);
  ctx.imageSmoothingEnabled = false;   // pixels nets

  drawSky();
  // montagnes & forêt : tuilées en gardant le ratio (pas d'écrasement)
  drawLayer("mountains", HORIZON+6, 178);
  drawLayer("forest",    HORIZON+8, 96);
  drawLake();                 // le lac s'étend de l'horizon jusqu'au premier plan
  drawDock();                 // ponton posé sur l'eau
  if (lvl("conveyor")) drawConveyor();
  drawHole();
  drawLantern();
  drawCat();
  fishes.forEach(drawFish);
  drawRake();
  drawParticles();
  drawSplashes();
  drawFrenzyVignette();
  drawCombo();

  drawFloatTexts();
  drawFishingGauge();
}

function drawFrenzyVignette(){
  if (frenzyUntil <= now()) return;
  const vg=ctx.createRadialGradient(W/2,H/2,H*0.28,W/2,H/2,H*0.85);
  vg.addColorStop(0,"rgba(255,150,0,0)");
  vg.addColorStop(1,`rgba(255,110,0,${0.22+0.08*Math.sin(waveT*6)})`);
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
}

function drawCombo(){
  if (combo<3 || now()-lastScoreT>COMBO_WINDOW) return;
  const grow = Math.min(combo,40)/40;
  const pulse = 1 + 0.12*Math.sin(waveT*10);
  const size = (30 + grow*34) * pulse;
  ctx.save();
  ctx.textAlign="center"; ctx.font=`900 ${Math.round(size)}px Segoe UI, sans-serif`;
  const hue = 50 - grow*50;                 // jaune -> rouge quand ça monte
  ctx.lineWidth=6; ctx.strokeStyle="rgba(0,0,0,.45)";
  ctx.fillStyle=`hsl(${hue},100%,60%)`;
  const x=W/2, y=150;
  ctx.strokeText("COMBO ×"+combo, x, y);
  ctx.fillText("COMBO ×"+combo, x, y);
  ctx.font=`700 ${Math.round(size*0.42)}px Segoe UI, sans-serif`;
  ctx.fillStyle="rgba(255,255,255,.85)";
  ctx.fillText("gains ×"+comboMult().toFixed(2), x, y+size*0.55);
  ctx.restore();
}

function drawSky(){
  // dégradé coucher de soleil
  const g = ctx.createLinearGradient(0,0,0,DOCK_Y);
  g.addColorStop(0,   "#7b6aa8");   // violet haut
  g.addColorStop(0.45,"#c98fb0");   // mauve
  g.addColorStop(0.72,"#f0a987");   // orange
  g.addColorStop(1,   "#fbd9a5");   // doré bas
  ctx.fillStyle=g; ctx.fillRect(0,0,W,DOCK_Y);
  // soleil + halo
  const sx=W-200, sy=130, r=46;
  const halo=ctx.createRadialGradient(sx,sy,0,sx,sy,150);
  halo.addColorStop(0,"rgba(255,240,200,.9)"); halo.addColorStop(1,"rgba(255,240,200,0)");
  ctx.fillStyle=halo; ctx.beginPath(); ctx.arc(sx,sy,150,0,7); ctx.fill();
  ctx.fillStyle="#fff3cf"; ctx.beginPath(); ctx.arc(sx,sy,r,0,7); ctx.fill();
}
function drawLake(){
  // dégradé : pâle (reflet du ciel) au loin -> profond au premier plan
  const g=ctx.createLinearGradient(0,HORIZON,0,H);
  g.addColorStop(0,   "#d7c2cf");   // rive lointaine, reflet coucher de soleil
  g.addColorStop(0.12,"#a7a9c4");
  g.addColorStop(0.32,"#5d8fb0");
  g.addColorStop(0.62,"#266a93");
  g.addColorStop(1,   "#0b3d5a");   // profond
  ctx.fillStyle=g; ctx.fillRect(0,HORIZON,W,H-HORIZON);
  // ligne d'horizon lumineuse (rive)
  ctx.fillStyle="rgba(255,238,205,.45)"; ctx.fillRect(0,HORIZON,W,2);
  // reflet du soleil (colonne verticale qui s'élargit en descendant)
  const rx=W-200;
  for(let i=0;i<16;i++){
    const yy=HORIZON+4+i*((H-HORIZON)/16);
    const ww=40+i*15+Math.sin(waveT*2+i)*12;
    ctx.fillStyle=`rgba(255,233,178,${Math.max(0,0.26-i*0.014)})`;
    ctx.fillRect(rx-ww/2, yy, ww, 5);
  }
  // silhouettes sous-marines qui dérivent (premier plan)
  if (SPRITES.shadow_fish){
    ctx.globalAlpha=0.16; const t=waveT*8;
    drawSprite("shadow_fish", (t%(W+300))-150,          H-120, 120, 0.5,0.5, 1);
    drawSprite("shadow_fish", W-((t*0.7)%(W+300))+150,  H-55,  90,  0.5,0.5, -1);
    ctx.globalAlpha=1;
  }
  // écume au premier plan (devant le ponton)
  ctx.fillStyle="rgba(255,255,255,.28)";
  for(let row=0;row<3;row++){ const yy=WATER_Y+10+row*30; const off=(Math.floor(waveT*8)+row*5)%14;
    for(let x=-off*PX;x<W;x+=14*PX){ ctx.fillRect(q(x),yy,7*PX,PX); } }
  if (isFishing){ ctx.fillStyle=`rgba(255,255,255,${0.08+0.05*Math.sin(waveT*4)})`;
    ctx.fillRect(0,WATER_Y,W,H-WATER_Y); }
}
function drawDock(){
  const top = DOCK_Y - 6;
  if (SPRITES.plank){
    const s=SPRITES.plank;
    const srcH = Math.round(s.h*0.55);          // partie haute = planches (sans le bord sombre)
    const surfH = 40;                            // surface fine où l'on se tient
    const tw = Math.round(surfH * s.w/srcH);
    const faceTop = top + surfH - 2;
    // face avant : texture dock_side tuilée (fond de secours pour éviter tout trou)
    ctx.fillStyle="#3a2817"; ctx.fillRect(0, faceTop, W, WATER_Y+8-faceTop);
    if (SPRITES.dock_side) drawLayer("dock_side", WATER_Y+8, WATER_Y+8-faceTop);
    // surface en planches : texture recadrée + répétée en tuiles
    for (let x=0; x<W; x+=tw){ ctx.drawImage(s.img, 0,0,s.w,srcH, x, top, tw+1, surfH); }
    ctx.fillStyle="rgba(0,0,0,.30)"; ctx.fillRect(0, top+surfH-3, W, 4);  // ombre sous la surface
  } else {
    ctx.fillStyle="#b07c44"; ctx.fillRect(0,DOCK_Y,W,60);
  }
  // poteaux de soutien (sprite, dans l'eau au premier plan)
  for (const px of [110, 470, 820, HOLE_X+70]){
    if (SPRITES.post) drawSprite("post", px, H+8, H-(WATER_Y-14), 0.5, 1);
    else { ctx.fillStyle="#6b4a2b"; ctx.fillRect(px-10, WATER_Y-6, 20, H); }
  }
}
function drawConveyor(){
  const y = DOCK_Y-6;
  ctx.fillStyle="#2b2f36"; ctx.fillRect(CONV_X1,y-8,CONV_X2-CONV_X1,18);
  ctx.fillStyle="#454b54";
  const off = (Math.floor(waveT*40))%30;
  for (let x=CONV_X1; x<CONV_X2; x+=30){ ctx.fillRect(x+off,y-6,16,14); }
  ctx.fillStyle="#1c1f24";
  ctx.beginPath(); ctx.arc(CONV_X1,y+1,11,0,7); ctx.arc(CONV_X2,y+1,11,0,7); ctx.fill();
  ctx.fillStyle="rgba(120,255,180,.5)";
  for (let x=CONV_X1+40; x<CONV_X2-20; x+=90){
    ctx.beginPath(); ctx.moveTo(x,y-2); ctx.lineTo(x+14,y+1); ctx.lineTo(x,y+4); ctx.fill(); }
}
function drawHole(){
  const frenzy = frenzyUntil>now();
  if (lvl("vortex")){
    const w=hole.holeW;
    ctx.save(); ctx.translate(HOLE_X, DOCK_Y-4);
    ctx.fillStyle="#05060a"; ctx.beginPath(); ctx.ellipse(0,0,w*0.9,34,0,0,7); ctx.fill();
    ctx.strokeStyle="rgba(150,80,255,.7)"; ctx.lineWidth=4;
    for (let i=0;i<3;i++){ ctx.beginPath();
      ctx.ellipse(0,0,(w*0.7)*(1-i*0.25),26*(1-i*0.2),waveT*1.5+i,0,7); ctx.stroke(); }
    ctx.restore();
    return;
  }
  // tonneau (sprite) — grandit légèrement avec le niveau du trou
  if (frenzy){
    const gl=ctx.createRadialGradient(HOLE_X,DOCK_Y-30,0,HOLE_X,DOCK_Y-30,120);
    gl.addColorStop(0,"rgba(255,170,40,.55)"); gl.addColorStop(1,"rgba(255,170,40,0)");
    ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(HOLE_X,DOCK_Y-30,120,0,7); ctx.fill();
  }
  drawSprite("barrel", HOLE_X, DOCK_Y+18, barrelHeight(), 0.5, 1);
}
function drawLantern(){
  if (!SPRITES.lantern) return;
  const lx=CAT_X+96, ly=DOCK_Y+4;
  // lueur chaude
  const gl=ctx.createRadialGradient(lx,ly-40,0,lx,ly-40,70);
  gl.addColorStop(0,`rgba(255,180,80,${0.30+0.06*Math.sin(waveT*3)})`);
  gl.addColorStop(1,"rgba(255,180,80,0)");
  ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(lx,ly-40,70,0,7); ctx.fill();
  drawSprite("lantern", lx, ly, 74, 0.5, 1);
}
function drawCat(){
  // ombre
  ctx.fillStyle="rgba(0,0,0,.20)";
  ctx.beginPath(); ctx.ellipse(CAT_X, DOCK_Y+6, 52, 10, 0, 0, 7); ctx.fill();
  const pose = (isFishing || drag.active) ? "cat_cast" : "cat_idle";
  const bob = isFishing ? Math.sin(waveT*3)*2 : 0;
  if (SPRITES[pose]) drawSprite(pose, CAT_X, DOCK_Y+8+bob, 172, 0.5, 1);
  else { ctx.fillStyle="#888"; ctx.beginPath(); ctx.arc(CAT_X,DOCK_Y-40,30,0,7); ctx.fill(); }
}
function drawRake(){
  if (!rake) return;
  const held = rakeDrag;
  ctx.save();
  ctx.translate(rake.position.x, rake.position.y);
  ctx.rotate(rake.angle);
  // halo léger quand on le tient
  if (held){
    const gl=ctx.createRadialGradient(0,0,0,0,0,80);
    gl.addColorStop(0,"rgba(255,236,180,.30)"); gl.addColorStop(1,"rgba(255,236,180,0)");
    ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(0,0,80,0,7); ctx.fill();
  }
  // manche en bois (part de la tête vers le haut-gauche)
  ctx.lineCap="round";
  ctx.strokeStyle="#6b4423"; ctx.lineWidth=10;
  ctx.beginPath(); ctx.moveTo(0,-2); ctx.lineTo(-10,-78); ctx.stroke();
  ctx.strokeStyle="#a9743b"; ctx.lineWidth=5;
  ctx.beginPath(); ctx.moveTo(0,-2); ctx.lineTo(-10,-78); ctx.stroke();
  // tête (barre)
  ctx.fillStyle="#8a5a2b"; ctx.strokeStyle="#5e3c1a"; ctx.lineWidth=2;
  roundRect(-RAKE_HEAD_W/2,-RAKE_HEAD_H/2,RAKE_HEAD_W,RAKE_HEAD_H,5); ctx.fill(); ctx.stroke();
  // dents
  ctx.fillStyle="#6b4423";
  for (let x=-RAKE_HEAD_W/2+8; x<=RAKE_HEAD_W/2-8; x+=14){
    ctx.fillRect(x-2, RAKE_HEAD_H/2-2, 5, 16);
  }
  ctx.restore();
}
function drawFish(f){
  const sp = SPECIES[f.species];
  // poisson doré = sprite dédié ; sinon sprite de l'espèce
  const spr = (f.golden && SPRITES.fish_gold) ? SPRITES.fish_gold : SPRITES["fish_"+f.species];
  ctx.save();
  ctx.translate(f.position.x, f.position.y);
  ctx.rotate(f.angle);
  ctx.scale(f.flip, 1);
  if (f.golden){ ctx.shadowColor="#ffcf3a"; ctx.shadowBlur=16; }
  if (spr){
    const dw = sp.w*2.3, dh = dw * spr.h/spr.w;
    const src = (f.golden && !SPRITES.fish_gold && spr.gold) ? spr.gold : spr.img;
    ctx.drawImage(src, -dw/2, -dh/2, dw, dh);
  } else {
    const w=sp.w,h=sp.h; ctx.fillStyle=f.golden?"#ffd54a":sp.color;
    ctx.beginPath(); ctx.ellipse(0,0,w/2,h/2,0,0,7); ctx.fill();
  }
  ctx.restore();
}
function drawFishingGauge(){
  if (fishingProgress<=0) return;
  const pct = Math.min(1, fishingProgress/fishInterval());
  const x=pointer.x, y=pointer.y-40;
  ctx.fillStyle="rgba(0,0,0,.5)"; roundRect(x-34,y-8,68,12,6); ctx.fill();
  ctx.fillStyle=pct>=1?"#46d17a":"#ffcf57"; roundRect(x-32,y-6,64*pct,8,4); ctx.fill();
}

/* ---------------- Particules + textes flottants -------------------------- */
const particles=[], floats=[];
function spawnCoinBurst(x,y,golden){
  for (let i=0;i<(golden?16:8);i++){
    particles.push({ x,y,
      vx:(Math.random()-0.5)*6, vy:-Math.random()*7-2,
      life:1, color: golden?"#ffd54a":"#ffcf57", r:Math.random()*3+2 });
  }
}
function floatText(x,y,txt,color){ floats.push({x,y,txt,color,life:1}); }

// éclaboussures (animation 4 frames)
const splashes=[];
const SPLASH_MS=90, SPLASH_LIFE=420;
function spawnSplash(x,y,scale=1){ splashes.push({x,y,scale,t:0}); }
function drawSplashes(){
  for (const s of splashes){
    const fi=Math.min(3, Math.floor(s.t/SPLASH_MS));
    const spr=SPRITES["splash_"+fi]; if(!spr) continue;
    const h=48*s.scale, w=h*spr.w/spr.h;
    ctx.globalAlpha=Math.max(0, 1-s.t/SPLASH_LIFE);
    ctx.drawImage(spr.img, s.x-w/2, s.y-h*0.72, w, h);
    ctx.globalAlpha=1;
  }
}

function updateParticles(dt){
  const k=dt/16.6;
  for (let i=splashes.length-1;i>=0;i--){
    splashes[i].t+=dt; if (splashes[i].t>SPLASH_LIFE) splashes.splice(i,1);
  }
  for (let i=particles.length-1;i>=0;i--){
    const p=particles[i];
    p.vy+=0.4*k; p.x+=p.vx*k; p.y+=p.vy*k; p.life-=0.02*k;
    if (p.life<=0) particles.splice(i,1);
  }
  for (let i=floats.length-1;i>=0;i--){
    floats[i].y-=0.6*k; floats[i].life-=0.012*k;
    if (floats[i].life<=0) floats.splice(i,1);
  }
}
function drawParticles(){
  for (const p of particles){
    ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=p.color;
    if (PIXEL_ART){ const s=q(p.r*2); ctx.fillRect(q(p.x)-s/2, q(p.y)-s/2, s, s); }
    else { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,7); ctx.fill(); }
  }
  ctx.globalAlpha=1;
}
function drawFloatTexts(){
  ctx.textAlign="center"; ctx.font="bold 22px Segoe UI";
  for (const f of floats){
    ctx.globalAlpha=Math.max(0,f.life);
    ctx.fillStyle="rgba(0,0,0,.4)"; ctx.fillText(f.txt,f.x+1,f.y+1);
    ctx.fillStyle=f.color; ctx.fillText(f.txt,f.x,f.y);
  }
  ctx.globalAlpha=1;
}

/* ---------------- Utilitaires de dessin ---------------------------------- */
function roundRect(x,y,w,h,r){ ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

/* ========================================================================= *
   COMPÉTENCE ACTIVE — Épuisette (pluie de poissons)
 * ========================================================================= */
const netBtn = document.getElementById("net-btn");
let netCdUntil = 0; const NET_CD = 15000;
netBtn.addEventListener("click", () => {
  if (now() < netCdUntil || !lvl("net")) return;
  netCdUntil = now()+NET_CD;
  let i=0;
  const rain = setInterval(()=>{
    spawnFish(CONV_X1 + Math.random()*(HOLE_X-CONV_X1), -40, rollSpecies());
    if (++i>=10) clearInterval(rain);
  }, 80);
});


/* ========================================================================= *
   INTERFACE — Boutique / Prestige / HUD
 * ========================================================================= */
let uiDirty=true;
const $ = id => document.getElementById(id);

function makeNode(def, kind){
  const n=document.createElement("div");
  n.className="node"; n.dataset.id=(kind==="perm"?"perm-":"")+def.id;
  n.innerHTML=`
    <div class="spine"></div>
    <button class="badge"><span class="bemoji">${def.emoji}</span><span class="block">🔒</span></button>
    <div class="body">
      <div class="nrow"><span class="nname">${def.name}</span><span class="nlvl"></span></div>
      <div class="ndesc"></div>
      <button class="nbuy"></button>
    </div>`;
  const act = kind==="perm" ? ()=>buyPerm(def) : ()=>buy(def);
  n.querySelector(".badge").addEventListener("click", e=>{ e.stopPropagation(); act(); });
  n.querySelector(".nbuy").addEventListener("click", e=>{ e.stopPropagation(); act(); });
  return n;
}
let nodePhase = {};       // id de l'amélioration -> index de phase
function buildShop(){
  const list = $("shop-list"); list.innerHTML=""; list.className="tree";
  let ph=-1;
  for (const def of SHOP){
    if (def.phase){
      ph++;
      const t=document.createElement("div"); t.className="tier"; t.dataset.phase=ph;
      t.innerHTML=`<span class="tdot"></span><span class="tlabel">${def.phase}</span>`;
      list.appendChild(t); continue;
    }
    nodePhase[def.id]=ph;
    const n=makeNode(def, "shop"); n.dataset.phase=ph;
    list.appendChild(n);
  }
  const perm=$("perm-list"); perm.innerHTML=""; perm.className="tree";
  for (const def of PERM) perm.appendChild(makeNode(def, "perm"));
}
// phase la plus avancée atteinte (un nœud y est déverrouillé) + 1 en aperçu
function revealLimit(){
  let active=0;
  for (const def of SHOP){ if(def.phase) continue; if(unlocked(def)) active=Math.max(active, nodePhase[def.id]); }
  return active+1;
}

function unlocked(def){
  // dépendances de déblocage
  if (def.id==="hole")     return lvl("bait")>=2 || lvl("magnet")>=1;
  if (def.id==="school")   return lvl("hole")>=1;
  if (def.id==="globebait")return lvl("hole")>=2;
  if (def.id==="conveyor") return lvl("hole")>=1;
  if (def.id==="net")      return lvl("hole")>=1;
  if (def.id==="auto")     return lvl("conveyor")>=1;
  if (def.id==="autospeed")return lvl("auto")>=1;
  if (def.id==="boost")    return lvl("conveyor")>=1;
  if (def.id==="frenzy")   return lvl("auto")>=1;
  if (def.id==="vortex")   return lvl("frenzy")>=1;
  return true;
}

function buy(def){
  const lv=lvl(def.id);
  if (lv>=def.max || !unlocked(def)) return;
  const c=cost(def,lv);
  if (S.money<c) return;
  S.money-=c; S.up[def.id]=lv+1;
  Sound.buy();
  onUpgrade(def.id);
  uiDirty=true; refreshShop();
}
function buyPerm(def){
  const lv=plvl(def.id);
  if (lv>=def.max) return;
  const c=cost(def,lv);
  if (S.gold<c) return;
  S.gold-=c; S.perm[def.id]=lv+1;
  Sound.buy();
  uiDirty=true; refreshShop();
}

function onUpgrade(id){
  if (id==="hole"){ Composite.remove(world,hole); hole=makeHole(); Composite.add(world,hole); }
  if (id==="net" && lvl("net")) netBtn.hidden=false;
  if (id==="rake") ensureRake();
  toast("Amélioration achetée !");
}

function setNode(n, {locked, maxed, afford, lvlTxt, descTxt, btnTxt, btnDisabled}){
  n.classList.toggle("locked", !!locked);
  n.classList.toggle("maxed", !!maxed);
  n.classList.toggle("afford", !!afford);
  n.classList.toggle("cant", !locked && !maxed && !afford);
  n.querySelector(".nlvl").textContent = lvlTxt;
  n.querySelector(".ndesc").textContent = descTxt;
  const b=n.querySelector(".nbuy"); b.textContent=btnTxt; b.disabled=btnDisabled;
}
function refreshShop(){
  // phases trop en avance = "mystère" (verrouillé, texte flouté)
  const reveal = revealLimit();
  $("shop-list").querySelectorAll(".tier").forEach(t=>{
    t.classList.toggle("mystery", (+t.dataset.phase) > reveal);
  });
  for (const def of SHOP){
    if (def.phase) continue;
    const n=document.querySelector(`.node[data-id="${def.id}"]`); if(!n) continue;
    if (nodePhase[def.id] > reveal){
      n.classList.add("mystery");
      n.classList.remove("locked","afford","cant","maxed");
      n.querySelector(".ndesc").textContent = "Amélioration à débloquer plus tard…";
      const b=n.querySelector(".nbuy"); b.textContent="🔒"; b.disabled=true;
      continue;        // on garde le vrai nom (flouté par le CSS)
    }
    n.classList.remove("mystery");
    const lv=lvl(def.id), un=unlocked(def), maxed=lv>=def.max, c=cost(def,lv);
    setNode(n, {
      locked:!un, maxed, afford: un&&!maxed&&S.money>=c,
      lvlTxt: def.max>1?`Niv ${lv}/${def.max}`:(lv?"✓ Actif":""),
      descTxt: un?def.desc(lv):"Continue de progresser pour débloquer",
      btnTxt: maxed?"MAX":(un?`${fmt(c)} $`:"🔒 Verrouillé"),
      btnDisabled: maxed||!un,
    });
  }
  for (const def of PERM){
    const n=document.querySelector(`.node[data-id="perm-${def.id}"]`); if(!n) continue;
    const lv=plvl(def.id), maxed=lv>=def.max, c=cost(def,lv);
    setNode(n, {
      locked:false, maxed, afford: !maxed&&S.gold>=c,
      lvlTxt:`Niv ${lv}/${def.max}`, descTxt:def.desc(lv),
      btnTxt: maxed?"MAX":`${fmt(c)} 🪙`, btnDisabled: maxed||S.gold<c,
    });
  }
  $("prestige-gain").textContent=fmt(prestigeGain());
  $("prestige-btn").disabled = prestigeGain()<1;
}

function refreshHUD(){
  $("money").textContent=fmt(Math.floor(S.money));
  $("rate").textContent=fmt(rateShown);
  $("gold").textContent=fmt(S.gold);
  $("gold-wrap").hidden = S.gold<=0 && plvl("pmult")===0 && prestigeGain()<1;
  $("frenzy-banner").hidden = frenzyUntil<=now();
  // cooldown épuisette
  if (lvl("net")){
    const cd = Math.max(0, netCdUntil-now());
    netBtn.classList.toggle("cooling", cd>0);
    netBtn.querySelector(".skill-cd").style.setProperty("--cd", (cd/NET_CD*100)+"%");
  }
  refreshShop();
}

/* ---------------- Prestige ----------------------------------------------- */
$("prestige-btn").addEventListener("click", ()=>{
  const g=prestigeGain();
  if (g<1) return;
  if (!confirm(`Sacrifier ton empire pour ${g} Écaille(s) d'Or ?\nTout (argent + machines) sera réinitialisé.`)) return;
  Sound.prestige();
  S.gold+=g;
  S.up={}; S.money=startMoney(); S.earnedThisRun=0;
  fishes.slice().forEach(removeFish);
  Composite.remove(world,hole); hole=makeHole(); Composite.add(world,hole);
  netBtn.hidden=true; ensureRake(); frenzyUntil=0;
  toast(`+${g} 🪙 Écailles d'Or !`);
  uiDirty=true;
});

/* ========================================================================= *
   SAUVEGARDE
 * ========================================================================= */
const KEY="thehole_save";
const OFFLINE_MAX = 8*3600;   // plafond : 8 h de gains hors-ligne
const OFFLINE_EFF = 0.5;      // efficacité hors-ligne (incite à jouer activement)
function save(){ S.lastSaved = Date.now(); localStorage.setItem(KEY, JSON.stringify(S)); }
function load(){
  try{ const d=JSON.parse(localStorage.getItem(KEY));
    if (d) S=Object.assign(structuredClone(DEFAULT_STATE), d);
  }catch(e){}
}
// gains accumulés pendant l'absence (si la pêche est automatisée)
function applyOffline(){
  if (!S.lastSaved) return;
  const elapsed = Math.min(OFFLINE_MAX, (Date.now()-S.lastSaved)/1000);
  const rate = passivePerSec();
  const earned = rate * elapsed * OFFLINE_EFF;
  if (earned >= 1 && elapsed >= 30){
    S.money += earned; S.earnedThisRun += earned;
    const mins = Math.floor(elapsed/60);
    setTimeout(()=>toast(`🌙 Absent ${mins>59?Math.floor(mins/60)+'h'+(mins%60)+'m':mins+'min'} : +${fmt(earned)}$`), 600);
  }
}
setInterval(save, 8000);
window.addEventListener("beforeunload", save);
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) save(); });

$("save-btn").addEventListener("click", ()=>{ save(); toast("Partie sauvegardée 💾"); });
$("reset-btn").addEventListener("click", ()=>{
  if (!confirm("Tout effacer (y compris les Écailles d'Or) ?")) return;
  localStorage.removeItem(KEY); S=structuredClone(DEFAULT_STATE);
  fishes.slice().forEach(removeFish);
  Composite.remove(world,hole); hole=makeHole(); Composite.add(world,hole);
  netBtn.hidden=true; ensureRake(); uiDirty=true; refreshShop(); toast("Réinitialisé");
});

/* ---------------- Toast / hint ------------------------------------------- */
let toastT;
function toast(msg){
  let el=$("toast"); if(!el){ el=document.createElement("div"); el.id="toast"; document.body.appendChild(el);}
  el.textContent=msg; el.classList.add("show");
  clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove("show"),1800);
}
function hideHint(){ if(!S.seenHint){ S.seenHint=true; const h=$("hint"); h.style.opacity="0"; setTimeout(()=>h.remove(),700);} }

/* ---------------- Tabs & shop drawer ------------------------------------- */
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(x=>x.classList.remove("active"));
  t.classList.add("active"); $("tab-"+t.dataset.tab).classList.add("active");
}));
$("shop-toggle").addEventListener("click",()=>$("shop").classList.add("open"));
$("shop-close").addEventListener("click",()=>$("shop").classList.remove("open"));
$("mute-btn").addEventListener("click", e=>{
  const m=Sound.toggle(); e.currentTarget.textContent=m?"🔇":"🔊";
  e.currentTarget.classList.toggle("muted",m);
});
$("rake-reset").addEventListener("click", ()=>{ respawnRake(); toast("Râteau replacé 🧹"); });

/* ---------------- Utils --------------------------------------------------- */
function now(){ return performance.now(); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function fmt(n){
  n=Math.floor(n);
  if (n<1000) return ""+n;
  const u=["","K","M","B","T","Qa","Qi","Sx","Sp","Oc","No","Dc"]; let i=0;
  while (n>=1000 && i<u.length-1){ n/=1000; i++; }
  return (n<10?n.toFixed(2):n<100?n.toFixed(1):Math.floor(n))+u[i];
}

/* ========================================================================= *
   DÉMARRAGE
 * ========================================================================= */
load();
if (S.up.net) netBtn.hidden=false;
ensureRake();
if (S.money===0 && S.earnedThisRun===0) S.money=startMoney();
applyOffline();          // gains accumulés pendant l'absence
buildShop();
resize();
refreshHUD();
requestAnimationFrame(loop);
