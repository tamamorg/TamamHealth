from pathlib import Path
import re, html
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak, LongTable, TableStyle, HRFlowable, CondPageBreak
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/pdf/Tamam-End-to-End-User-Guide.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
for name, file in [('Arial','Arial.ttf'), ('Arial-Bold','Arial Bold.ttf'), ('Arial-Italic','Arial Italic.ttf')]:
    pdfmetrics.registerFont(TTFont(name, '/System/Library/Fonts/Supplemental/' + file))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-Bold')
BLUE = colors.HexColor('#075990')
TEAL = colors.HexColor('#078D8B')
INK = colors.HexColor('#18344D')
MUTED = colors.HexColor('#52677A')
W, H = 595.28, 841.89
styles = {
 'body': ParagraphStyle('body', fontName='Arial', fontSize=10, leading=14.5, textColor=INK, spaceAfter=7),
 'h1': ParagraphStyle('h1', fontName='Arial-Bold', fontSize=23, leading=28, textColor=INK, spaceAfter=15, keepWithNext=True),
 'h2': ParagraphStyle('h2', fontName='Arial-Bold', fontSize=12.5, leading=17, textColor=BLUE, spaceBefore=12, spaceAfter=8, keepWithNext=True),
 'cell': ParagraphStyle('cell', fontName='Arial', fontSize=8.3, leading=11.5, textColor=INK),
 'head': ParagraphStyle('head', fontName='Arial-Bold', fontSize=8.3, leading=11.5, textColor=colors.white),
 'bullet': ParagraphStyle('bullet', fontName='Arial', fontSize=10, leading=14.5, textColor=INK, leftIndent=13, firstLineIndent=-10, spaceAfter=6),
 'callout': ParagraphStyle('callout', fontName='Arial', fontSize=9.5, leading=14, textColor=INK, backColor=colors.HexColor('#EDF6F7'), borderColor=TEAL, borderWidth=.6, borderPadding=11, spaceBefore=12, spaceAfter=15),
}

