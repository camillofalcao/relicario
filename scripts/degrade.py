# Simula uma folha impressa e fotografada: rotação leve, perspectiva, desfoque, ruído, JPEG.
import sys, random
from PIL import Image, ImageFilter, ImageEnhance
src, dst, scale = sys.argv[1], sys.argv[2], float(sys.argv[3])
random.seed(7)
im = Image.open(src).convert('L')
w, h = im.size
im = im.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
im = im.rotate(2.5, resample=Image.BICUBIC, expand=True, fillcolor=200)
w, h = im.size
d = 0.03
coeffs = [1 + d * 0.5, d * 0.2, -w * d * 0.1, d * 0.1, 1, -h * d * 0.05, 0.00002, 0.00001]
im = im.transform((w, h), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=200)
im = im.filter(ImageFilter.GaussianBlur(radius=1.0 * scale * 2))
im = ImageEnhance.Contrast(im).enhance(0.7)
im = ImageEnhance.Brightness(im).enhance(0.95)
px = im.load()
for _ in range(int(w * h * 0.01)):
    x, y = random.randrange(w), random.randrange(h)
    px[x, y] = max(0, min(255, px[x, y] + random.randint(-60, 60)))
im.save(dst, quality=70)
print(dst, im.size)
