#!/usr/bin/env python3
"""Traite les sprites Gemini : détoure le fond magenta, retire l'étincelle
décorative (coin bas-droit), recadre au contenu, redimensionne proprement.
Sortie -> assets/art/ (PNG transparents prêts pour le jeu)."""

from PIL import Image, ImageChops, ImageDraw
import os

HERE = os.path.dirname(__file__)
SRC  = os.path.join(HERE, "..", "assets", "px")
OUT  = os.path.join(HERE, "..", "assets", "art")
os.makedirs(OUT, exist_ok=True)

# (fichier source, nom sortie, type, taille cible, declutter)
# type "obj" -> contraint la + grande dimension ; "ban" -> contraint la largeur
# declutter -> retire l'étincelle décorative du coin bas-droit (False = la garder)
JOBS = [
    ("cat_fishing.png",              "cat_idle",     "obj", 340, True),
    ("cat_throwing_fishing_rod.png", "cat_cast",     "obj", 340, True),
    ("barrel.png",                   "barrel",       "obj", 320, True),
    ("lantern.png",                  "lantern",      "obj", 150, True),
    ("sardine.png",                  "fish_sardine", "obj", 230, True),
    ("fish_gold.png",                "fish_gold",    "obj", 240, False),  # garde les étincelles
    ("post.png",                     "post",         "obj", 300, True),
    ("fish_under_water.png",         "shadow_fish",  "obj", 360, True),
    ("moutain.png",                  "mountains",    "ban", 1024, True),
    ("forest.png",                   "forest",       "ban", 1024, True),
    ("plank.png",                    "plank",        "ban", 1024, True),
    ("dock_side.png",                "dock_side",    "ban", 1024, False),  # texture tuilée
    # --- nouvelles espèces / outil ---
    ("jellyfish.jpeg",               "fish_meduse",  "obj", 230, False),  # méduse (haute)
    ("chest.png",                    "fish_coffre",  "obj", 210, True),   # coffre (jackpot lourd)
    ("rake.jpeg",                    "rake",         "obj", 300, False),  # râteau (outil)
    ("crabe.png",                    "fish_crabe",   "obj", 200, True),   # crabe (fuit le trou)
    ("anguille.png",                 "fish_anguille","obj", 240, True),   # anguille (glissante)
    ("botte.png",                    "fish_botte",   "obj", 160, True),   # déchet (sans valeur)
    ("roi.png",                      "fish_roi",     "obj", 270, True),   # poisson-roi (légendaire)
    ("seagull.png",                  "gull",         "obj", 150, True),   # mouette assistante
]

KEY_THRESH = 45   # tolérance détection magenta : min(R,B)-G > seuil

def key_magenta(im):
    """Rend transparent le fond magenta (R,B élevés, G faible)."""
    R, G, B, A = im.split()
    minRB = ImageChops.darker(R, B)
    diff  = ImageChops.subtract(minRB, G)            # max(0, min(R,B)-G)
    bg    = diff.point(lambda v: 255 if v > KEY_THRESH else 0)
    bg    = ImageChops.multiply(bg, R.point(lambda v: 255 if v > 110 else 0))
    bg    = ImageChops.multiply(bg, B.point(lambda v: 255 if v > 110 else 0))
    alpha = ImageChops.invert(bg)                    # 255 = garder, 0 = fond
    return alpha

for src, out, typ, target, declutter in JOBS:
    im = Image.open(os.path.join(SRC, src)).convert("RGBA")
    w, h = im.size
    alpha = key_magenta(im)
    # retire l'étincelle décorative (coin bas-droit)
    if declutter:
        d = ImageDraw.Draw(alpha)
        d.rectangle([int(w*0.90), int(h*0.81), w, h], fill=0)
    im.putalpha(alpha)
    # recadre au contenu
    bbox = alpha.getbbox()
    im = im.crop(bbox)
    cw, ch = im.size
    # redimensionne
    if typ == "obj":
        f = target / max(cw, ch)
    else:
        f = target / cw
    nw, nh = max(1, round(cw*f)), max(1, round(ch*f))
    im = im.resize((nw, nh), Image.LANCZOS)
    im.save(os.path.join(OUT, out + ".png"))
    print(f"{out:14s} src {cw}x{ch}  ->  {nw}x{nh}")

# ---- éclaboussure : planche 4x2 -> 4 frames alignées (ligne du haut) ----
sheet = Image.open(os.path.join(SRC, "water_dropplets.png")).convert("RGBA")
sheet.putalpha(key_magenta(sheet))
cw, ch = sheet.width//4, sheet.height//2
frames = [sheet.crop((i*cw, 0, (i+1)*cw, ch)) for i in range(4)]   # ligne du haut
# bbox commune (alignement) à partir de tous les alphas
boxes = [f.split()[3].getbbox() for f in frames if f.split()[3].getbbox()]
ux0 = min(b[0] for b in boxes); uy0 = min(b[1] for b in boxes)
ux1 = max(b[2] for b in boxes); uy1 = max(b[3] for b in boxes)
sc = 90 / (uy1-uy0)
for i, f in enumerate(frames):
    f = f.crop((ux0, uy0, ux1, uy1))
    f = f.resize((max(1,round(f.width*sc)), max(1,round(f.height*sc))), Image.LANCZOS)
    f.save(os.path.join(OUT, f"splash_{i}.png"))
print(f"splash          4 frames -> {round((ux1-ux0)*sc)}x{round((uy1-uy0)*sc)}")

# ---- placeholders saumon / globe : sardine teintée (jusqu'aux vrais sprites) ----
def tint(src_name, dst_name, mult):
    im = Image.open(os.path.join(OUT, src_name + ".png")).convert("RGBA")
    r, g, b, a = im.split()
    r = r.point(lambda v: int(v*mult[0]/255))
    g = g.point(lambda v: int(v*mult[1]/255))
    b = b.point(lambda v: int(v*mult[2]/255))
    Image.merge("RGBA", (r, g, b, a)).save(os.path.join(OUT, dst_name + ".png"))
    print(f"{dst_name:14s} (placeholder teinté depuis {src_name})")

tint("fish_sardine", "fish_saumon", (255, 150, 110))   # orangé
tint("fish_sardine", "fish_globe",  (255, 214, 90))    # jaune

# ---- contact sheet pour vérif ----
names = [j[1] for j in JOBS]
imgs  = [Image.open(os.path.join(OUT, n + ".png")).convert("RGBA") for n in names]
PADX, PADY = 16, 30
cols = 3
rows = (len(imgs)+cols-1)//cols
cellw = max(i.width for i in imgs) + PADX*2
cellh = max(i.height for i in imgs) + PADY
sheet = Image.new("RGBA", (cellw*cols, cellh*rows), (40, 48, 62, 255))
# damier pour voir la transparence
chk = Image.new("RGBA", sheet.size, (40,48,62,255))
dc = ImageDraw.Draw(chk)
for yy in range(0, sheet.size[1], 16):
    for xx in range(0, sheet.size[0], 16):
        if (xx//16 + yy//16) % 2: dc.rectangle([xx,yy,xx+16,yy+16], fill=(52,60,76,255))
sheet = chk
for i, im in enumerate(imgs):
    cx = (i % cols)*cellw + PADX
    cy = (i//cols)*cellh + PADY
    sheet.alpha_composite(im, (cx, cy))
sheet.save("/tmp/art_preview.png")
print("preview -> /tmp/art_preview.png")
