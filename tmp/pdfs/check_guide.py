from pathlib import Path
from PIL import Image, ImageOps, ImageDraw
from pypdf import PdfReader
root=Path(__file__).resolve().parents[2]
pages=sorted((root/'tmp/pdfs').glob('verified-*.png'))
for offset in range(0,len(pages),12):
    canvas=Image.new('RGB',(1000,4*370),'#dce5ec')
    d=ImageDraw.Draw(canvas)
    for n,f in enumerate(pages[offset:offset+12]):
        im=Image.open(f).convert('RGB');im.thumbnail((320,340))
        x=(n%3)*333+(333-im.width)//2;y=(n//3)*370
        canvas.paste(im,(x,y));d.text((x,y+343),f.stem,fill='black')
    canvas.save(root/f'tmp/pdfs/contact-{offset//12+1}.png')
reader=PdfReader(root/'output/pdf/Tamam-End-to-End-User-Guide.pdf')
print('Pages:',len(reader.pages),'Text characters:',sum(len(p.extract_text()) for p in reader.pages))
print('Blank pages:',[i+1 for i,p in enumerate(reader.pages) if len(p.extract_text().strip())<80])
