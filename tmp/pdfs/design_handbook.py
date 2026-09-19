"""Editorial PDF edition. Full guide text retained; diagrams are reading aids."""
from pathlib import Path
import re, html
from reportlab.platypus import (BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,PageBreak,
    LongTable,Table,TableStyle,Flowable,KeepTogether,CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics import renderPDF
from svglib.svglib import svg2rlg

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/pdf/Tamam-End-to-End-User-Guide.pdf'
W,H=595.28,841.89
L,R=48,48
CW=W-L-R
C={k:colors.HexColor(v) for k,v in dict(blue='#015697',navy='#102E48',teal='#007F83',muted='#577086',line='#D7E2EA',light='#EFF5F8',gold='#BA7419',cream='#FFF5E6').items()}
for name,file in [('Body','Arial.ttf'),('BodyBold','Arial Bold.ttf'),('BodyItalic','Arial Italic.ttf'),('Display','DIN Alternate Bold.ttf')]:
    pdfmetrics.registerFont(TTFont(name,'/System/Library/Fonts/Supplemental/'+file))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='BodyBold',italic='BodyItalic',boldItalic='BodyBold')
logo=svg2rlg(str(ROOT/'platform/public/assets/tamamhealth-logo-full.svg'))
def logo_at(c,x,y,width):
    c.saveState();c.translate(x,y);c.scale(width/logo.width,width/logo.width);renderPDF.draw(logo,c,0,0);c.restoreState()

S={
 'body':ParagraphStyle('body',fontName='Body',fontSize=10.2,leading=15.4,textColor=C['navy'],spaceAfter=8),
 'small':ParagraphStyle('small',fontName='Body',fontSize=9,leading=13,textColor=C['muted'],spaceAfter=7),
 'sub':ParagraphStyle('sub',fontName='Display',fontSize=15,leading=19,textColor=C['blue'],spaceBefore=15,spaceAfter=8,keepWithNext=True),
 'cell':ParagraphStyle('cell',fontName='Body',fontSize=9,leading=12.7,textColor=C['navy']),
 'head':ParagraphStyle('head',fontName='BodyBold',fontSize=8.6,leading=12,textColor=colors.white),
 'bullet':ParagraphStyle('bullet',fontName='Body',fontSize=10.2,leading=15.4,textColor=C['navy'],leftIndent=12,firstLineIndent=-10,spaceAfter=6),
 'call':ParagraphStyle('call',fontName='Body',fontSize=10,leading=15,textColor=C['navy']),
}
for style in S.values():
    style.allowWidows=0
    style.allowOrphans=0
def inline(s):
    s=s.replace('—',' - ').replace('–','-').replace('‑','-').replace('→',' > ')
    s=re.sub(r'\[([^\]]+)\]\(([^)]+)\)',lambda m:m[1],s)
    s=html.escape(s)
    s=re.sub(r'\*\*(.*?)\*\*',r'<b>\1</b>',s)
    return re.sub(r'`([^`]+)`',r'\1',s)
def P(s,style='body'):return Paragraph(inline(s),S[style])

class Section(Flowable):
    def __init__(self,title):
        Flowable.__init__(self);self.title=title;self.keepWithNext=True
        m=re.match(r'(\d+)\. (.*)',title)
        self.num=m[1].zfill(2) if m else ('REF' if title.startswith('Appendix') else 'READ FIRST')
        self.text=m[2] if m else title
        self.p=Paragraph(inline(self.text),ParagraphStyle('sect',fontName='Display',fontSize=27,leading=30,textColor=C['navy']))
    def wrap(self,a,b):
        self.p.wrap(CW-65,b);self.height=max(58,self.p.height+25);return CW,self.height
    def draw(self):
        c=self.canv
        c.setFillColor(C['teal']);c.setFont('Display',27 if self.num.isdigit() else 9)
        c.drawString(0,self.height-28,self.num)
        self.p.drawOn(c,65,self.height-self.p.height-2)
        c.setStrokeColor(C['line']);c.line(0,7,CW,7)

class Step(Table):
    def __init__(self,num,text):
        super().__init__([[Paragraph(num,ParagraphStyle('n',fontName='Display',fontSize=13,textColor=C['teal'])),P(text)]],colWidths=[27,CW-27],hAlign='LEFT')
        self.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),3),('BOTTOMPADDING',(0,0),(-1,-1),3)]))

def callout(text):
    # A fixed inset prevents padding from protruding into the page margins.
    t=Table([[P(text,'call')]],colWidths=[CW],hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),C['light']),('LINEBEFORE',(0,0),(0,-1),3,C['teal']),('LEFTPADDING',(0,0),(-1,-1),14),('RIGHTPADDING',(0,0),(-1,-1),14),('TOPPADDING',(0,0),(-1,-1),11),('BOTTOMPADDING',(0,0),(-1,-1),11)]))
    return [Spacer(1,7),t,Spacer(1,12)]

