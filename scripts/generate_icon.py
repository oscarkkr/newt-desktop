from pathlib import Path
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]
out=root/"src-tauri/icons/icon.png"
im=Image.new("RGBA",(512,512),"#163b35"); d=ImageDraw.Draw(im)
d.polygon([(256,68),(106,134),(106,246),(115,320),(155,385),(256,448),(357,385),(397,320),(406,246),(406,134)],fill="#62c6a9")
d.line((256,158,256,358),fill="#163b35",width=28)
d.arc((163,221,270,329),270,355,fill="#163b35",width=28)
d.arc((242,180,349,288),185,270,fill="#163b35",width=28)
out.parent.mkdir(parents=True,exist_ok=True);im.save(out,optimize=True);print(out)
