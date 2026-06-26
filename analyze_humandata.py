"""
Champions BSS Reg M-A シーズン静的分析（Step A）
humandata の上位チームデータからメタ傾向を解析する。
"""
import json
import csv
import sys
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent
FILES = {
    "M-1": BASE_DIR / "humandata/s1_single_ranked_teams.json",
    "M-2": BASE_DIR / "humandata/s2_single_ranked_teams.json",
}
OUT_DIR = BASE_DIR / "analysis_output"
OUT_DIR.mkdir(exist_ok=True)

# レーティング上位N%に絞るか（Noneで全件）
TOP_RATING_FILTER = None   # 例: 2300 以上のみなら 2300

# ────────────────────────────────────────────
# データ読み込み
# ────────────────────────────────────────────

def load_all() -> list[dict]:
    """全シーズンのチームデータを読み込む（レーティングフィルタ付き）"""
    all_teams = []
    for season, path in FILES.items():
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        for team in data["teams"]:
            if TOP_RATING_FILTER and team["rating_value"] < TOP_RATING_FILTER:
                continue
            entry = {
                "season": season,
                "rank": team["rank"],
                "rating": team["rating_value"],
                "members": team["team"],
            }
            all_teams.append(entry)
    return all_teams


def pokemon_key(member: dict) -> str:
    """フォームを含めた表示名を返す"""
    form = member["form"]
    name = member["pokemon"]
    return f"{name}（{form}）" if form else name


# ────────────────────────────────────────────
# 集計
# ────────────────────────────────────────────

def aggregate(teams: list[dict]) -> dict:
    total_teams = len(teams)

    # 使用回数
    usage: Counter[str] = Counter()
    # 持ち物（ポケモン別）
    items: dict[str, Counter] = defaultdict(Counter)
    # 共選出（何と一緒に使われるか）
    coUsage: Counter[tuple] = Counter()
    # シーズン別使用数
    season_usage: dict[str, Counter] = defaultdict(Counter)
    # レーティング帯別（2000+, 2200+, 2400+）
    tier_usage: dict[str, Counter] = {
        "全体": Counter(),
        "2000+": Counter(),
        "2200+": Counter(),
        "2400+": Counter(),
    }

    for team in teams:
        members = team["members"]
        keys = [pokemon_key(m) for m in members if m.get("pokemon")]
        rating = team["rating"]

        for m in members:
            pkey = pokemon_key(m)
            if not pkey:
                continue
            usage[pkey] += 1
            season_usage[team["season"]][pkey] += 1
            item = m.get("item", "")
            if item:
                items[pkey][item] += 1

            tier_usage["全体"][pkey] += 1
            if rating and rating >= 2000:
                tier_usage["2000+"][pkey] += 1
            if rating and rating >= 2200:
                tier_usage["2200+"][pkey] += 1
            if rating and rating >= 2400:
                tier_usage["2400+"][pkey] += 1

        for pair in combinations(sorted(keys), 2):
            coUsage[pair] += 1

    return {
        "total_teams": total_teams,
        "usage": usage,
        "items": items,
        "coUsage": coUsage,
        "season_usage": season_usage,
        "tier_usage": tier_usage,
    }


# ────────────────────────────────────────────
# 出力
# ────────────────────────────────────────────

def save_usage_csv(result: dict) -> None:
    usage = result["usage"]
    total = result["total_teams"]
    tier = result["tier_usage"]
    s_usage = result["season_usage"]

    rows = []
    for poke, cnt in usage.most_common():
        rows.append({
            "pokemon": poke,
            "total_use": cnt,
            "use_rate": round(cnt / total * 100, 1),
            "M-1": s_usage["M-1"].get(poke, 0),
            "M-2": s_usage["M-2"].get(poke, 0),
            "2000+": tier["2000+"].get(poke, 0),
            "2200+": tier["2200+"].get(poke, 0),
            "2400+": tier["2400+"].get(poke, 0),
        })

    path = OUT_DIR / "usage.csv"
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> {path}")


