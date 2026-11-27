"""Complete Pokemon set previews from cached CardCorpus inventories, with resumable scans.
Use --prepare, --download, --apply in order; source snapshots and old assets are retained.
"""
from __future__ import annotations
import argparse,collections,concurrent.futures,copy,hashlib,io,json,pathlib,re,shutil,threading,time
import requests
from PIL import Image
ROOT=pathlib.Path(__file__).resolve().parent.parent
SHARED_CACHE=ROOT/'temp/pokemon-completion'
CACHE=SHARED_CACHE
BATCH_ID='2002-2003-next-ten'
LIMIT=10
PREFIX='globalThis.TCG_ART_ATLAS_CATALOG='
BASE='https://pokemon.cardcorpus.com/v1/'
TCG_SETS={'english/aquapolis':'ecard2','english/skyridge':'ecard3',**{'english/'+slug:'ex'+str(i) for i,slug in enumerate(['ex-ruby-sapphire','ex-sandstorm','ex-dragon','ex-team-magma-vs-team-aqua','ex-hidden-legends','ex-firered-leafgreen','ex-team-rocket-returns','ex-deoxys','ex-emerald','ex-unseen-forces','ex-delta-species','ex-legend-maker','ex-holon-phantoms','ex-crystal-guardians','ex-dragon-frontiers','ex-power-keepers'],1)},'english/nintendo-black-star-promos':'np',**{'english/'+slug:'dp'+str(i) for i,slug in enumerate(['diamond-pearl','mysterious-treasures','secret-wonders','great-encounters','majestic-dawn','legends-awakened','stormfront'],1)},'english/diamond-pearl-black-star-promos':'dpp',**{'english/'+slug:'pl'+str(i) for i,slug in enumerate(['platinum','rising-rivals','supreme-victors','arceus'],1)},**{'english/'+slug:'hgss'+str(i) for i,slug in enumerate(['heartgold-soulsilver','unleashed','undaunted','triumphant'],1)},'english/heartgold-soulsilver-black-star-promos':'hsp','english/black-white':'bw1','english/emerging-powers':'bw2','english/noble-victories':'bw3','english/next-destinies':'bw4','english/dark-explorers':'bw5','english/dragons-exalted':'bw6','english/call-of-legends':'col1','english/black-white-black-star-promos':'bwp'}
LOCK=threading.Lock()
def read(path):return json.loads(path.read_text('utf-8-sig'))
def write_atomic(path,content):
 pending=path.with_name(path.name+'.pending')
 for attempt in range(5):
  try:
   pending.write_text(content,encoding='utf-8',newline='\n');pending.replace(path);return
  except OSError:
   if attempt==4:raise
   time.sleep(attempt+1)

def save(path,data):write_atomic(path,json.dumps(data,ensure_ascii=False,indent=2)+'\n')
def catalog():return json.loads((ROOT/'public/catalog.js').read_text('utf-8')[len(PREFIX):].strip().rstrip(';'))
def source_file(ref):return CACHE/('sets_'+ref.replace('/','_')+'.json')
def fetch_json(path):
 f=CACHE/path.replace('/','_')
 if f.exists():return read(f)
 shared=SHARED_CACHE/path.replace('/','_')
 if shared!=f and shared.exists():
  data=read(shared);save(f,data);return data
 error=None
 for url in [BASE+path,'https://raw.githubusercontent.com/cardcorpus/pokemon-card-dataset/main/v1/'+path]:
  try:
   r=requests.get(url,timeout=45);r.raise_for_status();data=r.json();save(f,data);return data
  except Exception as e:error=e
 raise RuntimeError(f'{path}: {error}')
def front(value):return value.get('picture',{}).get('front',{}).get('image')
def safe(value):return re.sub(r'[^A-Z0-9]+','_',str(value).upper()).strip('_')
def image_number(value):return str(value).zfill(3) if str(value).isdigit() else safe(value)
def finish(value):
 if 'reverse' in value:return 'reverse'
 if 'holo' in value and value!='non_holo':return 'holo'
 return 'normal'
