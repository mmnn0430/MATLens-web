import io
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.utm_engine import parse_utm_raw_text, analyze_utm_dataset
from app.core.utm_pdf import generate_utm_pdf_report, generate_utm_charts_image
from app.engine.sem_engine import load_sem_grayscale_and_rgb


def fixture_data():
    lines=['일련번호\t시간\t하중\t변위\t응력\t변형률','\tsec\tN\tmm\tMPa\t%']
    for i in range(1,101):
        strain=i*.01
        stress=700*strain if strain<=.3 else 210+50*(strain-.3)
        lines.append(f'{i}\t{i*.1}\t{stress*10}\t{strain*.5}\t{stress}\t{strain}')
    return parse_utm_raw_text('\n'.join(lines))


def test_invalid_sem_is_validation_error():
    with pytest.raises(ValueError, match='SEM 이미지'):
        load_sem_grayscale_and_rgb(b'not an image')
    with TestClient(app) as client:
        project=client.post('/api/projects',json={'sample_name':'QA invalid SEM'}).json()
        try:
            r=client.post(f"/api/projects/{project['id']}/files/sem",files={'file':('invalid.png',b'not an image','image/png')})
            assert r.status_code == 400
        finally:
            client.delete(f"/api/projects/{project['id']}")


def test_utm_exports_use_same_regression_and_dimensions():
    req={'parsed_data':fixture_data(),'specimen_area_A0':20,'specimen_gauge_L0':50,'elastic_start_strain_pct':.05,'elastic_end_strain_pct':.3}
    # File-provided stress/strain take precedence; dimensions remain in the request.
    with TestClient(app) as client:
        analyzed=client.post('/api/utm/analyze',json=req).json()
        exported=client.post('/api/utm/download/json',json=req).json()['result']
        assert analyzed == exported
        assert analyzed['elastic_modulus']['E_GPa'] == 70.0


def test_utm_time_chart_uses_newtons(monkeypatch):
    from matplotlib.axes import Axes
    original_plot=Axes.plot
    original_ylabel=Axes.set_ylabel
    captured=[]; labels=[]
    def plot(self,*args,**kw):
        if kw.get('color') == '#7C3AED': captured.append(list(args[1]))
        return original_plot(self,*args,**kw)
    def ylabel(self,label,*args,**kw):
        labels.append(label)
        return original_ylabel(self,label,*args,**kw)
    monkeypatch.setattr(Axes,'plot',plot);monkeypatch.setattr(Axes,'set_ylabel',ylabel)
    data=analyze_utm_dataset(fixture_data(),elastic_start_strain_pct=.05,elastic_end_strain_pct=.3)
    assert generate_utm_charts_image(data).startswith(b'\x89PNG')
    assert captured == [data['curves']['load_N']]
    assert 'Load (kgf)' not in labels


def test_utm_pdf_escapes_markup_and_preserves_korean():
    import fitz
    data=analyze_utm_dataset(fixture_data(),elastic_start_strain_pct=.05,elastic_end_strain_pct=.3)
    pdf=generate_utm_pdf_report(data,file_name='한글 <시편>.txt',analysis_name='한글 분석 & 검증',notes='시험 <메모> & 데이터')
    doc=fitz.open(stream=pdf,filetype='pdf')
    text='\n'.join(p.get_text() for p in doc)
    assert '한글' in text and '시험 <메모>' in text
    assert '70.0 GPa' in text
