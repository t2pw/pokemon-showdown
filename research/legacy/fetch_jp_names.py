"""
PokeAPIから日本語名を取得してCSVにname_ja列を追加する。
キャッシュ(jp_names_cache.json)を使い、2回目以降は再リクエストしない。
Champions固有フォームは英語名のまま残す。
"""
import csv
import json
import time
import sys
import requests
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent
INPUT_CSV = BASE_DIR / "bss_regmb_pokemon.csv"
OUTPUT_CSV = BASE_DIR / "bss_regmb_pokemon_ja.csv"
CACHE_FILE = BASE_DIR / "jp_names_cache.json"

POKEAPI_BASE = "https://pokeapi.co/api/v2"
REQUEST_INTERVAL = 0.5  # 秒（レートリミット対策）

# 標準フォームのフォルム名→日本語プレフィックス/サフィックスのルール
# 形式: (プレフィックス, サフィックス)
FORME_JP: dict[str, tuple[str, str]] = {
    "Mega":          ("メガ", ""),
    "Mega-X":        ("メガ", "X"),
    "Mega-Y":        ("メガ", "Y"),
    "Alola":         ("アローラ", ""),
    "Galar":         ("ガラル", ""),
    "Hisui":         ("ヒスイ", ""),
    "Paldea":        ("パルデア", ""),
    "Paldea-Combat": ("パルデア", "（コンバット）"),
    "Paldea-Blaze":  ("パルデア", "（ブレイズ）"),
    "Paldea-Aqua":   ("パルデア", "（アクア）"),
    "Origin":        ("", "（オリジン）"),
    "Therian":       ("", "（霊獣）"),
    "Black":         ("", "（ブラック）"),
    "White":         ("", "（ホワイト）"),
    "Sky":           ("", "（スカイ）"),
    "Attack":        ("", "（アタック）"),
    "Defense":       ("", "（ディフェンス）"),
    "Speed":         ("", "（スピード）"),
    "Heat":          ("", "（ヒート）"),
    "Wash":          ("", "（ウォッシュ）"),
    "Frost":         ("", "（フロスト）"),
    "Fan":           ("", "（ファン）"),
    "Mow":           ("", "（モウ）"),
    "Hero":          ("", "（ヒーロー）"),
    "Zero":          ("", "（ゼロ）"),
    "Crowned":       ("", "（王者）"),
    "Eternamax":     ("", "（エタマックス）"),
    "Bloodmoon":     ("", "（ブラッドムーン）"),
    "Roaming":       ("", "（ローミング）"),
    "Low-Key":       ("", "（ローキー）"),
    "Amped":         ("", "（アンプド）"),
    "Ice":           ("", "（アイス）"),
    "Shadow":        ("", "（シャドー）"),
    "Dusk":          ("", "（たそがれ）"),
    "Dawn":          ("", "（あかつき）"),
    "Midnight":      ("", "（まよなか）"),
    "Dusk-Mane":     ("", "（たそがれのたてがみ）"),
    "Dawn-Wings":    ("", "（あかつきのつばさ）"),
    "Ultra":         ("", "（ウルトラ）"),
    "Ash":           ("", "（サトシ）"),
    "School":        ("", "（スクール）"),
    "Fusion":        ("", "（フュージョン）"),
    "Complete":      ("", "（完全体）"),
    "10%":           ("", "（10%）"),
    "50%":           ("", "（50%）"),
    "Resolute":      ("", "（カクゴ）"),
    "Pirouette":     ("", "（ステップ）"),
    "Aria":          ("", "（アリア）"),
}


def load_cache() -> dict:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_cache(cache: dict) -> None:
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def fetch_species_ja(num: int, cache: dict) -> str | None:
    """PokeAPIからポケモン種族の日本語名を取得する（キャッシュ優先）"""
    key = f"species_{num}"
    if key in cache:
        return cache[key]

    try:
        resp = requests.get(f"{POKEAPI_BASE}/pokemon-species/{num}/", timeout=10)
        time.sleep(REQUEST_INTERVAL)
        if resp.status_code != 200:
            cache[key] = None
            return None
        data = resp.json()
        # "ja" → 漢字まじり、"ja-Hrkt" → カナのみ
        ja_name = None
        for entry in data.get("names", []):
            if entry["language"]["name"] == "ja":
                ja_name = entry["name"]
                break
        if ja_name is None:
            for entry in data.get("names", []):
                if entry["language"]["name"] == "ja-Hrkt":
                    ja_name = entry["name"]
                    break
        cache[key] = ja_name
        return ja_name
    except Exception:
        cache[key] = None
        return None


def build_ja_name(english_name: str, num: int, cache: dict) -> str:
    """
    英語フォーム名と図鑑番号から日本語名を組み立てる。
    Championsの独自フォームはPokeAPIに存在しないため英語名をそのまま返す。
    """
    base_species, _, forme = english_name.partition("-")

    base_ja = fetch_species_ja(num, cache)
    if base_ja is None:
        # PokeAPIに存在しない（Champions独自）→ 英語名のまま
        return english_name

    if not forme:
        return base_ja

    # 既知フォームは日本語ルールを適用
    if forme in FORME_JP:
        prefix, suffix = FORME_JP[forme]
        return f"{prefix}{base_ja}{suffix}"

    # 未知フォーム（Championsオリジナル等）→ 英語名のまま
    return english_name


def main():
    print("=== 日本語名取得スクリプト ===\n")

    cache = load_cache()
    print(f"キャッシュ読み込み: {len(cache)} 件\n")

    rows = []
    with open(INPUT_CSV, encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        rows = list(reader)

    total = len(rows)
    updated = 0
    kept_english = 0

    for i, row in enumerate(rows, 1):
        name_en = row["name"]
        num = int(row["num"])
        name_ja = build_ja_name(name_en, num, cache)

        row["name_ja"] = name_ja

        if name_ja != name_en:
            updated += 1
        else:
            kept_english += 1

        if i % 50 == 0 or i == total:
            print(f"  [{i}/{total}] {name_en} -> {name_ja}")
            save_cache(cache)  # 途中保存

    save_cache(cache)

    # name_jaを2列目に挿入してCSV保存
    new_fields = ["id", "name_ja", "name"] + [f for f in fieldnames if f not in ("id", "name")]
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=new_fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n--- 完了 ---")
    print(f"日本語化: {updated} 体")
    print(f"英語維持（Champions固有）: {kept_english} 体")
    print(f"保存先: {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
