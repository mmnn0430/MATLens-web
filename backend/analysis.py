"""Deterministic analysis. All widths are degrees 2theta until explicitly converted."""
import hashlib
import io
import re
import warnings
from functools import lru_cache
from pathlib import Path
import cv2
import numpy as np
import pandas as pd
from PIL import Image
from scipy import sparse, ndimage as ndi
from scipy.optimize import curve_fit, nnls
from scipy.signal import find_peaks, peak_widths, savgol_filter
from scipy.sparse.linalg import spsolve
from scipy.stats import linregress
from skimage import measure, segmentation
from skimage.feature import peak_local_max
from .models import Settings

ROOT = Path(__file__).resolve().parents[1]
Image.MAX_IMAGE_PIXELS = 16_000_000


def read_csv(raw: bytes):
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('UTF-8 또는 CP949 인코딩 CSV를 사용해주세요.')
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.startswith('#')]
    if len(lines) < 20:
        raise ValueError('20행 이상의 각도·강도 데이터가 필요해요.')
    delimiter = '\t' if '\t' in lines[0] else ';' if ';' in lines[0] else ',' if ',' in lines[0] else r'\s+'
    parts = re.split(delimiter, lines[0])
    try:
        [float(v) for v in parts]
        header = None
    except ValueError:
        header = 0
    try:
        df = pd.read_csv(io.StringIO('\n'.join(lines)), sep=delimiter, engine='python', header=header)
    except Exception:
        raise ValueError('CSV 열 구분이 일정하지 않아요. 쉼표 또는 탭으로 저장해주세요.') from None
    if not 2 <= len(df.columns) <= 31 or len(df) > 30000:
        raise ValueError('CSV는 2~31열, 최대 30,000행까지 지원해요.')
    df.columns = [str(c) if header is not None else f'열 {i+1}' for i, c in enumerate(df.columns)]
    return df


def csv_preview(raw):
    df = read_csv(raw)
    names = [x.lower().replace(' ', '') for x in df.columns]
    xc = next((i for i,n in enumerate(names) if any(s in n for s in ('theta','2θ','angle'))), 0)
    yc = next((i for i,n in enumerate(names) if any(s in n for s in ('intens','count'))), 1)
    return {'columns':list(df.columns), 'rows':len(df), 'x_col':xc,'y_col':yc,
            'preview':df.head(5).fillna('').astype(str).values.tolist()}


def baseline(y, lam=1e6):
    n = len(y)
    d = sparse.diags([1.,-2.,1.],[0,1,2],shape=(n-2,n),format='csc')
    penalty = lam * (d.T @ d)
    w = np.ones(n)
    for _ in range(12):
        z = spsolve(sparse.diags(w,format='csc') + penalty, w*y)
        w = np.where(y>z,0.01,0.99)
    return z


def gaussian(x, amplitude, center, sigma, offset):
    return amplitude*np.exp(-0.5*((x-center)/sigma)**2)+offset


@lru_cache(maxsize=24)
def references(wavelength, low, high):
    import json
    manifest = json.loads((ROOT/'references'/'manifest.json').read_text('utf-8'))
    return [cif_reference(ROOT/'references'/r['file'], wavelength, low, high, r) for r in manifest]


