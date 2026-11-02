"""Bounded MP REST integration and immutable structure snapshots.

Contract checked against https://api.materialsproject.org/openapi.json.
Only chemical queries and the API key leave the server, never experimental files.
"""
import hashlib
import json
import math
import os
import re
import threading
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import httpx
from dotenv import dotenv_values, set_key
from pymatgen.core import Composition, Element, Structure
from pymatgen.analysis.diffraction.xrd import XRDCalculator
from importlib.metadata import version

BASE_URL = 'https://api.materialsproject.org'
FIELDS = 'material_id,formula_pretty,structure,symmetry,density,band_gap,energy_above_hull,is_stable,theoretical,last_updated,origins'
CACHE_HOURS = 24
KEY_LOCK = threading.Lock()
SEARCH_LOCK = threading.Lock()


class MPError(ValueError):
    pass


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def get_key(data_dir):
    path = Path(data_dir) / '.mp.env'
    local = dotenv_values(path).get('MP_API_KEY') if path.exists() else None
    return (local or os.getenv('MP_API_KEY') or os.getenv('PMG_MAPI_KEY') or '').strip()


def status(data_dir):
    path = Path(data_dir) / '.mp.env'
    local = dotenv_values(path) if path.exists() else {}
    return {'configured': bool(get_key(data_dir)), 'verified_at': local.get('MP_VERIFIED_AT'),
            'source': 'local' if local.get('MP_API_KEY') else 'environment',
            'dashboard_url': 'https://materialsproject.org/dashboard'}


def request_summary(key, params):
    # No automatic redirection, no raw upstream exception or response in user errors.
    try:
        with httpx.Client(timeout=httpx.Timeout(30, connect=10), follow_redirects=False) as client:
            response = client.get(BASE_URL + '/materials/summary/',
                                  headers={'X-API-KEY': key, 'User-Agent': 'MatLens/1.1'}, params=params)
        if response.status_code in (401, 403):
            raise MPError('MP API 키를 확인해주세요. 현재 계정의 접근 권한으로 인증되지 않았어요.')
        if response.status_code == 429:
            raise MPError('MP 요청 한도에 도달했어요. 잠시 후 다시 검색해주세요.')
        if response.status_code >= 500:
            raise MPError('Materials Project 서버에 일시적인 문제가 있어요. 나중에 다시 시도해주세요.')
        if response.status_code != 200:
            raise MPError('MP 검색 요청을 처리하지 못했어요. 검색 조건과 계정 접근 권한을 확인해주세요.')
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
            raise MPError('MP 응답 형식이 예상과 달라요. 기존 분석 결과는 유지돼요.')
        return payload
    except (httpx.HTTPError, json.JSONDecodeError):
        raise MPError('MP 서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.') from None


def configure_key(data_dir, key):
    key = key.strip()
    if not re.fullmatch(r'[A-Za-z0-9]{32}', key):
        raise MPError('MP 대시보드에서 발급한 32자리 API 키를 입력해주세요.')
    response = request_summary(key, {'material_ids': 'mp-149', '_fields': 'material_id', '_limit': 1})
    if not response['data']:
        raise MPError('키 인증 후 기준 자료를 확인하지 못했어요. MP 계정의 데이터 접근 권한을 확인해주세요.')
    path = Path(data_dir) / '.mp.env'
    path.parent.mkdir(parents=True, exist_ok=True)
    with KEY_LOCK:
        path.touch(mode=0o600, exist_ok=True)
        set_key(str(path), 'MP_API_KEY', key)
        set_key(str(path), 'MP_VERIFIED_AT', timestamp())
        if os.name != 'nt':
            path.chmod(0o600)
    return status(data_dir)


