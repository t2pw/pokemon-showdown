"""
Champions BSS Reg M-B 静的メタ分析スクリプト
出場可能ポケモンの種族値・タイプ・ティア情報を解析してCSV出力する。
"""
import re
import csv
import sys
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent
POKEDEX_PATH = BASE_DIR / "data/pokedex.ts"
FORMATS_DATA_PATH = BASE_DIR / "data/mods/champions/formats-data.ts"
ABILITIES_PATH = BASE_DIR / "data/mods/champions/abilities.ts"
OUTPUT_CSV = BASE_DIR / "bss_regmb_pokemon.csv"


def parse_ts_object(content: str) -> dict[str, dict]:
    """TypeScriptのオブジェクトリテラルをキーとプロパティのdictに変換する簡易パーサー"""
    result = {}
    # ネストなし/1段ネストのブロックを抽出
    pattern = re.compile(r'^\t(\w+):\s*\{(.*?)\n\t\}', re.MULTILINE | re.DOTALL)
    for m in pattern.finditer(content):
        key = m.group(1)
        body = m.group(2)
        result[key] = body
    return result


def extract_field(body: str, field: str) -> str | None:
    m = re.search(rf'{field}:\s*"([^"]+)"', body)
    return m.group(1) if m else None


def extract_field_num(body: str, field: str) -> int | None:
    m = re.search(rf'{field}:\s*(\d+)', body)
    return int(m.group(1)) if m else None


def extract_types(body: str) -> list[str]:
    m = re.search(r'types:\s*\[([^\]]+)\]', body)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def extract_base_stats(body: str) -> dict[str, int]:
    m = re.search(r'baseStats:\s*\{([^}]+)\}', body)
    if not m:
        return {}
    stats_str = m.group(1)
    stats = {}
    for stat in ['hp', 'atk', 'def', 'spa', 'spd', 'spe']:
        sm = re.search(rf'{stat}:\s*(\d+)', stats_str)
        if sm:
            stats[stat] = int(sm.group(1))
    return stats


def extract_tags(body: str) -> list[str]:
    m = re.search(r'tags:\s*\[([^\]]+)\]', body)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def extract_abilities(body: str) -> list[str]:
    m = re.search(r'abilities:\s*\{([^}]+)\}', body)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))


def main():
    print("=== Champions BSS Reg M-B 静的メタ分析 ===\n")

    # 1. pokedex.ts からベースデータを読み込む
    print("[1/4] pokedex.ts を解析中...")
    with open(POKEDEX_PATH, encoding='utf-8') as f:
        pokedex_content = f.read()
    pokedex = parse_ts_object(pokedex_content)
    print(f"  総エントリ数: {len(pokedex)}")

    # 2. Champions formats-data.ts から合法・ティア情報を読み込む
    print("[2/4] Champions formats-data.ts を解析中...")
    with open(FORMATS_DATA_PATH, encoding='utf-8') as f:
        formats_content = f.read()
    champ_data = parse_ts_object(formats_content)

    # 合法ポケモンのフィルタリング
    illegal_ids = set()
    nonstandard_ids = set()
    tier_map = {}
    for pid, body in champ_data.items():
        tier = extract_field(body, 'tier')
        ns = extract_field(body, 'isNonstandard')
        if tier:
            tier_map[pid] = tier
        if tier == 'Illegal' or ns in ('Past', 'Future', 'LGPE', 'Custom'):
            illegal_ids.add(pid)
            nonstandard_ids.add(pid)

    # 3. BSS Reg M-B のban対象（Mythical / Restricted Legendary）を特定
    print("[3/4] Mythical / Restricted Legendary を特定中...")
    mythical_ids = set()
    restricted_ids = set()
    for pid, body in pokedex.items():
        tags = extract_tags(body)
        if 'Mythical' in tags:
            mythical_ids.add(pid)
        if 'Restricted Legendary' in tags:
            restricted_ids.add(pid)
    print(f"  Mythical: {len(mythical_ids)}体, Restricted Legendary: {len(restricted_ids)}体")

    # Champions modで定義されているポケモンのうち合法なものに絞る
    # （formats-dataに存在しないものはベースGen9の扱い＝合法の可能性あり）
    legal_in_champ = set()
    for pid in pokedex:
        if pid in illegal_ids:
            continue
        if pid in mythical_ids or pid in restricted_ids:
            continue
        # formats-dataで明示的に合法ティアが付いているか、定義なし（=合法継承）
        champ_body = champ_data.get(pid, '')
        ns = extract_field(champ_body, 'isNonstandard') if champ_body else None
        if ns in ('Past', 'Future', 'LGPE', 'Custom'):
            continue
        champ_tier = tier_map.get(pid, '')
        if champ_tier == 'Illegal':
            continue
        legal_in_champ.add(pid)

    print(f"  BSS Reg M-B 出場可能ポケモン数: {len(legal_in_champ)}")

    # 4. 各ポケモンの詳細データを収集してCSV出力
    print("[4/4] データ集計・CSV出力中...")
    rows = []
    for pid in legal_in_champ:
        body = pokedex.get(pid, '')
        if not body:
            continue
        stats = extract_base_stats(body)
        if not stats:
            continue
        bst = sum(stats.values())
        types = extract_types(body)
        abilities = extract_abilities(body)
        name = extract_field(body, 'name') or pid
        num = extract_field_num(body, 'num')
        champ_tier = tier_map.get(pid, 'OU')  # デフォルトOUとして扱う

        rows.append({
            'id': pid,
            'name': name,
            'num': num or 0,
            'type1': types[0] if types else '',
            'type2': types[1] if len(types) > 1 else '',
            'hp': stats.get('hp', 0),
            'atk': stats.get('atk', 0),
            'def': stats.get('def', 0),
            'spa': stats.get('spa', 0),
            'spd': stats.get('spd', 0),
            'spe': stats.get('spe', 0),
            'bst': bst,
            'champ_tier': champ_tier,
            'abilities': ' / '.join(abilities[:3]),
        })

    # BST降順でソート
    rows.sort(key=lambda r: (-r['bst'], r['num']))

    # CSV保存
    fieldnames = ['id', 'name', 'num', 'type1', 'type2',
                  'hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst',
                  'champ_tier', 'abilities']
    with open(OUTPUT_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> {OUTPUT_CSV} に保存しました\n")

    # サマリー出力
    print("=== ティア別内訳 ===")
    tier_count = defaultdict(int)
    for r in rows:
        tier_count[r['champ_tier']] += 1
    for tier in ['OU', '(OU)', 'UUBL', 'UU', 'NFE', 'Uber', '']:
        if tier_count[tier]:
            label = tier if tier else '(未分類/継承)'
            print(f"  {label:12s}: {tier_count[tier]:4d}体")

    print("\n=== BSS Reg M-B 出場可能 TOP 30 (BST順) ===")
    print(f"{'名前':<22} {'タイプ':<18} {'HP':>3} {'攻撃':>4} {'防御':>4} {'特攻':>4} {'特防':>4} {'素早':>4} {'合計':>5}  {'ティア'}")
    print("-" * 90)
    for r in rows[:30]:
        type_str = r['type1'] + ('/' + r['type2'] if r['type2'] else '')
        print(f"{r['name']:<22} {type_str:<18} {r['hp']:>3} {r['atk']:>4} {r['def']:>4} {r['spa']:>4} {r['spd']:>4} {r['spe']:>4} {r['bst']:>5}  {r['champ_tier']}")

    print(f"\n合計 {len(rows)} 体のデータを解析しました。")
    print(f"詳細は {OUTPUT_CSV} を参照してください。")


if __name__ == "__main__":
    main()
