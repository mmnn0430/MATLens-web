import json
import httpx
import pytest
from fastapi.testclient import TestClient
from pymatgen.core import Structure
from backend import materials_project as mp
from backend.analysis import ROOT, xrd_analysis
from backend.models import Settings


@pytest.fixture
def upstream(monkeypatch):
    monkeypatch.setenv('MP_API_KEY', 'x' * 32)
    structure = Structure.from_file(ROOT / 'references' / 'silicon.cif')
    calls = []
    def respond(key, params):
        calls.append(params)
        return {'data': [{'material_id': 'mp-149', 'formula_pretty': 'Si',
            'structure': structure.as_dict(), 'symmetry': {'symbol': 'Fd-3m'},
            'band_gap': .6, 'density': 2.3, 'energy_above_hull': 0,
            'last_updated': '2026-01-01', 'is_stable': True}],
            'meta': {'total_doc': 1, 'db_version': 'test-fixture'}}
    monkeypatch.setattr(mp, 'request_summary', respond)
    return calls


def test_bounded_query():
    assert mp.normalize_query('formula', ' TiO2 ') == 'TiO2'
    assert mp.normalize_query('chemsys', 'Ti-O') == 'O-Ti'
    for mode, query in [('formula', '*'), ('formula', 'Xx2'), ('chemsys', 'Ti-Ti'), ('chemsys', 'Ti-Zz')]:
        with pytest.raises(mp.MPError): mp.normalize_query(mode, query)


def test_missing_key(tmp_path, monkeypatch):
    monkeypatch.delenv('MP_API_KEY', raising=False)
    monkeypatch.delenv('PMG_MAPI_KEY', raising=False)
    with pytest.raises(mp.MPError, match='먼저 연결'):
        mp.search(tmp_path, 'formula', 'Si')
    assert mp.status(tmp_path)['configured'] is False


@pytest.mark.parametrize('code', [401, 403, 429, 500, 422])
def test_upstream_errors_redacted(monkeypatch, code):
    original = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(code, text='secret-key-sensitive-response'))
    monkeypatch.setattr(mp.httpx, 'Client', lambda **kwargs: original(transport=transport, **kwargs))
    with pytest.raises(mp.MPError) as exc:
        mp.request_summary('secret-key-sensitive-response', {})
    assert 'secret-key' not in str(exc.value)


def test_timeout_redacted(monkeypatch):
    original = httpx.Client
    def timeout(request): raise httpx.ReadTimeout('secret-in-error')
    monkeypatch.setattr(mp.httpx, 'Client', lambda **kwargs: original(transport=httpx.MockTransport(timeout), **kwargs))
    with pytest.raises(mp.MPError) as exc: mp.request_summary('secret', {})
    assert 'secret' not in str(exc.value)


def test_key_verified_before_write(tmp_path, upstream, monkeypatch):
    result = mp.configure_key(tmp_path, 'a' * 32)
    assert result['configured'] and result['verified_at']
    assert 'a' * 32 not in json.dumps(result)
    def fail(*args): raise mp.MPError('인증 실패')
    monkeypatch.setattr(mp, 'request_summary', fail)
    with pytest.raises(mp.MPError): mp.configure_key(tmp_path, 'b' * 32)
    assert mp.get_key(tmp_path) == 'a' * 32


def test_immutable_snapshots_and_selection(tmp_path, upstream):
    first = mp.search(tmp_path, 'formula', 'Si')
    second = mp.search(tmp_path, 'formula', 'Si')
    assert first['snapshot_id'] == second['snapshot_id'] and second['cached']
    assert len(upstream) == 1 and 'structure' not in first['materials'][0]
    refreshed = mp.search(tmp_path, 'formula', 'Si', refresh=True)
    assert refreshed['snapshot_id'] != first['snapshot_id']
    assert mp.load_snapshot(tmp_path, first['snapshot_id'])['materials'][0]['id'] == 'mp-149'
    assert upstream[0]['deprecated'] is False and 'is_stable' not in upstream[0]
    for ids in [[], ['mp-invalid'], ['mp-149', 'mp-149']]:
        with pytest.raises(mp.MPError): mp.selected_materials(tmp_path, first['snapshot_id'], ids)
    with pytest.raises(mp.MPError): mp.load_snapshot(tmp_path, '../bad')


def test_pattern_wavelength_and_xrd_integration(tmp_path, upstream):
    snap = mp.search(tmp_path, 'formula', 'Si')
    material = mp.selected_materials(tmp_path, snap['snapshot_id'], ['mp-149'])[1][0]
    copper = mp.pattern_for(tmp_path, material, 1.5406, 10, 90)
    cobalt = mp.pattern_for(tmp_path, material, 1.7889, 10, 90)
    assert cobalt['x'][0] > copper['x'][0]
    assert mp.pattern_for(tmp_path, material, 1.5406, 10, 90) == copper
    settings = Settings(reference_source='mp', mp_snapshot=snap['snapshot_id'], mp_ids=['mp-149'], wavelength_confirmed=True)
    result = xrd_analysis((ROOT/'samples'/'silicon_synthetic.csv').read_bytes(), settings, mp_data_dir=tmp_path)
    assert result['reference_count'] == 1
    assert result['candidates'][0]['id'] == 'mp-149'
    assert result['candidates'][0]['source_kind'] == 'mp_calculated'
    assert result['candidates'][0]['score'] > 90
    assert result['mp']['compared'][0]['sha256'] == material['sha256']
    assert 'x' * 32 not in json.dumps(result)


def test_snapshot_failure_preserves_xrd(tmp_path):
    settings = Settings(reference_source='mp', mp_snapshot='a'*32, mp_ids=['mp-149'], wavelength_confirmed=True)
    result = xrd_analysis((ROOT/'samples'/'silicon_synthetic.csv').read_bytes(), settings, mp_data_dir=tmp_path)
    assert result['peaks'] and result['mp']['error'] and result['candidates'] == []


def test_local_api_and_secret_redaction(tmp_path, upstream, monkeypatch):
    from backend import main
    monkeypatch.setattr(main, 'DATA', tmp_path)
    client = TestClient(main.app, base_url='http://127.0.0.1')
    assert client.get('/api/materials-project/status').json()['configured']
    invalid = client.post('/api/materials-project/key', json={'api_key': {'secret': 'hidden'}})
    assert invalid.status_code == 422 and 'hidden' not in invalid.text
    denied = client.post('/api/materials-project/key', json={'api_key': 'a'*32}, headers={'origin': 'https://untrusted.example'})
    assert denied.status_code == 403
    response = client.post('/api/materials-project/search', json={'query': 'Si'})
    assert response.status_code == 200
    sid = response.json()['snapshot_id']
    assert client.get('/api/materials-project/snapshots/'+sid).status_code == 200
    assert client.post('/api/materials-project/search', json={'query': 'Si', 'limit': 999}).status_code == 422