def cif_reference(path, wavelength, low, high, meta=None):
    from pymatgen.core import Structure
    from pymatgen.analysis.diffraction.xrd import XRDCalculator
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        structure = Structure.from_file(str(path))
    if len(structure)>300:
        raise ValueError('기준 CIF는 단위 셀당 300개 이하 원자를 지원해요.')
    pattern = XRDCalculator(wavelength=wavelength).get_pattern(structure, two_theta_range=(low,high))
    meta = meta or {'id':'user-cif','name':structure.composition.reduced_formula,'source':'사용자 제공 CIF'}
    return {**meta,'formula':structure.composition.reduced_formula,
            'elements':[str(e) for e in structure.composition.elements],
            'x':pattern.x.tolist(),'y':pattern.y.tolist(),
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def phase_match(peaks, refs, tolerance, elements=''):
    allowed = set(re.findall(r'[A-Z][a-z]?', elements))
    mx = np.array([p['position'] for p in peaks if p['status']!='excluded'])
    weights = np.array([p['height'] for p in peaks if p['status']!='excluded'])
    active = [p for p in peaks if p['status']!='excluded']
    if not len(mx):
        return []
    ranked=[]
    for ref in refs:
        if allowed and not set(ref['elements']).issubset(allowed):
            continue
        rx, ry = np.array(ref['x']), np.array(ref['y'])
        rx, ry = rx[ry>=3], ry[ry>=3]
        used=set(); pairs=[]; support=0
        for index in np.argsort(-ry):
            dist=np.abs(mx-rx[index]); j=int(np.argmin(dist))
            if dist[j]<=tolerance and j not in used:
                used.add(j); support+=ry[index]*(1-dist[j]/(2*tolerance))
                pairs.append({'peak_id':active[j]['id'],'reference':float(rx[index]),'error':float(dist[j])})
        coverage=float(weights[list(used)].sum()/weights.sum()) if weights.sum()>0 else 0
        score=100*(0.65*support/max(float(ry.sum()),1)+0.35*coverage)
        ranked.append({**ref,'score':round(score,2),'pairs':pairs,
                       'unmatched_peak_ids':[p['id'] for j,p in enumerate(active) if j not in used]})
    return sorted(ranked,key=lambda r:r['score'],reverse=True)


def xrd_analysis(raw, s: Settings, user_cif=None, mp_data_dir=None):
    df=read_csv(raw)
    if max(s.x_col,s.y_col)>=len(df.columns):
        raise ValueError('선택한 CSV 열이 없어요.')
    data=df.iloc[:,[s.x_col,s.y_col]].apply(pd.to_numeric,errors='coerce').replace([np.inf,-np.inf],np.nan)
    missing=int(data.isna().any(axis=1).sum()); data=data.dropna(); data.columns=['x','y']
    duplicate=int(data.x.duplicated().sum()); data=data.groupby('x',as_index=False).y.mean().sort_values('x')
    data=data[(data.x>=s.low)&(data.x<=s.high)]
    if len(data)<20:
        raise ValueError('선택한 각도 범위에 유효한 데이터가 20개 미만이에요.')
    x=data.x.to_numpy(); y=data.y.to_numpy(); notes=[]
    if missing: notes.append(f'결측·비정상 값 {missing}행을 제외했어요.')
    if duplicate: notes.append(f'중복 각도 {duplicate}행의 강도를 평균했어요.')
    if np.any(y<0): notes.append('음수 강도가 있어요. 장비의 사전 배경 보정 여부를 확인해주세요.')
    if np.std(np.diff(x))/np.mean(np.diff(x))>0.02:
        grid=np.linspace(x[0],x[-1],len(x)); y=np.interp(grid,x,y); x=grid
        notes.append('불균일 각도 간격을 동일 개수의 균일 격자로 선형 보간했어요.')
    bg=baseline(y,s.als_lambda) if np.ptp(y)>1e-9 else y.copy()
    corrected=y-bg
    window=min(s.smooth|1,len(x)//2*2-1)
    smooth=savgol_filter(corrected,window,3) if s.smooth>=5 and window>=5 else corrected.copy()
    step=float(np.median(np.diff(x)))
    idx,_=find_peaks(smooth,prominence=max(float(np.ptp(smooth))*s.prominence,1e-8),distance=max(1,int(s.separation/step)))
    if len(idx)>200:
        raise ValueError('피크가 200개를 넘어요. prominence를 높여 노이즈를 줄여주세요.')
    widths=peak_widths(smooth,idx,rel_height=0.5)[0]*step if len(idx) else []
    peaks=[]
    for n,(i,width) in enumerate(zip(idx,widths),1):
        radius=max(width*1.8,step*6)
        mask=abs(x-x[i])<=radius
        p={'id':n,'position':float(x[i]),'height':float(max(corrected[i],0)),'fwhm':None,'area':None,'size_nm':None,'r2':None,'status':'failed','reason':'피팅 실패'}
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error')
                fit,_=curve_fit(gaussian,x[mask],corrected[mask],p0=[max(corrected[i],1e-6),x[i],max(width/2.355,step),0],
                    bounds=([0,x[i]-radius/2,step/3,-np.inf],[np.inf,x[i]+radius/2,radius,np.inf]),maxfev=4000)
            amp,center,sigma,_=fit; fwhm=float(2*np.sqrt(2*np.log(2))*sigma)
            residual=corrected[mask]-gaussian(x[mask],*fit)
            r2=1-float(np.sum(residual**2))/max(float(np.sum((corrected[mask]-np.mean(corrected[mask]))**2)),1e-15)
            overlap=any(abs(x[j]-center)<max(width*1.8,s.separation) for j in idx if j!=i)
            valid=r2>=0.9 and not overlap and fwhm>=2*step
            p.update(position=float(center),height=float(amp),fwhm=fwhm,area=float(amp*sigma*np.sqrt(2*np.pi)),r2=r2,
                     status='valid' if valid else 'review',reason='' if valid else '겹침 피크 또는 낮은 피팅 품질·분해능')
            if valid and s.wavelength_confirmed:
                if fwhm>s.instrumental:
                    beta=np.radians(np.sqrt(fwhm**2-s.instrumental**2))
                    p['size_nm']=float(s.k*s.wavelength/10/(beta*np.cos(np.radians(center/2))))
                else:
                    p.update(status='review',reason='측정 선폭이 기기 선폭 이하예요.')
            if s.wavelength_confirmed:
                p['d_angstrom']=float(s.wavelength/(2*np.sin(np.radians(center/2))))
        except (ValueError,RuntimeError,Warning,FloatingPointError):
            pass
        if n in s.excluded_peaks: p.update(status='excluded',reason='사용자 제외',size_nm=None)
        peaks.append(p)
    refs=[]; ranking=[]; mp_info=None
    if s.wavelength_confirmed:
        if s.reference_source in ('local','combined'):
            refs=list(references(s.wavelength,float(x[0]),float(x[-1])))
            if user_cif: refs.append(cif_reference(user_cif,s.wavelength,float(x[0]),float(x[-1])))
        if s.reference_source in ('mp','combined'):
            from .materials_project import reference_patterns, MPError
            try:
                if mp_data_dir is None: raise MPError('MP 저장 경로가 설정되지 않았어요.')
                mp_refs,mp_info=reference_patterns(mp_data_dir,s.mp_snapshot,s.mp_ids,s.wavelength,float(x[0]),float(x[-1]))
                refs.extend(mp_refs)
                notes.append(f'MP 계산 구조 {len(mp_refs)}개와 비교했어요. 계산 격자·강도는 실측과 다를 수 있어요.')
                if mp_info['pattern_skipped_ids']:notes.append('이론 패턴 생성 실패: '+', '.join(mp_info['pattern_skipped_ids']))
                if mp_info['truncated']:notes.append('MP 검색 결과가 설정된 개수로 제한됐어요. 전체 후보를 검색한 결과가 아니에요.')
            except MPError as ex:
                mp_info={'error':str(ex)};notes.append('MP 비교 실패: '+str(ex))
        ranking=phase_match(peaks,refs,s.tolerance,s.elements)
    else: notes.append('파장을 확인해야 상 후보 비교와 결정자 크기를 계산할 수 있어요.')
    if not s.instrumental: notes.append('기기 선폭 미보정 추정값이에요. Gaussian 피크 형상을 가정해요.')
    if not peaks: notes.append('유효한 피크를 찾지 못했어요. 범위와 prominence를 확인해주세요.')
    notes.append('기준 라이브러리 내 상대 매칭 점수이며 상의 확정 확률이 아니에요.')
    sizes=[p['size_nm'] for p in peaks if p['size_nm'] is not None]
    wh={'status':'unavailable','reason':'상 후보 선택 및 기기 보정 후 유효한 동일 상 피크 3개 이상이 필요해요.'}
    if ranking and s.instrumental>0 and len(ranking[0]['pairs'])>=3:
        ids={p['peak_id'] for p in ranking[0]['pairs']}
        ps=[p for p in peaks if p['id'] in ids and p['size_nm'] is not None]
        if len(ps)>=3:
            t=np.radians(np.array([p['position'] for p in ps])/2)
            b=np.radians(np.sqrt(np.array([p['fwhm'] for p in ps])**2-s.instrumental**2))
            xx=4*np.sin(t); yy=b*np.cos(t); fit=linregress(xx,yy)
            if fit.intercept>0 and fit.slope>=0 and fit.rvalue**2>=0.8:
                wh={'status':'experimental','phase':ranking[0]['name'],'size_nm':float(s.k*s.wavelength/10/fit.intercept),
                    'strain':float(fit.slope),'r2':float(fit.rvalue**2),'x':xx.tolist(),'y':yy.tolist(),
                    'fit':(fit.intercept+fit.slope*xx).tolist(),'reason':'최상위 후보 귀속 가정. 상 확인·등방성·Gaussian FWHM 근사에 의존하는 탐색 결과.'}
            else: wh['reason']='회귀가 비물리적이거나 적합도 R²가 0.8 미만이에요.'
    return {'x':x.tolist(),'raw':y.tolist(),'baseline':bg.tolist(),'corrected':corrected.tolist(),
            'peaks':peaks,'candidates':ranking[:6],'size_nm':float(np.median(sizes)) if sizes else None,
            'notes':notes,'wh':wh,'range':[float(x[0]),float(x[-1])],'wavelength':s.wavelength,
            'reference_version':'bundled-cif-v1','reference_count':len(refs),'mp':mp_info,
            'method':'Gaussian FWHM / ALS / Savitzky-Golay detection only'}


def load_image(raw):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error',Image.DecompressionBombWarning)
            im=Image.open(io.BytesIO(raw))
            if im.format not in ('JPEG','PNG') or im.width*im.height>16_000_000:
                raise ValueError('JPG/PNG, 최대 1,600만 픽셀 이미지를 사용해주세요.')
            im.load()
            return np.array(im.convert('L'))
    except (OSError,Image.DecompressionBombError,Image.DecompressionBombWarning):
        raise ValueError('이미지를 읽을 수 없어요. JPG/PNG와 해상도를 확인해주세요.') from None


def image_preview(raw):
    gray=load_image(raw); h,w=gray.shape
    means=gray.mean(axis=1); delta=np.abs(np.diff(means)); start=int(h*.6)
    # Score transitions into a persistent extreme-background strip, not the scale line itself.
    row=h; best_score=0.
    extreme=((gray<30)|(gray>225)).mean(axis=1)
    for candidate in range(start+1,h-max(3,int(h*.03))):
        below=float(extreme[candidate:].mean())
        above=float(extreme[max(0,candidate-40):candidate].mean())
        score=float(delta[candidate-1])*max(0,below-above)
        if below>.65 and score>best_score and delta[candidate-1]>10:
            best_score=score;row=candidate
    region=gray[row if row<h else int(h*.8):]
    offset=row if row<h else int(h*.8)
    best=None
    for polarity in (True,False):
        mask=(region>220) if polarity else (region<35)
        horizontal=cv2.morphologyEx(mask.astype('uint8'),cv2.MORPH_OPEN,np.ones((1,max(8,int(w*.03))),np.uint8))
        count,_,stats,_=cv2.connectedComponentsWithStats(horizontal,8)
        for x,y,ww,hh,area in stats[1:]:
            if w*.03<=ww<=w*.6 and hh<=max(12,h*.025) and (best is None or ww>best['length_px']):
                best={'x0':int(x),'x1':int(x+ww),'y':int(y+offset+hh/2),'length_px':int(ww)}
    return {'width':w,'height':h,'roi':[0,0,w,row],'scale_candidate':best,
            'note':'자동 후보예요. 실제 스케일 길이와 ROI를 확인해주세요.'}


def sem_analysis(raw,s:Settings,outdir):
    gray=load_image(raw); h,w=gray.shape
    roi=s.roi or image_preview(raw)['roi']
    x0,y0,x1,y1=roi
    if not(0<=x0<x1<=w and 0<=y0<y1<=h) or min(x1-x0,y1-y0)<20:
        raise ValueError('ROI는 이미지 안에서 가로·세로 20px 이상이어야 해요.')
    crop=gray[y0:y1,x0:x1]
    enhanced=cv2.GaussianBlur(crop,(3,3),0)
    if np.ptp(crop)<3:
        binary=np.zeros(crop.shape,bool); threshold=None
    else:
        threshold,mask=cv2.threshold(enhanced,0,255,cv2.THRESH_BINARY+cv2.THRESH_OTSU)
        binary=mask>0
        if s.invert: binary=~binary
        binary=ndi.binary_fill_holes(binary)
    distance=ndi.distance_transform_edt(binary)
    points=peak_local_max(distance,min_distance=s.min_distance,labels=measure.label(binary),exclude_border=False)
    markers=np.zeros(crop.shape,np.int32)
    if len(points): markers[tuple(points.T)]=np.arange(1,len(points)+1)
    labels=segmentation.watershed(-distance,markers,mask=binary)
    if s.exclude_border: labels=segmentation.clear_border(labels)
    unit=s.scale_unit if s.scale_confirmed else 'px'; scale=s.scale_length/s.scale_px if s.scale_confirmed else 1
    objects=[]
    for prop in measure.regionprops(labels):
        if prop.area<s.min_size or prop.label in s.excluded_objects:
            labels[labels==prop.label]=0; continue
        perimeter=prop.perimeter_crofton
        objects.append({'id':int(prop.label),'area':float(prop.area*scale**2),
            'diameter':float(prop.equivalent_diameter_area*scale),'major':float(prop.axis_major_length*scale),
            'minor':float(prop.axis_minor_length*scale),'aspect_ratio':float(prop.axis_major_length/prop.axis_minor_length) if prop.axis_minor_length else None,
            'circularity':float(4*np.pi*prop.area/perimeter**2) if perimeter else None,
            'cx':float(prop.centroid[1]+x0),'cy':float(prop.centroid[0]+y0)})
    overlay=cv2.cvtColor(crop,cv2.COLOR_GRAY2RGB)
    inside=labels>0
    overlay[inside]=(overlay[inside]*.85+np.array([49,130,246])*.15).astype(np.uint8)
    overlay[segmentation.find_boundaries(labels,mode='inner')]=[49,130,246]
    for obj in objects[:400]:
        cv2.putText(overlay,str(obj['id']),(int(obj['cx']-x0),int(obj['cy']-y0)),cv2.FONT_HERSHEY_SIMPLEX,.3,(255,255,255),1)
    Image.fromarray(overlay).save(outdir/'overlay.png'); Image.fromarray(crop).save(outdir/'roi.png')
    diam=np.array([o['diameter'] for o in objects]); circ=[o['circularity'] for o in objects if o['circularity'] is not None]
    stats={'count':len(objects),'mean':None,'median':None,'std':None,'d10':None,'d50':None,'d90':None,'circularity':None}
    if len(diam):
        stats.update(mean=float(diam.mean()),median=float(np.median(diam)),std=float(diam.std()),
                     d10=float(np.percentile(diam,10)),d50=float(np.percentile(diam,50)),d90=float(np.percentile(diam,90)),
                     circularity=float(np.mean(circ)) if circ else None)
    notes=['2D 관찰면의 개수 기준 등가원 직경 분포예요. 결정립 크기나 3D 입도와 구분해주세요.']
    if not s.scale_confirmed: notes.append('스케일 미확인: 실제 길이 대신 px로 표시해요.')
    if not s.segmentation_confirmed: notes.append('분할 경계를 확인하기 전의 잠정 통계예요.')
    if not objects: notes.append('분리된 객체가 없어요. ROI·밝기 반전·최소 면적을 조정해주세요.')
    if any(v>1 for v in circ): notes.append('픽셀 격자와 Crofton 둘레 근사 때문에 원형도가 1을 조금 넘을 수 있어요. 원시 계산값을 유지했어요.')
    return {'objects':objects,'stats':stats,'unit':unit,'scale':scale,'roi':roi,'threshold':threshold,
            'confirmed':s.segmentation_confirmed,'notes':notes,'mode':'particles'}
