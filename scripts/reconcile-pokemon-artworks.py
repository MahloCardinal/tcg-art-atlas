"""Review Pokemon type observations and compare reprinted illustrations without deleting cards.

Use --prepare to build cached visual comparisons, review the contact sheets, then --apply.
Only explicit CardCorpus painting references and verified image matches link different codes.
"""
from pathlib import Path
from collections import defaultdict, Counter
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
import argparse, hashlib, json, re, sys
import numpy as np
import cv2
from zipfile import BadZipFile
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent.parent
CACHE=ROOT/'temp/pokemon-artworks'
FEATURE_CACHE=CACHE/'features'
BATCH_ID=None
CACHE.mkdir(parents=True,exist_ok=True)
PREFIX='globalThis.TCG_ART_ATLAS_CATALOG='
sys.stdout.reconfigure(encoding='utf8')
cv2.setNumThreads(1)

def read(path):return json.loads(path.read_text('utf8'))
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    pending=path.with_name(path.name+'.pending')
    pending.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8',newline='\n')
    pending.replace(path)
def catalog():return json.loads((ROOT/'public/catalog.js').read_text('utf8')[len(PREFIX):].strip().rstrip(';'))
def save_catalog(value):
    pending=ROOT/'public/catalog.js.pending'
    pending.write_text(PREFIX+json.dumps(value,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8',newline='\n')
    pending.replace(ROOT/'public/catalog.js')

def sheets(items,folder):
    folder.mkdir(parents=True,exist_ok=True);font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',13);manifest=[]
    for start in range(0,len(items),12):
        batch=items[start:start+12];sheet=Image.new('RGB',(1200,((len(batch)+3)//4)*420),'#eeeeee');draw=ImageDraw.Draw(sheet)
        for n,item in enumerate(batch):
            x=n%4*300;y=n//4*420
            with Image.open(ROOT/'public'/item['image']) as raw:
                image=raw.convert('RGB');image.thumbnail((235,325));sheet.paste(image,(x,y))
                # A larger view of the printed type symbol, without modifying the source scan.
                w,h=raw.size;symbol=raw.crop((w*.80,h*.015,w*.99,h*.16));symbol.thumbnail((62,110));sheet.paste(symbol,(x+237,y))
            for k,line in enumerate(item['label'].split('\n')[:5]):draw.text((x+3,y+330+k*16),line[:43],font=font,fill='black')
        path=folder/f'{start//12+1:03}.jpg';sheet.save(path,quality=92);manifest.append({'file':str(path.relative_to(CACHE)),'items':batch})
    save(folder/'index.json',manifest)

def notes_sheets():
    c=catalog();r=read(ROOT/'CARD_REVIEW.json');by={x['id']:x for x in c['cards']};items=[]
    for i,note in enumerate(r.get('userObservations',{}).get('entries',[])):
        if note.get('status')!='open':continue
        card=by[note['cardId']]
        items.append({'cardId':card['id'],'noteId':note['id'],'image':card['image'],'label':f'{i+1}. {card["name"]}\n{note["text"]}\n{card["setId"]}\n{card["printedNumber"]}'})
    sheets(items,CACHE/'type-observations')
    print('Observation contact sheets',len(items),flush=True)

def apply_types():
    c=catalog();r=read(ROOT/'CARD_REVIEW.json');by={x['id']:x for x in c['cards']};decisions=read(CACHE/'type-decisions.json');resolved=[]
    notes={n['id']:n for n in r['userObservations']['entries']}
    for d in decisions:
        card=by[d['cardId']]
        assert card['game']=='pokemon' and card['category']=='Pokemon'
        assert notes[d['noteId']]['cardId']==card['id']
        assert card['image']==d['image'] and hashlib.sha256((ROOT/'public'/card['image']).read_bytes()).hexdigest()==d['sha256']
        assert not card['types'] or card['types']==d['types'], 'Existing type conflicts with reviewed observation'
    for d in decisions:
        card=by[d['cardId']];before=list(card['types']);card['types']=d['types']
        audit=r['cards'][card['id']];audit['issues']=[issue for issue in audit['issues'] if issue!='MISSING_TYPES']
        audit.setdefault('metadata',{})['typeReference']={'sourceUrl':audit.get('metadata',{}).get('sourceUrl'),'image':d['image'],'sha256':d['sha256'],'method':d['method'],'noteId':d['noteId'],'verifiedAt':d['verifiedAt']}
        notes[d['noteId']].update(status='resolved',resolvedAt='2026-11-27',resolution={'action':'setPokemonType','previousTypes':before,'types':d['types'],'evidence':d})
        resolved.append({'cardId':card['id'],'noteId':d['noteId'],'types':d['types']})
    deferred=r.get('pokemonDeferredVariantAssociation',{})
    corrected={d['cardId'] for d in decisions}
    if deferred:
        deferred['cardIds']=[id for id in deferred['cardIds'] if id not in corrected]
        deferred['resolvedTypeCardIds']=sorted(set(deferred.get('resolvedTypeCardIds',[]))|corrected)
    r['pokemonTypeObservationReview']={'reviewedAt':'2026-11-27','resolved':resolved,'policy':'User Terra means Fighting; Normale means Colorless. Every corrected type symbol was visually checked on the exact stored card scan. Other missing types remain pending.'}
    observations=r.pop('userObservations');r['userObservations']=observations
    save_catalog(c);save(ROOT/'CARD_REVIEW.json',r)
    print('Type observations resolved',len(resolved),Counter(d['types'][0] for d in decisions),flush=True)

def feature_path(relative):
    path=ROOT/'public'/relative;stat=path.stat();key=hashlib.sha256(f'{relative}:{stat.st_size}:{stat.st_mtime_ns}:art-crop-v1'.encode()).hexdigest()[:24]
    return FEATURE_CACHE/f'{key}.npz'

@lru_cache(maxsize=80)
def feature(relative):
    target=feature_path(relative)
    if target.exists():
        try:
            with target.open('rb') as handle:
                with np.load(handle) as cached:return cached['points'],cached['descriptors'],tuple(cached['size'])
        except (OSError,ValueError,EOFError,BadZipFile):target.unlink()
    with Image.open(ROOT/'public'/relative) as raw:
        w,h=raw.size;art=raw.convert('RGB').crop((int(w*.10),int(h*.17),int(w*.91),int(h*.53)))
        art=art.resize((360,round(360*art.height/art.width)),Image.Resampling.LANCZOS)
        grey=cv2.cvtColor(np.array(art),cv2.COLOR_RGB2GRAY)
    keypoints,descriptors=cv2.SIFT_create(nfeatures=450,contrastThreshold=.018,edgeThreshold=14).detectAndCompute(grey,None)
    points=np.array([kp.pt for kp in keypoints],dtype=np.float32).reshape(-1,2)
    if descriptors is None:descriptors=np.empty((0,128),dtype=np.float32)
    target.parent.mkdir(parents=True,exist_ok=True)
    pending=target.with_suffix('.pending')
    with pending.open('wb') as handle:np.savez_compressed(handle,points=points,descriptors=descriptors,size=np.array([grey.shape[1],grey.shape[0]]))
    pending.replace(target)
    return points,descriptors,(grey.shape[1],grey.shape[0])

def compare(a,b):
    if a==b:return {'method':'same verified scan','accepted':True}
    pa,da,sa=feature(a);pb,db,sb=feature(b)
    if min(len(da),len(db))<12:return {'accepted':False,'reason':'too few visual features'}
    pairs=cv2.BFMatcher().knnMatch(da,db,k=2)
    good=[m for m,n in pairs if m.distance<.72*n.distance]
    if len(good)<12:return {'accepted':False,'goodMatches':len(good)}
    aa=np.array([pa[m.queryIdx] for m in good]);bb=np.array([pb[m.trainIdx] for m in good])
    matrix,mask=cv2.findHomography(aa,bb,cv2.RANSAC,4)
    if matrix is None:return {'accepted':False,'goodMatches':len(good),'reason':'no consistent image transform'}
    mask=mask.ravel().astype(bool);inliers=int(mask.sum());fraction=inliers/len(good)
    coverage=[]
    for points,size in [(aa[mask],sa),(bb[mask],sb)]:
        coverage.append(float(np.ptp(points[:,0])*np.ptp(points[:,1])/(size[0]*size[1])) if len(points)>1 else 0)
    corners=np.array([[[0,0],[sa[0],0],[sa[0],sa[1]],[0,sa[1]]]],dtype=np.float32)
    projected=cv2.perspectiveTransform(corners,matrix)[0]
    target=np.array([[0,0],[sb[0],0],[sb[0],sb[1]],[0,sb[1]]],dtype=np.float32)
    try:overlap,_=cv2.intersectConvexConvex(projected,target)
    except cv2.error:return {'accepted':False,'goodMatches':len(good),'reason':'inconsistent illustration geometry'}
    area=abs(cv2.contourArea(projected));frameOverlap=min(float(overlap/max(area,1)),float(overlap/(sb[0]*sb[1])))
    accepted=inliers>=16 and fraction>=.55 and min(coverage)>=.23 and frameOverlap>=.68
    return {'method':'SIFT illustration crop + RANSAC','accepted':bool(accepted),'goodMatches':len(good),'inliers':inliers,'inlierFraction':round(fraction,4),'coverage':[round(x,4) for x in coverage],'frameOverlap':round(frameOverlap,4)}

def prepare():
    c=catalog();r=read(ROOT/'CARD_REVIEW.json');pk=[x for x in c['cards'] if x['game']=='pokemon'];by={x['id']:x for x in pk}
    # Snapshot only once, so source IDs and observations remain available for an audit.
    if not (CACHE/'catalog-before.json').exists():save(CACHE/'catalog-before.json',c)
    groups=defaultdict(list)
    for card in pk:
        painting=r['cards'][card['id']].get('metadata',{}).get('paintingId')
        if painting:groups[painting].append(card)
    files=sorted({card['image'] for rows in groups.values() if len(rows)>1 for card in rows})
    # Bounded memory; groups read the persisted descriptors again as needed.
    with ThreadPoolExecutor(4) as pool:
        for i,_ in enumerate(pool.map(feature,files),1):
            if i%1000==0:print('Illustration features',i,'/',len(files),flush=True)
    feature.cache_clear()
    previous=r.get('pokemonArtworkGrouping',{}) if BATCH_ID else {}
    parent={x['id']:x['id'] for x in pk};evidence=list(previous.get('visualEvidence',[]));pending=[]
    def root(id):
        while parent[id]!=id:parent[id]=parent[parent[id]];id=parent[id]
        return id
    def union(a,b):
        a=root(a);b=root(b)
        if a!=b:parent[max(a,b)]=min(a,b)
    # Preserve approved families; the newly imported prints still need comparison.
    fresh=set()
    if BATCH_ID:
        batch=r['pokemonCompletionBatches'][BATCH_ID]
        selected={entry['setId'] for entry in batch['coverage']}
        fresh={card['id'] for card in pk if card['setId'] in selected}
    reference_evidence=list(previous.get('referenceEvidence',[]))
    for group in previous.get('groups',[]):
        retained=[id for id in group['cardIds'] if id in by and id not in fresh]
        for id in retained[1:]:union(retained[0],id)
    source_cards={}
    for card in pk:
        ref=r['cards'][card['id']].get('metadata',{}).get('catalogReference')
        if ref and not card['isAlternative']:source_cards[(ref['set'],ref['card'])]=card
    for card in pk:
        counterpart=r['cards'][card['id']].get('metadata',{}).get('counterpart') or {}
        proof=counterpart.get('manualVerification')
        target=source_cards.get((counterpart.get('set'),counterpart.get('id')))
        if not proof or not target or root(card['id'])==root(target['id']):continue
        # A documented review must still refer to scans actually present in both records.
        own_scans={v['image'] for v in card.get('imageVersions',[card])}
        other_scans={v['image'] for v in target.get('imageVersions',[target])}
        if target['image'] in own_scans and card['image'] in other_scans:
            union(card['id'],target['id'])
            reference_evidence.append({'a':card['id'],'b':target['id'],'accepted':True,'method':'documented manual counterpart review with reciprocal verified scans','review':proof})
    # Existing edition variants keep their popup family; no IDs or favorite keys are changed.
    bycode=defaultdict(list)
    for card in pk:bycode[card['code']].append(card)
    for rows in bycode.values():
        for card in rows[1:]:
            metadata=r['cards'][card['id']].get('metadata',{})
            variant=next((v for v in metadata.get('variantInventory',[]) if v['id']==metadata.get('variantId')),{})
            if not set(variant.get('differsFromStandard',{})).intersection({'painting','artwork'}):union(rows[0]['id'],card['id'])
    for index,(painting,rows) in enumerate(groups.items(),1):
        if len(rows)<2:continue
        representatives=[]
        for card in rows:
            if any(root(card['id'])==root(ref['id']) for ref in representatives):continue
            options=[]
            for ref in representatives:
                result=compare(ref['image'],card['image'])
                if result['accepted']:
                    union(ref['id'],card['id']);evidence.append({'paintingId':painting,'a':ref['id'],'b':card['id'],**result});break
                options.append({'a':ref['id'],'b':card['id'],'paintingId':painting,**result})
            else:
                if options:pending.append(min(options,key=lambda row:-row.get('inliers',0)))
                representatives.append(card)
        if index%1000==0:print('Painting references checked',index,'/',len(groups),flush=True)
    components=defaultdict(list)
    for id in parent:components[root(id)].append(id)
    linked=[]
    for ids in components.values():
        if len(ids)<2:continue
        paints=sorted({r['cards'][id].get('metadata',{}).get('paintingId') for id in ids}-{None})
        gid='pk-art-'+hashlib.sha256('|'.join(sorted(ids)).encode()).hexdigest()[:16]
        linked.append({'id':gid,'cardIds':sorted(ids),'paintingIds':paints})
    save(CACHE/'plan.json',{'groups':linked,'evidence':evidence,'pending':pending,'batchId':BATCH_ID,
        'referenceEvidence':reference_evidence,'manualEvidence':previous.get('manualEvidence',[]),'visualSampleReview':previous.get('visualSampleReview',{}),'newCardIds':sorted(fresh)})
    alakazam=[{'cardId':card['id'],'image':card['image'],'label':card['name']+'\n'+card['id']+'\n'+card['setId']} for card in pk if 'alakazam' in card['name'].lower()]
    sheets(alakazam,CACHE/'alakazam')
    print('Groups',len(linked),'linked records',sum(len(g['cardIds']) for g in linked),'pending image comparisons',len(pending),flush=True)

def refine_references():
    c=catalog();r=read(ROOT/'CARD_REVIEW.json');plan=read(CACHE/'plan.json');pk=[x for x in c['cards'] if x['game']=='pokemon'];by={x['id']:x for x in pk};parent={x['id']:x['id'] for x in pk}
    def root(id):
        while parent[id]!=id:parent[id]=parent[parent[id]];id=parent[id]
        return id
    def union(a,b):
        a=root(a);b=root(b)
        if a!=b:parent[max(a,b)]=min(a,b)
    for group in plan['groups']:
        for id in group['cardIds'][1:]:union(group['cardIds'][0],id)
    exact={};references={};extra=[]
    for card in pk:
        if card['image'] in exact and root(card['id'])!=root(exact[card['image']]):
            other=exact[card['image']];union(card['id'],other);extra.append({'a':other,'b':card['id'],'accepted':True,'method':'exact same primary scan resource','image':card['image']})
        exact[card['image']]=card['id']
        paint=r['cards'][card['id']].get('metadata',{}).get('paintingId')
        if not paint:continue
        for view in card.get('imageVersions',[{'image':card['image']}]):
            key=(paint,view['image'])
            if key in references and root(card['id'])!=root(references[key]):
                other=references[key];union(card['id'],other);extra.append({'a':other,'b':card['id'],'accepted':True,'method':'same verified counterpart scan and explicit CardCorpus painting reference','paintingId':paint,'image':view['image']})
            references[key]=card['id']
    components=defaultdict(list)
    for id in parent:components[root(id)].append(id)
    linked=[]
    for ids in components.values():
        if len(ids)<2:continue
        paints=sorted({r['cards'][id].get('metadata',{}).get('paintingId') for id in ids}-{None})
        gid='pk-art-'+hashlib.sha256('|'.join(sorted(ids)).encode()).hexdigest()[:16]
        linked.append({'id':gid,'cardIds':sorted(ids),'paintingIds':paints})
    plan['groups']=linked;plan['referenceEvidence']=plan.get('referenceEvidence',[])+extra
    plan['pending']=[p for p in plan['pending'] if root(p['a'])!=root(p['b'])]
    save(CACHE/'plan.json',plan)
    print('Exact/reference scan links',len(extra),'groups',len(linked),'pending',len(plan['pending']),flush=True)

def comparison_sheets():
    c=catalog();by={x['id']:x for x in c['cards']};plan=read(CACHE/'plan.json')
    new=set(plan.get('newCardIds',[]))
    sample=[row for row in plan['evidence'] if not new or row['a'] in new or row['b'] in new]
    for name,rows in [('pending',plan['pending']),('accepted-sample',sorted(sample,key=lambda x:x.get('inliers',10000))[:24])]:
        items=[]
        for i,row in enumerate(rows,1):
            for side in ['a','b']:
                card=by[row[side]]
                items.append({'cardId':card['id'],'image':card['image'],'label':f'{i}{side}: {card["name"]}\n{card["id"]}\n{row["paintingId"]}'})
        sheets(items,CACHE/name)

def apply_manual():
    c=catalog();by={x['id']:x for x in c['cards']};plan=read(CACHE/'plan.json');decisions=read(CACHE/'manual-decisions.json');parent={id:id for id in by}
    def root(id):
        while parent[id]!=id:parent[id]=parent[parent[id]];id=parent[id]
        return id
    def union(a,b):
        a=root(a);b=root(b)
        if a!=b:parent[max(a,b)]=min(a,b)
    for group in plan['groups']:
        for id in group['cardIds'][1:]:union(group['cardIds'][0],id)
    for d in decisions:
        for side in ['a','b']:
            card=by[d[side]];assert card['game']=='pokemon'
            assert hashlib.sha256((ROOT/'public'/card['image']).read_bytes()).hexdigest()==d['sha256'][side]
        if d['accepted']:union(d['a'],d['b'])
    components=defaultdict(list)
    for id in parent:
        if by[id]['game']=='pokemon':components[root(id)].append(id)
    audit=read(ROOT/'CARD_REVIEW.json');linked=[]
    for ids in components.values():
        if len(ids)<2:continue
        paints=sorted({audit['cards'][id].get('metadata',{}).get('paintingId') for id in ids}-{None})
        linked.append({'id':'pk-art-'+hashlib.sha256('|'.join(sorted(ids)).encode()).hexdigest()[:16],'cardIds':sorted(ids),'paintingIds':paints})
    plan['groups']=linked;plan['manualEvidence']=plan.get('manualEvidence',[])+decisions
    reviewed={(d['a'],d['b']) for d in decisions}
    plan['pending']=[p for p in plan['pending'] if root(p['a'])!=root(p['b']) and (p['a'],p['b']) not in reviewed]
    save(CACHE/'plan.json',plan)
    print('Manual decisions',len(decisions),'groups',len(linked),'pending',len(plan['pending']),flush=True)

def apply_groups():
    c=catalog();r=read(ROOT/'CARD_REVIEW.json');plan=read(CACHE/'plan.json');by={x['id']:x for x in c['cards']};before=read(CACHE/'catalog-before.json');old={x['id']:x for x in before['cards']}
    assert {x['id'] for x in before['cards']}==set(by),'Catalog inventory changed; review the comparison plan again'
    for card in c['cards']:
        assert card['image']==old[card['id']]['image'] and card['code']==old[card['id']]['code'],'Compared scan or printed identity changed'
        if card['game']=='pokemon':card.pop('artworkGroup',None)
    for group in plan['groups']:
        for id in group['cardIds']:
            assert by[id]['game']=='pokemon'
            by[id]['artworkGroup']=group['id']
    previous=r.get('pokemonArtworkGrouping',{})
    r['pokemonArtworkGrouping']={'reviewedAt':'2026-11-27','groups':plan['groups'],'visualEvidence':plan['evidence'],'referenceEvidence':plan.get('referenceEvidence',[]),'manualEvidence':plan.get('manualEvidence',[]),'pendingImageComparisons':plan['pending'],
        'policy':'Illustration only: use explicit CardCorpus painting identities with verified counterpart scans or SIFT/RANSAC comparisons of the illustration crop. Equal names alone never join cards. Keep each printed ID, set, code, scan, edition and prize stamp available as its own popup entry and favorite target. Do not apply this grouping to One Piece.',
        'visualSampleReview':plan.get('visualSampleReview',previous.get('visualSampleReview',{})),
        'batches':previous.get('batches',{}),'cache':str(CACHE.relative_to(ROOT)).replace('\\','/')+'/'}
    if BATCH_ID:
        r['pokemonArtworkGrouping']['batches'][BATCH_ID]={'reviewedAt':'2026-11-27','importedCardIds':plan['newCardIds'],'groups':len(plan['groups']),'linkedRecords':sum(len(g['cardIds']) for g in plan['groups']),'cache':r['pokemonArtworkGrouping']['cache'],'sampleReview':plan.get('batchVisualSampleReview')}
    deferred=r.get('pokemonDeferredVariantAssociation')
    if deferred:
        deferred['policy']='The 2026-11-27 user request permits grouping visually verified reprints now. Keep unknown types pending except individually reviewed observations. No grouping or type inference from the absence of a type or from a matching Pokemon name.'
        deferred['verifiedArtworkGrouping']='pokemonArtworkGrouping'
    save_catalog(c)
    latest=read(ROOT/'CARD_REVIEW.json')
    observations=r.pop('userObservations');r['userObservations']=latest.get('userObservations',observations)
    save(ROOT/'CARD_REVIEW.json',r)
    print('Published artwork groups',len(plan['groups']),'records',sum(len(g['cardIds']) for g in plan['groups']),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ['notes-sheets','prepare','apply-types','refine-references','comparison-sheets','apply-manual','apply']:parser.add_argument('--'+flag,action='store_true')
    parser.add_argument('--batch')
    args=parser.parse_args()
    if args.batch:
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',args.batch):parser.error('Invalid batch name')
        BATCH_ID=args.batch;CACHE=ROOT/'temp'/('pokemon-artworks-'+BATCH_ID);CACHE.mkdir(parents=True,exist_ok=True)
    if args.notes_sheets:notes_sheets()
    if args.prepare:prepare()
    if args.apply_types:apply_types()
    if args.refine_references:refine_references()
    if args.comparison_sheets:comparison_sheets()
    if args.apply_manual:apply_manual()
    if args.apply:apply_groups()
