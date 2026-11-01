#!/usr/bin/env python3
"""Build English UI assets from authored Russian strings, never from user content.
Run: python3 scripts/build-i18n.py. No external packages or network required.
"""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
PAGES=['index.html','chat.html','login.html','developers.html','privacy.html']
SCRIPTS=['developers.js','folder.js','agent.js','cloud.js']+[str(p.relative_to(PUBLIC)) for p in sorted((PUBLIC/'js').glob('*.js'))]
CYR=re.compile('[А-Яа-яЁё]')
CAT=ROOT/'locales/en.json'
catalog=json.loads(CAT.read_text()) if CAT.exists() else {}
pattern=re.compile('|'.join(('(?<![А-Яа-яЁё])' if CYR.fullmatch(k[:1]) else '')+re.escape(k)+('(?![А-Яа-яЁё])' if CYR.fullmatch(k[-1:]) else '') for k in sorted(catalog,key=len,reverse=True))) if catalog else None
inventory=set()
def translate(text,quote=None):
    if CYR.search(text):inventory.add(text)
    if not pattern:return text
    def repl(m):
        value=catalog[m[0]]
        if quote in ("'",'"'):value=value.replace('\\','\\\\').replace(quote,'\\'+quote).replace('\n','\\n')
        elif quote=='`':value=value.replace('`','\\`').replace('${','\\${')
        return value
    return pattern.sub(repl,text)
def compile_js(src):
    n=len(src)
    def scan(i,stop=False):
        out=[]; depth=0;prev=''
        while i<n:
            c=src[i]
            if c=='}' and stop and depth==0:return ''.join(out),i
            if src.startswith('//',i):
                j=src.find('\n',i);j=n if j<0 else j;out.append(src[i:j]);i=j;continue
            if src.startswith('/*',i):
                j=src.find('*/',i+2);j=n if j<0 else j+2;out.append(src[i:j]);i=j;continue
            if c in ('"',"'"):
                q=c;j=i+1
                while j<n:
                    if src[j]=='\\':j+=2;continue
                    if src[j]==q:break
                    j+=1
                out.append(q+translate(src[i+1:j],q)+q);i=j+1;prev='v';continue
            if c=='`':
                out.append('`');i+=1;start=i
                while i<n:
                    if src[i]=='\\':i+=2;continue
                    if src[i]=='`':out.append(translate(src[start:i],'`')+'`');i+=1;break
                    if src.startswith('${',i):
                        out.append(translate(src[start:i],'`')+'${');inner,i=scan(i+2,True);out.append(inner+'}');i+=1;start=i;continue
                    i+=1
                prev='v';continue
            # Regex literals are not UI text and must remain byte-for-byte intact.
            if c=='/' and (not prev or prev in '=(:,[!&|?;{}>' or re.search(r'\b(?:return|case|throw)\s*$',src[:i])):
                j=i+1;cl=False
                while j<n:
                    if src[j]=='\\':j+=2;continue
                    if src[j]=='[':cl=True
                    if src[j]==']':cl=False
                    if src[j]=='/' and not cl:
                        j+=1
                        while j<n and src[j].isalpha():j+=1
                        break
                    if src[j]=='\n':break
                    j+=1
                out.append(src[i:j]);i=j;prev='v';continue
            if c=='{':depth+=1
            if c=='}':depth-=1
            out.append(c);i+=1
            if not c.isspace():prev=c
        return ''.join(out),i
    return scan(0)[0]
def compile_html(src):
    out=[];at=0
    for m in re.finditer(r'<(script|style)\b[^>]*>.*?</\1\s*>',src,re.S|re.I):
        out.append(translate(src[at:m.start()]))
        block=m[0]
        if m[1].lower()=='script':
            j=block.index('>')+1;k=block.lower().rfind('</script');block=block[:j]+compile_js(block[j:k])+block[k:]
        out.append(block);at=m.end()
    out.append(translate(src[at:]));src=''.join(out).replace('<html lang="ru">','<html lang="en">')
    for name in SCRIPTS:src=src.replace('src="/'+name,'src="/en/'+name)
    return src

def build():
    en=PUBLIC/'en';en.mkdir(exist_ok=True)
    for name in PAGES+SCRIPTS:
        src=(PUBLIC/name).read_text();dst=en/name;dst.parent.mkdir(parents=True,exist_ok=True)
        result=compile_html(src) if name.endswith('.html') else compile_js(src)
        # English uses English number agreement, locale and speech input selection.
        result=result.replace("'ru-RU'","'en-US'") if name != 'js/11-voice.js' else result
        result=re.sub(r"(const plural\s*=\s*\([^;]+?=>)\s*[^;]+;",r'\1 n === 1 ? a : b;',result) if name=='js/02-markdown.js' else result
        if name=='index.html':result=re.sub(r"const pl = \(n, a, b, c\) => [^;]+;",'const pl = (n, a, b, c) => n === 1 ? a : b;',result)
        if name=='js/11-voice.js':result=result.replace("/^en/i.test(navigator.language) ? 'en-US' : 'ru-RU'", "'en-US'")
        if name=='js/13-billing.js':result=result.replace("lim(p.code, 'run', 'runs', 'runs', 'Unlimited Python').replace(/в день$/, 'Python runs per day')", "p.code == null ? 'Unlimited Python' : `${p.code} Python runs per day`")
        if name=='index.html':result=result.replace("lim(p.code, 'run', 'runs', 'runs', 'Unlimited Python', ' Python runs per day')", "p.code == null ? 'Unlimited Python' : `${p.code} Python runs per day`")
        if name=='developers.js':result=re.sub(r"units = w % 10[^;]+;","units = w === 1 ? 'message' : 'messages';",result)
        dst.write_text(result)
    print('Built',len(PAGES)+len(SCRIPTS),'English UI files')
    # Inventory only authored phrases, with HTML stripped for concise review.
    phrases=set()
    for text in inventory:
        for p in re.split(r'<[^>]*>|[\n\r]',text):
            p=p.strip()
            if CYR.search(p):phrases.add(p)
    (ROOT/'locales/source-inventory.json').write_text(json.dumps(sorted(phrases),ensure_ascii=False,indent=2)+'\n')
if __name__=='__main__':build()
