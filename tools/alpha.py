# Combines two shots of tools/portraits.html, one on black and one on white, into a transparent image:
# alpha = 1 - (white - black), colour = black / alpha.
# usage: python3 alpha.py <black.png> <white.png> <canvas px> <out.webp> <out px> [quality]
import sys
from PIL import Image
import numpy as np

black_path, white_path, canvas, out, px = sys.argv[1:6]
quality = int(sys.argv[6]) if len(sys.argv) > 6 else 90
canvas, px = int(canvas), int(px)
b = np.asarray(Image.open(black_path).convert('RGB').crop((0, 0, canvas, canvas)), dtype=np.float32) / 255
w = np.asarray(Image.open(white_path).convert('RGB').crop((0, 0, canvas, canvas)), dtype=np.float32) / 255
a = np.clip(1 - (w - b).mean(axis=2), 0, 1)
rgb = np.where(a[..., None] > 0.004, np.clip(b / np.maximum(a[..., None], 1e-3), 0, 1), 0)
img = Image.fromarray((np.dstack([rgb, a]) * 255).round().astype(np.uint8))
img.resize((px, px), Image.LANCZOS).save(out, 'WEBP', quality=quality, method=6)
