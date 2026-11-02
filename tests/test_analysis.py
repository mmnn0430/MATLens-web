import io
import json
from pathlib import Path
import numpy as np
import pytest
from PIL import Image,ImageDraw
from backend.analysis import xrd_analysis,sem_analysis,csv_preview,ROOT,image_preview
from backend.models import Settings,AIReport
from backend.reports import validate_ai,ai_report


def csv_bytes(x,y):
    output=io.StringIO();np.savetxt(output,np.column_stack([x,y]),delimiter=',',header='angle,intensity',comments='');return output.getvalue().encode()


def test_gaussian_width_and_scherrer():
    x=np.linspace(20,60,4001);width=.4;y=10+1000*np.exp(-4*np.log(2)*((x-40)/width)**2)
    result=xrd_analysis(csv_bytes(x,y),Settings(low=20,high=60,wavelength_confirmed=True,smooth=9))
    assert len(result['peaks'])==1
    peak=result['peaks'][0]
    assert abs(peak['position']-40)<.01
    assert abs(peak['fwhm']-width)/width<.05
    expected=.9*.15406/(np.radians(width)*np.cos(np.radians(20)))
    assert abs(peak['size_nm']-expected)/expected<.05


def test_constant_and_invalid_csv():
    x=np.linspace(10,90,1000)
    r=xrd_analysis(csv_bytes(x,np.ones_like(x)*12),Settings())
    assert r['peaks']==[] and r['size_nm'] is None
    with pytest.raises(ValueError):csv_preview(b'not,csv\n1,2')


def test_unconfirmed_wavelength():
    raw=(ROOT/'samples'/'silicon_synthetic.csv').read_bytes()
    result=xrd_analysis(raw,Settings())
    assert result['size_nm'] is None and result['candidates']==[]


def test_reference_matching_sample():
    result=xrd_analysis((ROOT/'samples'/'silicon_synthetic.csv').read_bytes(),Settings(wavelength_confirmed=True))
    assert result['candidates'][0]['id']=='COD-9008566'
    assert len(result['candidates'][0]['pairs'])>=3
    assert result['candidates'][0]['score']>90
    for peak in result['peaks']:
        if peak['status']=='valid':assert abs(peak['fwhm']-.28)<.025


def image_bytes(im):
    f=io.BytesIO();im.save(f,format='PNG');return f.getvalue()


def test_sem_ground_truth_and_scale(tmp_path):
    raw=(ROOT/'samples'/'particles_synthetic.png').read_bytes()
    s=Settings(roi=[0,0,960,620],scale_px=200,scale_length=2,scale_confirmed=True)
    r=sem_analysis(raw,s,tmp_path)
    gt=json.loads((ROOT/'samples'/'matlens_pipeline_truth.json').read_text(encoding='utf-8'))
    assert r['stats']['count']==40
    expected=np.median([v['radius_px']*2*.01 for v in gt['sem_circles']])
    assert abs(r['stats']['median']-expected)/expected<.08
    s.scale_length=4;r2=sem_analysis(raw,s,tmp_path)
    assert r2['stats']['median']==pytest.approx(2*r['stats']['median'])
    assert r2['objects'][0]['area']==pytest.approx(4*r['objects'][0]['area'])
    s.scale_confirmed=False;r3=sem_analysis(raw,s,tmp_path)
    assert r3['unit']=='px'
    assert r3['stats']['median']>20


def test_empty_image_and_roi(tmp_path):
    raw=image_bytes(Image.new('L',(100,100),120))
    r=sem_analysis(raw,Settings(roi=[0,0,100,100]),tmp_path)
    assert r['stats']['count']==0 and r['stats']['median'] is None
    with pytest.raises(ValueError):sem_analysis(raw,Settings(roi=[-1,0,50,50]),tmp_path)


