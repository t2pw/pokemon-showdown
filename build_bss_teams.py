"""
Step D: Champions BSS Reg M-B シミュレーション用チームプールを構築する。

データソース:
  - humandata: M-A上位ポケモンの使用率・持ち物
  - analysis_output/mb_new_pokemon_builds.json: M-B新規ポケモンの構成
  - analysis_output/mega_stone_map.json: メガストーン JP→EN マッピング
  - analysis_output/standard_item_map.json: 汎用アイテム JP→EN マッピング
  - data/mods/champions/learnsets.ts: 使用可能技リスト

出力:
  - analysis_output/team_pool.json: チームプール（Showdown形式の文字列）
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
BASE_DIR = Path(__file__).parent
OUT_DIR  = BASE_DIR / "analysis_output"

# ─── アイテムマッピングの読み込み ───────────────────────────────
def load_item_map() -> dict[str, str]:
    std  = json.loads((OUT_DIR / "standard_item_map.json").read_text(encoding="utf-8"))
    mega = json.loads((OUT_DIR / "mega_stone_map.json").read_text(encoding="utf-8"))
    combined = {**std, **mega}
    return combined

# ─── humandata からポケモンごとの最頻アイテムを取得 ─────────────
def load_usage_and_items() -> tuple[Counter, dict[str, Counter]]:
    usage    = Counter()
    items_by = defaultdict(Counter)
    for fname in ["humandata/s1_single_ranked_teams.json",
                  "humandata/s2_single_ranked_teams.json"]:
        with open(BASE_DIR / fname, encoding="utf-8") as f:
            data = json.load(f)
        for team in data["teams"]:
            for p in team["team"]:
                form = p.get("form", "")
                name = p["pokemon"] + (f"（{form}）" if form else "")
                if not name.strip():
                    continue
                usage[name] += 1
                item = p.get("item", "")
                if item and item != "持ち物なし":
                    items_by[name][item] += 1
    return usage, items_by

# ─── 日本語ポケモン名 → Showdown ID の変換 ──────────────────────
# bss_regmb_pokemon_ja.csv から逆引きマップを構築
FORM_MANUAL_MAP = {
    # humandata のフォーム表記 → Showdown ID
    "イダイトウ（オスのすがた）":   "basculegion",  # male form = base
    "フラエッテ（えいえんのはな）":  "floetteeternal",
    "ミミッキュ（ばけたすがた）":   "mimikyu",      # シールドフォルムでチームに登録
    "ギルガルド（シールドフォルム）": "aegislash",
    "ダイケンキ（ヒスイのすがた）":  "samurotthisui",
    "カイリュー":               "dragonite",
    "ギャラドス":               "gyarados",
}

def load_poke_id_map() -> dict[str, str]:
    """日本語名 → Showdown ID"""
    import csv
    poke_map = dict(FORM_MANUAL_MAP)
    with open(BASE_DIR / "bss_regmb_pokemon_ja.csv", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            poke_map[row["name_ja"]] = row["id"]
    return poke_map

# ─── Champions learnsets から使用可能技トップNを取得 ────────────
def load_learnsets() -> dict[str, list[str]]:
    """ポケモンID → 使用可能技リスト"""
    path = BASE_DIR / "data/mods/champions/learnsets.ts"
    if not path.exists():
        path = BASE_DIR / "data/learnsets.ts"
    with open(path, encoding="utf-8") as f:
        content = f.read()
    result = {}
    for m in re.finditer(r'^\t(\w+):\s*\{[^}]*learnset:\s*\{([^}]*)\}', content,
                         re.MULTILINE | re.DOTALL):
        pid = m.group(1)
        moves_str = m.group(2)
        moves = re.findall(r'^\s+(\w+):', moves_str, re.MULTILINE)
        result[pid] = moves
    return result

def load_base_learnsets() -> dict[str, list[str]]:
    path = BASE_DIR / "data/learnsets.ts"
    with open(path, encoding="utf-8") as f:
        content = f.read()
    result = {}
    for m in re.finditer(r'^\t(\w+):\s*\{[^}]*learnset:\s*\{([^}]*)\}', content,
                         re.MULTILINE | re.DOTALL):
        pid = m.group(1)
        moves_str = m.group(2)
        moves = re.findall(r'^\s+(\w+):', moves_str, re.MULTILINE)
        result[pid] = moves
    return result

# ─── 技データから攻撃技を選定 ───────────────────────────────────
def load_move_data() -> dict[str, dict]:
    """技ID → {basePower, type, category}"""
    path = BASE_DIR / "data/moves.ts"
    with open(path, encoding="utf-8") as f:
        content = f.read()
    moves_data = {}
    for m in re.finditer(r'^\t(\w+):\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
                         content, re.MULTILINE | re.DOTALL):
        mid, body = m.group(1), m.group(2)
        bp  = re.search(r'\bbasePower:\s*(\d+)', body)
        cat = re.search(r'\bcategory:\s*"([^"]+)"', body)
        typ = re.search(r'\btype:\s*"([^"]+)"', body)
        moves_data[mid] = {
            "bp":       int(bp.group(1))  if bp  else 0,
            "category": cat.group(1)      if cat else "Status",
            "type":     typ.group(1)      if typ else "Normal",
        }
    return moves_data

PRIORITY_MOVES = {
    "earthquake", "closecombat", "flareblitz", "ironhead", "iciclecrash",
    "stoneedge", "rockslide", "aquajet", "extremespeed", "bulletpunch",
    "shadowball", "shadowclaw", "playrough", "moonblast", "flashcannon",
    "thunderbolt", "icebeam", "flamethrower", "surf", "psychic",
    "dracometeor", "dragonpulse", "dragonrush", "uturn", "voltswitch",
    "nastyplot", "swordsdance", "calmmind", "dragondance", "shellsmash",
    "protect",
    # TM技はChampions modで習得不可のケースがあるため除外
    # "willowisp", "thunderwave", "stealthrock", "toxic"
}

def pick_moves(pid: str, learnsets: dict, base_learnsets: dict,
               move_data: dict) -> list[str]:
    """ポケモンIDから対戦で使いやすい技4つを選ぶ"""
    available = set(learnsets.get(pid, []) + base_learnsets.get(pid, []))

    # 優先技から取れるものを先に採用
    priority = [m for m in PRIORITY_MOVES if m in available]

    # 次に高BP攻撃技
    attack_moves = sorted(
        [m for m in available if move_data.get(m, {}).get("bp", 0) >= 80
         and move_data.get(m, {}).get("category") in ("Physical", "Special")],
        key=lambda m: -move_data[m]["bp"]
    )

    chosen: list[str] = []
    for m in priority + attack_moves:
        if m not in chosen:
            chosen.append(m)
        if len(chosen) == 4:
            break

    # 不足分はHP回復技や変化技で補完
    if len(chosen) < 4:
        filler = [m for m in available
                  if m not in chosen and move_data.get(m, {}).get("bp", 0) > 0]
        filler.sort(key=lambda m: -move_data[m]["bp"])
        for m in filler:
            if m not in chosen:
                chosen.append(m)
            if len(chosen) == 4:
                break

    return chosen[:4] if chosen else ["struggle"]


def move_id_to_name(mid: str) -> str:
    """moveIDをShowdown技名に変換（先頭大文字化）"""
    # 例: closecombat → Close Combat
    special = {
        "uturn": "U-turn", "voltswitch": "Volt Switch",
        "willowisp": "Will-O-Wisp", "thunderwave": "Thunder Wave",
        "stealthrock": "Stealth Rock", "nastyplot": "Nasty Plot",
        "swordsdance": "Swords Dance", "calmmind": "Calm Mind",
        "dragondance": "Dragon Dance", "shellsmash": "Shell Smash",
        "shadowball": "Shadow Ball", "shadowclaw": "Shadow Claw",
        "playrough": "Play Rough", "moonblast": "Moonblast",
        "flashcannon": "Flash Cannon", "thunderbolt": "Thunderbolt",
        "icebeam": "Ice Beam", "flamethrower": "Flamethrower",
        "psychic": "Psychic", "dracometeor": "Draco Meteor",
        "dragonpulse": "Dragon Pulse", "dragonrush": "Dragon Rush",
        "closecombat": "Close Combat", "flareblitz": "Flare Blitz",
        "ironhead": "Iron Head", "iciclecrash": "Icicle Crash",
        "stoneedge": "Stone Edge", "rockslide": "Rock Slide",
        "aquajet": "Aqua Jet", "extremespeed": "Extreme Speed",
        "bulletpunch": "Bullet Punch", "earthquake": "Earthquake",
        "protect": "Protect", "toxic": "Toxic",
    }
    if mid in special:
        return special[mid]
    # 汎用変換: camelCase / lowercaseをスペース区切りに
    words = re.sub(r'([A-Z])', r' \1', mid).strip().split()
    return " ".join(w.capitalize() for w in words) if words else mid.capitalize()


# Champions BSS Stat Points: max 32 per stat, 66 total
PHYS_EVS = "32 Atk / 2 Def / 32 Spe"
SPEC_EVS = "32 SpA / 2 Def / 32 Spe"
TANK_EVS = "32 HP / 32 Def / 2 SpD"

JP_NATURE_MAP = {
    "ようき": "Jolly", "いじっぱり": "Adamant", "おくびょう": "Timid",
    "ひかえめ": "Modest", "しんちょう": "Careful", "おだやか": "Calm",
    "やんちゃ": "Naughty", "むじゃき": "Naive", "わんぱく": "Impish",
    "ずぶとい": "Bold",
}

JP_MOVE_MAP = {
    "バレットパンチ": "Bullet Punch", "コメットパンチ": "Meteor Mash",
    "じしん": "Earthquake", "れいとうパンチ": "Ice Punch",
    "ウェーブタックル": "Wave Crash", "まもる": "Protect",
    "つるぎのまい": "Swords Dance", "フレアドライブ": "Flare Blitz",
    "インファイト": "Close Combat", "だいちのちから": "Earth Power",
    "りゅうのはどう": "Dragon Pulse", "リーフストーム": "Leaf Storm",
    "ゴールドラッシュ": "Make It Rain", "シャドーボール": "Shadow Ball",
    "10まんボルト": "Thunderbolt", "ふんどのこぶし": "Rage Fist",
    "ドレインパンチ": "Drain Punch", "ビルドアップ": "Bulk Up",
    "ちょうはつ": "Taunt", "かみなりパンチ": "Thunder Punch",
    "いわなだれ": "Rock Slide", "はたきおとす": "Knock Off",
    "じならし": "Bulldoze", "こおりのつぶて": "Ice Shard",
    "しっぽきり": "Shed Tail", "しんくうは": "Vacuum Wave",
    "エナジーボール": "Energy Ball", "きあいだま": "Focus Blast",
    "わるだくみ": "Nasty Plot", "トリック": "Trick",
}

def jp_move_to_en(jp: str) -> str:
    return JP_MOVE_MAP.get(jp, jp)

def jp_nature_to_en(jp: str) -> str:
    first = jp.split("/")[0].strip()
    return JP_NATURE_MAP.get(first, "Jolly")

# ─── Showdown形式のチームエントリを生成 ─────────────────────────
def make_showdown_entry(
    name_ja: str, pid: str, item_en: str,
    learnsets: dict, base_learnsets: dict, move_data: dict,
    pokedex: dict
) -> str:
    # 種族値から物理/特殊を判定
    base = pokedex.get(pid, {})
    atk  = int(re.search(r'atk:\s*(\d+)', base).group(1)) if re.search(r'atk:\s*(\d+)', base) else 80
    spa  = int(re.search(r'spa:\s*(\d+)', base).group(1)) if re.search(r'spa:\s*(\d+)', base) else 80

    if atk >= spa:
        nature = "Adamant"
        evs    = PHYS_EVS
    else:
        nature = "Modest"
        evs    = SPEC_EVS

    moves = pick_moves(pid, learnsets, base_learnsets, move_data)
    move_lines = "\n".join(f"- {move_id_to_name(m)}" for m in moves)

    # Showdown のポケモン名（英語）
    name_en = pid  # フォールバック
    nm_match = re.search(r'name:\s*"([^"]+)"', base)
    if nm_match:
        name_en = nm_match.group(1)

    item_line = f" @ {item_en}" if item_en else ""
    entry = (
        f"{name_en}{item_line}\n"
        f"Level: 50\n"
        f"EVs: {evs}\n"
        f"{nature} Nature\n"
        f"{move_lines}"
    )
    return entry


# ─── メイン ─────────────────────────────────────────────────────
def main():
    print("=== Step D: BSS チームプール構築 ===\n")

    print("[1/6] データ読み込み中...")
    item_map   = load_item_map()
    usage, items_by = load_usage_and_items()
    poke_id_map = load_poke_id_map()
    learnsets  = load_learnsets()
    base_ls    = load_base_learnsets()
    move_data  = load_move_data()

    # pokedex raw text（種族値抽出用）
    with open(BASE_DIR / "data/pokedex.ts", encoding="utf-8") as f:
        pokedex_raw = f.read()
    pokedex: dict[str, str] = {}
    for m in re.finditer(r'^\t(\w+):\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}',
                         pokedex_raw, re.MULTILINE | re.DOTALL):
        pokedex[m.group(1)] = m.group(2)  # 値は文字列（TSブロック本体）

    # M-B新規ポケモンの構成
    mb_builds = json.loads((OUT_DIR / "mb_new_pokemon_builds.json").read_text(encoding="utf-8"))
    mb_ids = {b["id"]: b for b in mb_builds["pokemon"]}

    print("[2/6] 使用率TOP36ポケモンを選定中...")
    top_poke = [name for name, _ in usage.most_common(36)]
    print(f"  対象: {len(top_poke)} 体")

    # M-B新規ポケモンを追加
    mb_names = [b["name_ja"] for b in mb_builds["pokemon"]]
    for name in mb_names:
        if name not in top_poke:
            top_poke.append(name)
    print(f"  M-B新規6体を追加 → 合計 {len(top_poke)} 体")

    print("[3/6] 各ポケモンのShowdownエントリを生成中...")
    # entries: name_ja -> (showdown_entry_without_item, item_en, fallback_items_en)
    entries: dict[str, tuple[str, str, list[str]]] = {}
    skipped = []

    for name_ja in top_poke:
        pid = poke_id_map.get(name_ja)

        # M-B新規ポケモンはbuildデータを使用
        if pid and pid in mb_ids:
            b = mb_ids[pid]
            item_ja_raw = b.get("item", "")
            # スラッシュ区切りの場合は先頭を使用
            item_ja_first = item_ja_raw.split("/")[0].strip()
            item_en = item_map.get(item_ja_first, item_ja_first)
            item_fallbacks = [item_map.get(i.strip(), i.strip())
                              for i in item_ja_raw.split("/")[1:] if i.strip()]

            nm_match = re.search(r'name:\s*"([^"]+)"', pokedex.get(pid, ""))
            name_en  = nm_match.group(1) if nm_match else pid
            nature_en = jp_nature_to_en(b.get("nature", "ようき"))

            # EV スプレッド（ev_spreadフィールドから判定）
            ev_spread = b.get("ev_spread", "")
            if "HP特化" in ev_spread or "耐久" in ev_spread:
                evs = TANK_EVS
            elif "特攻" in ev_spread:
                evs = SPEC_EVS
            else:
                evs = PHYS_EVS

            moves_jp = b.get("moves_confirmed", [])[:4]
            move_lines = "\n".join(f"- {jp_move_to_en(m)}" for m in moves_jp)
            base_entry = (
                f"{name_en}\n"
                f"Level: 50\n"
                f"EVs: {evs}\n"
                f"{nature_en} Nature\n"
                f"{move_lines}"
            )
            entries[name_ja] = (base_entry, item_en, item_fallbacks)
            continue

        if not pid:
            skipped.append(name_ja)
            continue

        # M-A ポケモン: humandata の最頻アイテムリスト + 自動技選択
        item_counter = items_by.get(name_ja, Counter())
        item_list = [item_map.get(i, "") for i, _ in item_counter.most_common(5) if item_map.get(i)]
        item_en_primary = item_list[0] if item_list else ""
        item_fallbacks  = item_list[1:]

        base_entry = make_showdown_entry(
            name_ja, pid, "",  # アイテムはここでは空、後でチーム編成時に付与
            learnsets, base_ls, move_data, pokedex
        )
        entries[name_ja] = (base_entry, item_en_primary, item_fallbacks)

    print(f"  生成: {len(entries)} 体 / スキップ: {len(skipped)} 体")
    if skipped:
        print(f"  スキップ（ID未解決）: {skipped[:5]}...")

    print("[4/6] 6匹1チームに編成（Item Clause: アイテム重複排除）...")
    valid = list(entries.keys())
    teams: list[list[str]] = []
    for i in range(0, len(valid) - 5, 6):
        team_members = valid[i:i+6]
        if len(team_members) == 6:
            teams.append(team_members)

    print(f"  {len(teams)} チームを作成")

    def resolve_item(base_entry: str, primary: str, fallbacks: list[str], used: set[str]) -> tuple[str, str]:
        """Item Clause に従いアイテムを解決し (entry_with_item, used_item) を返す"""
        for candidate in [primary] + fallbacks:
            if candidate and candidate not in used:
                name_line = base_entry.split("\n")[0]
                full_entry = base_entry.replace(name_line, f"{name_line} @ {candidate}", 1)
                return full_entry, candidate
        # 全候補が重複 → アイテムなし
        return base_entry, ""

    print("[5/6] チームプールをJSON保存...")
    pool = []
    for i, members in enumerate(teams):
        used_items: set[str] = set()
        member_entries = []
        for m in members:
            base_entry, primary, fallbacks = entries[m]
            full_entry, used_item = resolve_item(base_entry, primary, fallbacks, used_items)
            if used_item:
                used_items.add(used_item)
            member_entries.append(full_entry)
        team_str = "\n\n".join(member_entries)
        pool.append({
            "team_id": i + 1,
            "members_ja": members,
            "showdown_team": team_str,
        })

    out_path = OUT_DIR / "team_pool.json"
    out_path.write_text(json.dumps(pool, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {out_path}")

    print("\n[6/6] プレビュー（チーム1）:")
    if pool:
        t = pool[0]
        print(f"  メンバー: {', '.join(t['members_ja'])}")
        print()
        print(t["showdown_team"][:600])

    print(f"\n完了: {len(pool)} チーム / {len(entries)} ポケモンエントリ")


if __name__ == "__main__":
    main()
