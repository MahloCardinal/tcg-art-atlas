"""Reusable, read-only illustrator comparisons. Keeps source scans and caches outside public/."""
from __future__ import annotations
import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gc
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import unicodedata
from urllib.parse import urljoin
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "temp" / "illustrators"
SITE = "https://onepiece.limitlesstcg.com"
CACHE.mkdir(parents=True, exist_ok=True)
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
LOCK = threading.Lock()

def read_json(path, default=None):
    return json.loads(path.read_text("utf8")) if path.exists() else default

def write_json(path, value, preserve=False):
    data = json.dumps(value, ensure_ascii=False, indent=2)
    if path.exists():
        previous = path.read_text("utf8")
        if previous == data:
            return
        if preserve:
            digest = hashlib.sha256(previous.encode()).hexdigest()[:12]
            backup = path.with_name(f"{path.stem}-{digest}{path.suffix}")
            if not backup.exists():
                backup.write_text(previous, "utf8")
    pending = path.with_suffix(path.suffix + ".pending")
    pending.write_text(data, "utf8")
    pending.replace(path)

def catalog():
    raw = (ROOT / "public" / "catalog.js").read_text("utf8")
    return json.loads(raw.split("=", 1)[1].rstrip(";\n"))

def archive_attributions(cards):
    audit = read_json(ROOT / "CARD_REVIEW.json")
    summary = audit.get("onepieceIllustratorAudit", {})
    records = []
    for card in cards:
        if card["game"] != "onepiece":
            continue
        credit = audit["cards"][card["id"]].get("metadata", {}).get("illustratorAttribution")
        if credit:
            records.append({"cardId": card["id"], "code": card["code"], "images": card.get("imageVersions", []), "attribution": credit})
    archive = {"archivedAt": datetime.now(timezone.utc).isoformat(), "attributions": records,
               "heldBack": summary.get("heldBack", []), "unattributedCardIds": summary.get("unattributedCardIds", []),
               "unavailableReferenceScans": summary.get("unavailableReferenceScans", [])}
    path = CACHE / "attribution-archive.json"
    existing = read_json(path, {})
    if {key: value for key, value in existing.items() if key != "archivedAt"} == {key: value for key, value in archive.items() if key != "archivedAt"}:
        return existing
    write_json(path, archive, preserve=True)
    return archive

def http(url, **kwargs):
    import requests
    response = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=90, **kwargs)
    response.raise_for_status()
    response.encoding = "utf8"
    return response

def load_credits(refresh=False):
    saved = CACHE / "credits.json"
    if saved.exists() and not refresh:
        return read_json(saved)
    from bs4 import BeautifulSoup
    artists = http(SITE + "/api/cards/artists").json()
    write_json(CACHE / "artists.json", artists, preserve=True)
    jobs = [(lang, artists[start:start + 20]) for lang in ("en", "jp") for start in range(0, len(artists), 20)]
    def fetch(job):
        lang, names = job
        query = '!artist:"' + ",".join(names) + '"'
        page = http(SITE + "/cards/" + lang, params={"q": query, "display": "full", "show": "all", "unique": "prints"})
        soup = BeautifulSoup(page.text, "html.parser")
        rows = []
        for profile in soup.select(".card-profile"):
            author = profile.select_one(".card-text-artist a")
            code = profile.select_one(".card-text-id")
            image = profile.select_one(".card-image img")
            link = profile.select_one(".card-text-name a")
            if not all((author, code, image, link)):
                continue
            rows.append({"code": code.get_text(" ", strip=True), "artist": author.get_text(" ", strip=True),
                         "language": "ja" if lang == "jp" else "en", "sourceUrl": urljoin(SITE, link["href"]),
                         "sourceImageUrl": image.get("data-src") or image["src"], "artistUrl": urljoin(SITE, author["href"])})
        soup.decompose()
        return rows
    by_image = {}
    with ThreadPoolExecutor(4) as pool:
        for number, rows in enumerate(pool.map(fetch, jobs), 1):
            for row in rows:
                old = by_image.get(row["sourceImageUrl"])
                if old and old["artist"] != row["artist"]:
                    raise ValueError("Conflicting credits for " + row["sourceImageUrl"])
                by_image[row["sourceImageUrl"]] = row
            print(f"Source metadata: {number}/{len(jobs)}", flush=True)
    rows = sorted(by_image.values(), key=lambda row: row["sourceImageUrl"])
    write_json(saved, rows, preserve=True)
    return rows

