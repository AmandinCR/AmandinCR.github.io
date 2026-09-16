"""Build the web-sized images the site loads from the full-size files in originals/.

    python make-images.py        (needs Pillow: pip install pillow)

originals/NAME.png|jpg  ->  images/NAME.jpg       gallery tile (960px wide)
                            images/NAME-full.jpg  lightbox (1920px wide)
originals/profile2.JPG  ->  images/profile.jpg    avatar (256px square)
"""
from pathlib import Path
from PIL import Image, ImageOps

SRC, OUT = Path("originals"), Path("images")
PROFILE = "profile2.JPG"


def save(im, path, width):
    im = im.copy()
    im.thumbnail((width, width * 10), Image.LANCZOS)  # never upscales
    im.save(path, quality=82, optimize=True, progressive=True)


OUT.mkdir(exist_ok=True)
for f in sorted(SRC.iterdir()):
    im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")
    if f.name == PROFILE:
        side = min(im.size)
        x, y = (im.width - side) // 2, (im.height - side) // 4
        save(im.crop((x, y, x + side, y + side)), OUT / "profile.jpg", 256)
    elif not f.name.startswith("profile"):
        save(im, OUT / f"{f.stem}.jpg", 960)
        save(im, OUT / f"{f.stem}-full.jpg", 1920)
