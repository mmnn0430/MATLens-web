import csv
import hashlib
import importlib.metadata
import io
import json
import os
import re
import shutil
import sqlite3
import uuid
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime,timezone
from pathlib import Path
from fastapi import FastAPI,UploadFile,File,Form,HTTPException,Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from urllib.parse import urlsplit
from fastapi.responses import FileResponse,Response,JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError, BaseModel, SecretStr, Field
from typing import Literal
from dotenv import load_dotenv
from .analysis import csv_preview,image_preview,xrd_analysis,sem_analysis
from .models import Settings
from .reports import rules,ai_report,pdf_report
from . import materials_project as mp

ROOT=Path(__file__).resolve().parents[1]
load_dotenv(ROOT/'.env')
DATA=Path(os.getenv('MATLENS_DATA',str(ROOT/'runtime'))).resolve()
DATA.mkdir(parents=True,exist_ok=True)
DB=DATA/'matlens.sqlite3'
MAX_BYTES=20*1024*1024


def connection():
    con=sqlite3.connect(DB,timeout=30);con.row_factory=sqlite3.Row;return con


def init_db():
    with connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, document TEXT NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, project_id TEXT, status TEXT, stage TEXT, created_at TEXT, document TEXT, error TEXT)')
        db.execute("UPDATE runs SET status='failed', error='서버가 재시작되어 중단됐어요. 새 분석을 실행해주세요.' WHERE status IN ('queued','running')")


def safe_id(value):
    if not re.fullmatch(r'[a-f0-9]{32}',value): raise HTTPException(404,'항목을 찾지 못했어요.')
    return value


def project(pid):
    safe_id(pid)
    with connection() as db: row=db.execute('SELECT document FROM projects WHERE id=?',(pid,)).fetchone()
    if not row: raise HTTPException(404,'시료를 찾지 못했어요.')
    return json.loads(row['document'])


def runrow(rid):
    safe_id(rid)
    with connection() as db: row=db.execute('SELECT * FROM runs WHERE id=?',(rid,)).fetchone()
    if not row: raise HTTPException(404,'분석을 찾지 못했어요.')
    return dict(row)


def stamp(): return datetime.now(timezone.utc).isoformat()


def progress(rid,stage):
    with connection() as db: db.execute("UPDATE runs SET status='running', stage=? WHERE id=?",(stage,rid))


def execute_run(rid,pid,settings):
    p=project(pid); s=Settings(**settings); source=DATA/pid; folder=source/rid;folder.mkdir(exist_ok=True)
    result={'id':rid,'project_id':pid,'name':p['name'],'description':p['description'],'sample':p['sample'],
            'created_at':stamp(),'settings':settings,'xrd':None,'sem':None,'errors':{}}
    try:
        for kind in ('xrd','sem'):
            if kind not in p['files']:continue
            progress(rid,'XRD 피크 분석' if kind=='xrd' else 'SEM 입자 분리')
            raw=(source/p['files'][kind]['stored']).read_bytes()
            try:
                if kind=='xrd':result[kind]=xrd_analysis(raw,s,source/p['files']['cif']['stored'] if 'cif' in p['files'] else None,DATA)
                else:result[kind]=sem_analysis(raw,s,folder)
            except ValueError as ex:result['errors'][kind]=str(ex)
        if not result['xrd'] and not result['sem']: raise ValueError(' / '.join(result['errors'].values()) or '분석할 데이터가 없어요.')
        result['provenance']={'algorithm_version':'1.1.0','files':p['files'],
            'versions':{lib:importlib.metadata.version(lib) for lib in ('numpy','scipy','pandas','scikit-image','pymatgen','google-genai')},
            'reference_hashes':[{k:c[k] for k in ('id','sha256','source')} for c in result['xrd']['candidates']] if result['xrd'] else []}
        if result['xrd'] and result['xrd'].get('mp'):result['provenance']['materials_project']=result['xrd']['mp']
        result['report']=rules(result); progress(rid,'리포트 작성')
        result['ai']=ai_report(result,folder)
        text=json.dumps(result,ensure_ascii=False,allow_nan=False)
        (folder/'result.json').write_text(text,encoding='utf-8')
        with connection() as db:db.execute("UPDATE runs SET status='complete',stage='분석 완료',document=? WHERE id=?",(text,rid))
    except Exception as ex:
        message=str(ex) if isinstance(ex,ValueError) else '분석 처리 중 오류가 발생했어요. 입력 파일과 조건을 확인해주세요.'
        with connection() as db:db.execute("UPDATE runs SET status='failed',error=? WHERE id=?",(message,rid))