def inline(s):
    s = s.replace('—',' - ').replace('–','-').replace('‑','-').replace('→',' > ')
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: m[1], s)
    s = html.escape(s)
    s = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+)`', r'\1', s)
    return s

class Guide(BaseDocTemplate):
    def afterFlowable(self, f):
        if isinstance(f, Paragraph) and getattr(f, 'toc_entry', False):
            key = 'section-' + str(self.seq.nextf('section'))
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(f.getPlainText(), key, 0, False)
            self.notify('TOCEntry', (0, f.getPlainText(), self.page, key))

def chrome(canvas, doc):
    canvas.saveState()
    if doc.page == 1:
        canvas.setFillColor(INK);canvas.rect(0,0,W,H,fill=1,stroke=0)
        canvas.setFillColor(BLUE);canvas.rect(0,H-15,W,15,fill=1,stroke=0)
        canvas.setFillColor(TEAL);canvas.rect(44, H-115,52,5,fill=1,stroke=0)
        canvas.setStrokeColor(colors.HexColor('#34536A'));canvas.setLineWidth(.6)
        for x in range(390,650,38):
            canvas.line(x,0,x,H-500)
        for y in range(0,340,38): canvas.line(350,y,W,y)
        canvas.setFillColor(TEAL);canvas.roundRect(44,135,507,64,8,fill=1,stroke=0)
        canvas.setFillColor(colors.white);canvas.setFont('Arial-Bold',11)
        canvas.drawString(60,174,'REGISTER  >  CARE  >  HAND OVER  >  FOLLOW UP')
        canvas.setFont('Arial',9);canvas.drawString(60,153,'Practical instructions for a connected patient journey')
    if doc.page > 1:
        canvas.setFillColor(BLUE)
        canvas.setFont('Arial-Bold', 8)
        canvas.drawString(44, H-29, 'TAMAM HEALTH  /  USER GUIDE')
        canvas.setStrokeColor(colors.HexColor('#DCE5EC'))
        canvas.line(44, H-37, W-44, H-37)
    canvas.setFont('Arial', 8)
    canvas.setFillColor(colors.HexColor('#C2D4DF') if doc.page==1 else MUTED)
    canvas.drawString(44, 25, 'Version 1.0  |  19 September 2026')
    canvas.drawRightString(W-44, 25, str(doc.page))
    canvas.restoreState()

doc = Guide(str(OUT), pagesize=(W,H), leftMargin=44, rightMargin=44, topMargin=52, bottomMargin=45,
            title='Tamam Health: End-to-End User Guide', author='Tamam Health', allowSplitting=True)
doc.addPageTemplates(PageTemplate(id='guide', frames=[Frame(44,45,W-88,H-97,id='main',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)], onPage=chrome))
coverbody=ParagraphStyle('coverbody',fontName='Arial',fontSize=11,leading=17,textColor=colors.HexColor('#C2D4DF'))
story = [Spacer(1,85), Paragraph('TAMAM HEALTH', ParagraphStyle('eyebrow',fontName='Arial-Bold',fontSize=13,textColor=colors.HexColor('#76D6D0'),spaceAfter=28)),
 Paragraph('End-to-end<br/>user guide',ParagraphStyle('cover',fontName='Arial-Bold',fontSize=43,leading=49,textColor=colors.white,spaceAfter=25)),
 Paragraph('Every role. Every handoff.<br/>From registration to follow-up.',ParagraphStyle('sub',fontName='Arial',fontSize=18,leading=26,textColor=colors.HexColor('#C2D4DF'))),Spacer(1,32),
 Paragraph('Practical workflows, worked examples, payment guidance,<br/>offline procedures, and edge-case recovery.',coverbody),Spacer(1,24),
 Paragraph('25 staff roles + patients and guardians',ParagraphStyle('coverlabel',fontName='Arial-Bold',fontSize=12,leading=17,textColor=colors.white,spaceAfter=10)),
 Paragraph('Reference release: d676a8ee<br/>Verification boundaries and facility sign-off included.',coverbody),PageBreak(),Paragraph('Contents',styles['h1'])]
toc = TableOfContents()
toc.levelStyles=[ParagraphStyle('toc',fontName='Arial',fontSize=10,leading=15,textColor=INK,spaceBefore=6,leftIndent=0,firstLineIndent=0)]
story += [toc,PageBreak()]
lines=(ROOT/'docs/TAMAM-END-TO-END-USER-GUIDE.md').read_text().splitlines()
i=0
while i<len(lines):
    line=lines[i].strip()
    if not line or line.startswith('# ') or line.startswith('Version 1.0') or line.startswith('Audience:'):
        i+=1; continue
    if line=='## Contents':
        i+=1
        while i<len(lines) and not lines[i].startswith('## '): i+=1
        continue
    if line.startswith('## '):
        if line.startswith('## Appendix C.'): story.append(PageBreak())
        elif line!='## About this guide': story.extend([Spacer(1,20),CondPageBreak(240)])
        p=Paragraph(inline(line[3:]),styles['h1']);p.toc_entry=True;story.extend([p,HRFlowable(width=52,thickness=3,color=TEAL,hAlign='LEFT',spaceAfter=17)]);i+=1;continue
    if line.startswith('### '):
        story.append(Paragraph(inline(line[4:]),styles['h2']));i+=1;continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            row=lines[i].strip().strip('|').split('|')
            if not all(re.fullmatch(r'\s*:?-+:?\s*',c) for c in row): rows.append([c.strip() for c in row])
            i+=1
        n=len(rows[0]); width=W-88
        if n==3: widths=[width*.23,width*.37,width*.40]
        elif n==4: widths=[width*.14,width*.27,width*.31,width*.28]
        else: widths=[width*.38,width*.62] if n==2 else [width/n]*n
        table=LongTable([[Paragraph(inline(c),styles['head' if r==0 else 'cell']) for c in row] for r,row in enumerate(rows)],colWidths=widths,repeatRows=1,hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),BLUE),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F0F5F8'),colors.white]),('LINEBELOW',(0,1),(-1,-1),.4,colors.HexColor('#DAE3EA'))]))
        story += [table,Spacer(1,10)];continue
    if line.startswith('- ') or re.match(r'^\d+\. ',line):
        story.append(Paragraph(inline('• '+line[2:] if line.startswith('- ') else line),styles['bullet']));i+=1;continue
    para=[line];i+=1
    while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||- |\d+\. )',lines[i]):
        para.append(lines[i].strip());i+=1
    content=' '.join(para)
    style='callout' if content.startswith(('**Verification boundary:**','**Example:**','**Completion check:**','**Final rule:**','**Four different confirmations:**','**Training case:**')) else 'body'
    story.append(Paragraph(inline(content),styles[style]))
doc.multiBuild(story)
print(OUT)
