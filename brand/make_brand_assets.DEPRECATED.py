import sys
from PIL import Image, ImageDraw, ImageFont
OUT = sys.argv[1]  # target assets/ dir

GOLD       = (169,111,34)
GOLD_LIGHT = (196,138,60)
GOLD_DARK  = (132,86,26)
CREAM      = (247,239,227)
DARK       = (38,29,21)
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

def vgrad(w,h,top,bot):
    img = Image.new("RGB",(w,h))
    px = img.load()
    for y in range(h):
        t = y/(h-1)
        c = tuple(round(top[i]+(bot[i]-top[i])*t) for i in range(3))
        for x in range(w): px[x,y]=c
    return img

def centered_letter(draw, box, ch, font, fill):
    # center a glyph within box (x0,y0,x1,y1) using its bounding box
    l,t,r,b = draw.textbbox((0,0), ch, font=font)
    gw, gh = r-l, b-t
    cx = (box[0]+box[2])/2; cy=(box[1]+box[3])/2
    draw.text((cx-gw/2-l, cy-gh/2-t), ch, font=font, fill=fill)

def icon_full(size=1024):
    img = vgrad(size,size,GOLD_LIGHT,GOLD_DARK).convert("RGBA")
    d = ImageDraw.Draw(img)
    # subtle inset hairline border for refinement
    m = round(size*0.085); bw = max(2, round(size*0.006))
    d.rounded_rectangle([m,m,size-m,size-m], radius=round(size*0.10), outline=CREAM+(70,), width=bw)
    f = ImageFont.truetype(FONT, round(size*0.62))
    centered_letter(d, (0, -size*0.02, size, size*0.98), "A", f, CREAM+(255,))
    return img.convert("RGB")

def icon_foreground(size=1024):
    img = Image.new("RGBA",(size,size),(0,0,0,0))
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, round(size*0.44))   # smaller: adaptive safe zone
    centered_letter(d, (0,0,size,size), "A", f, CREAM+(255,))
    return img

def icon_background(size=1024):
    return vgrad(size,size,GOLD_LIGHT,GOLD_DARK)

def splash(size=2732, bg=CREAM, fg=GOLD, ring=True):
    img = Image.new("RGB",(size,size),bg)
    d = ImageDraw.Draw(img)
    if ring:
        r = round(size*0.16); cx=cy=size/2
        d.ellipse([cx-r,cy-r,cx+r,cy+r], outline=fg, width=max(3,round(size*0.004)))
    f = ImageFont.truetype(FONT, round(size*0.17))
    centered_letter(d, (0,0,size,size), "A", f, fg)
    return img

icon_full().save(f"{OUT}/icon-only.png")
icon_foreground().save(f"{OUT}/icon-foreground.png")
icon_background().save(f"{OUT}/icon-background.png")
splash().save(f"{OUT}/splash.png")
splash(bg=DARK, fg=CREAM).save(f"{OUT}/splash-dark.png")
print("wrote 5 source assets to", OUT)
