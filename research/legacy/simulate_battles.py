"""
Champions Random Battle シミュレーション（Track B）
大量試合を実行してポケモン単体の勝率・登場率を収集する。
"""
import asyncio
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

from poke_env import RandomPlayer, LocalhostServerConfiguration

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = Path(__file__).parent
STATS_JSON = BASE_DIR / "battle_stats.json"
STATS_CSV = BASE_DIR / "battle_stats.csv"
JP_NAMES_CSV = BASE_DIR / "bss_regmb_pokemon_ja.csv"

FORMAT = "gen9championsrandombattle"
N_BATTLES = 1000       # 1回の実行で行う試合数
BATCH_SIZE = 50        # 並行試合数
CONCURRENT = 10        # 同時接続数


def load_jp_cache() -> dict[str, str]:
    """Showdown の id（小文字）→ 日本語名 のマッピングを構築する"""
    if not JP_NAMES_CSV.exists():
        return {}
    mapping = {}
    with open(JP_NAMES_CSV, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            sid = row["id"].lower().replace("-", "").replace(" ", "")
            mapping[sid] = row["name_ja"]
    return mapping


def load_stats() -> dict:
    if STATS_JSON.exists():
        with open(STATS_JSON, encoding='utf-8') as f:
            return json.load(f)
    return {
        "total_battles": 0,
        "pokemon": {}  # species_name -> {appearances, wins}
    }


def save_stats(stats: dict) -> None:
    with open(STATS_JSON, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)


def get_species_name(pokemon) -> str:
    """Pokemonオブジェクトから種族名文字列を取得する"""
    sp = pokemon.species
    if sp is None:
        return pokemon.name or "unknown"
    # poke_env の species は文字列の場合と Species オブジェクトの場合がある
    if isinstance(sp, str):
        return sp
    return str(sp)


def extract_battle_data(player_1: RandomPlayer, player_2: RandomPlayer) -> list[dict]:
    """
    両プレイヤーのbattlesを突き合わせて全試合のチームデータを抽出する。
    戻り値: [{p1_team:[...], p2_team:[...], p1_won: bool}, ...]
    """
    results = []
    p1_battles = player_1.battles
    p2_battles = player_2.battles

    for tag, b1 in p1_battles.items():
        if not b1.finished:
            continue
        b2 = p2_battles.get(tag)
        if b2 is None or not b2.finished:
            continue

        # player_1 の視点: b1.team が p1 の完全チーム
        # player_2 の視点: b2.team が p2 の完全チーム
        p1_team = [get_species_name(p) for p in b1.team.values()]
        p2_team = [get_species_name(p) for p in b2.team.values()]

        p1_won = b1.won  # True/False/None

        results.append({
            "tag": tag,
            "p1_team": p1_team,
            "p2_team": p2_team,
            "p1_won": p1_won,
        })

    return results


def update_stats(stats: dict, battle_results: list[dict]) -> None:
    """抽出したバトルデータを累積統計に反映する"""
    poke_stats = stats["pokemon"]

    for result in battle_results:
        p1_won = result["p1_won"]
        if p1_won is None:
            continue  # 引き分け/未決着はスキップ

        stats["total_battles"] += 1

        for species in result["p1_team"]:
            if species not in poke_stats:
                poke_stats[species] = {"appearances": 0, "wins": 0}
            poke_stats[species]["appearances"] += 1
            if p1_won:
                poke_stats[species]["wins"] += 1

        for species in result["p2_team"]:
            if species not in poke_stats:
                poke_stats[species] = {"appearances": 0, "wins": 0}
            poke_stats[species]["appearances"] += 1
            if not p1_won:
                poke_stats[species]["wins"] += 1


def save_csv(stats: dict, jp_cache: dict) -> None:
    """統計をCSVに出力（win_rate降順、5試合以上登場したポケモンのみ）"""
    poke_stats = stats["pokemon"]
    rows = []
    for species, s in poke_stats.items():
        if s["appearances"] < 5:
            continue
        win_rate = s["wins"] / s["appearances"] * 100

        # 日本語名の解決（キャッシュから）
        # jp_cacheのキーはspecies_<num>形式なので直接は使えないが
        # species名→日本語名の別マッピングを構築済みの場合に対応
        name_ja = jp_cache.get(species, species)

        rows.append({
            "species": species,
            "name_ja": name_ja,
            "appearances": s["appearances"],
            "wins": s["wins"],
            "win_rate": round(win_rate, 2),
        })

    rows.sort(key=lambda r: -r["win_rate"])

    with open(STATS_CSV, 'w', newline='', encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=["species", "name_ja", "appearances", "wins", "win_rate"])
        writer.writeheader()
        writer.writerows(rows)


def print_top(stats: dict, jp_cache: dict, n: int = 20) -> None:
    poke_stats = stats["pokemon"]
    rows = []
    for species, s in poke_stats.items():
        if s["appearances"] < 5:
            continue
        win_rate = s["wins"] / s["appearances"] * 100
        name_ja = jp_cache.get(species, species)
        rows.append((name_ja, species, s["appearances"], s["wins"], win_rate))

    rows.sort(key=lambda r: -r[4])
    total = stats["total_battles"]

    print(f"\n=== TOP {n} 勝率ポケモン（累計 {total} 試合） ===")
    print(f"{'日本語名':<20} {'species':<28} {'登場':>6} {'勝利':>6} {'勝率':>7}")
    print("-" * 75)
    for r in rows[:n]:
        print(f"{r[0]:<20} {r[1]:<28} {r[2]:>6} {r[3]:>6} {r[4]:>6.1f}%")


async def run_batch(n: int, stats: dict, jp_cache: dict) -> None:
    """n 試合を並行実行して統計を更新する"""
    player_1 = RandomPlayer(
        battle_format=FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=CONCURRENT,
    )
    player_2 = RandomPlayer(
        battle_format=FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=CONCURRENT,
    )

    await player_1.battle_against(player_2, n_battles=n)

    results = extract_battle_data(player_1, player_2)
    update_stats(stats, results)
    save_stats(stats)
    save_csv(stats, jp_cache)

    return len(results)


async def main():
    print(f"=== Champions Random Battle シミュレーション ===")
    print(f"フォーマット: {FORMAT}")
    print(f"目標試合数: {N_BATTLES}（バッチ: {BATCH_SIZE} 試合ずつ）\n")

    stats = load_stats()
    jp_cache = load_jp_cache()

    print(f"既存累積データ: {stats['total_battles']} 試合\n")

    completed = 0
    batch_num = 0
    while completed < N_BATTLES:
        batch_num += 1
        current_batch = min(BATCH_SIZE, N_BATTLES - completed)
        print(f"[バッチ {batch_num}] {current_batch} 試合を実行中...", end="", flush=True)

        n_done = await run_batch(current_batch, stats, jp_cache)
        completed += n_done

        print(f" 完了 ({n_done} 試合) | 累計: {stats['total_battles']} 試合")

    print_top(stats, jp_cache, n=20)
    print(f"\n統計保存先: {STATS_JSON}")
    print(f"CSV 保存先: {STATS_CSV}")


if __name__ == "__main__":
    asyncio.run(main())