def test_scale_candidate():
    r=image_preview((ROOT/'samples'/'particles_synthetic.png').read_bytes())
    assert r['scale_candidate'] is not None
    assert abs(r['scale_candidate']['length_px']-200)<=2
    assert r['roi'][3]<=630


def test_ai_evidence_validation(monkeypatch,tmp_path):
    report=AIReport(claims=[{'kind':'observation','text':'유효한 피크가 관찰돼요.','evidence_ids':['xrd.peaks']}])
    validate_ai(report,{'xrd.peaks':{'value':3}})
    report.claims[0].text='직경은 999 nm예요.'
    with pytest.raises(ValueError):validate_ai(report,{'xrd.peaks':{'value':3}})
    report.claims[0].text='피크가 있어요.';report.claims[0].evidence_ids=['invented']
    with pytest.raises(ValueError):validate_ai(report,{})
    monkeypatch.delenv('GEMINI_API_KEY',raising=False)
    assert ai_report({'settings':{'ai':True}},tmp_path)['status']=='unavailable'


def test_csv_columns_and_bad_conditions():
    text='counts\tangle\textra\n'+'\n'.join(f'{i+100}\t{i+20}\tmeta' for i in range(30))
    p=csv_preview(text.encode());assert p['x_col']==1 and p['y_col']==0
    r=xrd_analysis(text.encode(),Settings(x_col=1,y_col=0,low=10,high=80));assert len(r['x'])==30
    with pytest.raises(ValueError):Settings(low=90,high=20)
    with pytest.raises(ValueError):Settings(wavelength=float('nan'))


def test_overlap_and_instrumental_guard():
    x=np.linspace(30,50,2001)
    y=10+1000*np.exp(-4*np.log(2)*((x-40)/.2)**2)
    result=xrd_analysis(csv_bytes(x,y),Settings(wavelength_confirmed=True,instrumental=.4))
    assert result['size_nm'] is None


def test_resolved_overlapping_peaks_are_not_used_for_size():
    x=np.linspace(30,50,4001)
    y=10+1000*np.exp(-4*np.log(2)*((x-40)/.3)**2)+900*np.exp(-4*np.log(2)*((x-40.48)/.3)**2)
    r=xrd_analysis(csv_bytes(x,y),Settings(wavelength_confirmed=True,separation=.1,smooth=0))
    assert len(r['peaks'])>=2
    assert any(abs(p['position']-40)<.03 for p in r['peaks'])
    assert any(abs(p['position']-40.48)<.03 for p in r['peaks'])
    assert all(p['size_nm'] is None for p in r['peaks'])


def test_missing_and_duplicate_rows_are_reported():
    x=np.linspace(20,60,200)
    raw=csv_bytes(x,np.ones_like(x)*10)+b'20,12\n21,nan\n'
    r=xrd_analysis(raw,Settings(low=20,high=60))
    assert any('중복' in note for note in r['notes'])
    assert any('결측' in note for note in r['notes'])


def test_touching_particles(tmp_path):
    im=Image.new('L',(240,160),20);d=ImageDraw.Draw(im)
    d.ellipse((40,40,120,120),fill=210);d.ellipse((110,40,190,120),fill=210)
    r=sem_analysis(image_bytes(im),Settings(roi=[0,0,240,160],min_distance=20),tmp_path)
    assert r['stats']['count']==2


def test_gemini_failure_preserves_rule_report(monkeypatch,tmp_path):
    from google import genai
    monkeypatch.setenv('GEMINI_API_KEY','test-placeholder')
    monkeypatch.setenv('GEMINI_MODEL','test-placeholder')
    def fail(*args,**kwargs):raise RuntimeError('simulated SDK error')
    monkeypatch.setattr(genai,'Client',fail)
    r={'settings':{'ai':True,'same_sample':False,'scale_confirmed':False,'segmentation_confirmed':False},'description':'test','report':{'summary':['rule survives']}}
    assert ai_report(r,tmp_path)['status']=='failed'
    assert r['report']['summary']==['rule survives']
