import json,re,sys
def add(p,d,draft):
  s=open(p).read(); i=s.rstrip().rfind('};')
  j=s.rstrip().rfind('} as const;')
  if j>i: i=j
  q = "'" if re.search(r"^\s*'[a-zA-Z]", s, re.M) and not re.search(r'^\s*"[a-zA-Z]', s, re.M) else '"'
  def lit(x): return json.dumps(x,ensure_ascii=False) if q=='"' else "'"+x.replace("\\","\\\\").replace("'","\\'")+"'"
  lines=''.join(f'  {lit(k)}: {lit(v)},'+(' // DRAFT — Kevin reviews' if draft else '')+'\n' for k,v in d.items())
  s=s[:i]+lines+s[i:]; open(p,'w').write(s)
ns=sys.argv[1]; en=json.loads(sys.argv[2]); vi=json.loads(sys.argv[3])
add(f'i18n/ns/{ns}.en.ts',en,False); add(f'i18n/ns/{ns}.vi.ts',vi,True)