def prepare():
 CACHE.mkdir(exist_ok=True)
 c=catalog();a=read(ROOT/'CARD_REVIEW.json')
 assert BATCH_ID not in a.get('pokemonCompletionBatches',{}), 'This batch is already applied; choose a new --batch to prepare another selection.'
 selected_path=CACHE/'selected-sets.json'
 if selected_path.exists():selected=read(selected_path)
 else:
  selected=[{'set':s,'audit':a['sets']['pokemon:'+s['id']]} for s in sorted(c['sets'],key=lambda s:(s.get('releaseDate') or '9999',s['id'])) if s['game']=='pokemon' and s.get('category')=='expansion' and a['sets']['pokemon:'+s['id']].get('preview')][:LIMIT]
  save(selected_path,selected)
 docs={}
 for item in selected:
  ref=item['audit']['sourceUrl'].split('/sets/',1)[1].removesuffix('.json');docs[ref]=fetch_json('sets/'+ref+'.json')
 paintings=sorted({card['painting']['id'] for d in docs.values() for card in d['cards'] if card.get('painting')})
 with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:list(ex.map(lambda pid:fetch_json('paintings/'+pid+'.json'),paintings))
 print(f'Prepared {len(docs)} inventories and {len(paintings)} painting references',flush=True)
 tcg={}
 for ref,sid in TCG_SETS.items():
  f=CACHE/('tcg-'+sid+'.json')
  if not f.exists():
   r=requests.get('https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/'+sid+'.json',timeout=45);r.raise_for_status();save(f,r.json())
  tcg[ref]={str(x['number']).upper():x for x in read(f)}
 public_sets={s['id']:s for s in c['sets'] if s['game']=='pokemon'}
 folders={}
 for sid,s in public_sets.items():
  url=a['sets']['pokemon:'+sid].get('sourceUrl','')
  if '/sets/' in url and url.endswith('.json'):folders[url.split('/sets/',1)[1][:-5]]=s['folder']
 old_by_ref={}
 for card in c['cards']:
  if card['game']!='pokemon':continue
  au=a['cards'][card['id']];ref=au.get('metadata',{}).get('catalogReference')
  if ref and not card.get('isAlternative'):old_by_ref[(ref['set'],ref['card'])]=card
 images={};picture_map={};used_paths={}
 for card in c['cards']:
  for im in card.get('imageVersions') or [{'language':card['imageLanguage'],'image':card['image']}]:used_paths[im['image']]='existing'
  if card['game']!='pokemon':continue
  au=a['cards'][card['id']]
  for version in au.get('versions',[]):
   url=version.get('metadata',{}).get('sourceImageUrl','')
   if version['image']==card['image']:url=url or au.get('metadata',{}).get('sourceImageUrl','')
   match=re.search(r'/s1/\d+/([a-zA-Z0-9]+)\.',url)
   if match and (ROOT/'public'/version['image']).exists():picture_map[(match[1],version['language'])]=version['image']
 quality_exceptions=read(CACHE/'scan-quality-exceptions.json') if (CACHE/'scan-quality-exceptions.json').exists() else {}
 overrides=read(CACHE/'source-image-overrides.json') if (CACHE/'source-image-overrides.json').exists() else {}
 def register(image_id,lang,ref,number,variant=None):
  key=(image_id,lang)
  if key in picture_map:return {'language':lang,'image':picture_map[key],'pictureId':image_id,'sourceSet':ref}
  folder=folders.get(ref) or safe(ref.split('/',1)[1])+('_JP' if lang=='ja' else '')
  name=image_number(number)+(('_'+safe(variant)) if variant else '')+('_JAP' if lang=='ja' else '')+'.webp'
  target=f'cards/pokemon/{folder}/{name}'
  if target in used_paths:target=target[:-5]+'_P'+image_id[:8].upper()+('.webp' if lang=='en' else '') if lang=='en' else target[:-9]+'_P'+image_id[:8].upper()+'_JAP.webp'
  assert target not in used_paths,(image_id,target)
  used_paths[target]=image_id;picture_map[key]=target
  images[image_id]={'id':image_id,'url':overrides.get(image_id,{}).get('imageUrl',f'https://img.cardcorpus.com/s1/960/{image_id}.avif'),'image':target,**({'qualityException':quality_exceptions[image_id]} if image_id in quality_exceptions else {}),**({'sourceOverride':overrides[image_id]} if image_id in overrides else {})}
  return {'language':lang,'image':target,'pictureId':image_id,'sourceSet':ref}
 exclusions=read(CACHE/'source-entry-exclusions.json') if (CACHE/'source-entry-exclusions.json').exists() else {}
 type_overrides=read(CACHE/'type-overrides.json') if (CACHE/'type-overrides.json').exists() else {}
 native_overrides=read(CACHE/'native-scan-overrides.json') if (CACHE/'native-scan-overrides.json').exists() else {}
 manual=read(CACHE/'manual-counterparts.json') if (CACHE/'manual-counterparts.json').exists() else {}
 exceptions=read(CACHE/'counterpart-exceptions.json') if (CACHE/'counterpart-exceptions.json').exists() else {}
 def scan_id(card):
  pid=front(card)
  if pid:return pid
  proof=native_overrides.get(card['set']+'#'+card['id'])
  if proof:
   pid='external'+hashlib.sha256(proof['imageUrl'].encode()).hexdigest()[:24];overrides[pid]=proof;return pid
  return None
 rows=[];coverage=[]
 for item in selected:
  pub=item['set'];ref=item['audit']['sourceUrl'].split('/sets/',1)[1][:-5];doc=docs[ref];set_rows=[]
  imported_sources=[]
  for source in doc['cards']:
   source_key=ref+'#'+source['id']
   if source_key in exclusions:continue
   imported_sources.append(source)
   paint=source.get('painting',{}).get('id');painting=fetch_json('paintings/'+paint+'.json') if paint else None
   own=painting.get('prints',{}).get(ref,{}).get(source['id'],{}) if painting else {}
   counterpart=None
   other_catalog='japanese' if source['language']=='en' else 'english'
   link=own.get('links',{}).get('counterparts',{}).get(other_catalog)
   if link and painting:
    candidate=painting.get('prints',{}).get(link['set'],{}).get(link['id'])
    if candidate and scan_id(candidate):counterpart=candidate
   manual_proof=manual.get(ref+'#'+source['id'])
   if manual_proof:
    other=fetch_json('sets/'+manual_proof['set']+'.json')
    candidate=next(x for x in other['cards'] if x['id']==manual_proof['id'])
    assert scan_id(candidate)
    allowed_names=manual_proof.get('allowedNames',[])
    assert candidate.get('englishName')==source.get('englishName') or (candidate.get('englishName') in allowed_names and source.get('englishName') in allowed_names)
    assert (candidate.get('credit') or manual_proof.get('candidateCredit') or '').strip().casefold()==(source.get('credit') or manual_proof.get('sourceCredit') or '').strip().casefold()
    if manual_proof.get('variantId'):
     variant=next(v for v in candidate['variants'] if v['id']==manual_proof['variantId']);assert front(variant);candidate=copy.deepcopy(candidate);candidate['picture']=variant['picture']
    counterpart=candidate;link={'$kind':'card','set':candidate['set'],'id':candidate['id'],'manualVerification':manual_proof}
   metadata=None;type_reference=None
   candidates=[source]+([counterpart] if counterpart else [])
   # The painting's card groups give explicit counterpart/parallel identity.
   if painting:
    cluster=next((g for g in painting.get('cards',[]) if any(x['set']==ref and x['id']==source['id'] for x in g)),[])
    candidates.extend(painting.get('prints',{}).get(x['set'],{}).get(x['id'],{}) for x in cluster if x['set'].startswith('english/'))
   for candidate in candidates:
    if candidate.get('set') in tcg:
     number=str(candidate.get('number',{}).get('short',candidate.get('id',''))).upper()
     metadata=tcg[candidate['set']].get(number)
     if not metadata and re.fullmatch(r'\d+[AB]',number):
      typed=tcg[candidate['set']].get(number[:-1])
      if typed and typed['name'].casefold()==candidate.get('englishName','').casefold():metadata=typed
     if metadata:
      type_reference={'sourceUrl':'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/'+TCG_SETS[candidate['set']]+'.json','number':metadata['number'],'via':{'set':candidate['set'],'card':candidate['id']}};break
   if source_key in type_overrides:
    proof=type_overrides[source_key];metadata=tcg[proof['set']][proof['number']];type_reference={'sourceUrl':'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/cards/en/'+TCG_SETS[proof['set']]+'.json','number':proof['number'],'manualVerification':proof}
   category={'pokemon':'Pokemon','energy':'Energy'}.get(source['cardType'],'Trainer')
   types=metadata.get('types',[]) if metadata and category=='Pokemon' else []
   existing=old_by_ref.get((ref,source['id']))
   card_id=existing['id'] if existing else f"pk-{pub['id']}-{source['id']}"
   code=existing['code'] if existing else f"{pub['id']}-{source['id']}"
   variants=source.get('variants',[])
   image_variant_id=source.get('picture',{}).get('front',{}).get('of',{}).get('id',source.get('defaultVariant'))
   image_variant=next((v for v in variants if v['id']==image_variant_id),{})
   editions=['firstEdition'] if image_variant.get('edition')=='first_edition' else []
   native_id=front(source)
   if not native_id:
    proof=native_overrides.get(source_key)
    assert proof, 'Missing native scan: '+source_key
    native_id='external'+hashlib.sha256(proof['imageUrl'].encode()).hexdigest()[:24];overrides[native_id]=proof
   main=register(native_id,source['language'],ref,source['id'])
   versions=[main]
   if counterpart:versions.append(register(scan_id(counterpart),counterpart['language'],counterpart['set'],counterpart['id']))
   record={'id':card_id,'game':'pokemon','name':source.get('englishName') or source['name'],'code':code,'number':source.get('number',{}).get('short',source['id']),'printedNumber':source.get('number',{}).get('printed',''),'setId':pub['id'],'releaseDate':pub['releaseDate'],'rarity':{'Common (C)':'Common','Uncommon (U)':'Uncommon','Rare (R)':'Rare','Super Rare (SR)':'Super Rare','Ultra Rare (UR)':'Ultra Rare','Double Rare (RR)':'Double Rare'}.get(source.get('rarity'),source.get('rarity') or 'Unknown'),'category':category,'isAlternative':False,'variantGroup':card_id,'variantLabel':'Prima edizione' if editions else 'Standard','illustrator':source.get('credit') or (metadata or {}).get('artist',''),'types':types,'finishes':list(dict.fromkeys(finish(v.get('finish','non_holo')) for v in variants)) or ['normal'],'editions':editions}
   proof={'sourceUrl':BASE+'sets/'+ref+'.json','catalogReference':{'set':ref,'card':source['id']},'paintingId':paint,'sourceImageUrl':images.get(main['pictureId'],{}).get('url',f"https://img.cardcorpus.com/s1/960/{main['pictureId']}.avif"),'typeReference':type_reference,'imageVariantId':image_variant_id,'counterpart':link if counterpart else None,'variantInventory':variants,'counterpartException':exceptions.get(ref+'#'+source['id'])}
   rows.append({'card':record,'versions':versions,'metadata':proof});set_rows.append(record['id'])
   seen_signatures=set();default=next((v for v in variants if v['id']==source.get('defaultVariant')),variants[0] if variants else {})
   visible_keys={'edition','stamp','painting','artwork','errorState'}
   for variant in variants:
    diff=variant.get('differsFromStandard',{})
    changed=sorted(set(diff).intersection(visible_keys))
    if not changed:continue
    signature=tuple((key,json.dumps(variant.get(key,diff[key]),sort_keys=True)) for key in changed)
    if all(variant.get(key,diff[key])==default.get(key) for key in changed) or signature in seen_signatures:continue
    seen_signatures.add(signature)
    image_id=front(variant)
    if not image_id or image_id==front(source):continue
    vc=copy.deepcopy(record);vc.update(id=card_id+'-v-'+variant['id'],isAlternative=True,variantLabel={'Unlimited':'Unlimited','1st Edition':'Prima edizione'}.get(variant['name'],variant['name']),editions=['firstEdition'] if variant.get('edition')=='first_edition' else [],finishes=[finish(variant.get('finish','non_holo'))])
    vi=register(image_id,source['language'],ref,source['id'],variant['id'])
    vp=copy.deepcopy(proof);vp.update(variantId=variant['id'],counterpart=None,sourceImageUrl=images.get(image_id,{}).get('url',f'https://img.cardcorpus.com/s1/960/{image_id}.avif'),**({'sourceImageReference':overrides[image_id]} if image_id in overrides else {}))
    rows.append({'card':vc,'versions':[vi],'metadata':vp})
  coverage.append({'setId':pub['id'],'sourceSet':ref,'sourceCount':len(imported_sources),'rawSourceCount':len(doc['cards']),'excludedSourceEntries':{key:proof for key,proof in exclusions.items() if key.startswith(ref+'#')},'sourceCardIds':[x['id'] for x in imported_sources],'standardCardIds':set_rows})
 plan={'createdAt':'2026-11-27','batchId':BATCH_ID,'coverage':coverage,'rows':rows,'images':list(images.values())}
 save(CACHE/'import-plan.json',plan)
 print('Plan:',len(rows),'artwork/edition records,',len(images),'new scans,',sum(len(x['versions'])>1 for x in rows),'bilingual records; missing types',sum(x['card']['category']=='Pokemon' and not x['card']['types'] for x in rows),flush=True)
