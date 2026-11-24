"""Import six complete sets. One image per artwork; finishes are metadata."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import hashlib
import io
import json
import re
import subprocess
import time
from bs4 import BeautifulSoup
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'sources'
PUBLIC = ROOT / 'public'
LOCKS = {}
PK_SETS = [('base1', 102), ('base2', 64), ('base3', 62)]
OP_SETS = [
    ('OP01', 'ROMANCE DAWN', '2022-12-02', 121),
    ('OP02', 'PARAMOUNT WAR', '2023-03-10', 121),
    ('OP03', 'PILLARS OF STRENGTH', '2023-06-30', 123),
]
# Visually matched against the four official OP03 Special images.
OP03_SPECIALS = [
    ('OP01-051_p2', 'OP01-051AA2', 'OP01', 'OP01-051'),
    ('ST01-012_p1', 'ST01-012AA5', 'ST01', 'ST01-012'),
    ('ST03-009_p1', 'ST03-009AA', 'ST03', 'ST03-009'),
    ('ST04-003_p1', 'ST04-003AA6', 'ST04', 'ST04-003'),
]


def download(url):
    with LOCKS.setdefault(url, Lock()):
        CACHE.mkdir(parents=True, exist_ok=True)
        cache = CACHE / hashlib.sha256(url.encode()).hexdigest()
        if cache.exists():
            return cache.read_bytes()
        for attempt in range(3):
            try:
                req = Request(url, headers={'User-Agent': 'CList/0.2'})
                with urlopen(req, timeout=60) as response:
                    raw = response.read()
                cache.write_bytes(raw)
                return raw
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(2 + attempt)


def get_json(url):
    return json.loads(download(url))


def image_files(card_id, url):
    out = PUBLIC / 'images' / 'cards'
    out.mkdir(parents=True, exist_ok=True)
    large = out / f'{card_id}.webp'
    thumb = out / f'{card_id}-thumb.webp'
    stamp = CACHE / (hashlib.sha256((card_id + url + ':rgba92-v2').encode()).hexdigest() + '.image.json')
    if stamp.exists() and large.exists() and thumb.exists():
        return json.loads(stamp.read_text(encoding='utf8'))
    raw = download(url)
    with Image.open(io.BytesIO(raw)) as source:
        image = ImageOps.exif_transpose(source).convert('RGBA')
        width, height = image.size
        if width < 180 or height < 250:
            raise ValueError(f'Unexpected image size for {card_id}: {width}x{height}')
        pixel_hash = hashlib.sha256(image.tobytes()).hexdigest()
        image.save(large, 'WEBP', quality=92, method=4)
        image.thumbnail((300, 420), Image.Resampling.LANCZOS)
        image.save(thumb, 'WEBP', quality=86, method=4)
    result = {'image': f'/images/cards/{card_id}.webp', 'thumbnail': f'/images/cards/{card_id}-thumb.webp', 'imageWidth': width, 'imageHeight': height, 'imageSha256': hashlib.sha256(large.read_bytes()).hexdigest(), 'pixelSha256': pixel_hash}
    stamp.write_text(json.dumps(result), encoding='utf8')
    return result


def pokemon_record(brief):
    data = get_json(f"https://api.tcgdex.net/v2/en/cards/{brief['id']}")
    if not data.get('image'):
        raise ValueError(f"Missing Pokemon image: {data['id']}")
    return data


def make_pokemon():
    sets, cards = [], []
    for set_id, expected in PK_SETS:
        expansion = get_json(f'https://api.tcgdex.net/v2/en/sets/{set_id}')
        if len(expansion['cards']) != expected:
            raise ValueError(f"{set_id}: expected {expected} records, got {len(expansion['cards'])}")
        with ThreadPoolExecutor(max_workers=4) as pool:
            records = list(pool.map(pokemon_record, expansion['cards']))
        by_number = {int(record['localId']): record for record in records}
        groups = []
        # Explicit same-art holo/non-holo collector-number pairs in these sets.
        paired = 16 if set_id == 'base2' else 15 if set_id == 'base3' else 0
        for number in sorted(by_number):
            if paired < number <= paired * 2:
                continue
            group = [by_number[number]]
            if number <= paired:
                other = by_number[number + paired]
                if (other['name'], other.get('illustrator')) != (group[0]['name'], group[0].get('illustrator')):
                    raise ValueError(f'Holo pair identity mismatch: {set_id}-{number}')
                group.append(other)
            groups.append(group)
        for group in groups:
            card = group[0]
            finishes = sorted({key for item in group for key in ('normal', 'holo', 'reverse') if item.get('variants', {}).get(key)})
            printings = [{'code': item['id'], 'number': item['localId'], 'rarity': item['rarity'], 'finishes': [key for key in ('normal', 'holo', 'reverse') if item.get('variants', {}).get(key)]} for item in group]
            url = card['image'] + '/high.png'
            cards.append({
                'id': 'pk-' + card['id'], 'game': 'pokemon', 'name': card['name'],
                'code': card['id'], 'codes': [item['id'] for item in group], 'number': card['localId'], 'numbers': [item['localId'] for item in group],
                'printings': printings, 'language': 'en', 'imageLanguage': 'en', 'setId': set_id, 'setName': expansion['name'], 'releaseDate': expansion['releaseDate'],
                'rarity': card['rarity'], 'rarities': sorted({item['rarity'] for item in group}), 'category': card.get('category', ''),
                'artwork': 'Standard', 'isAlternative': False, 'variantGroup': 'pk-' + card['id'], 'variantLabel': 'Standard', 'finishes': finishes,
                'editions': [key for key in ('firstEdition', 'wPromo') if any(item.get('variants', {}).get(key) for item in group)],
                'illustrator': card.get('illustrator', ''), 'source': 'TCGdex', 'sourceUrl': f"https://api.tcgdex.net/v2/en/cards/{card['id']}",
                'metadataUrl': f"https://api.tcgdex.net/v2/en/cards/{card['id']}", 'sourceImageUrl': url,
            })
        sets.append({'id': set_id, 'game': 'pokemon', 'name': expansion['name'], 'releaseDate': expansion['releaseDate'], 'expectedCodes': expected, 'sourceUrl': f'https://api.tcgdex.net/v2/en/sets/{set_id}'})
        print(f'Metadata {set_id}: {expected} numbers, {len(groups)} artworks', flush=True)
    return cards, sets


def make_onepiece():
    cards, sets = [], []
    for set_id, name, date, expected in OP_SETS:
        url = f'https://oppp.online/proxies/one-piece/{set_id.lower()}'
        soup = BeautifulSoup(download(url), 'html.parser')
        nodes = {}
        for node in soup.select('.gcard'):
            code_node = node.select_one('.cd')
            if not code_node:
                continue
            match = re.search(r'OP\d{2}-\d{3}', code_node.get_text())
            if match and match[0].startswith(set_id + '-'):
                nodes[match[0]] = node
        expected_codes = {f'{set_id}-{i:03}' for i in range(1, expected + 1)}
        if set(nodes) != expected_codes:
            raise ValueError(f'{set_id}: missing {sorted(expected_codes-set(nodes))}; extra {sorted(set(nodes)-expected_codes)}')
        # Metadata stays primary-source Bandai. Its sample images are never used.
        official_url = 'https://en.onepiece-cardgame.com/cardlist/?series=5691' + set_id[-2:]
        official = BeautifulSoup(download(official_url), 'html.parser')
        for code, node in sorted(nodes.items()):
            metadata = official.find('dl', id=code)
            if metadata is None:
                raise ValueError(f'Official metadata missing: {code}')
            spans = metadata.select('.infoCol span')
            rarity = spans[1].get_text(strip=True)
            category = spans[2].get_text(strip=True)
            page = urljoin(url, node.select_one('a[href]')['href'])
            art_variants = [{'c': code, 'i': '/api/card-optimized/' + code}] + json.loads(node.get('data-alts', '[]'))
            seen = set()
            for index, artwork in enumerate(art_variants):
                source_id = artwork['c']
                if source_id in seen:
                    continue
                seen.add(source_id)
                image_url = urljoin(url, artwork['i'])
                label = 'Standard' if not index else f'Alternativa {index}'
                cards.append({
                    'id': 'op-' + source_id, 'game': 'onepiece', 'name': node.select_one('.nm').get_text(strip=True),
                    'code': code, 'codes': [code], 'number': code.split('-')[1], 'numbers': [code.split('-')[1]],
                    'printings': [{'code': code, 'number': code.split('-')[1], 'rarity': rarity, 'finishes': []}],
                    'language': 'en', 'imageLanguage': 'en' if not index else 'source', 'setId': set_id, 'setIds': [set_id], 'setName': name, 'releaseDate': date,
                    'rarity': rarity, 'rarities': [rarity], 'category': category, 'artwork': label, 'isAlternative': bool(index), 'variantGroup': 'op-' + code,
                    'variantLabel': label, 'sourceVariantId': source_id, 'finishes': [], 'editions': [], 'illustrator': '',
                    'source': 'OPPP', 'sourceUrl': page, 'sourceImageUrl': image_url, 'metadataUrl': official_url,
                })
        official_codes = sorted({node.select_one('.infoCol span').get_text(strip=True) for node in official.select('dl.modalCol')})
        if set_id == 'OP03':
            for official_id, source_id, origin, code in OP03_SPECIALS:
                existing = next((card for card in cards if card['id'] == 'op-' + source_id), None)
                if existing:
                    existing['setIds'].append('OP03')
                    existing.update({'artwork': 'Special', 'variantLabel': 'Special OP03', 'setId': 'OP03', 'setName': name, 'releaseDate': date, 'metadataUrl': official_url})
                    existing.setdefault('productPrintings', []).append({'setId': 'OP03', 'officialId': official_id})
                    continue
                source_page = f'https://oppp.online/proxies/one-piece/{origin.lower()}'
                source_soup = BeautifulSoup(download(source_page), 'html.parser')
                source_node = next(node for node in source_soup.select('.gcard') if node.select_one('.cd') and code in node.select_one('.cd').get_text())
                source_variant = next(item for item in json.loads(source_node.get('data-alts', '[]')) if item['c'] == source_id)
                metadata = official.find('dl', id=official_id)
                spans = metadata.select('.infoCol span')
                rarity = spans[1].get_text(strip=True)
                cards.append({
                    'id': 'op-' + source_id, 'game': 'onepiece', 'name': source_node.select_one('.nm').get_text(strip=True),
                    'code': code, 'codes': [code], 'number': code.split('-')[1], 'numbers': [code.split('-')[1]],
                    'printings': [{'code': code, 'number': code.split('-')[1], 'rarity': rarity, 'finishes': []}],
                    'language': 'en', 'imageLanguage': 'en', 'setId': 'OP03', 'setIds': ['OP03'], 'setName': name, 'releaseDate': date,
                    'rarity': rarity, 'rarities': [rarity], 'category': spans[2].get_text(strip=True),
                    'artwork': 'Special', 'isAlternative': True, 'variantGroup': 'op-' + code, 'variantLabel': 'Special OP03',
                    'sourceVariantId': source_id, 'finishes': [], 'editions': [], 'illustrator': '', 'source': 'OPPP',
                    'sourceUrl': urljoin(source_page, source_node.select_one('a[href]')['href']),
                    'sourceImageUrl': urljoin(source_page, source_variant['i']), 'metadataUrl': official_url,
                    'productPrintings': [{'setId': 'OP03', 'officialId': official_id}],
                })
        sets.append({'id': set_id, 'game': 'onepiece', 'name': name, 'releaseDate': date, 'expectedCodes': len(official_codes), 'expectedCodeList': official_codes, 'sourceUrl': url})
        print(f'Metadata {set_id}: {len(nodes)} base codes', flush=True)
    return cards, sets


def process_image(card):
    return {**card, **image_files(card['id'], card['sourceImageUrl'])}


def add_onepiece_finishes_and_don(cards, sets):
    """Import only subtype names, never prices. DON cards are not numbered."""
    code_finishes = {}
    groups = {'OP01': 3188, 'OP02': 17698, 'OP03': 22890}
    for set_id, group in groups.items():
        def dataset(kind):
            cached = CACHE / f'tcgcsv-{group}-{kind}.json'
            if cached.exists():
                return json.loads(cached.read_bytes())['results']
            time.sleep(.1)
            raw = download(f'https://tcgcsv.com/tcgplayer/68/{group}/{kind}')
            cached.write_bytes(raw)
            return json.loads(raw)['results']
        products = dataset('products')
        subtypes = {}
        for row in dataset('prices'):
            subtype = {'Normal': 'normal', 'Foil': 'holo'}.get(row['subTypeName'])
            if subtype:
                subtypes.setdefault(row['productId'], set()).add(subtype)
        expansion = next(item for item in sets if item['id'] == set_id)
        for product in products:
            fields = {field['name']: field['value'] for field in product.get('extendedData', [])}
            code = fields.get('Number', '')
            if re.fullmatch(r'(OP\d{2}|ST\d{2})-\d{3}', code):
                code_finishes.setdefault(code, set()).update(subtypes.get(product['productId'], set()))
            if not product['name'].startswith('DON!!'):
                continue
            # This SKU uses the same generic artwork as product 549342.
            if product['productId'] == 456320:
                continue
            label = product['name'].replace('DON!! Card', '').strip(' /()') or 'Standard'
            clean_don = {
                482273: ('https://cards.oplaytcg.com/DON/jp/small/pdf-2-9.webp?v=1795027578', 'https://oplaytcg.com/en/dons/op02-shanks'),
                498519: ('https://cards.oplaytcg.com/DON/jp/small/pdf-3-1.webp?v=1795027578', 'https://oplaytcg.com/en/dons/op03-sanji'),
            }.get(product['productId'])
            cards.append({
                'id': f"op-don-{product['productId']}", 'game': 'onepiece', 'name': 'DON!!', 'code': 'DON!!', 'codes': [],
                'number': 'DON', 'numbers': [], 'printings': [], 'language': 'en', 'imageLanguage': 'jp' if clean_don else 'en',
                'setId': set_id, 'setIds': ['OP01', 'OP02', 'OP03'] if product['productId'] == 549342 else [set_id], 'setName': expansion['name'], 'releaseDate': expansion['releaseDate'],
                'rarity': 'DON!!', 'rarities': ['DON!!'], 'category': 'DON!!', 'artwork': label,
                'isAlternative': label != 'Standard', 'variantGroup': 'op-don-' + set_id, 'variantLabel': label,
                'finishes': sorted(subtypes.get(product['productId'], set())), 'editions': [], 'illustrator': '',
                'source': 'OPlayTCG' if clean_don else 'TCGplayer', 'sourceUrl': clean_don[1] if clean_don else product['url'], 'metadataUrl': product['url'],
                'sourceImageUrl': clean_don[0] if clean_don else product['imageUrl'].replace('_200w', '_in_1000x1000'),
                'tcgplayerProductId': product['productId'], 'finishesSourceUrl': f'https://tcgcsv.com/tcgplayer/68/{group}/prices',
            })
    for card in cards:
        if card.get('category') == 'DON!!':
            continue
        card['finishes'] = sorted(code_finishes.get(card['code'], set()))
        card['finishScope'] = 'card-code'
        card['finishesSourceUrl'] = 'https://tcgcsv.com/docs'
    return cards


def main():
    pk, pk_sets = make_pokemon()
    op, op_sets = make_onepiece()
    op = add_onepiece_finishes_and_don(op, op_sets)
    records = pk + op
    print(f'Downloading/converting {len(records)} images', flush=True)
    results, failures = {}, []
    with ThreadPoolExecutor(max_workers=4) as pool:
        tasks = {pool.submit(process_image, card): card for card in records}
        for index, task in enumerate(as_completed(tasks), 1):
            card = tasks[task]
            try:
                results[card['id']] = task.result()
            except Exception as exc:
                failures.append({'id': card['id'], 'url': card['sourceImageUrl'], 'error': str(exc)})
                print(f"FAILED {card['id']}: {exc}", flush=True)
            if index % 25 == 0 or index == len(records):
                print(f'Images {index}/{len(records)}', flush=True)
    if failures:
        (ROOT/'data'/'import-errors.json').write_text(json.dumps(failures, indent=2), encoding='utf8')
        raise RuntimeError(f'{len(failures)} image imports failed. Existing catalog left untouched. See data/import-errors.json')
    cards = [results[card['id']] for card in records]
    unique, duplicates = {}, []
    for card in cards:
        key = (card['variantGroup'], card['pixelSha256'])
        if key in unique:
            unique[key].setdefault('sourceAliases', []).append(card.get('sourceVariantId', card['id']))
            duplicates.append(card['id'])
        else:
            unique[key] = card
    cards = list(unique.values())
    sets = pk_sets + op_sets
    for expansion in sets:
        members = [card for card in cards if card['game'] == expansion['game'] and expansion['id'] in card.get('setIds', [card['setId']])]
        codes = {code for card in members for code in card['codes']}
        expansion.update({'coveredCodes': len(codes), 'artworkCount': len(members), 'complete': len(codes) == expansion['expectedCodes']})
        if not expansion['complete']:
            raise ValueError(f"Incomplete set: {expansion['id']}")
        if expansion.get('expectedCodeList') and codes != set(expansion['expectedCodeList']):
            raise ValueError(f"Set inventory mismatch: {expansion['id']}")
    catalog = {'schemaVersion': 2, 'importedAt': datetime.now(timezone.utc).isoformat(), 'scope': 'six-complete-sets', 'languages': ['en'], 'cards': cards, 'sets': sets, 'duplicateSourceImages': duplicates, 'holoPolicy': 'One image per artwork; holo/non-holo collector numbers are grouped, finishes are metadata.'}
    from enrich_catalog import enrich_catalog
    enrich_catalog(catalog, get_json, download)
    data_dir = PUBLIC / 'data'
    data_dir.mkdir(exist_ok=True, parents=True)
    temporary = data_dir / 'catalog.tmp.json'
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporary.replace(data_dir / 'catalog.json')
    subprocess.run(['node', str(ROOT / 'scripts' / 'prepare-local.mjs')], cwd=ROOT, check=True)
    unique_codes = {(card['game'], code) for card in cards for code in card['codes']}
    print(f"COMPLETE: {len(cards)} artworks, {len(unique_codes)} distinct card codes, six complete sets, {len(duplicates)} exact duplicates grouped.", flush=True)


if __name__ == '__main__':
    main()
