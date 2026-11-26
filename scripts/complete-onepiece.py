"""Inventory and import verified One Piece printings. Sources/cache stay outside public/."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import sys
import unicodedata
import shutil
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from collections import Counter, defaultdict
import numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'temp' / 'onepiece-completion'
CACHE.mkdir(parents=True, exist_ok=True)
sys.stdout.reconfigure(encoding='utf8')

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    for attempt in range(30):
        try:
            temporary.replace(path)
            break
        except PermissionError:
            if attempt==29:raise
            time.sleep(.2)

def get(url, filename):
    path = CACHE / filename
    if not path.exists():
        response = requests.get(url, timeout=90, headers={'User-Agent':'Mozilla/5.0'})
        response.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(response.content)
    return path

def field(node, selector):
    tag = node.select_one(selector)
    if tag is None:
        return ''
    tag = BeautifulSoup(str(tag), 'html.parser')
    for extra in tag.select('h3,.getInfoBtnCol'):
        extra.decompose()
    return tag.get_text(' ', strip=True)

def parse_official(path, language, series):
    domain = 'en.onepiece-cardgame.com' if language == 'en' else 'www.onepiece-cardgame.com'
    url = f'https://{domain}/cardlist/?series={series}'
    soup = BeautifulSoup(path.read_text('utf8'), 'html.parser')
    rows = []
    for node in soup.select('dl.modalCol'):
        info = [s.get_text(' ', strip=True) for s in node.select('.infoCol span')]
        image = node.select_one('.frontCol img')
        if len(info) < 3 or image is None:
            continue
        color = field(node, '.color')
        colors = re.findall('Red|Green|Blue|Purple|Black|Yellow', color) if language == 'en' else [{'赤':'Red','緑':'Green','青':'Blue','紫':'Purple','黒':'Black','黄':'Yellow'}[c] for c in re.findall('[赤緑青紫黒黄]', color)]
        rows.append({'key': f'{language}:{node["id"]}', 'printing': node['id'], 'language':language, 'series':series,
                     'code':info[0], 'rarity':info[1], 'category':info[2], 'name':field(node,'.cardName'),
                     'colors':colors, 'label':field(node,'.getInfo'), 'sourceUrl':url,
                     'sourceImageUrl':urljoin(url,image.get('data-src') or image['src'])})
    return rows, soup

def inventory():
    registry = []
    for language, series in [('en','569901'),('ja','550901')]:
        domain = 'en.onepiece-cardgame.com' if language == 'en' else 'www.onepiece-cardgame.com'
        path = get(f'https://{domain}/cardlist/?series={series}', f'official/{language}_{series}.html')
        soup = BeautifulSoup(path.read_text('utf8'), 'html.parser')
        registry.extend({'language':language, 'series':o['value'], 'label':BeautifulSoup(o.get_text(), 'html.parser').get_text(' ',strip=True)} for o in soup.select('#series option') if o.get('value'))
    save(CACHE/'official-series.json',registry)
    def fetch(source):
        language, series = source['language'], source['series']
        domain = 'en.onepiece-cardgame.com' if language == 'en' else 'www.onepiece-cardgame.com'
        url = f'https://{domain}/cardlist/?series={series}'
        path = get(url, f'official/{language}_{series}.html')
        rows, soup = parse_official(path,language,series)
        soup.decompose()
        save(CACHE/f'inventories/{language}_{series}.json',rows)
        print(language,series,len(rows),source['label'],flush=True)
        return rows
    with ThreadPoolExecutor(4) as pool:
        inventories = list(pool.map(fetch,registry))
    rows = [r for group in inventories for r in group]
    save(CACHE/'official-all.json',rows)
    print('Official inventory:',len(rows),'product rows;',len({r['key'] for r in rows}),'unique regional scans',flush=True)

def supplemental():
    urls = {
      'tcg-groups.json':'https://tcgcsv.com/tcgplayer/68/groups',
      'limitless-all-en.html':'https://onepiece.limitlesstcg.com/cards/en?q=*&display=full&show=all&unique=prints',
      'limitless-all-ja.html':'https://onepiece.limitlesstcg.com/cards/jp?q=*&display=full&show=all&unique=prints',
      'onepiecegg-sets.html':'https://onepiece.gg/sets/',
    }
    def fetch(pair):
        filename,url = pair
        path=get(url,filename)
        print(filename,len(path.read_bytes()),flush=True)
    with ThreadPoolExecutor(4) as pool:
        list(pool.map(fetch,urls.items()))

def tcg_inventory():
    groups=json.loads((CACHE/'tcg-groups.json').read_text('utf8'))['results']
    def fetch(group):
        path=get(f'https://tcgcsv.com/tcgplayer/68/{group["groupId"]}/products',f'tcg/{group["groupId"]}.json')
        rows=json.loads(path.read_text('utf8'))['results']
        print('TCG',group['groupId'],len(rows),group['name'],flush=True)
        return rows
    with ThreadPoolExecutor(4) as pool:
        rows=[row for group in pool.map(fetch,groups) for row in group]
    save(CACHE/'tcg-all.json',rows)

def source_assets():
    urls={
      'limitless-advanced.html':'https://onepiece.limitlesstcg.com/cards/advanced',
      'limitless-main.js':'https://onepiece.limitlesstcg.com/build/assets/main-0198dafa.js',
      'limitless-advanced.js':'https://onepiece.limitlesstcg.com/build/assets/advanced-b11f703c.js',
      'onepiecegg-common.js':'https://onepiece.gg/wp-content/plugins/dotgg-game/common/js/common.4f83ac8fd4b91a5597c3.js?ver=1.0.0',
      'onepiecegg-main.js':'https://onepiece.gg/wp-content/plugins/dotgg-game/games/onepiece/js/main.7a48e859804b59932539.js?ver=1.0.0',
      'limitless-promos.html':'https://onepiece.limitlesstcg.com/cards/promos',
      'tournament-reference.html':'https://onepiecevisualspoiler.com/tournament/',
      'limitless-prints-en.html':'https://onepiece.limitlesstcg.com/cards/en?q=category:leader,character,event,stage&display=full&show=all&unique=prints',
      'limitless-prints-ja.html':'https://onepiece.limitlesstcg.com/cards/jp?q=category:leader,character,event,stage&display=full&show=all&unique=prints',
      'dotgg-cards.json':'https://api.dotgg.gg/cgfw/getcards?game=onepiece&mode=indexed',
    }
    with ThreadPoolExecutor(4) as pool:
        for path in pool.map(lambda pair:get(pair[1],pair[0]),urls.items()):
            print(path.name,path.stat().st_size,flush=True)

def limitless_inventory():
    tasks=[]
    for language in ['en','ja']:
        soup=BeautifulSoup((CACHE/f'limitless-prints-{language}.html').read_text('utf8'),'html.parser')
        pages=int(soup.select_one('.pagination')['data-max'])
        tasks.extend((language,page) for page in range(1,pages+1))
    def fetch(task):
        language,page=task
        url=f'https://onepiece.limitlesstcg.com/cards/{"jp" if language=="ja" else "en"}?q=category:leader,character,event,stage&display=full&show=all&unique=prints&page={page}'
        path=CACHE/f'limitless-prints-{language}.html' if page==1 else get(url,f'limitless/{language}_{page}.html')
        soup=BeautifulSoup(path.read_text('utf8'),'html.parser')
        rows=[]
        for profile in soup.select('.card-profile'):
            code=profile.select_one('.card-text-id'); image=profile.select_one('.card-image img');link=profile.select_one('.card-text-name a')
            if not all([code,image,link]):continue
            artist=profile.select_one('.card-text-artist a')
            category=profile.select_one('[data-tooltip="Category"]');color=profile.select_one('[data-tooltip="Color"]')
            rows.append({'code':code.text.strip(),'language':language,'name':link.text.strip(),'category':category.text.strip().upper() if category else '',
                         'colors':color.text.strip().split('/') if color else [],'artist':artist.text.strip() if artist else None,
                         'sourceUrl':urljoin('https://onepiece.limitlesstcg.com',link['href']), 'sourceImageUrl':image.get('data-src') or image['src']})
        print('Limitless',language,page,len(rows),flush=True)
        return rows
    with ThreadPoolExecutor(4) as pool:
        rows=[row for group in pool.map(fetch,tasks) for row in group]
    save(CACHE/'limitless-all.json',rows)

def coverage():
    catalog=json.loads((CACHE/'catalog-before.js').read_text('utf8').split('=',1)[1].rstrip(';\n'))
    review=json.loads((CACHE/'review-before.json').read_text('utf8'))
    refs={}
    for card in catalog['cards']:
        if card['game']!='onepiece':continue
        audit=review['cards'][card['id']]
        for source in audit.get('metadata',{}).get('printSources',[]):
            url=source.get('referenceImageUrl')
            if url:refs[url.split('?')[0]]=card['id']
    rows=json.loads((CACHE/'official-all.json').read_text('utf8'))
    missing=[r for r in rows if r['sourceImageUrl'].split('?')[0] not in refs]
    save(CACHE/'official-missing.json',missing)
    from collections import Counter
    print('Existing official refs',len(refs),'missing',len(missing))
    print(Counter((r['language'],r['series']) for r in missing))
    print('Examples',missing[:3])

def download_missing():
    rows=json.loads((CACHE/'official-missing.json').read_text('utf8'))
    errors=[]
    def fetch(row):
        try:
            path=get(row['sourceImageUrl'],f'official-images/{row["language"]}_{row["printing"]}.png')
            from PIL import Image
            with Image.open(path) as image:
                if image.width<200 or image.height<200:raise ValueError('Unexpected image dimensions')
            return None
        except Exception as e:
            return {'key':row['key'],'sourceImageUrl':row['sourceImageUrl'],'error':str(e)}
    with ThreadPoolExecutor(6) as pool:
        for i,error in enumerate(pool.map(fetch,rows),1):
            if error:errors.append(error)
            if i%100==0:print('Official scans',i,'/',len(rows),flush=True)
    save(CACHE/'official-download-errors.json',errors)
    print('Official downloads complete; errors',len(errors),flush=True)

def baseline():
    catalog=json.loads((CACHE/'catalog-before.js').read_text('utf8').split('=',1)[1].rstrip(';\n'))
    review=json.loads((CACHE/'review-before.json').read_text('utf8'))
    return catalog,review

def source_maps(catalog,review):
    images={}; tcg={}
    def product_ids(value):
        text=json.dumps(value)
        return set(re.findall(r'(?:tcgplayer[^" ]*/product/|tcgplayer[^" ]*product%2F)(\d+)',text))
    for card in catalog['cards']:
        if card['game']!='onepiece':continue
        audit=review['cards'][card['id']]
        for version in audit.get('versions',[]):
            language=version['language']
            if language not in ('en','ja'):continue
            url=version.get('metadata',{}).get('sourceImageUrl')
            if url:images[url.split('?')[0]]={'cardId':card['id'],'language':language,'file':str(ROOT/'public'/version['image'])}
        for pid in product_ids(audit):tcg[pid]=card['id']
        m=re.fullmatch(r'op-(?:TCG|don-)(\d+)',card['id'])
        if m:tcg[m[1]]=card['id']
    return images,tcg

def supplemental_candidates():
    catalog,review=baseline();images,tcg=source_maps(catalog,review)
    raw=json.loads((CACHE/'dotgg-cards.json').read_text('utf8'))
    gg=[dict(zip(raw['names'],row)) for row in raw['data']]
    # DotGG market IDs can point to the ordinary card for a different artwork.
    # They are search hints only; they cannot establish printing identity.
    singles=[]
    for row in json.loads((CACHE/'tcg-all.json').read_text('utf8')):
        data={entry['name']:entry['value'] for entry in row.get('extendedData',[])}
        if data.get('CardType') not in ('Leader','Character','Event','Stage','DON!!') and not (data.get('Number')=='1/1000'):continue
        code=data.get('Number') or ('DON!!' if data.get('CardType')=='DON!!' else '')
        if not (re.fullmatch(r'(?:OP|ST|EB|PRB)\d+-\d+|P-\d+|DON!!|1/1000',code)):continue
        row={**row,'code':code,'data':data,'existingCardId':tcg.get(str(row['productId']))}
        singles.append(row)
    save(CACHE/'tcg-singles.json',singles)
    save(CACHE/'existing-image-map.json',images)
    print('TCG singles',len(singles),'already linked',sum(bool(r['existingCardId']) for r in singles),flush=True)
    # These sources identify the image independently; no variant is equated by its suffix alone.
    save(CACHE/'dotgg-expanded.json',gg)
    jobs=[]
    previous_errors=json.loads((CACHE/'tcg-download-errors.json').read_text('utf8')) if (CACHE/'tcg-download-errors.json').exists() else []
    unavailable={str(row['productId']) for row in previous_errors if '404' in row.get('error','')}
    for row in singles:
        if str(row['productId']) in unavailable:continue
        url=re.sub(r'_200w\.[a-z]+$', '_in_1000x1000.jpg', row['imageUrl'])
        jobs.append((url,f'tcg-images/{row["productId"]}.jpg',str(row['productId'])))
    errors=list(previous_errors)
    def fetch(job):
        url,filename,key=job
        try:
            path=get(url,filename)
            from PIL import Image
            with Image.open(path) as image:
                if image.width<200 or image.height<200:raise ValueError('Unexpected image dimensions')
            return None
        except Exception as error:return {'productId':key,'sourceImageUrl':url,'error':str(error)}
    with ThreadPoolExecutor(8) as pool:
        for i,error in enumerate(pool.map(fetch,jobs),1):
            if error:errors.append(error)
            if i%200==0:print('TCG scans',i,'/',len(jobs),flush=True)
    save(CACHE/'tcg-download-errors.json',errors)
    print('TCG downloads complete; errors',len(errors),flush=True)

def image_feature(path):
    path=Path(path)
    stat=path.stat()
    key=hashlib.sha256(f'{path}:{stat.st_size}:{stat.st_mtime_ns}'.encode()).hexdigest()
    cached=CACHE/'features'/f'{key}.npy'
    if cached.exists():return np.load(cached,allow_pickle=False)
    image,_=normalized_image(path)
    array=np.asarray(image.resize((120,168),Image.Resampling.LANCZOS),dtype=np.uint8)
    cached.parent.mkdir(parents=True,exist_ok=True);np.save(cached,array,allow_pickle=False)
    return array

def normalized_image(path):
    with Image.open(path) as raw:image=raw.convert('RGB')
    crop=None
    # Reviewed square photographs: remove only the white canvas outside the card.
    if Path(path).stem in {'698315','698316','717459','733586','733594','733599','733600'}:
        array=np.asarray(image);yy,xx=np.where(np.min(array,axis=2)<220)
        crop=[int(xx.min()),int(yy.min()),int(xx.max())+1,int(yy.max())+1]
        image=image.crop(tuple(crop))
    return image,crop

def image_distance(a,b):
    diff=np.abs(a.astype(np.int16)-b.astype(np.int16)).astype(np.float32)
    outside=np.concatenate([diff[4:58,4:116],diff[105:164,4:116]])
    top=diff[4:54,4:114].reshape(5,10,11,10,3).mean(axis=(1,3,4))
    bottom=diff[108:158,4:114].reshape(5,10,11,10,3).mean(axis=(1,3,4))
    return float(outside.mean()),float(max(top.max(),bottom.max())),float(diff[12:58,12:108].mean())

def whole_distance(a,b):
    diff=np.abs(a.astype(np.int16)-b.astype(np.int16)).astype(np.float32)
    blocks=diff.reshape(14,12,12,10,3).mean(axis=(1,3,4))
    return float(diff.mean()),float(blocks.max())

def stamp_class(label):
    text=label.lower()
    for original,translated in [('準優勝',' finalist '),('優勝',' winner '),('チャンピオンシップ',' championship '),
                                ('フラッグシップバトル',' flagship battle '),('スタンダードバトル',' standard battle '),
                                ('イベントパック',' event pack '),('ジャッジ',' judge '),('ベスト',' top ')]:
        text=text.replace(original,translated)
    text=re.sub(r'\bcs\b','championship',text)
    flags=[]
    if re.search(r'winner|champion(?!ship)|優勝',text):flags.append('winner')
    if re.search(r'finalist|準優勝',text):flags.append('finalist')
    if re.search(r'judge|ジャッジ',text):flags.append('judge')
    if re.search(r'pre[- ]?release',text):flags.append('prerelease')
    if re.search(r'serial|シリアル',text):flags.append('serial')
    for pattern,flag in [(r'top ?players?|top ?\d+','top-player'),(r'regional','regional'),(r'treasure ?cup','treasure-cup'),
                         (r'championship','championship'),(r'event ?pack','event-pack'),(r'tournament ?pack','tournament-pack'),
                         (r'anniversary','anniversary'),(r'beginner.*(?:party|battle)','beginner'),(r'release ?event','release-event'),
                         (r'flagship ?battle','flagship'),(r'standard ?battle','standard-battle')]:
        if re.search(pattern,text):flags.append(flag)
    if flags:
        flags.extend(re.findall(r'online|offline|20\d{2}|\b\d{2}[-–]\d{2}\b',text))
        flags.extend('vol'+number for number in re.findall(r'vol\.?\s*(\d+)',text))
        flags.extend('season'+number for number in re.findall(r'season\s*(\d+)',text))
        flags.extend('place'+number for number in re.findall(r'(\d+)位',text))
        flags.extend('anniversary'+number for number in re.findall(r'(\d+)(?:st|nd|rd|th)\s*anniversary',text))
    return sorted(flags)

def separate_stamps():
    catalog,review=baseline();cards={c['id']:c for c in catalog['cards']}
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'));existing_refs={};changes=[];extra=[]
    tcg={r['productId']:r for r in json.loads((CACHE/'tcg-singles.json').read_text('utf8'))}
    product_group_names={r['groupId']:r['name'] for r in json.loads((CACHE/'tcg-groups.json').read_text('utf8'))['results']}
    def source_identity(source):
        label=source['label']
        if source['kind']=='tcg':label+=' '+product_group_names[tcg[source['productId']]['groupId']]
        return tuple(stamp_class(label))
    for cid,audit in review['cards'].items():
        for source in audit.get('metadata',{}).get('printSources',[]):
            if source.get('referenceImageUrl'):existing_refs[source['referenceImageUrl'].split('?')[0]]=cid
    def raw_view(source):
        file=CACHE/(f'official-images/{source["language"]}_{source["printing"]}.png' if source['kind']=='official' else f'tcg-images/{source["productId"]}.jpg')
        return {'file':str(file),'existing':False,'source':source} if file.exists() else None
    for design in designs:
        if design['existing']:
            audit=review['cards'][design['id']]
            labels=[cards[design['id']].get('variantLabel','')]+[s.get('label','') for s in audit.get('metadata',{}).get('printSources',[])]
            allowed={tuple(stamp_class(label)) for label in labels}
        else:allowed={source_identity(design['sources'][0])}
        groups=defaultdict(list);keep=[]
        for source in design['sources']:
            stamp=source_identity(source)
            direct=existing_refs.get(source['sourceImageUrl'].split('?')[0])==design['id']
            if stamp in allowed or direct:keep.append(source)
            else:groups[stamp].append(source)
        if not groups:continue
        design['sources']=keep
        removed={s['key'] for group in groups.values() for s in group}
        design['matches']=[m for m in design.get('matches',[]) if m['key'] not in removed]
        if not design['existing']:
            views={}
            for source in sorted(keep,key=lambda s:s['kind']=='official'):
                view=raw_view(source)
                if view:views.setdefault(source['language'],view)
            design['views']=views
        for cohort,sources in groups.items():
            first=sources[0];identifier='op-print-'+first['key'].replace(':','-')
            views={}
            for source in sorted(sources,key=lambda s:s['kind']=='official'):
                view=raw_view(source)
                if view:views.setdefault(source['language'],view)
            if not views:raise ValueError('Missing source for stamp split '+identifier)
            extra.append({'id':identifier,'code':design['code'],'existing':False,'views':views,'sources':sources,'labels':[s['label'] for s in sources]})
            changes.append({'from':design['id'],'to':identifier,'identity':cohort,'sources':[s['key'] for s in sources]})
    designs.extend(extra)
    save(CACHE/'design-plan.json',designs);save(CACHE/'stamp-separations.json',changes)
    print('Kept distinct stamp cohorts:',len(extra),flush=True)

def official_set(row):
    series=row['series']
    tail=series[-3:]
    if tail=='901':return 'P' if row['code'].startswith('P-') else 'PROMO_JP'
    if tail=='801':return 'OTHER'
    if tail=='701':return 'FAMILY_DECK_JP'
    if tail[0]=='3':return 'PRB'+tail[1:]
    if tail[0]=='2':return 'EB'+tail[1:]
    if tail[0]=='1':return 'OP'+tail[1:]
    if tail[0]=='0':return 'ST'+tail[1:]
    raise ValueError(series)

def tcg_set(row,group_map,set_map):
    name=group_map[row['groupId']]['name']
    if row['groupId']==17675:return 'P' if row['code'].startswith('P-') else 'PROMO_JP'
    if row['groupId']==23304:return 'OTHER'
    if row['groupId']==23907:return 'OPDD'
    if row['groupId']==23890:return 'REVISION'
    if row['groupId'] in {17659:0,17658:1,17660:2,17661:3}:return {17659:'ST01_PRE',17658:'ST02_PRE',17660:'ST03_PRE',17661:'ST04_PRE'}[row['groupId']]
    match=re.search(r'Double Pack Set Vol\.?\s*(\d+)',row['name'],re.I)
    if match:return 'DP'+match[1].zfill(2)
    match=re.match(r'ST-(\d+)',name)
    if match:return 'ST'+match[1].zfill(2)
    if 'Premium Booster' in name:return 'PRB02' if 'Vol. 2' in name else 'PRB01'
    # Product names are an independent TCGplayer grouping, not the code prefix of reprints.
    clean=lambda value:re.sub(r'[^a-z0-9]','',value.lower())
    for set_id,entry in set_map.items():
        if re.fullmatch(r'OP\d{2}',set_id) and clean(entry['name']) in clean(name):
            if re.search(r'(?:Pre-Release|Release Event)',name,re.I):return set_id+'_RELEASE'
            if 'Anniversary Tournament' in name:return set_id+'_ANNIVERSARY'
            return set_id
    extra={'Extra Booster: Memorial Collection':'EB01','Extra Booster: Anime 25th Collection':'EB02','Extra Booster: One Piece Heroines Edition':'EB03','Extra Booster: One Piece Heroines Edition Vol. 2':'EB05'}
    if name in extra:return extra[name]
    if name=='Learn Together Deck Set':return 'LD01'
    if name=='Set Sail Deck Set':return 'SD01'
    return 'OTHER'

def prepare_plan():
    catalog,review=baseline()
    source_images,tcg_direct=source_maps(catalog,review)
    set_map={s['id']:s for s in catalog['sets'] if s['game']=='onepiece'}
    groups={g['groupId']:g for g in json.loads((CACHE/'tcg-groups.json').read_text('utf8'))['results']}
    designs={};families=defaultdict(list);direct={};features={};comparisons=[];missing=[]
    def feature(file):
        if file not in features:features[file]=image_feature(file)
        return features[file]
    for card in catalog['cards']:
        if card['game']!='onepiece':continue
        audit=review['cards'][card['id']]
        views={v['language']:{'file':str(ROOT/'public'/v['image']),'existing':True} for v in (card.get('imageVersions') or [{'language':card['imageLanguage'],'image':card['image']}]) if v['language'] in ['en','ja']}
        design={'id':card['id'],'code':card['code'],'existing':True,'views':views,'sources':[],
                'labels':[card.get('variantLabel','')]+[s.get('label','') for s in audit.get('metadata',{}).get('printSources',[])]}
        designs[card['id']]=design;families[card['code']].append(design)
        for source in audit.get('metadata',{}).get('printSources',[]):
            url=source.get('referenceImageUrl')
            if url:direct[url.split('?')[0]]=card['id']
    checkpoint=CACHE/'plan-checkpoint.json'
    saved=json.loads(checkpoint.read_text('utf8')) if checkpoint.exists() else None
    if saved and saved.get('version')==2:
        designs={d['id']:d for d in saved['designs']};families=defaultdict(list)
        for design in designs.values():families[design['code']].append(design)
        direct=saved['direct'];comparisons=saved['comparisons'];missing=saved['missing']
    def checkpoint_save(phase,index,finish_pairs=None):
        save(checkpoint,{'version':2,'phase':phase,'index':index,'designs':list(designs.values()),'direct':direct,
                         'comparisons':comparisons,'missing':missing,'finishPairs':[[*key,value] for key,value in (finish_pairs or {}).items()]})
    def best_match(row,file,cross=False):
        options=[];a=feature(file);stamp=stamp_class(row['label'])
        for design in families[row['code']]:
            labels=' '.join(design['labels'])
            # A prize stamp must never disappear into an ordinary print on illustration similarity alone.
            if stamp!=stamp_class(labels):continue
            for language,view in design['views'].items():
                if cross == (language==row['language']):continue
                if not Path(view['file']).exists():continue
                mean,patch,art=image_distance(a,feature(view['file']))
                options.append((mean,patch,art,design['id'],language))
        return sorted(options)[:3]
    official=json.loads((CACHE/'official-all.json').read_text('utf8'))
    # English first; shared regional PRB print identifiers still require an image comparison.
    official.sort(key=lambda row:(row['language']!='en',row['series'],row['code'],row['printing']))
    for i,row in enumerate(official):
        if saved and saved.get('version')==2 and (saved['phase']=='tcg' or i<=saved['index']):continue
        row={**row,'kind':'official','setId':official_set(row)}
        uri=row['sourceImageUrl'].split('?')[0]
        target=direct.get(uri)
        file=str(CACHE/f'official-images/{row["language"]}_{row["printing"]}.png')
        match=None
        if not target:
            if not Path(file).exists():missing.append(row);continue
            candidates=best_match(row,file)
            if candidates:
                mean,patch,art,candidate,language=candidates[0]
                if mean<1.8 and patch<11:target=candidate;match={'mean':mean,'patch':patch,'art':art,'method':'same-language-whole-frame'}
                # Explicit reprints can change text/block/finish while preserving the illustration.
                elif '_r' in row['printing'] and row['setId'].startswith('PRB') and art<2.2 and mean<9:
                    target=candidate;match={'mean':mean,'patch':patch,'art':art,'method':'PRB-reprint-artwork'}
                elif mean<8:comparisons.append({'row':row,'file':file,'candidates':candidates})
            if not target and row['language']=='ja' and (row['setId'].startswith('PRB') or re.fullmatch(r'P-\d+',row['printing'])):
                for candidate in best_match(row,file,cross=True):
                    mean,patch,art,identifier,language=candidate
                    design=designs[identifier]
                    same_print=any(s.get('printing')==row['printing'] and s['setId']==row['setId'] for s in design['sources'])
                    if same_print and mean<13 and art<7:
                        target=identifier;match={'mean':mean,'patch':patch,'art':art,'method':'regional-identifier-and-artwork'};break
        if not target:
            target='op-complete-'+row['language']+'-'+row['printing']
            if target in designs:raise ValueError(target)
            designs[target]={'id':target,'code':row['code'],'existing':False,'views':{},'sources':[],'labels':[]}
            families[row['code']].append(designs[target])
        design=designs[target]
        design['sources'].append(row);design['labels'].append(row['label'])
        if row['language'] not in design['views']:design['views'][row['language']]={'file':file,'existing':False,'source':row}
        direct[uri]=target
        if match:design.setdefault('matches',[]).append({'key':row['key'],**match})
        if i%1000==0:print('Planning official',i,'/',len(official),flush=True)
    if not saved or saved.get('phase')!='tcg':checkpoint_save('official',len(official)-1)
    # Process normal DON before their finish-only Gold/Special Foil counterpart.
    tcg=json.loads((CACHE/'tcg-singles.json').read_text('utf8'))
    tcg.sort(key=lambda r:bool(re.search(r'\((?:Gold|Special Foil)\)',r['name'])))
    finish_pairs={(gid,name):cid for gid,name,cid in saved.get('finishPairs',[])} if saved and saved.get('phase')=='tcg' else {}
    recovered={str(r['productId']) for r in json.loads((CACHE/'thumbnail-recovery.json').read_text('utf8')).get('recovered',[])} if (CACHE/'thumbnail-recovery.json').exists() else set()
    for i,product in enumerate(tcg):
        if saved and saved.get('version')==2 and saved['phase']=='tcg' and i<=saved['index']:continue
        pid=str(product['productId']);file=str(CACHE/f'tcg-images/{pid}.jpg')
        thumb=CACHE/f'tcg-thumbnails/{pid}.jpg'
        if not Path(file).exists() and pid in recovered and thumb.exists():file=str(thumb)
        row={'kind':'tcg','key':'tcg:'+pid,'productId':product['productId'],'code':product['code'],'language':'en',
             'name':product['name'],'label':product['name'],'rarity':product['data'].get('Rarity',''),
             'category':product['data'].get('CardType','Character').upper(),
             'colors':re.findall('Red|Green|Blue|Purple|Black|Yellow',product['data'].get('Color','')),
             'setId':tcg_set(product,groups,set_map),'sourceUrl':product['url'],
             'sourceImageUrl':re.sub(r'_200w\.[a-z]+$','_in_1000x1000.jpg',product['imageUrl'])}
        if file==str(thumb):row['sourceImageUrl']=product['imageUrl'];row['lowResolution']=True
        target=product.get('existingCardId')
        if target and row['language'] not in designs[target]['views'] and not Path(file).exists():missing.append(row);continue
        match=None
        finish_name=re.sub(r'\s*\((?:Gold|Special Foil)\)','',row['name']).strip()
        finish_key=(product['groupId'],finish_name)
        finish_only=row['category']=='DON!!' and finish_name!=row['name'] and finish_key in finish_pairs
        if finish_only:target=finish_pairs[finish_key]
        if not target:
            if not Path(file).exists() or pid=='599832':missing.append(row);continue
            candidates=best_match(row,file)
            if candidates:
                mean,patch,art,candidate,language=candidates[0]
                if mean<2.8 and patch<15:target=candidate;match={'mean':mean,'patch':patch,'art':art,'method':'same-language-whole-frame'}
                elif mean<9:comparisons.append({'row':row,'file':file,'candidates':candidates})
        if not target:
            target='op-TCG'+pid
            if target in designs:raise ValueError(target)
            designs[target]={'id':target,'code':row['code'],'existing':False,'views':{},'sources':[],'labels':[]}
            families[row['code']].append(designs[target])
        design=designs[target];design['sources'].append(row);design['labels'].append(row['label'])
        if row['language'] not in design['views']:design['views']['en']={'file':file,'existing':False,'source':row}
        # Prefer the product photograph over a SAMPLE reference for a new, securely matched artwork.
        elif not design['existing'] and not finish_only and design['views']['en'].get('source',{}).get('kind')=='official' and Path(file).exists() and (match or product.get('existingCardId')):
            design['views']['en']={'file':file,'existing':False,'source':row}
        if match:design.setdefault('matches',[]).append({'key':row['key'],**match})
        if finish_only:design.setdefault('finishOnly',[]).append(row['key'])
        finish_pairs[finish_key]=target
        if i%1000==0:print('Planning TCG',i,'/',len(tcg),flush=True)
        if i%500==0:checkpoint_save('tcg',i,finish_pairs)
    save(CACHE/'design-plan.json',list(designs.values()))
    save(CACHE/'close-comparisons.json',comparisons)
    save(CACHE/'unavailable-source-scans.json',missing)
    if checkpoint.exists():checkpoint.unlink()
    print('Design plan',len(designs),'new',sum(not d['existing'] for d in designs.values()),'close comparisons',len(comparisons),'unavailable',len(missing),flush=True)

def write_catalog(catalog):
    (ROOT/'public/catalog.js').write_text('globalThis.TCG_ART_ATLAS_CATALOG='+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf8')

def reconcile_regional_renders():
    catalog,review=baseline();cards={c['id']:c for c in catalog['cards'] if c['game']=='onepiece'}
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'));byid={d['id']:d for d in designs};families=defaultdict(list);changes=[];removed=set()
    for card in cards.values():families[card['code']].append(card)
    feature={}
    def pixels(file):
        if file not in feature:feature[file]=image_feature(file)
        return feature[file]
    normalize=lambda name:re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',name).lower())
    for design in designs:
        if design['existing'] or set(design['views'])!={'en'}:continue
        sources=[s for s in design['sources'] if s['kind']=='tcg' and re.fullmatch(r'(?:OP|EB|ST)\d{2}',s['setId']) and not stamp_class(s['label'])]
        if not sources:continue
        source=sources[0];options=[]
        for card in families[design['code']]:
            audit=review['cards'][card['id']]
            jp=next((v for v in audit.get('versions',[]) if v['language']=='ja' and 'onepiece-cardgame.com/cardlist/' in v.get('metadata',{}).get('sourceUrl','')),None)
            en=next((v for v in audit.get('versions',[]) if v['language']=='en'),None)
            if not jp or not en:continue
            refs=[s for s in audit.get('metadata',{}).get('printSources',[]) if s.get('region')=='en' and s.get('setId')==source['setId'] and s.get('referenceImageUrl')]
            if not refs:continue
            mean,patch,art=image_distance(pixels(design['views']['en']['file']),pixels(str(ROOT/'public'/jp['image'])))
            plain_name=re.sub(r'\s*\(\d+\)\s*$','',source['name'])
            standard=(not card['isAlternative'] and normalize(plain_name)==normalize(card['name']) and any(Path(s['referenceImageUrl'].split('?')[0]).stem==card['code'] for s in refs))
            options.append((art,mean,patch,card['id'],en,jp,standard))
        options.sort(key=lambda v:v[0])
        if not options:continue
        art,mean,patch,cid,en,jp,standard=options[0]
        gap=options[1][0]-art if len(options)>1 else 100
        if not ((art<2.5 and gap>3) or (standard and 'oppp.online' in en.get('metadata',{}).get('sourceUrl',''))):continue
        target=byid[cid]
        target['sources'].extend(design['sources']);target['labels'].extend(design['labels'])
        target.setdefault('matches',[]).append({'key':source['key'],'method':'verified-product-identity-and-Japanese-reference','artDifference':art,'outsideDifference':mean,'gap':gap})
        # Existing faithful photographs are retained. Reconstructed proxy frames are replaced in place.
        old_image=str(ROOT/'public'/en['image']);actual=design['views']['en']['file']
        old_mean,old_patch,_=image_distance(pixels(old_image),pixels(actual))
        if old_mean>2.8 or old_patch>15:
            target['views']['en']={**design['views']['en'],'replaceImage':en['image'],'replacementReason':'Original physical printing verified against product inventory and official Japanese scan; replaces a reconstructed or differently reframed English rendering.'}
        changes.append({'from':design['id'],'to':cid,'source':source['key'],'artDifference':art,'outsideDifference':mean,'standardProductIdentity':standard,'oldEnglishImage':en['image']})
        removed.add(design['id'])
    save(CACHE/'design-plan.json',[d for d in designs if d['id'] not in removed]);save(CACHE/'regional-render-reconciliations.json',changes)
    print('Regional originals reconciled',len(changes),'English render replacements',sum('replaceImage' in d['views'].get('en',{}) for d in designs),flush=True)

def make_sheet(items,destination,columns=4,per_page=16):
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',13)
    destination.mkdir(parents=True,exist_ok=True)
    manifest=[]
    for start in range(0,len(items),per_page):
        batch=items[start:start+per_page]
        sheet=Image.new('RGB',(columns*250,((len(batch)+columns-1)//columns)*410),'#eeeeee');draw=ImageDraw.Draw(sheet)
        for offset,item in enumerate(batch):
            x=(offset%columns)*250;y=(offset//columns)*410
            with Image.open(item['file']) as raw:
                image=raw.convert('RGB');image.thumbnail((238,338),Image.Resampling.LANCZOS)
                sheet.paste(image,(x+(250-image.width)//2,y+4))
            for line_no,line in enumerate(item['label'].split('\n')[:4]):draw.text((x+5,y+345+line_no*15),line[:38],font=font,fill='black')
        path=destination/f'{start//per_page+1:03}.jpg';sheet.save(path,quality=92)
        manifest.append({'file':str(path),'items':batch})
    save(destination/'index.json',manifest)
    print('Contact sheets',len(manifest),destination,flush=True)

def language_sheets():
    rows=json.loads((CACHE/'tcg-singles.json').read_text('utf8'));gg=json.loads((CACHE/'dotgg-expanded.json').read_text('utf8'));languages=defaultdict(set)
    for row in gg:
        for pid in re.findall(r'\d+',str(row.get('marketIds') or '')):languages[pid].add(row['language'])
    items=[]
    for row in rows:
        flags=languages.get(str(row['productId']),set())
        file=CACHE/f'tcg-images/{row["productId"]}.jpg'
        if file.exists() and flags and 'en' not in flags:
            items.append({'file':str(file),'label':f'{row["productId"]} {row["code"]}\n{row["name"]}\nGG: {"/".join(sorted(flags))}','productId':row['productId']})
    make_sheet(items,CACHE/'language-sheets')

def download_limitless():
    rows=json.loads((CACHE/'limitless-all.json').read_text('utf8'))
    errors=[]
    def fetch(row):
        key=hashlib.sha256(row['sourceImageUrl'].encode()).hexdigest()[:20]
        try:
            path=get(row['sourceImageUrl'],f'limitless-images/{key}.webp')
            with Image.open(path) as image:
                if image.width<200 or image.height<200:raise ValueError('Unexpected dimensions')
            return None
        except Exception as error:return {**row,'error':str(error)}
    with ThreadPoolExecutor(8) as pool:
        for i,error in enumerate(pool.map(fetch,rows),1):
            if error:errors.append(error)
            if i%200==0:print('Limitless scans',i,'/',len(rows),flush=True)
    save(CACHE/'limitless-download-errors.json',errors)
    print('Limitless reference downloads complete;',len(errors),'errors',flush=True)

def recover_thumbnails():
    rows=[r for r in json.loads((CACHE/'tcg-singles.json').read_text('utf8')) if not (CACHE/f'tcg-images/{r["productId"]}.jpg').exists()]
    errors=[];recovered=[]
    def fetch(row):
        try:
            file=get(row['imageUrl'],f'tcg-thumbnails/{row["productId"]}.jpg')
            with Image.open(file) as image:
                if image.width<120 or not 1.28<image.height/image.width<1.52:raise ValueError('Not a usable card thumbnail')
            return {'productId':row['productId'],'file':str(file),'sourceImageUrl':row['imageUrl']}
        except Exception as error:return {'productId':row['productId'],'error':str(error)}
    with ThreadPoolExecutor(6) as pool:
        for result in pool.map(fetch,rows):
            (errors if 'error' in result else recovered).append(result)
    save(CACHE/'thumbnail-recovery.json',{'recovered':recovered,'errors':errors})
    print('Original public thumbnails recovered',len(recovered),'unavailable',len(errors),flush=True)

def download_dotgg():
    rows=json.loads((CACHE/'dotgg-expanded.json').read_text('utf8'))
    jobs={r['id']:r for r in rows};errors=[]
    def fetch(item):
        key,row=item;url=f'https://static.dotgg.gg/onepiece/card/{key}.webp'
        try:
            file=get(url,f'dotgg-images/{key}.webp')
            with Image.open(file) as image:
                if image.width<200 or image.height<200:raise ValueError('Unexpected image size')
            return None
        except Exception as error:return {'id':key,'sourceImageUrl':url,'error':str(error)}
    with ThreadPoolExecutor(8) as pool:
        for i,error in enumerate(pool.map(fetch,jobs.items()),1):
            if error:errors.append(error)
            if i%500==0:print('DotGG scans',i,'/',len(jobs),flush=True)
    save(CACHE/'dotgg-download-errors.json',errors)
    print('DotGG reference downloads complete;',len(errors),'unavailable',flush=True)

def clean_candidates():
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'));rows=json.loads((CACHE/'dotgg-expanded.json').read_text('utf8'))
    families=defaultdict(list);features={};matches=[]
    for row in rows:
        code='DON!!' if row['cardType']=='DON!!' else row['id_normal']
        file=CACHE/f'dotgg-images/{row["id"]}.webp'
        if file.exists():families[code].append((row,str(file)))
    def feature(file):
        if file not in features:features[file]=image_feature(file)
        return features[file]
    for i,design in enumerate(designs):
        for language,view in design['views'].items():
            if language!='en' or view['existing']:continue
            original=feature(view['file']);options=[]
            for row,file in families[design['code']]:
                candidate=feature(file);mean,patch,art=image_distance(original,candidate)
                if mean>2.5 or patch>12 or art>2.5:continue
                actual=original[58:105,4:116].astype(np.float32);clean=candidate[58:105,4:116].astype(np.float32)
                delta=actual-clean;changed=np.abs(delta).mean(axis=2)>10
                if changed.sum()<100:continue
                white=255-clean;alpha=np.clip((delta*white).sum(axis=2)/(np.square(white).sum(axis=2)+1e-5),0,1)
                residual=np.abs(actual-(clean+alpha[:,:,None]*white)).mean(axis=2)
                positive=float((delta[changed].mean(axis=1)>4).mean());error=float(residual[changed].mean())
                if positive<.9 or error>5 or delta.mean()<1.8:continue
                source=view['source'];ordinary=bool(re.fullmatch(r'(?:OP|EB|ST|PRB)\d{2}',source['setId'])) and not stamp_class(source['label']) and not stamp_class(row['CardSets'] or '')
                options.append({'cardId':design['id'],'language':language,'id':row['id'],'file':file,'referenceFile':view['file'],
                    'sourceImageUrl':f'https://static.dotgg.gg/onepiece/card/{row["id"]}.webp','sourceUrl':f'https://onepiece.gg/cards/{row["id"]}/',
                    'label':row['CardSets'],'outsideDifference':mean,'maxOutsideBlock':patch,'artDifference':art,
                    'positiveWhiteningFraction':positive,'whiteningFitError':error,'automaticOrdinaryMatch':ordinary})
            if options:matches.append(min(options,key=lambda row:(not row['automaticOrdinaryMatch'],row['outsideDifference'],row['whiteningFitError'])))
        if i%2000==0:print('Clean-image comparisons',i,'/',len(designs),flush=True)
    save(CACHE/'clean-candidates.json',matches)
    print('Clean candidates',len(matches),'ordinary',sum(m['automaticOrdinaryMatch'] for m in matches),'prize variants for visual review',sum(not m['automaticOrdinaryMatch'] for m in matches),flush=True)

def cache_features():
    catalog,_=baseline();files=set()
    for card in catalog['cards']:
        if card['game']=='onepiece':files.update(str(ROOT/'public'/v['image']) for v in card.get('imageVersions',[{'image':card['image']}]))
    for folder,extension in [('official-images','png'),('tcg-images','jpg'),('limitless-images','webp')]:
        files.update(str(p) for p in (CACHE/folder).glob('*.'+extension))
    with ThreadPoolExecutor(8) as pool:
        for i,_ in enumerate(pool.map(image_feature,sorted(files)),1):
            if i%1000==0:print('Image features',i,'/',len(files),flush=True)
    print('Feature cache complete',len(files),flush=True)

def index_conversions():
    current=json.loads((ROOT/'public/catalog.js').read_text('utf8').split('=',1)[1].rstrip(';\n'));cards={c['id']:c for c in current['cards']}
    index={}
    for design in json.loads((CACHE/'design-plan.json').read_text('utf8')):
        card=cards.get(design['id'])
        if not card:continue
        versions=card.get('imageVersions',[{'language':card['imageLanguage'],'image':card['image'],'width':card['imageWidth'],'height':card['imageHeight']}])
        for language,view in design['views'].items():
            if view['existing']:continue
            version=next(v for v in versions if v['language']==language);target=ROOT/'public'/version['image'];stat=Path(view['file']).stat()
            signature=f'{view["file"]}:{stat.st_size}:{stat.st_mtime_ns}:webp90m5:canvas2'
            _,crop=normalized_image(view['file']) if Path(view['file']).stem in {'698315','698316','717459','733586','733594','733599','733600'} else (None,None)
            stat=target.stat();index[version['image']]={'signature':signature,'outputStat':[stat.st_size,stat.st_mtime_ns],'size':[version['width'],version['height']],'crop':crop}
    save(CACHE/'conversion-index.json',index)
    print('Indexed conversions',len(index),flush=True)

def enrich_limitless():
    catalog,review=baseline()
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'))
    by_id={d['id']:d for d in designs};by_code=defaultdict(list);known={};features={};unmatched=[];matches=[]
    for design in designs:by_code[design['code']].append(design)
    def feature(file):
        if file not in features:features[file]=image_feature(file)
        return features[file]
    for i,row in enumerate(json.loads((CACHE/'limitless-all.json').read_text('utf8'))):
        target=None;distance=None
        if not target:
            key=hashlib.sha256(row['sourceImageUrl'].encode()).hexdigest()[:20]
            file=str(CACHE/f'limitless-images/{key}.webp')
            if not Path(file).exists():
                unmatched.append({**row,'file':file,'candidates':[],'issue':'REFERENCE_SCAN_UNAVAILABLE'});continue
            candidates=[];a=feature(file)
            for design in by_code[row['code']]:
                views=[]
                if design['views'].get(row['language']):views.append(design['views'][row['language']]['file'])
                for source in design['sources']:
                    if source['language']!=row['language']:continue
                    file_path=CACHE/(f'official-images/{source["language"]}_{source["printing"]}.png' if source['kind']=='official' else f'tcg-images/{source["productId"]}.jpg')
                    if file_path.exists():views.append(str(file_path))
                for source_file in set(views):
                    mean,patch=whole_distance(a,feature(source_file))
                    candidates.append((mean,patch,0,design['id']))
            candidates.sort()
            if candidates and candidates[0][0]<2.8 and candidates[0][1]<15:
                mean,patch,art,target=candidates[0];distance={'mean':mean,'patch':patch,'art':art}
            else:unmatched.append({**row,'file':file,'candidates':candidates[:3]});continue
        design=by_id[target]
        if row.get('artist'):design.setdefault('artistCandidates',[]).append({**row,'match':distance or {'method':'previously-verified-exact-reference'}})
        matches.append({'sourceImageUrl':row['sourceImageUrl'],'sourceUrl':row['sourceUrl'],'cardId':target,'language':row['language'],'match':distance})
        if i%1000==0:print('Limitless comparison',i,'/',9748,flush=True)
    save(CACHE/'design-plan.json',designs);save(CACHE/'limitless-unmatched.json',unmatched);save(CACHE/'limitless-matches.json',matches)
    print('Limitless matched',len(matches),'unmatched',len(unmatched),flush=True)

def limitless_details():
    rows=json.loads((CACHE/'limitless-unmatched.json').read_text('utf8'))
    tasks={r['sourceUrl'].split('?')[0]:r for r in rows if 'issue' not in r}
    def fetch(item):
        base,row=item;language=row['language'];code=row['code']
        path=get(base,f'limitless-details/{language}_{code}.html')
        soup=BeautifulSoup(path.read_text('utf8'),'html.parser')
        prints=[]
        current=soup.select_one('.card-prints-current .text-lg')
        if current:prints.append({'sourceUrl':base,'label':current.get_text(' ',strip=True)})
        for tr in soup.select('.card-prints-versions tr'):
            link=tr.select_one('td:first-child a[href]')
            if link:prints.append({'sourceUrl':urljoin('https://onepiece.limitlesstcg.com',link['href']),'label':link.get_text(' ',strip=True)})
        return prints
    entries=[]
    with ThreadPoolExecutor(6) as pool:
        for i,prints in enumerate(pool.map(fetch,tasks.items()),1):
            entries.extend(prints)
            if i%100==0:print('Print descriptions',i,'/',len(tasks),flush=True)
    save(CACHE/'limitless-print-labels.json',{r['sourceUrl']:r['label'] for r in entries})
    print('Retrieved descriptions',len(entries),'from',len(tasks),'card families',flush=True)

def finish_references():
    """Resolve supplemental references by exact print identity, not shared artwork/marketIds."""
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'))
    if (CACHE/'reference-resolution.json').exists():raise ValueError('References already resolved; review the saved resolution before rerunning')
    catalog,_=baseline();by_id={d['id']:d for d in designs};by_code=defaultdict(list)
    for d in designs:by_code[d['code']].append(d)
    tcg={s['productId']:d for d in designs for s in d['sources'] if s['kind']=='tcg'}
    labels=json.loads((CACHE/'limitless-print-labels.json').read_text('utf8'))
    links=json.loads((CACHE/'limitless-market-links.json').read_text('utf8'))
    resolved=[];added=[];pending=[];features={}
    def feature(file):
        if file not in features:features[file]=image_feature(file)
        return features[file]
    def source_files(d,language):
        files=[v['file'] for lang,v in d['views'].items() if lang==language]
        for s in d['sources']:
            if s['language']!=language:continue
            file=CACHE/(f'official-images/{language}_{s["printing"]}.png' if s['kind']=='official' else f'tcg-images/{s["productId"]}.jpg')
            if file.exists():files.append(str(file))
        return set(files)
    def credit(d,row,proof):
        if row.get('artist'):d.setdefault('artistCandidates',[]).append({**row,'match':proof})
        resolved.append({'sourceUrl':row['sourceUrl'],'sourceImageUrl':row['sourceImageUrl'],'cardId':d['id'],'language':row['language'],'match':proof})
    normalize=lambda s:re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s).lower())
    set_names={normalize(s['name']):s['id'] for s in catalog['sets'] if s['game']=='onepiece'}
    set_names.update({'onepiececardthebest':'PRB01','onepiececardthebestvol2':'PRB02','onepieceheroinesedition':'EB03','memorialcollection':'EB01','anime25thcollection':'EB02','exgear5':'ST21','exluffyace':'ST30'})
    for row in json.loads((CACHE/'limitless-unmatched.json').read_text('utf8')):
        if 'issue' in row:pending.append(row);continue
        label=re.sub(r'\s+',' ',labels[row['sourceUrl']]).strip();photo=feature(row['file']);target=None;proof=None
        # The price URL belongs to the specific row in the print table. Unlike DotGG marketIds,
        # it is not borrowed from another artwork; still require the picture to agree.
        pid=links.get(row['sourceUrl'],{}).get('productId')
        if row['language']=='en' and pid in tcg and tcg[pid]['code']==row['code']:
            reference=CACHE/f'tcg-images/{pid}.jpg'
            mean,patch,art=image_distance(photo,feature(str(reference)))
            if mean<7 and art<7 and patch<40:
                target=tcg[pid];proof={'method':'Specific Limitless print-table product identity and same-code photograph','productId':pid,'outsideMean':mean,'outsideMaxBlock':patch,'artMean':art}
        if target:
            credit(target,row,proof);continue
        options=[];flags=stamp_class(label)
        for d in by_code[row['code']]:
            # Do not turn an unlabelled ordinary scan into a prize variant or vice versa.
            identities=[stamp_class(s['label']) for s in d['sources'] if s['language']==row['language']]
            if flags and not any(set(flags)==set(f) for f in identities):continue
            if not flags and identities and all(f for f in identities):continue
            for file in source_files(d,row['language']):
                other=feature(file);mean,patch=whole_distance(photo,other);outside,block,art=image_distance(photo,other)
                # Compression/colour differences only. Full-frame blocks protect central stamps.
                if mean<4 and patch<12:options.append((mean,d,{'method':'Whole-frame comparison, including the stamp area','mean':mean,'maxBlock':patch}))
                elif outside<2.8 and block<12 and art<2.8:
                    # Accept a published SAMPLE overlay only when the rest of the frame agrees
                    # and neither direction contains meaningful unexplained darker marks.
                    a=photo.astype(np.float32);b=other.astype(np.float32)
                    for actual,clean in [(a,b),(b,a)]:
                        delta=actual-clean;white=255-clean
                        alpha=np.clip((delta*white).sum(axis=2)/(np.square(white).sum(axis=2)+1e-5),0,1)
                        changed=np.abs(delta).mean(axis=2)>15
                        residual=np.abs(actual-(clean+alpha[:,:,None]*white)).mean(axis=2)
                        negative=int(((delta.mean(axis=2)<-25)&(np.abs(delta).mean(axis=2)>30)).sum())
                        if changed.sum()>100 and negative<=2 and float(residual[changed].mean())<3:
                            options.append((mean,d,{'method':'Same print label and frame; difference fits the published white SAMPLE overlay','outsideMean':outside,'outsideMaxBlock':block,'fitError':float(residual[changed].mean())}));break
        if options:
            _,target,proof=min(options,key=lambda v:v[0]);credit(target,row,proof);continue
        # Only a clearly different scan is automatically added. Near matches stay in the private
        # queue rather than creating a second card for an uncertain finish/colour rendering.
        best=row['candidates'][0] if row['candidates'] else None
        if best and best[0]<8 and best[1]<35:
            pending.append({**row,'label':label,'issue':'VERIFY_PRINT_EQUIVALENCE'});continue
        code=row['code'];sid='P' if code.startswith('P-') else 'PROMO_JP' if re.search('prize|regional|championship|tournament|battle|event pack',label,re.I) else 'OTHER'
        product=re.search(r'\(((?:OP|EB|PRB|ST)\d{2})\)',label)
        short=re.sub(r'\s+(?:aa|fa|jr|tf)$','',label)
        if product:sid=product[1]
        elif normalize(short) in set_names:sid=set_names[normalize(short)]
        siblings=by_code[code];rarities={s['rarity'] for d in siblings for s in d['sources'] if s['setId']==sid and s['code']==code}
        rarity=next(iter(rarities)) if len(rarities)==1 else ''
        source={'kind':'limitless','key':'limitless:'+row['sourceUrl'],'code':code,'language':row['language'],'name':row['name'],
                'label':label,'rarity':rarity,'category':row['category'],'colors':row['colors'],'setId':sid,
                'sourceUrl':row['sourceUrl'],'sourceImageUrl':row['sourceImageUrl']}
        key=hashlib.sha256(row['sourceImageUrl'].encode()).hexdigest()[:12]
        design={'id':'op-reference-'+key,'code':code,'existing':False,'views':{row['language']:{'file':row['file'],'existing':False,'source':source}},'sources':[source],'labels':[label]}
        credit(design,row,{'method':'Direct import of this exact credited source scan'});designs.append(design);added.append(design['id'])
        # Keep this pass deterministic; newly imported files are not used as generic cross-print
        # references for other rows with insufficient product information.
    # A strict subset of ordinary scan substitutions. Never remove an event stamp, dialogue or
    # black text in exchange for a cleaner-looking image. Prize candidates stay untouched.
    clean=[]
    for row in json.loads((CACHE/'clean-candidates.json').read_text('utf8')):
        if not row['automaticOrdinaryMatch'] or row['strongNegativePixels'] or row['negativePixels']>=10 or row['whiteningFitError']>=3:continue
        d=by_id[row['cardId']];view=d['views'][row['language']]
        view['file']=row['file'];view['source']={**view['source'],'kind':'dotgg','sourceUrl':row['sourceUrl'],'sourceImageUrl':row['sourceImageUrl']}
        view['cleanMatch']=row;clean.append(row)
    save(CACHE/'design-plan.json',designs)
    save(CACHE/'reference-resolution.json',{'resolved':resolved,'addedCardIds':added,'pending':pending,'cleanOrdinaryScans':clean})
    print('Supplemental prints resolved',len(resolved),'new',len(added),'pending',len(pending),'conservative clean matches',len(clean),flush=True)


def refine_references():
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'));catalog,_=baseline()
    resolution=json.loads((CACHE/'reference-resolution.json').read_text('utf8'))
    if resolution.get('refined'):raise ValueError('References already refined')
    originals={c['id']:c for c in catalog['cards']};by_id={d['id']:d for d in designs};removed=set();changes=[]
    placeholders={r['productId'] for r in json.loads((CACHE/'landscape-source-images.json').read_text('utf8'))}
    # The marketplace sometimes serves its own landscape placeholder with a successful HTTP
    # response. It is a missing scan, not a card. Recover the ordinary product identity only.
    for d in designs:
        bad=[s for s in d['sources'] if s.get('productId') in placeholders]
        if not bad:continue
        for source in bad:
            target=next((by_id[c['id']] for c in originals.values() if c['game']=='onepiece' and c['code']==source['code'] and source['setId'] in c.get('setIds',[c['setId']]) and not c['isAlternative']),None)
            if not target:raise ValueError('Placeholder requires manual product resolution: '+source['key'])
            target['sources'].append(source);changes.append({'from':d['id'],'to':target['id'],'method':'Ordinary product/code identity; marketplace scan is a landscape placeholder'})
        if d['existing']:raise ValueError('Do not discard an original ID')
        removed.add(d['id'])
    tcg={s['productId']:d for d in designs if d['id'] not in removed for s in d['sources'] if s['kind']=='tcg'}
    links=json.loads((CACHE/'limitless-market-links.json').read_text('utf8'))
    incoming=set(resolution['addedCardIds']);families=defaultdict(list);features={}
    for d in designs:
        if d['id'] not in removed and d['id'] not in incoming:families[d['code']].append(d)
    def feature(file):
        if file not in features:features[file]=image_feature(file)
        return features[file]
    for d in designs:
        if d['id'] not in incoming:continue
        source=d['sources'][0];language=source['language'];pid=links.get(source['sourceUrl'],{}).get('productId');target=None;proof=None
        # This is the exact physical print's marketplace link in the Limitless table, not a
        # fuzzy code match. Foil photographs can differ greatly in brightness and colour.
        if language=='en' and pid in tcg and tcg[pid]['code']==d['code']:
            target=tcg[pid];proof={'method':'Exact physical-print table product identity; colour/foil rendering or placeholder differs','productId':pid}
        if target is None and re.fullmatch(r'(?:OP|EB|PRB|ST)\d{2}',source['setId']) and not stamp_class(source['label']):
            options=[]
            for other in families[d['code']]:
                if not any(s['setId']==source['setId'] and s['language']==language and not stamp_class(s['label']) for s in other['sources']):continue
                view=other['views'].get(language)
                if not view:continue
                mean,patch,art=image_distance(feature(d['views'][language]['file']),feature(view['file']))
                if mean<3.5 and patch<15 and art<4:options.append((mean,other,{'method':'Same ordinary physical product and full printed frame outside the differing published SAMPLE fonts','outsideMean':mean,'maxOutsideBlock':patch,'artMean':art}))
            if options:_,target,proof=min(options,key=lambda v:v[0])
        if target:
            target['sources'].extend(d['sources']);target.setdefault('artistCandidates',[]).extend({**c,'match':proof} for c in d.get('artistCandidates',[]))
            changes.append({'from':d['id'],'to':target['id'],**proof});removed.add(d['id'])
            for r in resolution['resolved']:
                if r['cardId']==d['id']:r.update(cardId=target['id'],match=proof)
    resolution['addedCardIds']=[cid for cid in resolution['addedCardIds'] if cid not in removed]
    resolution['refined']=changes
    save(CACHE/'design-plan.json',[d for d in designs if d['id'] not in removed]);save(CACHE/'reference-resolution.json',resolution)
    print('Reference equivalents/placeholder rows reconciled',len(changes),'remaining new supplemental prints',len(resolution['addedCardIds']),flush=True)


def fix_language_fallbacks():
    """Fourteen EN reference pages were visually checked: they actually display Japanese scans."""
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'));by={d['id']:d for d in designs}
    resolution=json.loads((CACHE/'reference-resolution.json').read_text('utf8'));matches=json.loads((CACHE/'limitless-matches.json').read_text('utf8'))
    rows=[r for r in json.loads((CACHE/'limitless-all.json').read_text('utf8')) if r['language']=='en' and '_JP.' in r['sourceImageUrl']]
    if len(rows)!=14:raise ValueError('Changed regional fallbacks require a new visual review')
    urls={r['sourceUrl']:r for r in rows};index={r['sourceUrl']:r for r in matches+resolution['resolved']};proofs=[]
    for url,row in urls.items():
        reference=index[url];d=by[reference['cardId']];reference['language']='ja'
        file=CACHE/f'limitless-images/{hashlib.sha256(row["sourceImageUrl"].encode()).hexdigest()[:20]}.webp'
        source=next((s for s in d['sources'] if s['sourceUrl']==url),None)
        if source:source['language']='ja'
        if 'ja' not in d['views']:
            label=re.sub(r'\s+',' ',json.loads((CACHE/'limitless-print-labels.json').read_text('utf8'))[url]).strip()
            source=source or {'kind':'limitless','key':'limitless:'+url,'code':row['code'],'language':'ja','name':row['name'],'label':label,'rarity':'','category':row['category'],'colors':row['colors'],'setId':'OTHER','sourceUrl':url,'sourceImageUrl':row['sourceImageUrl']}
            if not any(s['key']==source['key'] for s in d['sources']):d['sources'].append(source)
            d['views']['ja']={'file':str(file),'existing':False,'source':source}
        for credit in d.get('artistCandidates',[]):
            if credit['sourceUrl']==url:credit['language']='ja'
        proofs.append({'sourceUrl':url,'sourceImageUrl':row['sourceImageUrl'],'cardId':d['id'],'printedLanguage':'ja','method':'Full-card visual review in regional-fallback-review/001.jpg and 002.jpg; the English page uses a Japanese photograph'})
    # The JP pages referencing the same photos also resolve to these now bilingual cards.
    resolution['regionalPhotoFallbacks']=proofs
    save(CACHE/'design-plan.json',designs);save(CACHE/'reference-resolution.json',resolution);save(CACHE/'limitless-matches.json',matches)
    print('Verified Japanese photo fallbacks',len(proofs),flush=True)


def deduplicate_images():
    catalog=json.loads((ROOT/'public/catalog.js').read_text('utf8').split('=',1)[1].rstrip(';\n'))
    review=json.loads((ROOT/'CARD_REVIEW.json').read_text('utf8'));original,_=baseline()
    original_files={v['image'] for c in original['cards'] for v in c.get('imageVersions',[{'image':c['image']}])}
    languages={v['image']:v['language'] for c in catalog['cards'] if c['game']=='onepiece' for v in c.get('imageVersions',[{'language':c['imageLanguage'],'image':c['image']}])}
    groups=defaultdict(list)
    def digest(relative):return relative,hashlib.sha256((ROOT/'public'/relative).read_bytes()).hexdigest()
    with ThreadPoolExecutor(6) as pool:
        for relative,sha in pool.map(digest,languages):groups[(languages[relative],sha)].append(relative)
    moves={}
    for paths in groups.values():
        if len(paths)<2:continue
        canonical=min(paths,key=lambda p:(p not in original_files,len(p),p))
        moves.update({p:canonical for p in paths if p!=canonical})
    for c in catalog['cards']:
        c['image']=moves.get(c['image'],c['image'])
        for v in c.get('imageVersions',[]):v['image']=moves.get(v['image'],v['image'])
    for c in review['cards'].values():
        for v in c.get('versions',[]):
            if 'image' in v:v['image']=moves.get(v['image'],v['image'])
    for relative in moves:
        target=(ROOT/'public'/relative).resolve()
        if not target.is_relative_to((ROOT/'public/cards/onepiece').resolve()):raise ValueError('Unsafe duplicate path')
        target.unlink()
    review['onepieceCompletionAudit']['identicalScanAliases']=moves
    write_catalog(catalog);save(ROOT/'CARD_REVIEW.json',review)
    print('Identical published scans shared',len(moves),flush=True)


def update_display_data(catalog,review):
    official=json.loads((CACHE/'official-all.json').read_text('utf8'))
    english={r['code']:r for r in official if r['language']=='en'};translations=defaultdict(Counter)
    for row in official:
        if row['language']=='ja' and row['code'] in english:
            translations[unicodedata.normalize('NFKC',row['name'])][english[row['code']]['name']]+=1
    changed=0
    for card in catalog['cards']:
        if card['game']!='onepiece' or not re.search(r'[\u3040-\u30ff\u3400-\u9fff]',card['name']):continue
        before=card['name'];row=english.get(card['code']);choices=translations[unicodedata.normalize('NFKC',before)]
        name=row['name'] if row else choices.most_common(1)[0][0] if choices else 'Habitual Dine and Dashers' if card['code']=='P-134' else None
        if name is None:raise ValueError('English display name needs a verified translation: '+card['code'])
        source=row['sourceUrl'] if row else 'https://optcg.app/jp/cards/p-134-habitual-dine-and-dashers/' if card['code']=='P-134' else 'https://en.onepiece-cardgame.com/cardlist/'
        card['name']=name;audit=review['cards'][card['id']];audit['name']=name
        audit.setdefault('metadata',{})['englishDisplayName']={'originalName':before,'name':name,'sourceUrl':source,'verifiedAt':'2026-11-27',
            'method':'Official English name for the same card code' if row else 'English translation of this Japanese-only event card' if card['code']=='P-134' else 'Exact Japanese character name matched to official English card names, normalized with NFKC; scan language unchanged'}
        changed+=1
    artwork=CACHE/'promo-artwork.json'
    if artwork.exists():
        manifest=json.loads(artwork.read_text('utf8'));next(s for s in catalog['sets'] if s['game']=='onepiece' and s['id']=='P')['image']=manifest['image']
        review['sets']['onepiece:P']['imageSource']=manifest
    return changed


def update_display():
    catalog=json.loads((ROOT/'public/catalog.js').read_text('utf8').split('=',1)[1].rstrip(';\n'));review=json.loads((ROOT/'CARD_REVIEW.json').read_text('utf8'))
    changed=update_display_data(catalog,review);write_catalog(catalog);save(ROOT/'CARD_REVIEW.json',review)
    print('English display names updated',changed,flush=True)


def apply_plan():
    catalog,review=baseline()
    designs=json.loads((CACHE/'design-plan.json').read_text('utf8'))
    cards={c['id']:c for c in catalog['cards']};sets={s['id']:s for s in catalog['sets'] if s['game']=='onepiece'}
    names={c['code']:c['name'] for c in catalog['cards'] if c['game']=='onepiece' and c.get('imageLanguage')=='en'}
    for row in json.loads((CACHE/'official-all.json').read_text('utf8')):
        if row['language']=='en':names.setdefault(row['code'],row['name'])
    for row in json.loads((CACHE/'tcg-singles.json').read_text('utf8')):
        names.setdefault(row['code'],re.sub(r'\s*-\s*(?:OP|ST|EB|PRB|P)\d*-\d+.*$','',row['name'].split(' (')[0]))
    group_map={g['groupId']:g for g in json.loads((CACHE/'tcg-groups.json').read_text('utf8'))['results']}
    written=[];added=[];mapping={};used={v['image'] for c in catalog['cards'] if c['game']=='onepiece' for v in c.get('imageVersions',[{'image':c['image']}])}
    visual={str(r['productId']):r for r in json.loads((CACHE/'visually-reviewed-tcg.json').read_text('utf8'))} if (CACHE/'visually-reviewed-tcg.json').exists() else {}
    # Keep generated names deterministic on reruns, considering the original public assets only.
    previous= json.loads((CACHE/'generated-files.json').read_text('utf8')) if (CACHE/'generated-files.json').exists() else []
    image_uses=Counter(image for c in catalog['cards'] for image in {v['image'] for v in c.get('imageVersions',[{'image':c['image']}])})
    superseded=json.loads((CACHE/'superseded-scans.json').read_text('utf8')) if (CACHE/'superseded-scans.json').exists() else {}
    conversion_index=json.loads((CACHE/'conversion-index.json').read_text('utf8')) if (CACHE/'conversion-index.json').exists() else {}
    artist_key=lambda value:re.sub(r'\s+','',unicodedata.normalize('NFKD',value)).casefold()
    artist_names={artist_key(c['illustrator']):c['illustrator'] for c in reversed(catalog['cards']) if c.get('illustrator')}
    conversions=[];main_versions={};pool=ThreadPoolExecutor(6)
    def convert(file,target,version):
        key=str(target.relative_to(ROOT/'public')).replace('\\','/')
        stat=Path(file).stat();signature=f'{file}:{stat.st_size}:{stat.st_mtime_ns}:webp90m5:canvas2'
        cached=conversion_index.get(key)
        if cached and cached['signature']==signature and target.exists() and [target.stat().st_size,target.stat().st_mtime_ns]==cached['outputStat']:
            version['width'],version['height']=cached['size'];return cached.get('crop')
        image,crop=normalized_image(file);image.thumbnail((1000,1000),Image.Resampling.LANCZOS)
        image.save(target,'WEBP',quality=90,method=5)
        version['width'],version['height']=image.size
        stat=target.stat();conversion_index[key]={'signature':signature,'outputStat':[stat.st_size,stat.st_mtime_ns],'size':list(image.size),'crop':crop}
        return crop
    def ensure_set(source):
        sid=source['setId']
        if sid in sets:return
        if sid.startswith('DP'):
            name='Double Pack Set Vol. '+str(int(sid[2:]));group='Double Pack';order=6
        elif sid.endswith('_RELEASE') or sid.endswith('_ANNIVERSARY'):
            base=sets[sid.split('_')[0]]
            name=base['name']+(' (Anniversary Tournament)' if sid.endswith('_ANNIVERSARY') else ' (Prerelease / Release Event)')
            group='Eventi di lancio';order=7
        else:name='Revision Pack';group='Altri prodotti';order=5
        entry={'id':sid,'game':'onepiece','name':name,'folder':sid,'group':group,'groupOrder':order,'region':'Internazionale','language':'en','releaseDates':{'en':None},'image':''}
        if sid.endswith('_RELEASE') or sid.endswith('_ANNIVERSARY'):
            for key in ['image','imageFit']:
                if key in base:entry[key]=base[key]
        sets[sid]=entry;catalog['sets'].append(entry)
        review['sets']['onepiece:'+sid]={'name':name,'group':group,'issues':['VERIFY_RELEASE_DATE'],'sourceUrl':source['sourceUrl']}
    def allocate(card,language,preferred=None):
        folder=sets[card['setId']]['folder']
        code='DON' if card['category']=='DON!!' else 'CERTIFICATE_001' if card['code']=='1/1000' else card['code'].replace('-','_')
        suffix='_JAP' if language=='ja' else ''
        prefix=f'cards/onepiece/{folder}/'
        if preferred:
            filename=preferred.removesuffix('_JAP.webp').removesuffix('.webp')+suffix+'.webp'
            if prefix+filename not in used:return prefix+filename
        for number in range(10000):
            filename=code+(f'_A{number:02}' if number else '')+suffix+'.webp'
            if prefix+filename not in used:return prefix+filename
        raise ValueError('No image name available')
    for design in designs:
        sources=design['sources']
        for source in sources:ensure_set(source)
        if not design['existing']:
            if not design['views']:continue
            primary=min(sources,key=lambda s:(s['setId'] not in ['P','OTHER','PROMO_JP'] and not s['setId'].startswith('PRB'),s['language']!='en',s['kind']!='official'))
            # A physical PRB remains the product; aggregate Promo membership is additional.
            physical=[s for s in sources if not sets[s['setId']].get('collection')]
            if physical:primary=min(physical,key=lambda s:(s['kind']!='official',s['language']!='en'))
            code=design['code'];category=primary['category'];rarity={'PR':'P','SP':'SP CARD','SPカード':'SP CARD'}.get(primary['rarity'],primary['rarity'])
            label=primary['label']
            if category=='DON!!':name='DON!!'
            else:name=names.get(code,primary['name'])
            alternative=bool(re.search(r'_p\d',primary.get('printing','')) or stamp_class(label) or re.search(r'alternate|parallel|manga|anniversary|treasure cup|regional|championship',label,re.I))
            if any(c['game']=='onepiece' and c['code']==code and not c['isAlternative'] for c in cards.values()):alternative=True
            card={'id':design['id'],'game':'onepiece','name':name,'code':code,'number':'DON' if category=='DON!!' else code.split('-')[-1],
                  'setId':primary['setId'],'rarity':rarity,'category':category,'isAlternative':alternative,'variantGroup':'op-'+code,
                  'variantLabel':label,'colors':primary['colors']}
            if sets[card['setId']].get('releaseDate'):card['releaseDate']=sets[card['setId']]['releaseDate']
            cards[card['id']]=card;catalog['cards'].append(card);added.append(card['id'])
            review['cards'][card['id']]={'code':code,'game':'onepiece','name':name,'setId':card['setId'],'issues':[],'versions':[],'metadata':{}}
        card=cards[design['id']];audit=review['cards'][card['id']]
        audit.setdefault('metadata',{});audit.setdefault('versions',[])
        memberships=list(dict.fromkeys((card.get('setIds') or [card['setId']])+[s['setId'] for s in sources]+(['P'] if card['code'].startswith('P-') else [])))
        if len(memberships)>1:card['setIds']=memberships
        for source in sources:
            refs=audit['metadata'].setdefault('printSources',[])
            reference={'region':source['language'],'setId':source['setId'],'label':source['label'],'sourceUrl':source['sourceUrl'],'referenceImageUrl':source['sourceImageUrl'],'printingId':source['key']}
            if not any(s.get('printingId')==source['key'] and s.get('setId')==source['setId'] for s in refs):refs.append(reference)
            mapping[source['key']]=card['id']
        versions=list(card.get('imageVersions') or ([{'language':card['imageLanguage'],'image':card['image'],'width':card['imageWidth'],'height':card['imageHeight']}] if 'image' in card else []))
        preferred=None
        for language,view in sorted(design['views'].items(),key=lambda item:item[0]!='en'):
            if view['existing']:
                if language=='en':preferred=Path(view['file']).name
                continue
            source=view['source']
            old_image=view.get('replaceImage')
            relative=old_image if old_image and image_uses[old_image]==1 else allocate(card,language,preferred)
            if relative not in used:written.append(relative)
            used.add(relative)
            if old_image:
                if old_image not in superseded:
                    original=ROOT/'public'/old_image
                    digest=hashlib.sha256(original.read_bytes()).hexdigest()
                    backup=CACHE/'superseded'/f'{digest[:16]}_{original.name}';backup.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,backup)
                    superseded[old_image]={'sha256':digest,'backup':str(backup.relative_to(ROOT)).replace('\\','/'),'metadata':next((v for v in audit['versions'] if v['language']==language),None)}
                audit['metadata'].setdefault('supersededScans',[]).append({**superseded[old_image],'reason':view['replacementReason'],'replacementSourceUrl':source['sourceUrl']})
            target=ROOT/'public'/relative;target.parent.mkdir(parents=True,exist_ok=True)
            with Image.open(view['file']) as original:width,height=original.size
            version={'language':language,'image':relative,'width':width,'height':height}
            conversions.append((pool.submit(convert,view['file'],target,version),audit,language))
            versions=[v for v in versions if v['language']!=language]+[version]
            verified=visual.get(str(source.get('productId')))
            if verified and verified['sha256']!=hashlib.sha256(Path(view['file']).read_bytes()).hexdigest():verified=None
            sample=verified['imageHasSample'] if verified else True if source['kind']=='official' else None
            audit['versions']=[v for v in audit['versions'] if v['language']!=language]+[{'language':language,'image':relative,
                'issues':['REPLACE_SAMPLE'] if sample else [] if sample is False else ['CHECK_SAMPLE'],
                'metadata':{'sourceUrl':source['sourceUrl'],'sourceImageUrl':source['sourceImageUrl'],'imageHasSample':sample}}]
            if verified:audit['versions'][-1]['metadata']['visualReview']=verified
            if view.get('cleanMatch'):audit['versions'][-1]['metadata']['cleanScanComparison']=view['cleanMatch']
            if language=='en':preferred=Path(relative).name
        if versions:
            versions.sort(key=lambda v:v['language']!='en')
            if len(versions)>1:card['imageVersions']=versions
            main=next((v for v in versions if v['language']==card.get('imageLanguage')),versions[0])
            main_versions[card['id']]=main
            card.update(image=main['image'],imageLanguage=main['language'],imageWidth=main['width'],imageHeight=main['height'])
        # Add physical product editions without inventing languages for an aggregate collection.
        physical={p['setId']:set(p['languages']) for p in card.get('productVersions',[])}
        for source in sources:
            if not sets[source['setId']].get('collection'):physical.setdefault(source['setId'],set()).add(source['language'])
        if physical and (card.get('productVersions') or len(physical)>1):
            if card['setId'] not in physical and not sets[card['setId']].get('collection'):
                physical[card['setId']]={v['language'] for v in versions if v['language'] in ['en','ja']}
            card['productVersions']=[{'setId':sid,'languages':sorted(languages,key=lambda l:l!='en')} for sid,languages in physical.items()]
        if design.get('matches'):audit['metadata']['completionImageMatches']=design['matches']
        if design.get('finishOnly'):audit['metadata']['finishOnlyPrintings']=design['finishOnly']
        if not design['existing'] and design.get('artistCandidates'):
            candidates=design['artistCandidates']
            credited={artist_names.get(artist_key(c['artist']),c['artist']) for c in candidates}
            if len(credited)==1:
                card['illustrator']=next(iter(credited))
                audit['metadata']['illustratorAttribution']={'name':card['illustrator'],'source':'Limitless One Piece','verifiedAt':'2026-11-26',
                    'method':'Explicit credit for the source scan, with a full-frame image comparison or direct import of that exact scan.',
                    'evidence':[{'language':c['language'],'sourceArtist':c['artist'],'sourceUrl':c['sourceUrl'],'sourceImageUrl':c['sourceImageUrl'],'match':c['match']} for c in candidates]}
            else:audit['metadata']['conflictingIllustratorCredits']=candidates
        if not card.get('illustrator') and not design['existing']:audit['issues'].append('MISSING_ILLUSTRATOR')
        if not card.get('rarity') and not design['existing']:audit['issues'].append('MISSING_RARITY')
        if not design['existing'] and not card.get('releaseDate'):audit['issues'].append('VERIFY_RELEASE_DATE')
        if not design['existing'] and card['category']!='DON!!' and not card['colors']:audit['issues'].append('MISSING_COLORS')
    for i,(future,audit,language) in enumerate(conversions,1):
        crop=future.result()
        if crop:next(v for v in audit['versions'] if v['language']==language)['metadata']['outerCanvasCrop']=crop
        if i%500==0:print('Published scans prepared',i,'/',len(conversions),flush=True)
    pool.shutdown(wait=True)
    save(CACHE/'conversion-index.json',conversion_index)
    for cid,main in main_versions.items():cards[cid].update(imageWidth=main['width'],imageHeight=main['height'])
    official=json.loads((CACHE/'official-all.json').read_text('utf8'))
    for sid in ['PRB01','PRB02','OTHER','PROMO_JP']:
        rows=[r for r in official if official_set(r)==sid or (sid=='PROMO_JP' and r['series'].endswith('901'))]
        for card in catalog['cards']:
            # Both regional event lists contribute to the existing aggregate; P remains a code namespace.
            if sid=='PROMO_JP' and any(mapping.get(r['key'])==card['id'] for r in rows):card['setIds']=list(dict.fromkeys((card.get('setIds') or [card['setId']])+[sid]))
        audit=review['sets']['onepiece:'+sid];audit['preview']=False
        audit['completionCoverage']=[{'key':r['key'],'language':r['language'],'code':r['code'],'cardId':mapping.get(r['key']),'sourceImageUrl':r['sourceImageUrl']} for r in rows]
    review['sets']['onepiece:P']['preview']=False
    events=sets['PROMO_JP'];events.update(language='en',region='Internazionale / Giappone',releaseDates={'en':None,'ja':None})
    # Keep a complete source ledger even for scans that cannot be safely published.
    review['onepieceCompletionAudit']={'updatedAt':'2026-11-26','officialRows':len(official),'tcgSingles':len(json.loads((CACHE/'tcg-singles.json').read_text('utf8'))),
        'newCardIds':added,'sourceToCard':mapping,'unavailableScans':json.loads((CACHE/'unavailable-source-scans.json').read_text('utf8')),
        'policy':'EN/JP only. Prize stamps are distinct. Shared scans and finish-only DON variants do not duplicate an artwork. DotGG marketIds are search hints only: several alternate artworks share an ordinary-card marketplace ID. Never merge a printing from that ID without comparing its image. Sources and image comparisons are retained privately.',
        'cache':'temp/onepiece-completion/','sourceIndex':['https://en.onepiece-cardgame.com/cardlist/','https://www.onepiece-cardgame.com/cardlist/','https://tcgcsv.com/tcgplayer/68/groups','https://onepiece.gg/sets/','https://onepiece.limitlesstcg.com/cards']}
    if (CACHE/'reference-resolution.json').exists():review['onepieceCompletionAudit']['supplementalReferences']=json.loads((CACHE/'reference-resolution.json').read_text('utf8'))
    if (CACHE/'limitless-matches.json').exists():review['onepieceCompletionAudit']['limitlessFullFrameMatches']=json.loads((CACHE/'limitless-matches.json').read_text('utf8'))
    if (CACHE/'tournament-coverage.json').exists():review['onepieceCompletionAudit']['tournamentCoverage']=json.loads((CACHE/'tournament-coverage.json').read_text('utf8'))
    for inventory in review['sets'].values():
        for row in inventory.get('officialPrintingCoverage',[]):
            if row['key'] in mapping:row['cardId']=mapping[row['key']]
    # Remove only files previously generated by this importer and no longer referenced after a reviewed merge.
    references={v['image'] for c in catalog['cards'] for v in c.get('imageVersions',[{'image':c['image']}])}
    for relative in (set(previous)|set(conversion_index))-references:
        target=(ROOT/'public'/relative).resolve()
        if not target.is_relative_to((ROOT/'public/cards/onepiece').resolve()):raise ValueError('Unsafe generated path')
        if target.exists():target.unlink()
    update_display_data(catalog,review)
    write_catalog(catalog);save(ROOT/'CARD_REVIEW.json',review);save(CACHE/'generated-files.json',written)
    save(CACHE/'superseded-scans.json',superseded)
    save(CACHE/'source-to-card.json',mapping)
    print('Applied',len(added),'new artworks,',len(written),'new scans;',len(catalog['cards']),'artworks total',flush=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',action='store_true')
    parser.add_argument('--supplemental',action='store_true')
    parser.add_argument('--tcg-inventory',action='store_true')
    parser.add_argument('--source-assets',action='store_true')
    parser.add_argument('--coverage',action='store_true')
    parser.add_argument('--download-missing',action='store_true')
    parser.add_argument('--limitless-inventory',action='store_true')
    parser.add_argument('--supplemental-candidates',action='store_true')
    parser.add_argument('--plan',action='store_true')
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--language-sheets',action='store_true')
    parser.add_argument('--download-limitless',action='store_true')
    parser.add_argument('--enrich-limitless',action='store_true')
    parser.add_argument('--limitless-details',action='store_true')
    parser.add_argument('--separate-stamps',action='store_true')
    parser.add_argument('--recover-thumbnails',action='store_true')
    parser.add_argument('--cache-features',action='store_true')
    parser.add_argument('--reconcile-renders',action='store_true')
    parser.add_argument('--download-dotgg',action='store_true')
    parser.add_argument('--index-conversions',action='store_true')
    parser.add_argument('--clean-candidates',action='store_true')
    parser.add_argument('--finish-references',action='store_true')
    parser.add_argument('--refine-references',action='store_true')
    parser.add_argument('--deduplicate',action='store_true')
    parser.add_argument('--language-fallbacks',action='store_true')
    parser.add_argument('--update-display',action='store_true')
    args=parser.parse_args()
    if args.inventory: inventory()
    if args.supplemental: supplemental()
    if args.tcg_inventory: tcg_inventory()
    if args.source_assets: source_assets()
    if args.coverage: coverage()
    if args.download_missing: download_missing()
    if args.limitless_inventory: limitless_inventory()
    if args.supplemental_candidates: supplemental_candidates()
    if args.plan: prepare_plan()
    if args.apply: apply_plan()
    if args.language_sheets: language_sheets()
    if args.download_limitless: download_limitless()
    if args.enrich_limitless: enrich_limitless()
    if args.limitless_details: limitless_details()
    if args.separate_stamps: separate_stamps()
    if args.recover_thumbnails: recover_thumbnails()
    if args.cache_features: cache_features()
    if args.reconcile_renders: reconcile_regional_renders()
    if args.download_dotgg: download_dotgg()
    if args.index_conversions: index_conversions()
    if args.clean_candidates: clean_candidates()
    if args.finish_references: finish_references()
    if args.refine_references: refine_references()
    if args.deduplicate: deduplicate_images()
    if args.language_fallbacks: fix_language_fallbacks()
    if args.update_display: update_display()