@asynccontextmanager
async def lifespan(app):
    init_db();app.state.pool=ProcessPoolExecutor(max_workers=2)
    yield
    app.state.pool.shutdown(wait=True,cancel_futures=True)


app=FastAPI(title='MatLens API',lifespan=lifespan)


class MPKeyInput(BaseModel):
    api_key: SecretStr


class MPSearchInput(BaseModel):
    mode: Literal['formula','chemsys'] = 'formula'
    query: str = Field(min_length=1,max_length=100)
    limit: int = Field(30,ge=1,le=50)
    refresh: bool = False


def local_request(request):
    allowed={'127.0.0.1','localhost','::1'}
    if request.url.hostname not in allowed:
        raise HTTPException(403,'MP 연결 설정은 로컬 앱에서만 변경할 수 있어요.')
    origin=request.headers.get('origin')
    if origin and urlsplit(origin).hostname not in allowed:
        raise HTTPException(403,'다른 사이트에서 MP 연결을 요청할 수 없어요.')
    if request.headers.get('sec-fetch-site')=='cross-site':
        raise HTTPException(403,'다른 사이트에서 MP 연결을 요청할 수 없어요.')


@app.exception_handler(RequestValidationError)
async def safe_validation_error(request,exc):
    if request.url.path=='/api/materials-project/key':
        return JSONResponse(status_code=422,content={'detail':'MP API 키 입력 형식을 확인해주세요.'})
    return await request_validation_exception_handler(request,exc)


@app.get('/api/materials-project/status')
def mp_status():return mp.status(DATA)


@app.post('/api/materials-project/key')
def mp_key(body:MPKeyInput,request:Request):
    local_request(request)
    try:return mp.configure_key(DATA,body.api_key.get_secret_value())
    except mp.MPError as ex:raise HTTPException(400,str(ex)) from None


@app.post('/api/materials-project/search')
def mp_search(body:MPSearchInput,request:Request):
    local_request(request)
    try:return mp.search(DATA,**body.model_dump())
    except mp.MPError as ex:raise HTTPException(400,str(ex)) from None


@app.get('/api/materials-project/snapshots/{snapshot_id}')
def mp_snapshot(snapshot_id):
    try:return mp.public_snapshot(mp.load_snapshot(DATA,snapshot_id),True)
    except mp.MPError as ex:raise HTTPException(404,str(ex)) from None


@app.get('/api/health')
def health():return {'status':'ok','ai_configured':bool(os.getenv('GEMINI_API_KEY') and os.getenv('GEMINI_MODEL')),'mp_configured':mp.status(DATA)['configured']}


@app.get('/api/projects')
def projects():
    with connection() as db:rows=db.execute('SELECT document FROM projects ORDER BY rowid DESC').fetchall()
    return [json.loads(r['document']) for r in rows]


async def read_upload(file):
    raw=await file.read(MAX_BYTES+1)
    if len(raw)>MAX_BYTES:raise HTTPException(413,'파일당 최대 20MB까지 업로드할 수 있어요.')
    if not raw:raise HTTPException(400,'빈 파일이에요.')
    return raw