class Journey(Flowable):
    def __init__(self):Flowable.__init__(self);self.width=CW;self.height=490
    def draw(self):
        c=self.canv
        def box(x,y,w,title,owner,accent='blue'):
            c.setFillColor(C['light']);c.roundRect(x,y,w,60,6,fill=1,stroke=0)
            c.setFillColor(C[accent]);c.rect(x,y+57,w,3,fill=1,stroke=0)
            p=Paragraph(title,ParagraphStyle('jt',fontName='Display',fontSize=13,leading=15,textColor=C['navy']));p.wrap(w-20,35);p.drawOn(c,x+10,y+34)
            c.setFont('Body',8);c.setFillColor(C['muted']);c.drawString(x+10,y+13,owner)
        def arrow(x1,y1,x2,y2):
            c.setStrokeColor(C['teal']);c.setLineWidth(1.4);c.line(x1,y1,x2,y2)
            if y2<y1:c.line(x2,y2,x2-3,y2+5);c.line(x2,y2,x2+3,y2+5)
            else:c.line(x2,y2,x2-5,y2-3);c.line(x2,y2,x2-5,y2+3)
        box(0,413,150,'01  Identify & arrive','RECEPTION')
        box(174,413,150,'02  Triage & room','NURSING')
        box(348,413,151,'03  Assess & plan','CLINICIAN')
        arrow(151,443,173,443);arrow(325,443,347,443)
        arrow(423,411,423,373)
        box(348,310,151,'04  Ordered services','LAB / IMAGING / PHARMACY','teal')
        p=P('Services can run in parallel. Results return to the clinician. Review the current plan.','small');p.wrap(300,70);p.drawOn(c,10,320)
        arrow(423,308,423,273)
        box(348,210,151,'05  Nurse follow-up','OWNERSHIP + EVIDENCE','teal')
        box(0,210,299,'Financial work runs alongside care','CHARGES / RECEIPTS / CLAIMS / REVIEW','teal')
        arrow(423,208,423,173)
        box(348,110,151,'06  Safe checkout','CHECK PENDING ITEMS')
        p=P('A payment status does not replace a clinical handoff. Every pending action needs an accountable owner.','small');p.wrap(285,70);p.drawOn(c,10,130)
        arrow(423,108,423,73)
        box(0,10,499,'07  Follow-up and continuity','BOOK / CONFIRM / REVIEW RESULTS / RECONCILE OUTSTANDING WORK')

class Guide(BaseDocTemplate):
    def beforeDocument(self):self.running='User handbook';self.chapter=0
    def afterFlowable(self,f):
        if isinstance(f,Section):
            self.running=f.text;self.chapter=int(f.num) if f.num.isdigit() else 0
            key='s'+str(self.seq.nextf('sec'));self.canv.bookmarkPage(key);self.canv.addOutlineEntry(f.title,key,0)
            if f.title!='Find your next action':self.notify('TOCEntry',(0,f.title,self.page,key))

def chrome(c,doc):
    c.saveState()
    if doc.page==1:
        c.setFillColor(colors.white);c.rect(0,0,W,H,fill=1,stroke=0)
        logo_at(c,48,H-104,200)
        c.setFillColor(C['navy']);c.rect(0,0,W,620,fill=1,stroke=0)
        c.setFillColor(C['teal']);c.rect(48,577,46,4,fill=1,stroke=0)
        c.setFillColor(colors.white);c.setFont('Display',53)
        for j,t in enumerate(['One patient.','Every handoff.']):c.drawString(48,508-j*59,t)
        c.setFont('Body',18);c.setFillColor(colors.HexColor('#BFD5E3'));c.drawString(48,392,'The Tamam user handbook')
        c.setFont('Body',11)
        for j,t in enumerate(['End-to-end workflows for every team,','from the first registration to the next visit.']):c.drawString(48,354-j*17,t)
        c.setStrokeColor(colors.HexColor('#3A566B'));c.line(48,277,W-48,277)
        for x,num,label in [(48,'25','STAFF ROLES'),(225,'16','PRACTICAL CHAPTERS'),(410,'01','CONNECTED JOURNEY')]:
            c.setFillColor(colors.white);c.setFont('Display',31);c.drawString(x,226,num)
            c.setFillColor(colors.HexColor('#9FBCCD'));c.setFont('BodyBold',7.7);c.drawString(x,207,label)
        c.setFillColor(C['teal']);c.roundRect(48,100,CW,64,5,fill=1,stroke=0)
        c.setFillColor(colors.white);c.setFont('Display',16);c.drawString(64,139,'USE IT AT THE DESK. USE IT IN TRAINING.')
        c.setFont('Body',9.5);c.drawString(64,119,'Role guidance  /  Worked examples  /  Exceptions and recovery')
        c.setFont('Body',8);c.setFillColor(colors.HexColor('#A8C0D0'));c.drawString(48,48,'SEPTEMBER 2026  |  VERSION 1.0  |  REFERENCE d676a8ee')
    else:
        logo_at(c,L,H-37,87)
        c.setFont('BodyBold',7.5);c.setFillColor(C['muted']);c.drawRightString(W-R,H-27,'USER HANDBOOK  /  WORKFLOWS & REFERENCE')
        c.setStrokeColor(C['line']);c.line(L,H-48,W-R,H-48)
        c.line(L,37,W-R,37)
        c.setFont('Body',7.8);c.setFillColor(C['muted']);c.drawString(L,23,'TAMAM HEALTH  /  SEPTEMBER 2026')
        c.setFillColor(C['blue']);c.setFont('Display',11);c.drawRightString(W-R,22,f'{doc.page:02}')
    c.restoreState()