def save_items_csv(result: dict) -> None:
    items = result["items"]
    usage = result["usage"]
    rows = []
    for poke, item_cnt in items.items():
        total_use = usage[poke]
        top_items = item_cnt.most_common(5)
        row = {"pokemon": poke, "total_use": total_use}
        for i, (item, cnt) in enumerate(top_items, 1):
            row[f"item{i}"] = item
            row[f"item{i}_cnt"] = cnt
            row[f"item{i}_rate"] = round(cnt / total_use * 100, 1)
        rows.append(row)
    rows.sort(key=lambda r: -r["total_use"])

    fieldnames = ["pokemon", "total_use"] + \
        [f for i in range(1, 6) for f in (f"item{i}", f"item{i}_cnt", f"item{i}_rate")]
    path = OUT_DIR / "items.csv"
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> {path}")


def save_co_usage_csv(result: dict) -> None:
    rows = []
    for (p1, p2), cnt in result["coUsage"].most_common(100):
        rows.append({"pokemon1": p1, "pokemon2": p2, "co_count": cnt})

    path = OUT_DIR / "co_usage.csv"
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["pokemon1", "pokemon2", "co_count"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"  -> {path}")


def print_summary(result: dict) -> None:
    usage = result["usage"]
    items = result["items"]
    total = result["total_teams"]

    print(f"\n{'='*60}")
    print(f"  分析対象: {total} チーム ({', '.join(FILES.keys())})")
    print(f"  ユニークポケモン数: {len(usage)}")
    print(f"{'='*60}")

    print(f"\n▼ 使用率TOP20（全チーム中に登場した割合）")
    print(f"  {'ポケモン':<25} {'使用数':>5}  {'使用率':>6}  {'M-1':>5}  {'M-2':>5}")
    print("  " + "-" * 55)
    s = result["season_usage"]
    for poke, cnt in usage.most_common(20):
        rate = cnt / total * 100
        m1 = s["M-1"].get(poke, 0)
        m2 = s["M-2"].get(poke, 0)
        print(f"  {poke:<25} {cnt:>5}   {rate:>5.1f}%   {m1:>5}   {m2:>5}")

    print(f"\n▼ 主要ポケモンの持ち物 TOP3")
    print("  " + "-" * 55)
    for poke, cnt in usage.most_common(15):
        item_cnt = items.get(poke, Counter())
        top3 = item_cnt.most_common(3)
        items_str = "  /  ".join(
            f"{item}({c}回)" for item, c in top3
        )
        print(f"  {poke:<25} {items_str}")

    print(f"\n▼ 共選出TOP20（よく一緒に使われるペア）")
    print(f"  {'ポケモン1':<22}  {'ポケモン2':<22}  {'共選出数':>6}")
    print("  " + "-" * 55)
    for (p1, p2), cnt in result["coUsage"].most_common(20):
        print(f"  {p1:<22}  {p2:<22}  {cnt:>6}")

    print(f"\n▼ 高レーティング帯（2400+）での使用TOP10")
    print(f"  {'ポケモン':<25} {'使用数':>5}")
    print("  " + "-" * 35)
    for poke, cnt in result["tier_usage"]["2400+"].most_common(10):
        print(f"  {poke:<25} {cnt:>5}")


# ────────────────────────────────────────────
# メイン
# ────────────────────────────────────────────

def main():
    print("=== Champions BSS Reg M-A 静的メタ分析 ===\n")
    print("[1/3] データ読み込み中...")
    teams = load_all()
    print(f"  {len(teams)} チームを読み込みました")

    print("[2/3] 集計中...")
    result = aggregate(teams)

    print("[3/3] CSV出力中...")
    save_usage_csv(result)
    save_items_csv(result)
    save_co_usage_csv(result)

    print_summary(result)


if __name__ == "__main__":
    main()
