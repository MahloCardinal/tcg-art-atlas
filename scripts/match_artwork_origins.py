"""Build reviewable image matches against cached official printing inventories.

Downloads are reference material in the ignored cache, never frontend artwork.
Matches are candidates: inspect the review sheets before adopting them.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import io
import json
import time
import urllib.request
import numpy as np
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'sources'
OUT = CACHE / 'origin-images'
OUT.mkdir(exist_ok=True)

def feature(image):
    return np.asarray(image.convert('RGB').resize((72, 100), Image.Resampling.LANCZOS), dtype=np.float32) / 255

def fetch(row):
    target = OUT / (row['site'] + '-' + row['image_url'].rsplit('/', 1)[-1])
    try:
        if not target.exists():
            raw_cache = CACHE / hashlib.sha256(row['image_url'].encode()).hexdigest()
            if raw_cache.exists():
                raw = raw_cache.read_bytes()
            else:
                request = urllib.request.Request(row['image_url'], headers={'User-Agent': 'CList/0.2'})
                with urllib.request.urlopen(request, timeout=25) as response:
                    raw = response.read()
                time.sleep(.12)
            with Image.open(io.BytesIO(raw)) as image:
                image.verify()
            target.write_bytes(raw)
        with Image.open(target) as image:
            return row, feature(image), None
    except Exception as error:
        return row, None, str(error)

def main():
    catalog = json.loads((ROOT / 'public/data/catalog.json').read_text(encoding='utf8'))
    targets = [c for c in catalog['cards'] if c['game'] == 'onepiece' and c['isAlternative'] and c['category'] != 'DON!!']
    codes = {c['code'] for c in targets}
    rows = []
    for lang in ['en', 'jp']:
        rows.extend(json.loads(line) for line in (CACHE / f'audit-koala-data-printings-{lang}.jsonl').read_text(encoding='utf8').splitlines())
    rows = [r for r in rows if r['image_url'].rsplit('/', 1)[-1].split('_')[0].replace('.png', '') in codes]
    previous = CACHE / 'origin-matches.json'
    previous_matches = json.loads(previous.read_text(encoding='utf8'))['matches'] if previous.exists() else []
    if previous.exists() and (CACHE / 'audit-koala-data-printings-cn.jsonl').exists():
        unresolved = {m['code'] for m in previous_matches if m['candidates'][0]['score'] >= .14}
        global_cards = {r['key']: r.get('number') for r in map(json.loads, (CACHE / 'audit-koala-data-cards.jsonl').read_text(encoding='utf8').splitlines())}
        for row in map(json.loads, (CACHE / 'audit-koala-data-printings-cn.jsonl').read_text(encoding='utf8').splitlines()):
            cached = OUT / (row['site'] + '-' + row['image_url'].rsplit('/', 1)[-1])
            if global_cards[row['card_key']] in unresolved or (global_cards[row['card_key']] in codes and cached.exists()):
                rows.append({**row, 'match_code': global_cards[row['card_key']]})
    if (CACHE / 'tcgcsv-17675-products.json').exists():
        unresolved = ({m['code'] for m in previous_matches if m['candidates'][0]['score'] >= .14} if previous_matches else codes) | {'OP01-005'}
        for product in json.loads((CACHE / 'tcgcsv-17675-products.json').read_text(encoding='utf8'))['results']:
            code = next((v['value'] for v in product.get('extendedData', []) if v['name'] == 'Number'), None)
            cached = OUT / ('tcgplayer-' + product['imageUrl'].rsplit('/', 1)[-1])
            if code in unresolved or (code in codes and cached.exists()):
                rows.append({'site': 'tcgplayer', 'match_code': code, 'image_url': product['imageUrl'], 'source_text': product['name'], 'source_url': product['url'], 'key': str(product['productId'])})
    features, errors = {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = [pool.submit(fetch, row) for row in rows]
        for index, task in enumerate(as_completed(tasks), 1):
            row, data, error = task.result()
            if error:
                errors.append({'url': row['image_url'], 'error': error})
            else:
                code = row.get('match_code') or row['image_url'].rsplit('/', 1)[-1].split('_')[0].replace('.png', '')
                features.setdefault(code, []).append((row, data))
            if index % 50 == 0 or index == len(rows):
                print(f'References {index}/{len(rows)}, errors {len(errors)}', flush=True)
    result = []
    for card in targets:
        with Image.open(ROOT / 'public' / card['image'].lstrip('/')) as image:
            local = feature(image)
        ranked = []
        for row, reference in features.get(card['code'], []):
            # Full image distinguishes stamps and printed language; art confirms illustration.
            full = float(np.mean(np.abs(local - reference)))
            art = float(np.mean(np.abs(local[8:74, 4:68] - reference[8:74, 4:68])))
            ranked.append({'score': round(.6 * full + .4 * art, 5), 'full': round(full, 5), 'art': round(art, 5), 'printing': row})
        ranked.sort(key=lambda x: x['score'])
        result.append({'id': card['id'], 'code': card['code'], 'candidates': ranked[:4]})
    (CACHE / 'origin-matches.json').write_text(json.dumps({'matches': result, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf8')
    qa = ROOT / 'data/qa/origins'
    qa.mkdir(exist_ok=True)
    for start in range(0, len(result), 30):
        sheet = Image.new('RGB', (1200, 6 * 260), 'white')
        draw = ImageDraw.Draw(sheet)
        for pos, match in enumerate(result[start:start+30]):
            card = next(c for c in targets if c['id'] == match['id'])
            if not match['candidates']:
                continue
            best = match['candidates'][0]
            printing = best['printing']
            files = [ROOT / 'public' / card['thumbnail'].lstrip('/'), OUT / (printing['site'] + '-' + printing['image_url'].rsplit('/', 1)[-1])]
            x, y = (pos % 5) * 240, (pos // 5) * 260
            for side, file in enumerate(files):
                with Image.open(file) as image:
                    image = ImageOps.contain(image.convert('RGB'), (112, 158))
                    sheet.paste(image, (x + side * 116, y))
            text = f"{card['id']} {best['score']}\n{printing['site']} {printing['image_url'].rsplit('/',1)[-1]}\n{printing['source_text']}"
            safe = text.encode('ascii', errors='replace').decode('ascii')
            for line_index, line in enumerate([part[i:i+38] for part in safe.splitlines() for i in range(0,len(part),38)]):
                draw.text((x+2,y+163+line_index*12),line,fill='black')
        sheet.save(qa / f'{start//30+1:02}.jpg')
    print('Candidate matches and review sheets saved.', flush=True)

if __name__ == '__main__':
    main()