doc=Guide(str(OUT),pagesize=(W,H),title='Tamam Health | One patient. Every handoff.',author='Tamam Health',leftMargin=L,rightMargin=R,topMargin=67,bottomMargin=53)
doc.addPageTemplates(PageTemplate(id='main',frames=[Frame(L,53,CW,H-120,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=chrome))
story=[Spacer(1,1),PageBreak(),Section('Find your next action')]
story += [P('Read the complete journey first, then use the role chapters during a shift. Keep the troubleshooting and training sections close at hand.','small'),Spacer(1,8)]
toc=TableOfContents();toc.levelStyles=[ParagraphStyle('toc',fontName='Body',fontSize=9.5,leading=12,textColor=C['navy'],spaceBefore=4)]
story += [toc,PageBreak(),Section('The patient journey at a glance'),P('A shared record connects each station. The route changes with the patient\'s needs; accountability must remain clear.','small'),Journey(),*callout('**Before every handoff:** confirm the correct patient and encounter, record the current plan, and name the person or team responsible for the next action.'),PageBreak()]
lines=(ROOT/'docs/TAMAM-END-TO-END-USER-GUIDE.md').read_text().splitlines();i=0;section=''
while i<len(lines):
    line=lines[i].strip()
    if not line or line.startswith(('# ','Version 1.0','Audience:')):i+=1;continue
    if line=='## Contents':
        i+=1
        while i<len(lines) and not lines[i].startswith('## '):i+=1
        continue
    if line.startswith('## '):
        section=line[3:]
        if section.startswith('Appendix C'):story.append(PageBreak())
        elif section!='About this guide':story.extend([Spacer(1,22),CondPageBreak(250)])
        story.extend([Section(section),Spacer(1,10)]);i+=1;continue
    if line.startswith('### '):story.append(P(line[4:],'sub'));i+=1;continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            row=lines[i].strip().strip('|').split('|')
            if not all(re.fullmatch(r'\s*:?-+:?\s*',s) for s in row):rows.append([s.strip() for s in row])
            i+=1
        if section.startswith('15.'):
            for row in rows[1:]:
                heading=Paragraph(inline(row[0]),ParagraphStyle('case',fontName='Display',fontSize=13,leading=17,textColor=C['blue'],spaceAfter=7))
                card=Table([[P('**CHECK & DO**','small'),P(row[1],'cell')],[P('**AVOID / ESCALATE**','small'),P(row[2],'cell')]],colWidths=[105,CW-105])
                card.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),C['light']),('BACKGROUND',(0,1),(-1,1),C['cream']),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),8)]))
                story.extend([KeepTogether([heading,card,Spacer(1,17)])])
            continue
        n=len(rows[0]); ratios=([.23,.37,.40] if n==3 else [.14,.27,.31,.28] if n==4 else [.40,.60])
        t=LongTable([[P(c,'head' if j==0 else 'cell') for c in row] for j,row in enumerate(rows)],colWidths=[CW*r for r in ratios],repeatRows=1,hAlign='LEFT')
        t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),C['blue']),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9),('ROWBACKGROUNDS',(0,1),(-1,-1),[C['light'],colors.white]),('LINEBELOW',(0,1),(-1,-1),.4,C['line'])]))
        story.extend([t,Spacer(1,12)]);continue
    m=re.match(r'^(\d+)\. (.*)',line)
    if m:story.append(Step(m[1].zfill(2),m[2]));i+=1;continue
    if line.startswith('- '):story.append(P('• '+line[2:],'bullet'));i+=1;continue
    para=[line];i+=1
    while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||- |\d+\. )',lines[i]):para.append(lines[i].strip());i+=1
    content=' '.join(para)
    if content.startswith(('**Verification boundary:**','**Example:**','**Completion check:**','**Final rule:**','**Four different confirmations:**','**Training case:**','**Duplicates:**')):story.extend(callout(content))
    else:story.append(P(content))
doc.multiBuild(story)
print(OUT)
