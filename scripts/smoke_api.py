"""Exercise the running local server using only newly-created disposable fixtures."""
import json
import time
from pathlib import Path
import httpx

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output'/'qa';OUT.mkdir(parents=True,exist_ok=True)
c=httpx.Client(base_url='http://127.0.0.1:8018',timeout=60)
assert c.get('/api/health').status_code==200
bad=c.post('/api/projects',data={'name':'invalid'},files={'xrd':('bad.csv',b'invalid')})
assert bad.status_code==400
files={'xrd':('fixture.csv',(ROOT/'samples'/'silicon_synthetic.csv').read_bytes()),'sem':('fixture.png',(ROOT/'samples'/'particles_synthetic.png').read_bytes()),'cif':('silicon.cif',(ROOT/'references'/'silicon.cif').read_bytes())}
p=c.post('/api/projects',data={'name':'API QA fixture','description':'Disposable synthetic test'},files=files).json()
assert p.get('id'),p
pid=p['id']
settings={'wavelength_confirmed':True,'same_sample':True,'roi':[0,0,960,620],'scale_px':200,'scale_length':2,'scale_confirmed':True}
def run(settings):
    started=c.post(f'/api/projects/{pid}/runs',json=settings)
    assert started.status_code==200,started.text
    rid=started.json()['id']
    for _ in range(90):
        r=c.get('/api/runs/'+rid).json()
        if r['status']=='complete':return r['result']
        assert r['status']!='failed',r
        time.sleep(.5)
    raise AssertionError('Timed out')

r=run(settings);assert r['sem']['stats']['count']==40 and r['report']['integrated']
for kind,ext in [('json','json'),('xrd','csv'),('sem','csv'),('overlay','png'),('pdf','pdf')]:
    response=c.get(f"/api/runs/{r['id']}/download/{kind}")
    assert response.status_code==200,(kind,response.text[:100])
    assert len(response.content)>30
    (OUT/f'report-{kind}.{ext}').write_bytes(response.content)
r2=run({**settings,'scale_length':4,'segmentation_confirmed':True,'ai':True})
assert abs(r2['sem']['stats']['median']/r['sem']['stats']['median']-2)<1e-8
assert r2['sem']['confirmed'] is True
assert c.get('/api/runs/'+r['id']).json()['result']['sem']['stats']['median']==r['sem']['stats']['median']
assert len(c.get('/api/projects/'+pid).json()['runs'])==2
assert r2['ai']['status'] in ('unavailable','complete','failed')
assert c.delete('/api/projects/'+pid).status_code==200
assert c.get('/api/projects/'+pid).status_code==404
assert c.get('/api/runs/'+r['id']).status_code==404
(OUT/'api-checks.json').write_text(json.dumps({'upload':'pass','invalid_csv':'pass','user_cif':'pass','sample_count':40,'export_formats':['PDF','JSON','CSV','PNG'],'scale_reanalysis':'pass','history_immutable':'pass','project_delete':'pass','ai_status':r2['ai']['status']},indent=2))
print('API integration checks passed; PDF/CSV/JSON/PNG saved in output/qa.')
