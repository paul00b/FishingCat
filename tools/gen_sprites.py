#!/usr/bin/env python3
"""Génère les sprites pixel-art (PNG basse résolution) pour The Hole.
Rendu net : basse résolution + palette limitée + contour 1px.
Le jeu les affiche agrandis en nearest-neighbor (imageSmoothingEnabled=false)."""

from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "px")
os.makedirs(OUT, exist_ok=True)

# ---- palette ----
O   = (38, 44, 52, 255)     # contour sombre universel
GRY = (150, 156, 164, 255)  # fourrure grise
GRD = (108, 116, 126, 255)  # ombre fourrure
WHT = (240, 244, 247, 255)  # ventre / blanc
PNK = (233, 139, 160, 255)  # nez
INK = (217, 138, 153, 255)  # intérieur oreille
EYE = (255, 255, 255, 255)
PUP = (32, 32, 36, 255)
T   = (0, 0, 0, 0)          # transparent

def new(w, h):
    return Image.new("RGBA", (w, h), T)

def outlined_ellipse(d, box, fill):
    d.ellipse(box, fill=O)
    x0, y0, x1, y1 = box
    d.ellipse((x0+1, y0+1, x1-1, y1-1), fill=fill)

def outlined_poly(d, pts, fill):
    d.polygon(pts, fill=fill, outline=O)


# =========================================================================
def cat():
    w, h = 30, 34
    img = new(w, h); d = ImageDraw.Draw(img)
    # queue (attachée au corps, enroulée vers le haut)
    d.line([(9,30),(4,29),(2,24),(5,21),(8,22)], fill=O, width=5)
    d.line([(9,30),(4,29),(2,24),(5,21),(8,22)], fill=GRY, width=3)
    # corps
    outlined_ellipse(d, (5, 16, 25, 33), GRY)
    # ventre
    d.ellipse((10, 19, 20, 32), fill=WHT)
    # pattes
    d.ellipse((8, 29, 14, 33), fill=WHT); d.ellipse((16, 29, 22, 33), fill=WHT)
    d.ellipse((8, 29, 14, 33), outline=O)
    d.ellipse((16, 29, 22, 33), outline=O)
    # oreilles
    outlined_poly(d, [(7,9),(9,1),(15,7)], GRY)
    outlined_poly(d, [(23,9),(21,1),(15,7)], GRY)
    d.polygon([(9,8),(10,4),(13,8)], fill=INK)
    d.polygon([(21,8),(20,4),(17,8)], fill=INK)
    # tête
    outlined_ellipse(d, (6, 4, 24, 21), GRY)
    # museau clair
    d.ellipse((9, 12, 21, 20), fill=WHT)
    # rayures
    for x in (11, 15, 19):
        d.line([(x, 5), (x, 8)], fill=GRD, width=1)
    # yeux
    d.ellipse((10, 10, 13, 14), fill=EYE); d.ellipse((17, 10, 20, 14), fill=EYE)
    d.ellipse((11, 11, 12, 13), fill=PUP); d.ellipse((18, 11, 19, 13), fill=PUP)
    # nez + bouche
    d.polygon([(14,15),(16,15),(15,17)], fill=PNK)
    d.line([(15,17),(13,18)], fill=GRD, width=1); d.line([(15,17),(17,18)], fill=GRD, width=1)
    # moustaches
    d.line([(9,15),(3,14)], fill=WHT, width=1); d.line([(9,16),(3,17)], fill=WHT, width=1)
    d.line([(21,15),(27,14)], fill=WHT, width=1); d.line([(21,16),(27,17)], fill=WHT, width=1)
    return img


def fish(w, h, body, light, belly, fin, dark):
    """Poisson générique tourné vers la DROITE (tête à droite)."""
    img = new(w, h); d = ImageDraw.Draw(img)
    cy = h // 2
    # queue (fourche à gauche)
    outlined_poly(d, [(0,1),(int(w*0.28),cy),(0,h-2)], fin)
    d.polygon([(2,cy),(int(w*0.20),cy-2),(int(w*0.20),cy+2)], fill=dark)  # entaille
    # nageoires dorsale + ventrale
    outlined_poly(d, [(int(w*0.45),1),(int(w*0.68),4),(int(w*0.45),h*0.32)], fin)
    outlined_poly(d, [(int(w*0.45),h-2),(int(w*0.68),h-5),(int(w*0.45),h*0.68)], fin)
    # corps
    outlined_ellipse(d, (int(w*0.18), 1, w-2, h-2), body)
    # dos plus clair (bande supérieure)
    d.ellipse((int(w*0.24), 2, w-4, cy+1), fill=light)
    # ventre clair
    d.ellipse((int(w*0.24), cy, w-4, h-3), fill=belly)
    # ligne latérale
    d.line([(int(w*0.30),cy),(w-5,cy)], fill=dark, width=1)
    # ouïe
    d.arc((int(w*0.62),3,int(w*0.86),h-3), 300, 60, fill=dark, width=1)
    # oeil
    ex = w - 7
    d.ellipse((ex, cy-3, ex+4, cy+1), fill=EYE)
    d.ellipse((ex+1, cy-2, ex+3, cy), fill=PUP)
    return img