def download():
 import pillow_avif  # registers AVIF decoding in Pillow versions without native support
 plan=read(CACHE/'import-plan.json');out={};errors=[]
 previous=read(CACHE/'conversion-index.json') if (CACHE/'conversion-index.json').exists() else {}
 def task(spec):
  if not spec.get('id'):return 'missing-source-image',{'error':'Source entry has no image identity; resolve before apply'}
  raw=CACHE/(('override_'+spec['id']+'.webp') if spec.get('sourceOverride') else ('image_'+spec['id']+'.avif'));webp=CACHE/('converted_'+spec['id']+'.webp')
  cached=previous.get(spec['id'])
  if cached and 'sha256' in cached and webp.exists() and hashlib.sha256(webp.read_bytes()).hexdigest()==cached['sha256']:
   return spec['id'],cached
  for attempt in range(3):
   try:
    if not raw.exists():
     r=requests.get(spec['url'],timeout=60);r.raise_for_status();raw.write_bytes(r.content)
    with Image.open(raw) as im:
     im.load();width,height=im.size
     assert (width>=200 and height>=250) or spec.get('qualityException'),(spec['id'],im.size)
     if not webp.exists():im.convert('RGB').save(webp,'WEBP',quality=89,method=5)
    return spec['id'],{'width':width,'height':height,'converted':webp.name,'sha256':hashlib.sha256(webp.read_bytes()).hexdigest()}
   except Exception as e:
    error=str(e)
    if attempt<2:time.sleep(attempt+1)
  return spec['id'],{'error':error}
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
  for n,(pid,result) in enumerate(ex.map(task,plan['images']),1):
   out[pid]=result
   if 'error' in result:errors.append({'id':pid,**result})
   if n%50==0:
    save(CACHE/'conversion-index.json',out);print('Scans',n,'/',len(plan['images']),'errors',len(errors),flush=True)
 save(CACHE/'conversion-index.json',out);save(CACHE/'download-errors.json',errors);print('Downloaded/conversion complete; failures',len(errors),flush=True)