def create_project(name,description,uploads,sample=False):
    pid=uuid.uuid4().hex; folder=DATA/pid;folder.mkdir()
    p={'id':pid,'name':name[:100],'description':description[:2000],'created_at':stamp(),'sample':sample,'files':{},'preview':{}}
    try:
        for kind,(filename,raw) in uploads.items():
            if kind=='xrd':p['preview']['xrd']=csv_preview(raw)
            if kind=='sem':p['preview']['sem']=image_preview(raw)
            if kind=='cif':
                if len(raw)>1024*1024 or b'_cell_length_a' not in raw:raise ValueError('1MB 이하의 결정구조 CIF를 사용해주세요.')
            ext={'xrd':'.csv','sem':'.image','cif':'.cif'}[kind];stored=kind+ext
            (folder/stored).write_bytes(raw)
            p['files'][kind]={'name':Path(filename).name,'stored':stored,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
        with connection() as db:db.execute('INSERT INTO projects VALUES (?,?)',(pid,json.dumps(p,ensure_ascii=False)))
    except Exception:
        shutil.rmtree(folder);raise
    return p


@app.post('/api/projects')
async def upload(name:str=Form(...,max_length=100),description:str=Form('',max_length=2000),xrd:UploadFile|None=File(None),sem:UploadFile|None=File(None),cif:UploadFile|None=File(None)):
    if not name.strip() or not(xrd or sem):raise HTTPException(400,'시료명과 XRD 또는 SEM 파일이 필요해요.')
    uploads={}
    for kind,file in [('xrd',xrd),('sem',sem),('cif',cif)]:
        if file:uploads[kind]=(file.filename or kind,await read_upload(file))
    try:return create_project(name.strip(),description,uploads)
    except ValueError as ex:raise HTTPException(400,str(ex)) from None


@app.post('/api/sample')
def sample():
    return create_project('Silicon · 샘플 시료','Si CIF 기반 합성 XRD와 원형 객체로 생성한 합성 SEM. 실제 시료가 아니며 파이프라인 체험용입니다.',
        {'xrd':('silicon_synthetic.csv',(ROOT/'samples'/'silicon_synthetic.csv').read_bytes()),
         'sem':('particles_synthetic.png',(ROOT/'samples'/'particles_synthetic.png').read_bytes())},True)


@app.get('/api/projects/{pid}')
def get_project(pid):
    p=project(pid)
    with connection() as db:rows=db.execute('SELECT id,status,stage,created_at,error FROM runs WHERE project_id=? ORDER BY rowid DESC',(pid,)).fetchall()
    return {**p,'runs':[dict(r) for r in rows]}


@app.delete('/api/projects/{pid}')
def delete_project(pid):
    project(pid)
    with connection() as db:
        if db.execute("SELECT id FROM runs WHERE project_id=? AND status IN ('queued','running')",(pid,)).fetchone():raise HTTPException(409,'실행 중인 분석이 끝난 뒤 삭제해주세요.')
        folder=(DATA/pid).resolve()
        if folder.parent!=DATA:raise HTTPException(400,'잘못된 경로')
        shutil.rmtree(folder,ignore_errors=True)
        db.execute('DELETE FROM runs WHERE project_id=?',(pid,));db.execute('DELETE FROM projects WHERE id=?',(pid,))
    return {'deleted':True}


@app.get('/api/projects/{pid}/files/{kind}')
def original(pid,kind):
    p=project(pid)
    if kind not in p['files']:raise HTTPException(404)
    file=p['files'][kind]
    return FileResponse(DATA/pid/file['stored'],media_type='image/png' if kind=='sem' else 'application/octet-stream')


@app.post('/api/projects/{pid}/runs')
def start_run(pid,s:Settings):
    project(pid)
    if s.reference_source in ('mp','combined'):
        try:mp.selected_materials(DATA,s.mp_snapshot,s.mp_ids)
        except mp.MPError as ex:raise HTTPException(400,str(ex)) from None
    with connection() as db:
        if db.execute("SELECT COUNT(*) FROM runs WHERE status IN ('queued','running')").fetchone()[0]>=4:raise HTTPException(429,'대기 중인 분석이 많아요. 완료 후 다시 실행해주세요.')
        rid=uuid.uuid4().hex; db.execute('INSERT INTO runs VALUES (?,?,?,?,?,?,?)',(rid,pid,'queued','분석 대기',stamp(),None,None))
    app.state.pool.submit(execute_run,rid,pid,s.model_dump())
    return {'id':rid}


@app.get('/api/runs/{rid}')
def get_run(rid):
    row=runrow(rid)
    return {**row,'result':json.loads(row.pop('document')) if row.get('document') else None,'document':None}


@app.get('/api/runs/{rid}/download/{kind}')
def download(rid,kind):
    row=runrow(rid)
    if row['status']!='complete':raise HTTPException(409,'분석 완료 후 다운로드할 수 있어요.')
    result=json.loads(row['document']);folder=DATA/row['project_id']/rid
    if kind in ('overlay','roi'):
        path=folder/(kind+'.png')
        if not path.exists():raise HTTPException(404)
        return FileResponse(path,media_type='image/png',filename=kind+'.png')
    if kind=='json':return Response(row['document'],media_type='application/json',headers={'Content-Disposition':'attachment; filename="matlens-result.json"'})
    if kind=='pdf':return Response(pdf_report(result,folder),media_type='application/pdf',headers={'Content-Disposition':'attachment; filename="matlens-report.pdf"'})
    if kind in ('xrd','sem') and result.get(kind):
        rows=result[kind]['peaks' if kind=='xrd' else 'objects']
        if kind=='sem':rows=[{**r,'length_unit':result['sem']['unit'],'area_unit':result['sem']['unit']+'^2'} for r in rows]
        stream=io.StringIO();fields=list(dict.fromkeys(k for row in rows for k in row)) or ['id']
        writer=csv.DictWriter(stream,fieldnames=fields);writer.writeheader();writer.writerows(rows)
        return Response(('\ufeff'+stream.getvalue()).encode('utf-8'),media_type='text/csv',headers={'Content-Disposition':f'attachment; filename="matlens-{kind}.csv"'})
    raise HTTPException(404)


if (ROOT/'dist').exists(): app.mount('/',StaticFiles(directory=ROOT/'dist',html=True),name='web')