class References:
    def __init__(self, archive, refresh=False):
        self.index = read_json(CACHE / "reference-index.json", {})
        self.errors = {row["sourceImageUrl"]: row for row in read_json(CACHE / "download-errors.json", [])}
        for row in archive.get("unavailableReferenceScans", []):
            self.errors.setdefault(row["sourceImageUrl"], row)
        self.refresh = refresh

    def get(self, row):
        url = row["sourceImageUrl"]
        with LOCK:
            old = self.index.get(url)
            if not self.refresh and old and (CACHE / old["file"]).exists():
                return CACHE / old["file"]
            if not self.refresh and url in self.errors:
                return None
        try:
            data = http(url).content
            if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
                raise ValueError("Reference is not a WebP scan")
            digest = hashlib.sha256(data).hexdigest()
            file = CACHE / ("ref_" + digest + ".webp")
            with LOCK:
                if not file.exists():
                    file.write_bytes(data)
                entry = {"file": file.name, "sha256": digest, "bytes": len(data), "obtainedAt": datetime.now(timezone.utc).isoformat()}
                if old and old.get("sha256") != digest:
                    entry["history"] = old.get("history", []) + [{key: value for key, value in old.items() if key != "history"}]
                elif old:
                    entry = old
                self.index[url] = entry
                self.errors.pop(url, None)
            return file
        except Exception as error:
            with LOCK:
                self.errors[url] = {**row, "error": str(error), "checkedAt": datetime.now(timezone.utc).isoformat()}
            return None

    def save(self):
        with LOCK:
            index = dict(self.index)
            errors = list(self.errors.values())
        write_json(CACHE / "reference-index.json", index)
        write_json(CACHE / "download-errors.json", errors)

class FeatureCache:
    """Compressed, content-addressed pixel features; avoids retaining all scans in RAM."""
    def __init__(self):
        self.archive = zipfile.ZipFile(CACHE / "feature-cache.npz", "a", compression=zipfile.ZIP_DEFLATED)
        self.keys = set(self.archive.namelist())
        self.index = read_json(CACHE / "feature-index.json", {})
        self.hits = self.misses = 0
        self.lock = threading.Lock()

    def get(self, path):
        import numpy as np
        from PIL import Image, ImageFilter
        path = path.resolve()
        stat = path.stat()
        token = [stat.st_size, stat.st_mtime_ns]
        label = str(path.relative_to(ROOT))
        with self.lock:
            entry = self.index.get(label)
            if entry and entry["stat"] == token and entry["key"] + ".npy" in self.keys:
                self.hits += 1
                return np.load(io.BytesIO(self.archive.read(entry["key"] + ".npy")), allow_pickle=False)
        data = path.read_bytes()
        key = "rgb72x100_blur06_" + hashlib.sha256(data).hexdigest()
        with self.lock:
            if key + ".npy" in self.keys:
                self.hits += 1
                self.index[label] = {"stat": token, "key": key}
                return np.load(io.BytesIO(self.archive.read(key + ".npy")), allow_pickle=False)
        image = Image.open(io.BytesIO(data)).convert("RGBA")
        background = Image.new("RGBA", image.size, "white")
        background.alpha_composite(image)
        pixels = np.asarray(background.convert("RGB").resize((72, 100)).filter(ImageFilter.GaussianBlur(.6)))
        output = io.BytesIO()
        np.save(output, pixels, allow_pickle=False)
        with self.lock:
            if key + ".npy" not in self.keys:
                self.archive.writestr(key + ".npy", output.getvalue())
                self.keys.add(key + ".npy")
            self.index[label] = {"stat": token, "key": key}
            self.misses += 1
        return pixels

    def close(self):
        self.archive.close()
        write_json(CACHE / "feature-index.json", self.index)

def artist_key(name):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKD", name)).casefold()

def compare(cards, rows, references, include_known=False, limit=None):
    import numpy as np
    by_code = defaultdict(list)
    for row in rows:
        by_code[row["code"]].append(row)
    wanted = [card for card in cards if card["game"] == "onepiece" and (include_known or not card.get("illustrator"))]
    total = len(wanted)
    if limit is not None:
        wanted = wanted[:limit]
    families = defaultdict(list)
    for card in wanted:
        families[card["code"]].append(card)
    cache = FeatureCache()
    def distances(left, right, leader):
        difference = np.abs(left.astype(np.int16) - right.astype(np.int16)) / 255
        full = .8 * difference[12:76 if leader else 60, 5:67].mean() + .2 * difference.mean()
        masked = .75 * difference[12:34, 5:67].mean() + .25 * np.concatenate([difference[:34].ravel(), difference[66:].ravel()]).mean()
        return float(full), float(masked)
    def family(job):
        code, members = job
        scans = []
        for row in by_code[code]:
            file = references.get(row)
            if file:
                scans.append((row, cache.get(file)))
        output = []
        for card in members:
            accepted, tentative = [], []
            versions = card.get("imageVersions") or [{"language": card.get("imageLanguage", "und"), "image": card["image"]}]
            for version in versions:
                path = (ROOT / "public" / version["image"]).resolve()
                if not path.is_relative_to((ROOT / "public").resolve()):
                    raise ValueError("Image outside public/")
                pixels = cache.get(path)
                candidates = []
                for row, ref in scans:
                    full, masked = distances(pixels, ref, card.get("category") == "LEADER")
                    candidates.append((min(full, masked), full, masked, row))
                if not candidates:
                    continue
                candidates.sort(key=lambda candidate: candidate[0])
                score, full, masked, row = candidates[0]
                gap = next((value - score for value, _, _, other in candidates[1:] if artist_key(other["artist"]) != artist_key(row["artist"])), 1.0)
                evidence = {**row, "matchedImage": version["image"], "localImageLanguage": version["language"], "fullDistance": full, "maskedDistance": masked, "artistGap": gap}
                if (full < .085 or masked < .055) and gap > .025:
                    accepted.append(evidence)
                elif full < .18 or masked < .13:
                    tentative.append(evidence)
            names = {artist_key(item["artist"]) for item in accepted}
            status = "conflict" if len(names) > 1 else "candidate" if accepted else "review" if tentative else "unmatched"
            output.append({"cardId": card["id"], "code": code, "status": status, "evidence": accepted or tentative})
        return output
    results = []
    try:
        with ThreadPoolExecutor(2) as pool:
            for number, output in enumerate(pool.map(family, families.items()), 1):
                results.extend(output)
                if number % 25 == 0:
                    print(f"Compared code families: {number}/{len(families)}", flush=True)
    finally:
        cache.close()
        references.save()
    report = {"createdAt": datetime.now(timezone.utc).isoformat(), "scope": {"includeKnown": include_known, "limit": limit, "comparedCards": len(wanted), "availableCards": total},
              "policy": "Analysis only. Verify actual illustrations and conflicting credits before changing public data. Source language does not verify the local scan language.",
              "featureCacheHits": cache.hits, "featureCacheMisses": cache.misses, "results": results}
    destination = CACHE / ("comparison-" + STAMP + ".json")
    write_json(destination, report)
    print(f"Report: {destination}\nFeature cache: {cache.hits} hits, {cache.misses} newly calculated", flush=True)