def puffer():
    w, h = 26, 26
    img = new(w, h); d = ImageDraw.Draw(img)
    Y  = (255, 206, 63, 255)
    YL = (255, 233, 138, 255)
    YC = (240, 179, 42, 255)
    cx, cy, r = 13, 14, 9
    # piquants
    import math
    for k in range(8):
        a = k * math.pi / 4
        x0 = cx + math.cos(a) * (r-1); y0 = cy + math.sin(a) * (r-1)
        xt = cx + math.cos(a) * (r+4); yt = cy + math.sin(a) * (r+4)
        nx, ny = -math.sin(a)*2.2, math.cos(a)*2.2
        outlined_poly(d, [(x0+nx,y0+ny),(xt,yt),(x0-nx,y0-ny)], YC)
    # petite queue
    outlined_poly(d, [(0,cy-3),(6,cy),(0,cy+3)], YC)
    # corps rond
    outlined_ellipse(d, (cx-r, cy-r, cx+r, cy+r), Y)
    d.ellipse((cx-r+2, cy-r+2, cx+r-2, cy+2), fill=YL)   # haut clair
    d.ellipse((cx-5, cy+1, cx+5, cy+r-1), fill=(255,243,191,255))  # ventre
    # taches
    for (tx,ty) in [(cx-4,cy-3),(cx+3,cy-1),(cx-1,cy+3)]:
        d.point((tx,ty), fill=YC)
    # joues
    d.ellipse((cx-7,cy+1,cx-4,cy+4), fill=(255,158,176,180))
    d.ellipse((cx+4,cy+1,cx+7,cy+4), fill=(255,158,176,180))
    # yeux
    d.ellipse((cx-6,cy-4,cx-2,cy), fill=EYE); d.ellipse((cx+2,cy-4,cx+6,cy), fill=EYE)
    d.ellipse((cx-5,cy-3,cx-3,cy-1), fill=PUP); d.ellipse((cx+3,cy-3,cx+5,cy-1), fill=PUP)
    # bouche
    d.line([(cx-2,cy+5),(cx+2,cy+5)], fill=YC, width=1)
    return img


def bucket():
    w, h = 24, 26
    img = new(w, h); d = ImageDraw.Draw(img)
    M  = (185, 194, 200, 255)
    MD = (139, 148, 155, 255)
    MH = (232, 238, 242, 255)
    AQ = (63, 182, 230, 255)
    # anse
    d.arc((5, 2, 19, 16), 180, 360, fill=MD, width=2)
    # corps (tronc de cône, plus haut)
    outlined_poly(d, [(2,7),(5,h-1),(19,h-1),(22,7)], M)
    # reflet vertical
    d.line([(7,10),(6,h-3)], fill=MH, width=1)
    d.line([(16,10),(17,h-3)], fill=MD, width=1)
    # bord supérieur
    d.ellipse((1, 4, 23, 11), fill=M, outline=O)
    d.ellipse((3, 5, 21, 10), fill=(19,48,63,255))   # intérieur sombre
    d.ellipse((4, 5, 20, 9), fill=AQ)                # eau
    d.line([(7,6),(13,6)], fill=(150,224,255,255), width=1)  # reflet eau
    # cerclages
    d.line([(4,15),(20,15)], fill=MD, width=1)
    d.line([(4,21),(20,21)], fill=MD, width=1)
    return img


# =========================================================================
sprites = {
    "cat":          cat(),
    "fish_sardine": fish(28, 13, (159,176,191,255), (205,216,226,255),
                         (232,239,244,255), (134,150,165,255), (90,107,120,255)),
    "fish_saumon":  fish(34, 16, (240,111,73,255),  (255,157,120,255),
                         (255,217,196,255), (224,103,67,255), (168,64,31,255)),
    "fish_globe":   puffer(),
    "bucket":       bucket(),
}

# preview contact sheet (x12)
SC = 12
total_w = sum(s.width for s in sprites.values()) * SC + 20 * (len(sprites)+1)
total_h = max(s.height for s in sprites.values()) * SC + 40
sheet = Image.new("RGBA", (total_w, total_h), (30, 40, 55, 255))
x = 20
for name, s in sprites.items():
    s.save(os.path.join(OUT, name + ".png"))
    big = s.resize((s.width*SC, s.height*SC), Image.NEAREST)
    sheet.alpha_composite(big, (x, 20))
    x += s.width*SC + 20
    print(f"{name:14s} {s.width}x{s.height}")
sheet.save("/tmp/sprite_preview.png")
print("preview -> /tmp/sprite_preview.png")
