import sys,re
for p in sys.argv[1:]:
    s=open(p,encoding='utf8').read()
    out=[];mode=None
    for line in s.split('\n'):
        if line.startswith('<<<<<<< '): mode='ours'; continue
        if line.startswith('=======') and mode=='ours': mode='theirs'; continue
        if line.startswith('>>>>>>> ') and mode=='theirs': mode=None; continue
        out.append(line)
    t='\n'.join(out)
    # drop exact duplicate key lines (same key twice) keeping first
    seen=set();res=[]
    for line in t.split('\n'):
        m=re.match(r"\s*['\"]([\w.\-]+)['\"]\s*:",line)
        if m:
            if m.group(1) in seen: continue
            seen.add(m.group(1))
        res.append(line)
    open(p,'w',encoding='utf8').write('\n'.join(res))
    print(p,'ok')