def apply():
 plan=read(CACHE/'import-plan.json');conversion=read(CACHE/'conversion-index.json')
 errors=[s['id'] for s in plan['images'] if s['id'] not in conversion or 'error' in conversion[s['id']]]
 assert not errors, errors[:20]
 c=catalog();a=read(ROOT/'CARD_REVIEW.json')
 assert plan.get('batchId','2002-2003-next-ten')==BATCH_ID, 'Plan and requested batch do not match'
 assert BATCH_ID not in a.get('pokemonCompletionBatches',{}),'This batch is already applied'
 for src,name in [('public/catalog.js','catalog-before.js'),('CARD_REVIEW.json','review-before.json')]:
  if not (CACHE/name).exists():shutil.copy2(ROOT/src,CACHE/name)
 # Resume our interrupted two-file publication from the retained snapshot.
 before_text=(CACHE/'catalog-before.js').read_text('utf-8')
 before=json.loads(before_text[len(PREFIX):].strip().rstrip(';'))
 if c!=before:
  imported_ids={row['card']['id'] for row in plan['rows']}
  assert {k:v for k,v in c.items() if k!='cards'}=={k:v for k,v in before.items() if k!='cards'}, 'Unrelated catalog metadata changed; review before resuming'
  assert [x for x in c['cards'] if x['id'] not in imported_ids]==[x for x in before['cards'] if x['id'] not in imported_ids], 'Unrelated cards changed; review before resuming'
  assert a==read(CACHE/'review-before.json'), 'Audit changed; review before resuming'
  c=before
  print('Resuming interrupted catalog publication from verified snapshot',flush=True)
 # Deduplicate exact WebP content, retaining every source file in the private cache.
 by_hash={};path_map={};copied=0
 existing_images={v['image'] for card in c['cards'] if card['game']=='pokemon' for v in [card,*card.get('imageVersions',[])]}
 for image in existing_images:
  f=ROOT/'public'/image
  by_hash.setdefault(hashlib.sha256(f.read_bytes()).hexdigest(),image)
 for spec in plan['images']:
  info=conversion[spec['id']];target=spec['image'];canonical=by_hash.get(info['sha256'])
  if canonical:path_map[target]=canonical
  else:
   out=ROOT/'public'/target;out.parent.mkdir(exist_ok=True,parents=True);assert not out.exists() or hashlib.sha256(out.read_bytes()).hexdigest()==info['sha256'],target;shutil.copy2(CACHE/info['converted'],out);by_hash[info['sha256']]=target;copied+=1
 specs={x['id']:x for x in plan['images']}
 by_id={x['id']:x for x in c['cards']};added=[]
 for row in plan['rows']:
  record=copy.deepcopy(row['card']);versions=[];audit_versions=[]
  for v in row['versions']:
   image=path_map.get(v['image'],v['image']);info=conversion.get(v['pictureId'])
   if info:width,height=info['width'],info['height']
   else:
    with Image.open(ROOT/'public'/image) as im:width,height=im.size
   versions.append({'language':v['language'],'image':image,'width':width,'height':height})
   audit_versions.append({'language':v['language'],'image':image,'issues':['LOW_RESOLUTION_SCAN'] if specs.get(v['pictureId'],{}).get('qualityException') else [],'metadata':{'sourceUrl':BASE+'sets/'+v['sourceSet']+'.json','sourceImageUrl':specs.get(v['pictureId'],{}).get('url',f"https://img.cardcorpus.com/s1/960/{v['pictureId']}.avif"),'pictureId':v['pictureId'],'sourceSetId':v['sourceSet'],**({'sourceImageReference':specs[v['pictureId']]['sourceOverride']} if specs.get(v['pictureId'],{}).get('sourceOverride') else {})}})
  main=versions[0];record.update(image=main['image'],imageLanguage=main['language'],imageWidth=main['width'],imageHeight=main['height'],imageVersions=versions)
  issues=[]
  if any(x['width']<200 or x['height']<250 for x in versions):issues.append('LOW_RESOLUTION_SCAN')
  if record['category']=='Pokemon' and not record['types']:issues.append('MISSING_TYPES')
  if not record['illustrator']:issues.append('MISSING_ILLUSTRATOR')
  if len(versions)==1:issues.append((row['metadata'].get('counterpartException') or {}).get('issue','COUNTERPART_NOT_VERIFIED'))
  old=by_id.get(record['id'])
  if old:old.update(record)
  else:c['cards'].append(record);added.append(record['id'])
  a['cards'][record['id']]={'game':'pokemon','code':record['code'],'name':record['name'],'setId':record['setId'],'issues':issues,'versions':audit_versions,'metadata':row['metadata']}
 for entry in plan['coverage']:
  au=a['sets']['pokemon:'+entry['setId']];au.update(preview=False,expectedCodes=entry['sourceCount'],expectedCodeList=[f"{entry['setId']}-{cid}" for cid in entry['sourceCardIds']],sourceInventoryCount=entry['sourceCount'],importedAt='2026-11-27',standardCardIds=entry['standardCardIds'],sourceCardIds=entry['sourceCardIds'],completionBatch=BATCH_ID)
 a.setdefault('pokemonCompletionBatches',{})[BATCH_ID]={'importedAt':'2026-11-27','coverage':plan['coverage'],'addedCardIds':added,'artworkRecords':len(plan['rows']),'newScans':copied,'policy':'EN/JA from explicit CardCorpus counterpart links or documented human-reviewed scan pairs. Regional set inventories stay separate. Foil-only variants and serial-code differences do not create artworks. Distinct edition marks and prize stamps retain individual popup variants. Sources, original scans and conversion cache remain private.'}
 a['updatedAt']='2026-11-27'
 write_atomic(ROOT/'public/catalog.js',PREFIX+json.dumps(c,ensure_ascii=False,separators=(',',':'))+';\n')
 latest=read(ROOT/'CARD_REVIEW.json')
 if latest.get('userObservations'):a['userObservations']=latest['userObservations']
 save(ROOT/'CARD_REVIEW.json',a)
 print('APPLIED',len(added),'new artwork/edition records;',copied,'new WebP scans. Totals',len(c['cards']),len(c['sets']),flush=True)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--prepare',action='store_true');parser.add_argument('--download',action='store_true');parser.add_argument('--apply',action='store_true');parser.add_argument('--batch',default=BATCH_ID);parser.add_argument('--limit',type=int,default=10);args=parser.parse_args()
 if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',args.batch):parser.error('Use lowercase letters, digits and hyphens for --batch')
 if not 1<=args.limit<=200:parser.error('--limit must be between 1 and 200')
 BATCH_ID=args.batch;LIMIT=args.limit
 CACHE=SHARED_CACHE if BATCH_ID=='2002-2003-next-ten' else ROOT/'temp'/('pokemon-'+BATCH_ID)
 if args.prepare:prepare()
 if args.download:download()
 if args.apply:apply()
