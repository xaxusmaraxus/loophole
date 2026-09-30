"""Join art/previews/<name>_{front,side,34}.png into art/previews/<name>.png."""
import sys
from PIL import Image
for name in sys.argv[1:]:
    ims = [Image.open("art/previews/%s_%s.png" % (name, t)) for t in ("front", "side", "34")]
    c = Image.new("RGB", (sum(i.width for i in ims), ims[0].height))
    x = 0
    for i in ims:
        c.paste(i, (x, 0))
        x += i.width
    c.save("art/previews/%s.png" % name)
