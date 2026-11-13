import json,subprocess,sys
for f in sys.argv[1:]:
    d=json.load(open(f))
    for sec,rows in d.items():
        rows={k.zfill(2) if k.isdigit() else k: v for k,v in rows.items()}
        json.dump(rows,open('/tmp/_m.json','w'))
        r=subprocess.run(['python3','tooling/handoff/bl.py','mark',sec,'/tmp/_m.json'],capture_output=True,text=True)
        print(f.split('/')[-1], sec, (r.stdout.strip() or r.stderr.strip()[-160:]))
