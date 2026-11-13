import re,sys,json
import os
P=os.path.join(os.environ.get('REPO', os.getcwd()), 'docs/handoff/EXTRAS_BACKLOG.md')   # run from the repo root (or set REPO)
def load(): return open(P,encoding='utf8').read()
def section(s,name):
    occ=1
    if '@' in name: name,o=name.rsplit('@',1); occ=int(o)
    i=-1
    for _ in range(occ): i=s.index('## '+name, i+1)
    j=s.find('\n## ',i+5); j=len(s) if j<0 else j; return i,j
def show(name):
    s=load(); i,j=section(s,name)
    for m in re.finditer(r'^\| (\d+) \| ([^|]*)\| TODO',s[i:j],re.M): print(m.group(1),m.group(2)[:200])
def mark(name,marks):
    s=load(); i,j=section(s,name); sec=s[i:j]
    for k,v in marks.items():
        sec,n=re.subn(r'^(\| '+k+r' \| [^\n]*?\| )(?:TODO|BUILT \(part\)|EXISTS \(part\))[^\n]*\|$', lambda m: m.group(1)+v.replace('\n',' ').replace('|','/')+' |', sec, count=1, flags=re.M)
        if n!=1: print('MISS',k)
    s=s[:i]+sec+s[j:]
    body=s[s.index('**Rows: 1818**'):]
    b=len(re.findall(r'\| BUILT',body)); e=len(re.findall(r'\| EXISTS',body)); t=len(re.findall(r'\| TODO',body))
    s=re.sub(r'\| BUILT this arc \| [^|]* \|',f'| BUILT this arc | {b} (incl. part) |',s,count=1)
    s=re.sub(r'\| EXISTS \(opened and named\) \| [^|]* \|',f'| EXISTS (opened and named) | {e} (incl. part) |',s,count=1)
    nz=len(re.findall(r'\| NOISE',body))
    s=re.sub(r'\| NOISE \(parser picked up acceptance / instruction text\) \| \d+ \|',f'| NOISE (parser picked up acceptance / instruction text) | {nz} |',s,count=1)
    s=re.sub(r'\| TODO \| \d+ \|',f'| TODO | {t} |',s,count=1)
    open(P,'w',encoding='utf8').write(s); print('built',b,'exists',e,'todo',t)
if __name__=='__main__':
    if sys.argv[1]=='show': show(sys.argv[2])
    else: mark(sys.argv[2], json.loads(open(sys.argv[3]).read()))
