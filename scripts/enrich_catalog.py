"""Add visual filter metadata and local set artwork without importing new cards."""
import io
import json
import re
import subprocess
from pathlib import Path
from bs4 import BeautifulSoup
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]

def enrich_catalog(catalog, get_json, download):
    pages = {}
    versions_path = ROOT / 'data' / 'image-versions.json'
    versions = json.loads(versions_path.read_text(encoding='utf8')) if versions_path.exists() else {}
    origins_path = ROOT / 'data' / 'artwork-origins.json'
    origins = json.loads(origins_path.read_text(encoding='utf8'))['artworks'] if origins_path.exists() else {}
    for card in catalog['cards']:
        if card['game'] == 'onepiece':
            origin = origins.get(card['id'])
            if origin is None:
                origin = {'label': card['setName'].title() + ' · ' + card['setId'] + ' · Standard', 'status': 'product-reference', 'sourceUrl': card['metadataUrl']} if not card['isAlternative'] else {'label': 'OPPP · Origine non verificata', 'status': 'unverified', 'sourceUrl': card['sourceUrl']}
            card['artworkOrigin'] = origin
            card['variantLabel'] = origin['label']
            card['artwork'] = origin['label']
        if card['id'] in versions:
            card['imageVersions'] = versions[card['id']]
        if card['game'] == 'pokemon':
            card['types'] = get_json(card['metadataUrl']).get('types', [])
        elif card['category'] == 'DON!!':
            card['colors'] = []
        else:
            url = card['metadataUrl']
            if url not in pages:
                pages[url] = BeautifulSoup(download(url), 'html.parser')
            node = pages[url].find('dl', id=re.compile(r'^' + re.escape(card['code']) + r'(?:_|$)'))
            if node is None:
                raise ValueError(f"Missing color metadata: {card['id']}")
            color = node.select_one('.color')
            if color is None:
                raise ValueError(f"Missing color: {card['id']}")
            card['colors'] = re.findall(r'Red|Green|Blue|Purple|Black|Yellow', color.get_text(' ', strip=True))
            if not card['colors']:
                raise ValueError(f"Invalid color: {card['id']}")
    out = ROOT / 'public' / 'images' / 'sets'
    out.mkdir(parents=True, exist_ok=True)
    for expansion in catalog['sets']:
        target = out / f"{expansion['game']}-{expansion['id']}.webp"
        if expansion['game'] == 'pokemon':
            data = get_json(f"https://api.tcgdex.net/v2/en/sets/{expansion['id']}")
            expansion['seriesName'] = 'Base Set Series' if expansion['id'] in ['base1', 'base2', 'base3'] else data.get('serie', {}).get('name', '')
            expansion['seriesSourceUrl'] = 'https://www.pokellector.com/sets'
            with Image.open(io.BytesIO(download(data['logo'] + '.webp'))) as image:
                image.convert('RGBA').save(target, 'WEBP', quality=92, method=4)
            expansion['imageSourceUrl'] = data['logo'] + '.webp'
        else:
            image = Image.new('RGB', (720, 400), '#122a37')
            draw = ImageDraw.Draw(image)
            accent = {'OP01': '#f2be65', 'OP02': '#81c4c8', 'OP03': '#e3968e'}[expansion['id']]
            for offset in range(-200, 800, 85):
                draw.line((offset, 400, offset + 300, 0), fill='#193b49', width=2)
            draw.rounded_rectangle((30, 30, 690, 370), radius=16, outline=accent, width=2)
            font = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 142)
            small = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 22)
            draw.text((360, 185), expansion['id'], anchor='mm', font=font, fill=accent)
            draw.text((360, 290), 'ONE PIECE CARD GAME', anchor='mm', font=small, fill='#e6edf0')
            image.save(target, 'WEBP', quality=92, method=4)
        expansion['image'] = '/images/sets/' + target.name
    return catalog

if __name__ == '__main__':
    from import_cards import get_json, download
    target = ROOT / 'public' / 'data' / 'catalog.json'
    catalog = enrich_catalog(json.loads(target.read_text(encoding='utf8')), get_json, download)
    temporary = target.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    temporary.replace(target)
    subprocess.run(['node', str(ROOT / 'scripts' / 'prepare-local.mjs')], cwd=ROOT, check=True)
    print(f"Metadata updated: {len(catalog['cards'])} cards, {len(catalog['sets'])} set images.")
