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
const CONV_X1  = 470, CONV_X2 = 1055;   // zone de pluie de l'épuisette (net)

/* ---------------- État du jeu -------------------------------------------- */
const DEFAULT_STATE = {
  money: 0,
  gold: 0,
  earnedThisRun: 0,
  totalCaught: 0,
  totalEarned: 0,        // argent gagné sur toute la vie (≠ run)
  bestCombo: 0,          // meilleur combo atteint
  prestiges: 0,          // nombre de sacrifices
  caught: {},            // nb de prises par espèce (bestiaire)
  questTier: {},         // palier courant par chaîne de quête
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
  { id:"magnet",emoji:"🧲", name:"Aimant", base:600, mult:12, max:5,
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
  { id:"treasure", emoji:"🗺️", name:"Carte au Trésor", base:120000, mult:2.5, max:6,
    desc:l=>lvl("hole")<2?`Nécessite le Trou niveau 2`
                         :`Apparition des Coffres (jackpot lourd) : ${(coffreRate()*100).toFixed(1)}%`,
  },
  { id:"net",   emoji:"🪣", name:"Épuisette (actif)", base:7500, mult:1, max:1,
    desc:l=>l===0?`Compétence : fait pleuvoir 10 poissons`:`Compétence débloquée ✓`,
  },

  { phase:"Phase 3 — L'Usine" },
  { id:"auto",  emoji:"🤖", name:"Machine à Pêcher", base:60000, mult:1, max:1,
    desc:l=>l===0?`Pêche seule, 1 poisson / 3 s — à toi (ou à la Mouette) de les déposer`:`Pêche auto active ✓`,
  },
  { id:"autospeed", emoji:"⚡", name:"Survolteur de Machine", base:45000, mult:1.65, max:12,
    desc:l=>`Cadence de la machine. Délai : ${(autoInterval()/1000).toFixed(2)}s`,
  },
  { id:"frenzy",emoji:"🔥", name:"Mult. Frénétique", base:750000, mult:1, max:1,
    desc:l=>l===0?`+10 poissons/s dans le trou ⇒ gains ×2 (5s)`:`Frénésie active ✓`,
  },

  { phase:"Phase 4 — La Volière" },
  { id:"wall",  emoji:"🧱", name:"Mur Rebond", base:1500000, mult:2.4, max:5,
    req:()=>`Nécessite la Frénésie`,
    desc:l=>l===0?`Dresse un mur derrière le seau : les poissons trop lancés rebondissent vers le trou`
                 :`Mur niv ${l} • rebond ×${wallBounce().toFixed(2)} • +haut`,
  },
  { id:"gull",  emoji:"🐦", name:"Mouette Apprivoisée", base:6000000, mult:1, max:1,
    req:()=>`Nécessite 1 sacrifice 🌀`,
    desc:l=>l===0?`Engage une mouette : elle plonge régulièrement déposer un poisson dans le seau (débloque ses pouvoirs)`
                 :`Mouette active ✓ — porte ${gullCarry()} poisson(s), toutes les ${(gullInterval()/1000).toFixed(1)}s`,
  },
  { id:"gullspeed", emoji:"🪶", name:"Vol Rapide", base:1500000, mult:1.9, max:8,
    req:()=>`Nécessite la Mouette`,
    desc:l=>`Mouette plus rapide & fréquente — passage toutes les ${(gullInterval()/1000).toFixed(1)}s`,
  },
  { id:"gullcarry", emoji:"🎒", name:"Bec Vorace", base:4000000, mult:2.4, max:5,
    req:()=>`Nécessite la Mouette`,
    desc:l=>`La mouette emporte ${gullCarry()} poisson(s) par voyage`,
  },
  { id:"royal", emoji:"👑", name:"Leurre Royal", base:9000000, mult:2.9, max:6,
    req:()=>`Nécessite le Trou niveau 3`,
    desc:l=>`Apparition du Poisson-Roi (légendaire fugace) : ${(roiRate()*100).toFixed(2)}%`,
  },

  { phase:"Phase 5 — Le Vortex" },
  { id:"vortex",emoji:"🌀", name:"Le Vortex", base:400000000, mult:1, max:1,
    req:()=>`Nécessite 3 sacrifices 🌀 + la Mouette`,
    desc:l=>l===0?`Le trou aspire tous les poissons alentour. L'aboutissement — il faudra plusieurs sacrifices pour se l'offrir.`:`Vortex actif ✓`,
  },
];

const PERM = [
  { id:"pmult", emoji:"✨", name:"Gains Éternels", base:3, mult:1.45, max:60,
    desc:l=>`+${Math.round((permMult()-1)*100)}% à tous les gains (permanent) • +2% / palier`,
  },
  { id:"pgold", emoji:"🐠", name:"Poissons Dorés", base:5, mult:3, max:10,
    desc:l=>`+1% de poissons dorés / palier → ${(goldenChance()*100).toFixed(0)}% (×100 valeur)`,
  },
  { id:"pstart",emoji:"💼", name:"Pécule de Départ", base:4, mult:2.6, max:12,
    desc:l=>`Commence chaque run avec ${fmt(startMoney())}$`,
  },
  { id:"pfrenzy", emoji:"🔥", name:"Frénésie Prolongée", base:8, mult:2.4, max:8,
    desc:l=>`Frénésie : ${(frenzyDur()/1000).toFixed(0)}s, seuil ${frenzyThreshold()} poissons/s`,
  },
  { id:"pcombo", emoji:"⚡", name:"Combo Tenace", base:8, mult:2.4, max:8,
    desc:l=>`Fenêtre de combo ${(comboWindow()/1000).toFixed(1)}s • bonus max ×${comboMaxMult().toFixed(2)}`,
  },
  { id:"pmagnet", emoji:"🧲", name:"Tonneau Aimanté", base:12, mult:2.6, max:10,
    desc:l=>l===0?`Le tonneau attire les poissons proches`:`Attraction du tonneau niv ${l}`,
  },
  { id:"pmachine", emoji:"🤖", name:"Flotte de Machines", base:20, mult:3, max:8,
    desc:l=>`${autoMachines()} machine(s) à pêcher en parallèle`,
  },
];

/* ---------------- Quêtes / Objectifs ------------------------------------- */
// Chaînes de paliers : on affiche le palier courant ; le réclamer fait avancer.
const QUESTS = [
  { id:"catch", emoji:"🎣", name:"Pêcheur émérite", unit:"poissons", metric:()=>S.totalCaught,
    tiers:[ {goal:25,money:200},{goal:150,money:2500},{goal:750,money:30000},
            {goal:3000,gold:1},{goal:12000,gold:3},{goal:50000,gold:8},{goal:200000,gold:20} ] },
  { id:"earn", emoji:"💰", name:"Magnat du poisson", unit:"$ gagnés", big:true, metric:()=>S.totalEarned,
    tiers:[ {goal:1000,money:600},{goal:50000,money:9000},{goal:1e6,gold:2},
            {goal:5e7,gold:5},{goal:1e9,gold:12},{goal:1e11,gold:30},{goal:1e13,gold:75} ] },
  { id:"combo", emoji:"🔥", name:"Roi du combo", unit:"combo", metric:()=>S.bestCombo,
    tiers:[ {goal:5,money:400},{goal:15,money:6000},{goal:30,gold:1},{goal:50,gold:3},{goal:80,gold:8} ] },
  { id:"prestige", emoji:"🌀", name:"Maître du sacrifice", unit:"sacrifices", metric:()=>S.prestiges,
    tiers:[ {goal:1,gold:2},{goal:3,gold:5},{goal:7,gold:12},{goal:15,gold:30},{goal:30,gold:75} ] },
];
/* ---------------- Bestiaire ---------------------------------------------- */
// Collectionner les espèces récompense par un bonus de gains PERMANENT.
// Chaque palier de capture franchi (par espèce) ajoute +2% aux gains.
const BEST_TIERS = [10, 100, 1000, 10000];
const BEST_BONUS = 0.02;
const BESTIARY = [
  { key:"sardine", emoji:"🐟", blurb:"L'ordinaire du ponton. Abondante et docile." },
  { key:"saumon",  emoji:"🐠", blurb:"Plus gros, plus rare. Apparaît dès le trou niv 1." },
  { key:"globe",   emoji:"🐡", blurb:"Léger et rebondissant, belle valeur. Trou niv 2." },
  { key:"meduse",  emoji:"🪼", blurb:"Urticante ! Elle flotte et s'échappe par le haut. Tenue trop longtemps, elle pique et casse ton combo — lance-la vite." },
  { key:"crabe",   emoji:"🦀", blurb:"Évasif : il rampe sur le ponton en fuyant le trou. Attrape-le et lance-le vite avant qu'il ne replonge." },
  { key:"botte",   emoji:"🥾", blurb:"Un déchet sans valeur qui encombre le ponton. La jeter au trou ne rapporte rien et casse ton combo : écarte-la." },
  { key:"anguille",emoji:"🐍", blurb:"Glissante : elle se tortille et file hors de ta main. Difficile à garder et à viser." },
  { key:"coffre",  emoji:"🧰", blurb:"Jackpot. Si lourd qu'on ne peut pas le lancer à la main : pousse-le avec le râteau ou aspire-le au vortex." },
  { key:"roi",     emoji:"👑", blurb:"Légendaire ! Une fortune… mais il s'enfuit en quelques secondes. Une chasse éclair réservée à l'endgame (trou niv 3)." },
];
const discovered = key => (S.caught[key]||0) > 0;
function bestTiers(key){ const c=S.caught[key]||0; return BEST_TIERS.filter(g=>c>=g).length; }
function bestiaryTotalTiers(){ return BESTIARY.reduce((s,b)=>s+bestTiers(b.key),0); }
function bestiaryMult(){ return 1 + bestiaryTotalTiers()*BEST_BONUS; }

const qIdx = q => S.questTier[q.id] || 0;
const qCurrent = q => qIdx(q) < q.tiers.length ? q.tiers[qIdx(q)] : null;
function qClaimable(q){ const t=qCurrent(q); return t && q.metric() >= t.goal; }
function questsClaimable(){ return QUESTS.filter(qClaimable).length; }
function claimQuest(q){
  const t=qCurrent(q); if(!t || q.metric()<t.goal) return;
  if (t.money) S.money += t.money;
  if (t.gold)  S.gold  += t.gold;
  S.questTier[q.id] = qIdx(q)+1;
  Sound.gold();
  toast(`🎯 Objectif accompli ! +${t.gold?t.gold+" 🪙":fmt(t.money)+" $"}`);
  uiDirty=true;
}

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
function permMult(){ return 1 + plvl("pmult")*0.02; }   // +2% par palier (additif, lent)
function goldenChance(){ return plvl("pgold") * 0.01; }   // +1% par palier (max 10%)
function startMoney(){ return plvl("pstart") * 500 * Math.pow(2.5, plvl("pstart")); }
// prestige étendu
function frenzyDur(){ return 5000 + plvl("pfrenzy")*1500; }
function frenzyThreshold(){ return Math.max(5, 10 - plvl("pfrenzy")); }
function comboWindow(){ return COMBO_WINDOW + plvl("pcombo")*350; }
function comboMaxMult(){ return 1 + (40 + plvl("pcombo")*12)*0.025; }
function autoMachines(){ return 1 + plvl("pmachine"); }

// --- Phase 4 « La Volière » : mur rebond + mouette assistante ---
function wallHeight(){ return 80 + lvl("wall")*28; }                 // hauteur du mur (px monde)
function wallBounce(){ return Math.min(1, 0.7 + lvl("wall")*0.07); }  // restitution (rebond, ≤1)
function gullCarry(){ return 1 + lvl("gullcarry"); }                 // poissons par voyage
function gullInterval(){ return Math.max(2600, 11000 - lvl("gullspeed")*1200); }
function gullFlySpeed(){ return 5 + lvl("gullspeed")*0.9; }          // vitesse de vol

// Taux d'apparition des gros poissons : TRÈS rares de base, montés par leur palier dédié.
function saumonRate(){ return lvl("hole")>=1 ? 0.03 + lvl("school")*0.035 : 0; }   // 3% → ~24%
function globeRate(){  return lvl("hole")>=2 ? 0.008 + lvl("globebait")*0.018 : 0; } // 0.8% → ~12%
// Espèces "difficiles" : chacune apporte une friction différente, pas juste de la valeur.
function meduseRate(){   return lvl("hole")>=1 ? 0.05  : 0; }   // urticante (nuisance fréquente)
function crabeRate(){    return lvl("hole")>=1 ? 0.04  : 0; }   // fuit le trou (évasif)
function botteRate(){    return lvl("hole")>=1 ? 0.04  : 0; }   // déchet sans valeur (encombre)
function anguilleRate(){ return lvl("hole")>=2 ? 0.03  : 0; }   // glissante (drag qui lâche)
function coffreRate(){   return lvl("hole")>=2 ? 0.005 + lvl("treasure")*0.006 : 0; }  // 0.5% → ~4.1%
function roiRate(){      return lvl("hole")>=3 ? 0.002 + lvl("royal")*0.004    : 0; }  // 0.2% → ~2.6%

function gainMult(){ return baitMult() * holeMult() * permMult() * bestiaryMult() * (frenzyUntil > now() ? 2 : 1); }
function prestigeGain(){ return Math.floor(Math.sqrt(S.earnedThisRun / 4000000)); }

// valeur moyenne d'un poisson pêché (pondérée espèces + dorés) — pour les gains hors-ligne
function avgFishValue(){
  const rates = { roi:roiRate(), coffre:coffreRate(), globe:globeRate(), anguille:anguilleRate(),
                  botte:botteRate(), crabe:crabeRate(), meduse:meduseRate(), saumon:saumonRate() };
  // autoMul : fraction réellement encaissée par l'automatisation/hors-ligne.
  // Les espèces qui fuient (crabe), flottent (méduse) ou s'enfuient (roi) sont sous-pondérées
  // pour que les gains passifs restent honnêtes (le skill manuel en encaisse, lui, la pleine valeur).
  let v = 0, used = 0;
  for (const k in rates){ const sp=SPECIES[k]; v += rates[k]*sp.value*(sp.autoMul??1); used += rates[k]; }
  v += Math.max(0, 1-used) * SPECIES.sardine.value;
  return v * (1 + 99*goldenChance());
}
// revenu passif estimé ($/s) — la Mouette livre ce que la Machine pêche (Machine + Mouette).
// Sans mouette, rien n'est déposé tout seul : il faut jouer (râteau / lancer / vortex).
function passivePerSec(){
  if (!lvl("auto") || !lvl("gull")) return 0;
  const spawnRate = autoMachines() * 1000/autoInterval();   // poissons/s produits par la machine
  const gullRate  = gullCarry()    * 1000/gullInterval();   // poissons/s livrés par la mouette
  const rate = Math.min(spawnRate, gullRate);               // goulot = le plus lent des deux
  return rate * avgFishValue() * baitMult() * holeMult() * permMult() * bestiaryMult();
}

/* ---------------- Espèces de poissons ------------------------------------ */
const SPECIES = {
  sardine: { name:"Sardine",  value:1,   w:46, h:22, density:0.0012, color:"#b8c6d1", belly:"#eef3f7" },
  saumon:  { name:"Saumon",   value:12,  w:74, h:34, density:0.0020, color:"#ef7d5a", belly:"#ffd9c4" },
  globe:   { name:"Globe",    value:60,  w:48, h:46, density:0.0006, color:"#ffd54a", belly:"#fff1b0" },
  // Méduse : urticante. Flotte vers le haut et tente de s'échapper ; si on la
  // tient trop longtemps en main, elle pique → combo remis à zéro. À lancer vite.
  meduse:  { name:"Méduse",   value:30,  w:52, h:62, density:0.0006, color:"#bcd8f0", belly:"#ffd8e6", floaty:true, sting:true, autoMul:0.7 },
  // Coffre : jackpot LOURD. Quasi impossible à lancer à la main — il faut le
  // pousser (râteau / vortex). Très rare.
  coffre:  { name:"Coffre",   value:450, w:72, h:58, density:0.0140, color:"#caa15a", belly:"#ffe0a0", heavy:true },
  // Crabe : ÉVASIF. Marche latéralement et fuit le trou ; il faut l'attraper vite.
  crabe:   { name:"Crabe",    value:40,  w:58, h:44, density:0.0016, color:"#e8612e", belly:"#ffb47a", flees:true, autoMul:0.4 },
  // Anguille : GLISSANTE. Se tortille et glisse hors de la main (le drag se brise).
  anguille:{ name:"Anguille", value:80,  w:84, h:38, density:0.0014, color:"#2e6e66", belly:"#e8d49a", slippery:true },
  // Botte : DÉCHET. Valeur nulle, encombre le ponton et casse le rythme si jetée au trou.
  botte:   { name:"Vieille Botte", value:0, w:56, h:50, density:0.0022, color:"#7d7a4a", belly:"#9aa05a", junk:true },
  // Poisson-Roi : LÉGENDAIRE. Colossal mais disparaît en quelques secondes. Chasse éclair.
  roi:     { name:"Poisson-Roi", value:2500, w:96, h:48, density:0.0010, color:"#3aa0a8", belly:"#ffc24a", fleeting:true, autoMul:0.15 },
};
function rollSpecies(){
  let r = Math.random();
  // Espèces spéciales, des plus rares aux plus communes (chacune retranchée du tirage).
  for (const [key, rate] of [
        ["roi",      roiRate()],
        ["coffre",   coffreRate()],
        ["globe",    globeRate()],
        ["anguille", anguilleRate()],
        ["botte",    botteRate()],
        ["crabe",    crabeRate()],
        ["meduse",   meduseRate()],
        ["saumon",   saumonRate()] ]){
    if (r < rate) return key;
    r -= rate;
  }
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
    zap(){ tone(300,0.18,"sawtooth",0.5,70); noise(0.12,0.35); },
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
const STING_MS=1600;          // délai avant qu'une méduse tenue ne pique
const ROI_TTL=6000;           // durée de vie d'un poisson-roi avant qu'il ne s'enfuie
const comboMult = () => 1 + Math.min(combo, 40 + plvl("pcombo")*12)*0.025;
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
// Tête plus HAUTE qu'avant : une vraie lame verticale qui pousse une pile de poissons.
const RAKE_HEAD_W = 30, RAKE_HEAD_H = 78;
function makeRake(){
  const r = Bodies.rectangle(CAT_X+150, DOCK_Y-RAKE_HEAD_H/2, RAKE_HEAD_W, RAKE_HEAD_H, {
    chamfer:{ radius:6 },
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

/* ---------------- Mur Rebond (Phase 4) ----------------------------------- */
// Mur statique derrière le seau : les poissons trop lancés rebondissent vers le trou.
let wall = null;
const WALL_X = HOLE_X + 98;
function ensureWall(){
  if (wall){ Composite.remove(world, wall); wall=null; }
  if (lvl("wall")){
    const h = wallHeight();
    wall = staticBox(WALL_X, DOCK_Y + 14 - h/2, 20, h, { restitution:wallBounce(), friction:0.15 });
    Composite.add(world, wall);
  }
}

/* ---------------- La Mouette (Phase 4, assistante) ----------------------- */
// Machine à états : attend hors-champ → fonce sur un poisson du ponton → l'emporte
// au-dessus du seau → le dépose dedans → repart. Pouvoirs : cadence & contenance.
let gull = { state:"away", t:0, x:-120, y:120, vx:0, vy:0, carried:[], wing:0 };
function gullCatchable(){
  return fishes.filter(f => !f.dragging && !f.scored && !f.carried
    && !SPECIES[f.species].junk && f.position.y > DOCK_Y-110 && f.position.x > 80 && f.position.x < WALL_X)
    .sort((a,b)=> b.baseValue - a.baseValue);
}
function gullDeliver(){
  for (const f of gull.carried){
    if (!f.scored && fishes.includes(f)){ f.dragging=false; f.carried=false; f.scored=true; scoreFish(f); }
  }
  gull.carried.length = 0;
}
function updateGull(dt){
  if (!lvl("gull")) return;
  const step = dt/16.6, sp = gullFlySpeed();
  gull.wing += dt*0.018;

  if (gull.state==="away"){
    gull.t += dt;
    if (gull.t >= gullInterval()){
      const prey = gullCatchable();
      if (prey.length){ gull.target=prey[0]; gull.state="incoming"; gull.x=-100; gull.y=90; gull.t=0; }
      else gull.t = gullInterval()*0.6;            // pas de proie : réessaie bientôt
    }
    return;
  }

  let tx, ty;
  if (gull.state==="incoming"){
    const f = gull.target;
    if (!f || !fishes.includes(f) || f.dragging || f.scored){ gull.target=null; gull.state="leaving"; }
    else { tx=f.position.x; ty=f.position.y-34; }
  }
  if (gull.state==="carrying"){ tx=HOLE_X; ty=DOCK_Y+18-barrelHeight()-34; }
  if (gull.state==="leaving"){  tx=W+150; ty=64; }

  const dx=tx-gull.x, dy=ty-gull.y, d=Math.hypot(dx,dy)||1;
  gull.vx=dx/d*sp; gull.vy=dy/d*sp;
  gull.x += gull.vx*step; gull.y += gull.vy*step;

  // poissons portés suivent la mouette
  gull.carried = gull.carried.filter(f=>fishes.includes(f));
  gull.carried.forEach((f,i)=>
    Body.setPosition(f, { x:gull.x+(i-(gull.carried.length-1)/2)*22, y:gull.y+36 }));

  if (gull.state==="incoming" && d<34){
    const grab = gullCatchable().slice(0, gullCarry());
    grab.forEach(g=>{ g.carried=true; g.dragging=true; });
    gull.carried = grab;
    gull.state = grab.length ? "carrying" : "leaving";
  } else if (gull.state==="carrying" && d<30){
    gullDeliver(); Sound.score(2); gull.state="leaving";
  } else if (gull.state==="leaving" && gull.x>W+130){
    gull.state="away"; gull.t=0; gull.carried.length=0; gull.target=null;
  }
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
  // Poisson-Roi : fugace — il s'enfuit s'il n'est pas pêché à temps.
  if (sp.fleeting) f.fleeUntil = now() + ROI_TTL;
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

  // Déchet (vieille botte) : aucun gain, et ça casse le combo — il faut apprendre
  // à NE PAS le jeter au trou. On le catalogue quand même (pour le bestiaire).
  if (SPECIES[f.species].junk){
    combo = 0;
    S.totalCaught++;
    S.caught[f.species] = (S.caught[f.species]||0) + 1;
    Sound.splash();
    floatText(f.position.x, f.position.y-20, "Beurk… +0$", "#9aa05a");
    spawnSplash(HOLE_X, DOCK_Y+18-barrelHeight()+24, 0.6);
    removeFish(f);
    uiDirty = true;
    return;
  }

  // combo : enchaîner les prises rapproche le multiplicateur
  combo = (t - lastScoreT < comboWindow()) ? combo+1 : 1;
  lastScoreT = t;

  const value = f.baseValue * gainMult() * comboMult();
  S.money += value;
  S.earnedThisRun += value;
  S.totalEarned += value;
  S.totalCaught++;
  S.caught[f.species] = (S.caught[f.species]||0) + 1;
  if (combo > S.bestCombo) S.bestCombo = combo;
  scoreTimes.push(t);
  moneyLog.push({t, v:value});

  // frénésie : >10 poissons / seconde
  const wasFrenzy = frenzyUntil > t;
  if (lvl("frenzy") && countRecent(1000) > frenzyThreshold()){
    frenzyUntil = t + frenzyDur();
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

/* ---------------- Vortex & forces sur les poissons (beforeUpdate) -------- */
Events.on(engine, "beforeUpdate", () => {
  for (const f of fishes){
    if (f.dragging) continue;

    // Méduse : flotte vers le haut et dérive — difficile à garder près du trou,
    // tend à s'échapper par le haut de l'écran si on ne la lance pas vite.
    if (SPECIES[f.species].floaty){
      // Monte doucement mais PLAFONNE : la méduse flotte vers une bande haute du
      // ponton puis y reste, attrapable — elle ne s'échappe plus par le haut.
      const CEIL = DOCK_Y - 150;                                  // ~322 : zone d'équilibre
      const lift = f.position.y > CEIL ? -1.03 : -0.45;           // remonte sous le plafond, retombe au-dessus
      Body.applyForce(f, f.position, { x:Math.sin(now()/600+f.wiggleT)*0.00006*f.mass,
                                       y: lift*engine.gravity.y*f.mass*0.001 });
      if (f.velocity.y < -3.2) Body.setVelocity(f, { x:f.velocity.x, y:-3.2 });  // bride la montée
    }

    // Crabe : ÉVASIF — il rampe sur le ponton en s'éloignant du trou et sautille,
    // luttant contre le râteau. Il faut l'attraper et le lancer à la main.
    if (SPECIES[f.species].flees && f.position.y > DOCK_Y-70){
      Body.applyForce(f, f.position, { x:-0.00014*f.mass, y:0 });   // marche à gauche (loin du trou)
      if (Math.random()<0.03) Body.setVelocity(f, { x:-3-Math.random()*2, y:-3 });  // petit saut latéral
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
    // Tonneau aimanté (prestige) : attraction douce et permanente vers le trou
    else if (plvl("pmagnet")>0){
      const R = 180 + plvl("pmagnet")*40;
      const d = Vector.sub({x:HOLE_X,y:DOCK_Y-18}, f.position);
      const dist = Vector.magnitude(d) || 1;
      if (dist < R){
        const pull = 0.00009 * f.mass * plvl("pmagnet") * (1 - dist/R);
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
    f.grabT=now();
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

// Méduse : la piqûre relâche tous les poissons tenus, casse le combo et secoue.
function stungBy(med){
  combo = 0;
  shake = Math.min(18, shake+10);
  Sound.zap();
  floatText(med.position.x, med.position.y-24, "⚡ AÏE !", "#c9a6ff");
  drag.fish.forEach(f=>{
    f.dragging=false;
    Body.setVelocity(f, { x:(Math.random()-0.5)*6, y:-6 });   // éjectés vers le haut
    Body.setAngularVelocity(f, (Math.random()-0.5)*0.4);
  });
  drag = { active:false, fish:[], offsets:[] };
}

// Anguille : glisse hors de la main, repart d'un coup de queue. Elle reste pêchée,
// il faut juste la rattraper (et viser le trou) malgré ses dérobades.
function slipsAway(eel){
  eel.dragging = false;
  Body.setVelocity(eel, { x:(Math.random()-0.5)*10, y:-4-Math.random()*3 });
  Body.setAngularVelocity(eel, (Math.random()-0.5)*0.6);
  Sound.splash();
  floatText(eel.position.x, eel.position.y-20, "↯ glisse !", "#7fe3c8");
  const i = drag.fish.indexOf(eel);
  if (i>=0){ drag.fish.splice(i,1); drag.offsets.splice(i,1); }
  if (!drag.fish.length) drag = { active:false, fish:[], offsets:[] };
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
      for (let m=0; m<autoMachines(); m++) doFish();   // flotte de machines (prestige)
    }
  }

  // --- Mouette assistante (Phase 4) ---
  updateGull(dt);

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
    // Méduse urticante : tenue trop longtemps en main, elle pique → combo perdu.
    if (drag.fish.some(f=>SPECIES[f.species].sting && t-f.grabT > STING_MS)){
      stungBy(drag.fish.find(f=>SPECIES[f.species].sting));
    } else {
      drag.fish.forEach((f,i)=>{
        // Anguille glissante : après un court instant en main, elle peut filer.
        if (SPECIES[f.species].slippery && t-f.grabT > 200 && Math.random() < 0.035){
          slipsAway(f); return;
        }
        const target = { x:pointer.x+drag.offsets[i].x, y:pointer.y+drag.offsets[i].y };
        const np = Vector.add(f.position, Vector.mult(Vector.sub(target,f.position), 0.5));
        Body.setPosition(f, np);
        Body.setVelocity(f, {x:0,y:0});
      });
    }
  }

  // --- Physique ---
  Engine.update(engine, 1000/60);

  // Poisson-Roi : s'enfuit si non pêché à temps (plonge vers l'eau)
  for (let i=fishes.length-1;i>=0;i--){
    const f=fishes[i];
    if (f.fleeUntil && !f.dragging && !f.scored && t>f.fleeUntil){
      spawnSplash(f.position.x, Math.max(WATER_Y, f.position.y), 1.1);
      floatText(f.position.x, f.position.y-24, "👑 s'enfuit !", "#ffc24a");
      Sound.splash(); removeFish(f); continue;
    }
    if (f.fleeUntil && !f.dragging && t>f.fleeUntil-2200){
      // dernières secondes : il frétille nerveusement (signal "attrape-moi vite !")
      Body.applyForce(f, f.position, { x:Math.sin(t/90+f.wiggleT)*0.0006*f.mass, y:-0.0002*f.mass });
    }
  }

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
  if (combo>0 && now()-lastScoreT > comboWindow()) combo=0;

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
             "fish_meduse","fish_coffre","fish_crabe","fish_anguille","fish_botte","fish_roi",
             "fish_gold","rake","gull","splash_0","splash_1","splash_2","splash_3"];
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
  // Fond plein écran : évite les bandes noires quand l'écran est plus haut que
  // le monde 16:9 (mobile portrait). Ciel en haut, eau en bas — prolonge la scène.
  if (oy > 1){
    const bg = ctx.createLinearGradient(0,0,0,canvas.height);
    bg.addColorStop(0,    "#6a5a96");
    bg.addColorStop(0.42, "#c98fb0");
    bg.addColorStop(0.58, "#5a86a0");
    bg.addColorStop(1,    "#21405a");
    ctx.fillStyle=bg; ctx.fillRect(0,0,canvas.width,canvas.height);
  }
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
  drawWall();                 // mur rebond (derrière le seau)
  drawHole();
  drawLantern();
  drawCat();
  fishes.forEach(drawFish);
  drawRake();
  drawGull();
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
    const gl=ctx.createRadialGradient(0,0,0,0,0,90);
    gl.addColorStop(0,"rgba(255,236,180,.30)"); gl.addColorStop(1,"rgba(255,236,180,0)");
    ctx.fillStyle=gl; ctx.beginPath(); ctx.arc(0,0,90,0,7); ctx.fill();
  }
  const spr = SPRITES.rake;
  if (spr){
    // sprite vertical (manche en haut, dents en bas). On aligne la zone dents+tête
    // sur le corps physique (barre verticale) ; le manche dépasse vers le haut.
    const dh = RAKE_HEAD_H / 0.45;            // dents+tête ≈ 45% de la hauteur du sprite
    const dw = dh * spr.w/spr.h;
    ctx.drawImage(spr.img, -dw/2, RAKE_HEAD_H/2 - dh, dw, dh);
  } else {
    ctx.fillStyle="#8a5a2b"; ctx.strokeStyle="#5e3c1a"; ctx.lineWidth=2;
    roundRect(-RAKE_HEAD_W/2,-RAKE_HEAD_H/2,RAKE_HEAD_W,RAKE_HEAD_H,5); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
function drawWall(){
  if (!wall) return;
  const h = wallHeight(), w = 26, x = WALL_X, top = DOCK_Y+14 - h;
  ctx.save();
  ctx.fillStyle="#6b4a2a"; ctx.strokeStyle="#3a2614"; ctx.lineWidth=3;
  roundRect(x-w/2, top, w, h, 5); ctx.fill(); ctx.stroke();
  ctx.strokeStyle="rgba(0,0,0,.22)"; ctx.lineWidth=2;
  for (let yy=top+14; yy<DOCK_Y; yy+=18){ ctx.beginPath(); ctx.moveTo(x-w/2+2,yy); ctx.lineTo(x+w/2-2,yy); ctx.stroke(); }
  ctx.fillStyle="rgba(255,221,150,.16)"; ctx.fillRect(x-w/2+2, top+2, 4, h-4);   // face éclairée (côté trou)
  ctx.restore();
}
function drawGull(){
  if (!lvl("gull") || gull.state==="away") return;
  const spr = SPRITES.gull;
  ctx.save();
  ctx.translate(gull.x, gull.y + Math.sin(gull.wing)*3);   // léger flottement
  ctx.scale(gull.vx>=0?1:-1, 1);
  if (spr){
    const dw = 104, dh = dw * spr.h/spr.w;
    ctx.drawImage(spr.img, -dw/2, -dh/2, dw, dh);
  } else {
    ctx.fillStyle="#f5f7fb"; ctx.strokeStyle="#2b3340"; ctx.lineWidth=3;
    ctx.beginPath(); ctx.ellipse(0,0,22,12,0,0,7); ctx.fill(); ctx.stroke();
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
  buildQuests();
  buildBestiary();
}

function buildQuests(){
  const list=$("quest-list"); list.innerHTML="";
  for (const q of QUESTS){
    const el=document.createElement("div"); el.className="quest"; el.dataset.id=q.id;
    el.innerHTML=`
      <div class="qtop"><span class="qemoji">${q.emoji}</span>
        <span class="qname">${q.name}</span><span class="qreward"></span></div>
      <div class="qbar"><div class="qfill"></div></div>
      <div class="qfoot"><span class="qprog"></span><button class="qclaim">Réclamer</button></div>`;
    el.querySelector(".qclaim").addEventListener("click", ()=>{ claimQuest(q); refreshQuests(); });
    list.appendChild(el);
  }
}
function refreshQuests(){
  let anyClaim=false;
  for (const q of QUESTS){
    const el=document.querySelector(`.quest[data-id="${q.id}"]`); if(!el) continue;
    const t=qCurrent(q);
    if (!t){   // chaîne terminée
      el.classList.add("done"); el.classList.remove("ready");
      el.querySelector(".qname").textContent=q.name+" — ✓ Maîtrisé";
      el.querySelector(".qreward").textContent="";
      el.querySelector(".qfill").style.width="100%";
      el.querySelector(".qprog").textContent="Tous les paliers atteints";
      const b=el.querySelector(".qclaim"); b.hidden=true;
      continue;
    }
    const val=q.metric(), pct=Math.min(100, val/t.goal*100), ready=val>=t.goal;
    const showVal = q.big?fmt(val):Math.floor(val), showGoal=q.big?fmt(t.goal):t.goal;
    el.classList.toggle("ready", ready);
    el.querySelector(".qreward").textContent = t.gold?`+${t.gold} 🪙`:`+${fmt(t.money)} $`;
    el.querySelector(".qfill").style.width=pct+"%";
    el.querySelector(".qprog").textContent=`${showVal} / ${showGoal} ${q.unit}`;
    const b=el.querySelector(".qclaim"); b.hidden=false; b.disabled=!ready;
    b.textContent = ready?"Réclamer 🎁":"En cours…";
    if (ready) anyClaim=true;
  }
  const dot=$("quest-dot"); if(dot) dot.hidden=!anyClaim;
}

function buildBestiary(){
  const list=$("bestiary-list"); if(!list) return; list.innerHTML="";
  for (const b of BESTIARY){
    const el=document.createElement("div"); el.className="beast"; el.dataset.key=b.key;
    el.innerHTML=`
      <div class="bthumb"><img src="assets/art/fish_${b.key}.png" alt="" draggable="false"></div>
      <div class="binfo">
        <div class="bname"></div>
        <div class="bblurb"></div>
        <div class="btiers"></div>
      </div>
      <div class="bcount"></div>`;
    list.appendChild(el);
  }
}
function refreshBestiary(){
  const sum=$("bestiary-bonus");
  if (sum) sum.textContent = `+${Math.round((bestiaryMult()-1)*100)}% gains permanents`;
  for (const b of BESTIARY){
    const el=document.querySelector(`.beast[data-key="${b.key}"]`); if(!el) continue;
    const sp=SPECIES[b.key], c=S.caught[b.key]||0, disc=discovered(b.key);
    el.classList.toggle("locked", !disc);
    el.querySelector(".bname").textContent  = disc ? `${b.emoji} ${sp.name}` : "❓ Espèce inconnue";
    el.querySelector(".bblurb").textContent = disc ? b.blurb : "Pas encore pêchée…";
    el.querySelector(".bcount").textContent = disc ? `×${fmt(c)}` : "";
    const tiers=el.querySelector(".btiers"); tiers.innerHTML="";
    BEST_TIERS.forEach(g=>{
      const d=document.createElement("span");
      d.className="bdot"+(c>=g?" on":"");
      d.title=`${fmt(g)} pêchés → +${Math.round(BEST_BONUS*100)}% gains`;
      d.textContent = c>=g ? "★" : "☆";
      tiers.appendChild(d);
    });
  }
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
  if (def.id==="treasure") return lvl("hole")>=2;
  if (def.id==="royal")    return lvl("hole")>=3;
  if (def.id==="net")      return lvl("hole")>=1;
  if (def.id==="auto")     return lvl("hole")>=2;
  if (def.id==="autospeed")return lvl("auto")>=1;
  if (def.id==="frenzy")   return lvl("auto")>=1;
  // Phase 4 — La Volière : la mouette exige un premier sacrifice (le prestige sert enfin !)
  if (def.id==="wall")     return lvl("frenzy")>=1;
  if (def.id==="gull")     return S.prestiges>=1 && lvl("frenzy")>=1;
  if (def.id==="gullspeed")return lvl("gull")>=1;
  if (def.id==="gullcarry")return lvl("gull")>=1;
  if (def.id==="royal")    return lvl("hole")>=3;
  // Phase 5 — Le Vortex : l'aboutissement, plusieurs sacrifices requis
  if (def.id==="vortex")   return S.prestiges>=3 && lvl("gull")>=1;
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
  if (id==="wall") ensureWall();
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
      descTxt: un?def.desc(lv):(def.req?def.req():"Continue de progresser pour débloquer"),
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
  refreshQuests();
  refreshBestiary();
}

/* ---------------- Prestige ----------------------------------------------- */
$("prestige-btn").addEventListener("click", ()=>{
  const g=prestigeGain();
  if (g<1) return;
  if (!confirm(`Sacrifier ton empire pour ${g} Écaille(s) d'Or ?\nTout (argent + machines) sera réinitialisé.`)) return;
  Sound.prestige();
  S.gold+=g; S.prestiges++;
  S.up={}; S.money=startMoney(); S.earnedThisRun=0;
  fishes.slice().forEach(removeFish);
  Composite.remove(world,hole); hole=makeHole(); Composite.add(world,hole);
  netBtn.hidden=true; ensureRake(); ensureWall(); frenzyUntil=0;
  gull.state="away"; gull.carried.length=0; gull.target=null;
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
  netBtn.hidden=true; ensureRake(); ensureWall(); uiDirty=true; refreshShop(); toast("Réinitialisé");
  gull.state="away"; gull.carried.length=0; gull.target=null;
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
ensureWall();
if (S.money===0 && S.earnedThisRun===0) S.money=startMoney();
applyOffline();          // gains accumulés pendant l'absence
buildShop();
resize();
refreshHUD();
requestAnimationFrame(loop);
