# Usage: python3 textures_tripo.py <dumpdir>   (after dump_glb.mjs)
# Recolors the base color to the dog's cream coat (same as tools/recolor_texture.py) and
# downsizes the 4K textures for the web: <dumpdir>/tex_color.webp, tex_orm.webp, tex_normal.webp
import subprocess, sys, os
from PIL import Image
d = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
subprocess.run([sys.executable, '-I', os.path.join(here, '..', 'recolor_texture.py'), f'{d}/color.jpg', f'{d}/color_cream.webp'], check=True)
Image.open(f'{d}/color_cream.webp').resize((2048, 2048), Image.LANCZOS).save(f'{d}/tex_color.webp', quality=86, method=6)
# ORM: only roughness (G) is used; AO is flat and metalness is ignored
Image.open(f'{d}/orm.jpg').convert('RGB').resize((1024, 1024), Image.LANCZOS).save(f'{d}/tex_orm.webp', quality=80, method=6)
Image.open(f'{d}/normal.png').convert('RGB').resize((2048, 2048), Image.LANCZOS).save(f'{d}/tex_normal.webp', quality=90, method=6)
for n in ('color', 'orm', 'normal'): print(n, os.path.getsize(f'{d}/tex_{n}.webp'))
