"""
Step D: Champions BSS Reg M-B ラウンドロビンシミュレーション
team_pool.json の6チームで総当たり戦を行い、ポケモン単体の勝率を測定する。
"""
import argparse
import asyncio
import csv
import json
import random
import string
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

from poke_env import AccountConfiguration, LocalhostServerConfiguration
from poke_env.player import Player
from poke_env.teambuilder import ConstantTeambuilder

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).parent
OUT_DIR  = BASE_DIR / "analysis_output"

parser = argparse.ArgumentParser()
parser.add_argument("--team-pool", default=str(OUT_DIR / "team_pool.json"),
                    help="チームプールJSONのパス")
parser.add_argument("--out-prefix", default="bss_stats",
                    help="出力ファイルのプレフィックス（analysis_output/配下）")
args, _ = parser.parse_known_args()

TEAM_POOL_PATH = Path(args.team_pool)
BSS_STATS_JSON = OUT_DIR / f"{args.out_prefix}.json"
BSS_STATS_CSV  = OUT_DIR / f"{args.out_prefix}.csv"

FORMAT       = "gen9championsbssregmb"
BATTLES_PER_MATCHUP = 20   # 1組あたりの試合数
CONCURRENT   = 5


class FixedTeamPlayer(Player):
    """固定チームでランダム行動するプレイヤー"""
    def choose_move(self, battle):
        return self.choose_random_move(battle)


def load_team_pool() -> list[dict]:
    with open(TEAM_POOL_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_bss_stats() -> dict:
    if BSS_STATS_JSON.exists():
        with open(BSS_STATS_JSON, encoding="utf-8") as f:
            return json.load(f)
    return {"total_battles": 0, "matchups": {}, "pokemon": {}}


def save_bss_stats(stats: dict) -> None:
    with open(BSS_STATS_JSON, "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)


def update_pokemon_stats(
    stats: dict,
    team_a_members: list[str],
    team_b_members: list[str],
    a_won: bool,
) -> None:
    poke = stats["pokemon"]
    for m in team_a_members:
        if m not in poke:
            poke[m] = {"appearances": 0, "wins": 0}
        poke[m]["appearances"] += 1
        if a_won:
            poke[m]["wins"] += 1
    for m in team_b_members:
        if m not in poke:
            poke[m] = {"appearances": 0, "wins": 0}
        poke[m]["appearances"] += 1
        if not a_won:
            poke[m]["wins"] += 1


async def run_matchup(
    team_a: dict, team_b: dict, n_battles: int, stats: dict,
    idx_a: int = 0, idx_b: int = 1,
) -> None:
    key = f"{team_a['team_id']}vs{team_b['team_id']}"

    builder_a = ConstantTeambuilder(team_a["showdown_team"])
    builder_b = ConstantTeambuilder(team_b["showdown_team"])

    # 名前は最大18文字に制限: "Bx{idx}{suffix}" 形式（suffix=6文字）
    suffix = "".join(random.choices(string.ascii_lowercase, k=9))
    player_a = FixedTeamPlayer(
        battle_format=FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=CONCURRENT,
        team=builder_a,
        account_configuration=AccountConfiguration(f"Ba{idx_a}{suffix}", None),
    )
    player_b = FixedTeamPlayer(
        battle_format=FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=CONCURRENT,
        team=builder_b,
        account_configuration=AccountConfiguration(f"Bb{idx_b}{suffix}", None),
    )

    try:
        await asyncio.wait_for(
            player_a.battle_against(player_b, n_battles=n_battles),
            timeout=300,  # 5分でタイムアウト
        )
    except asyncio.TimeoutError:
        print(f"    [TIMEOUT] {key}")
        return
    except Exception as e:
        print(f"    [ERROR] {e}")
        return

    a_wins = player_a.n_won_battles
    b_wins = player_b.n_won_battles
    total  = player_a.n_finished_battles

    if key not in stats["matchups"]:
        stats["matchups"][key] = {"a_id": team_a["team_id"], "b_id": team_b["team_id"],
                                  "a_wins": 0, "b_wins": 0, "total": 0}
    stats["matchups"][key]["a_wins"] += a_wins
    stats["matchups"][key]["b_wins"] += b_wins
    stats["matchups"][key]["total"]  += total
    stats["total_battles"]           += total

    for _ in range(a_wins):
        update_pokemon_stats(stats, team_a["members_ja"], team_b["members_ja"], True)
    for _ in range(b_wins):
        update_pokemon_stats(stats, team_a["members_ja"], team_b["members_ja"], False)

    return a_wins, b_wins, total


def save_csv(stats: dict) -> None:
    rows = []
    for name, s in stats["pokemon"].items():
        n = s["appearances"]
        w = s["wins"]
        if n == 0:
            continue
        rows.append({
            "pokemon_ja": name,
            "appearances": n,
            "wins": w,
            "win_rate": round(w / n * 100, 1),
        })
    rows.sort(key=lambda r: -r["win_rate"])
    with open(BSS_STATS_CSV, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=["pokemon_ja", "appearances", "wins", "win_rate"])
        writer.writeheader()
        writer.writerows(rows)


def print_results(stats: dict) -> None:
    poke = stats["pokemon"]
    rows = [(n, s["appearances"], s["wins"], s["wins"]/s["appearances"]*100)
            for n, s in poke.items() if s["appearances"] > 0]
    rows.sort(key=lambda r: -r[3])

    print(f"\n=== BSS ラウンドロビン結果（累計 {stats['total_battles']} 試合）===")
    print(f"{'ポケモン':<25} {'登場':>5} {'勝率':>7}")
    print("-" * 45)
    for name, n, w, wr in rows:
        print(f"{name:<25} {n:>5} {wr:>6.1f}%")

    print(f"\n=== マッチアップ結果 ===")
    for key, m in stats["matchups"].items():
        if m["total"] == 0:
            continue
        aid, bid = m["a_id"], m["b_id"]
        aw, bw, tot = m["a_wins"], m["b_wins"], m["total"]
        print(f"  チーム{aid} vs チーム{bid}: {aw}勝 - {bw}勝 ({tot}試合)")


async def main():
    print("=== Champions BSS Reg M-B ラウンドロビンシミュレーション ===")
    print(f"フォーマット: {FORMAT}")
    print(f"1マッチアップあたり: {BATTLES_PER_MATCHUP} 試合\n")

    teams = load_team_pool()
    stats = load_bss_stats()

    print(f"チーム数: {len(teams)}")
    for t in teams:
        print(f"  チーム{t['team_id']}: {', '.join(t['members_ja'])}")

    matchups = list(combinations(range(len(teams)), 2))
    total_matchups = len(matchups)
    total_battles  = total_matchups * BATTLES_PER_MATCHUP
    print(f"\n総マッチアップ数: {total_matchups} / 予定試合数: {total_battles}\n")

    for i, (ia, ib) in enumerate(matchups, 1):
        ta, tb = teams[ia], teams[ib]
        print(f"[{i}/{total_matchups}] チーム{ta['team_id']} vs チーム{tb['team_id']} ({BATTLES_PER_MATCHUP}試合)...",
              end="", flush=True)
        result = await run_matchup(ta, tb, BATTLES_PER_MATCHUP, stats, ia, ib)
        if result:
            aw, bw, tot = result
            print(f" {aw}-{bw} ({tot}試合完了)")
        else:
            print(" エラー")
        save_bss_stats(stats)

    save_csv(stats)
    print_results(stats)
    print(f"\n保存先: {BSS_STATS_JSON} / {BSS_STATS_CSV}")


if __name__ == "__main__":
    asyncio.run(main())