def normalize_query(mode, query):
    query = query.strip()
    if not query or len(query) > 100:
        raise MPError('검색할 화학식 또는 원소계를 입력해주세요.')
    try:
        if mode == 'formula':
            if not re.fullmatch(r'[A-Za-z0-9().]+', query):
                raise ValueError()
            composition = Composition(query, strict=True)
            if not 1 <= len(composition.elements) <= 6 or any(v <= 0 for v in composition.values()):
                raise ValueError()
            return composition.reduced_formula
        if mode == 'chemsys':
            parts = [v for v in re.split(r'[-,\s]+', query) if v]
            if not 1 <= len(parts) <= 6 or len(set(parts)) != len(parts):
                raise ValueError()
            if not all(Element.is_valid_symbol(p) for p in parts):
                raise ValueError()
            return '-'.join(sorted(parts))
    except (ValueError, KeyError, TypeError):
        pass
    raise MPError('화학식은 TiO2, 원소계는 Ti-O처럼 입력해주세요. 최대 6종 원소를 지원해요.')


def atomic_json(path, document):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temp.write_text(json.dumps(document, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def load_snapshot(data_dir, snapshot_id):
    if not re.fullmatch(r'[a-f0-9]{32}', snapshot_id or ''):
        raise MPError('MP 후보를 먼저 검색하고 선택해주세요.')
    path = Path(data_dir) / 'mp' / 'snapshots' / (snapshot_id + '.json')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        raise MPError('저장된 MP 검색 결과를 찾지 못했어요. 다시 검색해주세요.') from None


def finite(value):
    return float(value) if isinstance(value, (float, int)) and math.isfinite(value) else None


def normalize_material(doc):
    mid = str(doc.get('material_id', ''))
    if not re.fullmatch(r'(mp|mvc)-[a-z0-9]+', mid):
        raise ValueError('unsupported material id')
    structure = Structure.from_dict(doc['structure'])
    if not 1 <= len(structure) <= 300 or not structure.is_ordered:
        raise ValueError('unsupported structure size/disorder')
    structure_json = structure.as_dict()
    digest = hashlib.sha256(json.dumps(structure_json, sort_keys=True, allow_nan=False).encode()).hexdigest()
    symmetry = doc.get('symmetry') or {}
    return {'id': mid, 'name': str(doc.get('formula_pretty') or structure.composition.reduced_formula),
            'formula': structure.composition.reduced_formula,
            'structure': structure_json, 'sha256': digest,
            'elements': [str(e) for e in structure.composition.elements],
            'spacegroup': symmetry.get('symbol'), 'crystal_system': symmetry.get('crystal_system'),
            'lattice': dict(zip(('a','b','c','alpha','beta','gamma'), (*structure.lattice.abc,*structure.lattice.angles))),
            'density': finite(doc.get('density')), 'band_gap': finite(doc.get('band_gap')),
            'energy_above_hull': finite(doc.get('energy_above_hull')), 'is_stable': doc.get('is_stable'),
            'theoretical': doc.get('theoretical'), 'last_updated': doc.get('last_updated'),
            'origins': doc.get('origins') or [], 'url': f'https://materialsproject.org/materials/{mid}',
            'source_kind': 'mp_calculated',
            'source': f'Materials Project {mid}. 계산 구조에서 생성한 이론 패턴; 시료 측정값이 아님.'}


def public_snapshot(snapshot, cached=False):
    return {**{k:v for k,v in snapshot.items() if k != 'materials'}, 'cached': cached,
            'materials': [{k:v for k,v in m.items() if k not in ('structure','origins')} for m in snapshot['materials']]}


def search(data_dir, mode, query, limit=30, refresh=False):
    query = normalize_query(mode, query)
    key = get_key(data_dir)
    if not key:
        raise MPError('Materials Project API 키를 먼저 연결해주세요.')
    if not 1 <= limit <= 50:
        raise MPError('검색은 최대 50개 후보까지 지원해요.')
    filters = {mode: query, 'deprecated': False, '_limit': limit, '_skip': 0,
               '_fields': FIELDS, '_sort_fields': 'material_id', 'license': 'BY-C', 'id_format': 'legacy'}
    cache_id = hashlib.sha256(json.dumps(filters, sort_keys=True).encode()).hexdigest()
    index = Path(data_dir) / 'mp' / 'queries' / (cache_id + '.json')
    # Serialize short, user-triggered searches to avoid duplicated concurrent upstream calls.
    with SEARCH_LOCK:
        if index.exists() and not refresh:
            try:
                pointer = json.loads(index.read_text('utf-8'))
                snapshot = load_snapshot(data_dir, pointer['snapshot_id'])
                if datetime.now(timezone.utc)-datetime.fromisoformat(snapshot['fetched_at']) < timedelta(hours=CACHE_HOURS):
                    return public_snapshot(snapshot, True)
            except (OSError, ValueError, KeyError):
                pass
        payload = request_summary(key, filters)
        materials=[]; skipped=[]; seen=set()
        for doc in payload['data'][:limit]:
            try:
                material=normalize_material(doc)
                if material['id'] not in seen:
                    materials.append(material); seen.add(material['id'])
            except (ValueError, TypeError, KeyError):
                skipped.append(str(doc.get('material_id','unknown')))
        meta=payload.get('meta') or {}
        total=meta.get('total_doc')
        snapshot={'snapshot_id':uuid.uuid4().hex,'query':{'mode':mode,'value':query,'limit':limit},
                  'fetched_at':timestamp(),'database_version':meta.get('db_version') or meta.get('version'),
                  'api_endpoint':BASE_URL+'/materials/summary/','license_filter':'BY-C',
                  'total_found':total,'truncated':bool(isinstance(total,int) and total>limit) or len(payload['data'])>=limit,
                  'materials':materials,'skipped_ids':skipped,
                  'note':'화학식은 해당 조성, 원소계는 정확히 그 원소계만 검색해요. 하위 원소계·준안정상은 별도 검토하세요. 후보는 안정성으로 제외하지 않아요.'}
        atomic_json(Path(data_dir)/'mp'/'snapshots'/(snapshot['snapshot_id']+'.json'),snapshot)
        atomic_json(index,{'snapshot_id':snapshot['snapshot_id']})
        return public_snapshot(snapshot)


def selected_materials(data_dir, snapshot_id, selected_ids):
    snapshot=load_snapshot(data_dir,snapshot_id)
    materials={m['id']:m for m in snapshot['materials']}
    if not selected_ids or len(selected_ids)>20 or len(set(selected_ids))!=len(selected_ids):
        raise MPError('비교할 MP 후보를 1~20개 선택해주세요.')
    if any(mid not in materials for mid in selected_ids):
        raise MPError('선택한 후보가 해당 MP 검색 결과에 없어요. 다시 선택해주세요.')
    return snapshot,[materials[mid] for mid in selected_ids]


def pattern_for(data_dir, material, wavelength, low, high):
    engine=version('pymatgen')
    cache_key=hashlib.sha256(json.dumps([material['sha256'],wavelength,low,high,engine]).encode()).hexdigest()
    path=Path(data_dir)/'mp'/'patterns'/(cache_key+'.json')
    pattern=None
    if path.exists():
        try:pattern=json.loads(path.read_text('utf-8'))
        except (OSError,json.JSONDecodeError):pass
    if pattern is None:
        structure=Structure.from_dict(material['structure'])
        result=XRDCalculator(wavelength=wavelength).get_pattern(structure,two_theta_range=(low,high))
        pattern={'x':result.x.tolist(),'y':result.y.tolist(),'hkl':[str(h) for h in result.hkls],
                 'pattern_engine':'pymatgen '+engine,'pattern_wavelength':wavelength,'pattern_range':[low,high]}
        atomic_json(path,pattern)
    return {**{k:v for k,v in material.items() if k!='structure'}, **pattern,
            'name':material['name']+' · '+material['id']}


def reference_patterns(data_dir, snapshot_id, selected_ids, wavelength, low, high):
    snapshot,materials=selected_materials(data_dir,snapshot_id,selected_ids)
    refs=[];skipped=[]
    for material in materials:
        try:refs.append(pattern_for(data_dir,material,wavelength,low,high))
        except (ValueError,TypeError,KeyError):skipped.append(material['id'])
    provenance={k:v for k,v in snapshot.items() if k!='materials'}
    provenance.update(selected_ids=selected_ids,pattern_skipped_ids=skipped,
        compared=[{'id':m['id'],'sha256':m['sha256'],'last_updated':m['last_updated']} for m in refs])
    return refs,provenance
