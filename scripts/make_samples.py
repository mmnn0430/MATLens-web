import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import json
import numpy as np
from PIL import Image,ImageDraw
from backend.analysis import references,ROOT

rng=np.random.default_rng(41)
x=np.linspace(10,90,4001);y=100+0.5*x+30*np.exp(-(x-10)/20)
ref=references(1.5406,10.,90.)[0]
for pos,intensity in zip(ref['x'],ref['y']):
    y+=intensity*12*np.exp(-4*np.log(2)*((x-pos)/.28)**2)
y+=rng.normal(0,2,len(x))
np.savetxt(ROOT/'samples'/'silicon_synthetic.csv',np.column_stack([x,y]),delimiter=',',header='two_theta,intensity',comments='')
im=Image.new('L',(960,720),35);d=ImageDraw.Draw(im);circles=[]
for row in range(5):
    for col in range(8):
        cx=int(65+col*116+rng.integers(-12,13));cy=int(60+row*112+rng.integers(-10,11));r=int(rng.integers(19,38))
        d.ellipse((cx-r,cy-r,cx+r,cy+r),fill=int(rng.integers(155,225)))
        circles.append({'cx':cx,'cy':cy,'radius_px':r})
d.rectangle((0,620,960,720),fill=10);d.rectangle((710,654,910,660),fill=255);d.text((745,674),'2 um / synthetic',fill=255)
im.save(ROOT/'samples'/'particles_synthetic.png')
(ROOT/'samples'/'matlens_pipeline_truth.json').write_text(json.dumps({'seed':41,'xrd_fwhm_deg':.28,'xrd_reference':ref['id'],'sem_count':40,'sem_circles':circles,'scale_px':200,'scale_length_um':2,'roi':[0,0,960,620]},indent=2))
print('Generated synthetic XRD and 40 circular SEM objects.')