def sheets(archive, references):
    from PIL import Image, ImageDraw
    pairs = [(case, evidence) for case in archive.get("heldBack", []) for evidence in case.get("evidence", [])]
    fingerprints = []
    for _, evidence in pairs:
        local = ROOT / "public" / evidence["matchedImage"]
        reference = references.get(evidence)
        fingerprints.append([hashlib.sha256(local.read_bytes()).hexdigest() if local.exists() else None, hashlib.sha256(reference.read_bytes()).hexdigest() if reference else None])
    digest = hashlib.sha256(json.dumps([pairs, fingerprints], sort_keys=True).encode()).hexdigest()[:12]
    for start in range(0, len(pairs), 24):
        part = pairs[start:start + 24]
        output = Image.new("RGB", (1000, ((len(part) + 3) // 4) * 225), "#eee")
        draw = ImageDraw.Draw(output)
        for index, (case, evidence) in enumerate(part):
            x, y = index % 4 * 250, index // 4 * 225
            name = evidence.get("sourceArtist", evidence.get("artist", ""))
            draw.text((x + 2, y + 2), f'{case["code"]} {name}'[:38], fill="black")
            draw.text((x + 2, y + 14), case["cardId"][:38], fill="black")
            reference = references.get(evidence)
            for column, file in enumerate([(ROOT / "public" / evidence["matchedImage"]), reference]):
                if file and file.exists():
                    image = Image.open(file).convert("RGB")
                    image.thumbnail((120, 188))
                    output.paste(image, (x + column * 123, y + 33))
        output.save(CACHE / f"held-back-{digest}-{start // 24}.jpg")
    references.save()
    print(f"Preserved {len(pairs)} visual comparison pairs", flush=True)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--restore-cache", action="store_true", help="Archive current decisions and cache reference scans for catalog codes")
    parser.add_argument("--refresh-credits", action="store_true", help="Refresh the source dataset, retaining the previous snapshot")
    parser.add_argument("--refresh-images", action="store_true", help="Retry unavailable scans and retain older content versions")
    parser.add_argument("--compare", action="store_true", help="Write a read-only comparison report; never publishes changes")
    parser.add_argument("--all", action="store_true", help="Also compare cards that already have an illustrator")
    parser.add_argument("--limit", type=int, help="Explicitly limit the number of compared cards")
    parser.add_argument("--sheets", action="store_true", help="Regenerate visual sheets for cases held back in CARD_REVIEW")
    options = parser.parse_args()
    if not any((options.restore_cache, options.refresh_credits, options.refresh_images, options.compare, options.sheets)):
        parser.print_help()
        return
    cards = catalog()["cards"]
    archive = archive_attributions(cards)
    gc.collect()
    if options.limit is not None and options.limit < 1:
        parser.error("--limit must be positive")
    if options.refresh_images:
        options.restore_cache = True
    rows = load_credits(options.refresh_credits) if options.restore_cache or options.refresh_credits or options.compare else []
    references = References(archive, options.refresh_images)
    if options.restore_cache:
        codes = {card["code"] for card in cards if card["game"] == "onepiece"}
        wanted = [row for row in rows if row["code"] in codes]
        with ThreadPoolExecutor(8) as pool:
            for number, _ in enumerate(pool.map(references.get, wanted), 1):
                if number % 250 == 0:
                    references.save()
                    print(f"Reference cache: {number}/{len(wanted)}", flush=True)
        references.save()
        print(f"Reference scans retained: {len(references.index)}; unavailable: {len(references.errors)}", flush=True)
    if options.compare:
        compare(cards, rows, references, options.all, options.limit)
    if options.sheets:
        sheets(archive, references)

if __name__ == "__main__":
    main()
