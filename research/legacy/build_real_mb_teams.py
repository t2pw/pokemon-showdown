"""
Step E: 実際のR2000+構築をShowdown形式に変換し、シミュレーション用JSONを作成する。

収集データ（2026-06-25時点）:
  - gray_sv: R2000.999 / M-3シーズン
  - jazzy_yarrow: M-3 マスターボール到達
  - sword828: M-2シーズン R2000

Champions BSS Stat Pointsシステム:
  - 1ステータスあたり最大32, 合計66まで
  - H=HP, A=Atk, B=Def, C=SpA, D=SpD, S=Spe
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
BASE_DIR = Path(__file__).parent
OUT_DIR  = BASE_DIR / "analysis_output"

# ─── 実構築データ ─────────────────────────────────────────────────
# Champions Stat Points (max 32/stat, 66 total)
# EVs表記: 実際のev値をそのまま記載する。合計が66になるよう調整済み。

GRAY_SV_TEAM = """\
Archaludon @ sitrusberry
Level: 50
EVs: 32 HP / 2 Def / 32 SpD
Calm Nature
- Draco Meteor
- Flash Cannon
- Thunder Wave
- Stealth Rock

Scizor @ scizorite
Level: 50
EVs: 32 HP / 32 Atk / 2 Spe
Adamant Nature
- Bullet Punch
- Close Combat
- Knock Off
- Swords Dance

Charizard @ charizarditey
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Flamethrower
- Air Slash
- Solar Beam
- Dragon Pulse

Garchomp @ choicescarf
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Outrage
- Stone Edge
- Poison Jab

Primarina @ mysticwater
Level: 50
EVs: 32 HP / 2 Def / 32 SpA
Quiet Nature
- Sparkling Aria
- Moonblast
- Encore
- Aqua Jet

Ceruledge @ focussash
Level: 50
EVs: 1 HP / 32 Atk / 1 Def / 32 Spe
Adamant Nature
- Bitter Blade
- Poltergeist
- Close Combat
- Shadow Sneak"""

JAZZY_YARROW_TEAM = """\
Annihilape @ sitrusberry
Level: 50
EVs: 32 HP / 2 Def / 32 SpD
Careful Nature
- Rage Fist
- Drain Punch
- Taunt
- Bulk Up

Metagross @ metagrossite
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Meteor Mash
- Bullet Punch
- Thunder Punch
- Ice Punch

Snorlax @ leftovers
Level: 50
EVs: 32 HP / 32 Def / 2 SpD
Impish Nature
- Yawn
- Protect
- Ice Punch
- Earthquake

Blaziken @ blazikenite
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Flare Blitz
- Close Combat
- Swords Dance
- Thunder Punch

Basculegion @ choicescarf
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Wave Crash
- Flip Turn
- Aqua Jet
- Ice Fang

Gyarados @ gyaradosite
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Dragon Dance
- Waterfall
- Earthquake
- Ice Fang"""

SWORD828_TEAM = """\
Gyarados @ gyaradosite
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Dragon Dance
- Waterfall
- Ice Fang
- Earthquake

Meowscarada @ focussash
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Adamant Nature
- Flower Trick
- Low Kick
- Knock Off
- Night Slash

Volcarona @ sitrusberry
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Quiver Dance
- Fiery Dance
- Bug Buzz
- Giga Drain

Aegislash @ leftovers
Level: 50
EVs: 32 HP / 3 Def / 11 SpA / 20 SpD
Quiet Nature
- Shadow Ball
- Shadow Claw
- King's Shield
- Iron Head

Archaludon @ chopleberry
Level: 50
EVs: 32 HP / 2 Def / 32 SpD
Sassy Nature
- Stealth Rock
- Dragon Tail
- Aura Sphere
- Flash Cannon

Floette-Eternal @ floettite
Level: 50
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Calm Mind
- Substitute
- Psychic
- Moonblast"""


REAL_TEAMS = [
    {
        "team_id": "gray_sv",
        "label": "gray_sv (R2000.999 / M-3)",
        "members_ja": [
            "ブリジュラス", "メガハッサム", "メガリザードンY",
            "ガブリアス", "アシレーヌ", "ソウブレイズ",
        ],
        "showdown_team": GRAY_SV_TEAM,
    },
    {
        "team_id": "jazzy_yarrow",
        "label": "jazzy_yarrow (M-3 マスターボール)",
        "members_ja": [
            "コノヨザル", "メガメタグロス", "カビゴン",
            "メガバシャーモ", "イダイトウ（オスのすがた）", "メガギャラドス",
        ],
        "showdown_team": JAZZY_YARROW_TEAM,
    },
    {
        "team_id": "sword828",
        "label": "sword828 (M-2 R2000)",
        "members_ja": [
            "メガギャラドス", "マスカーニャ", "ウルガモス",
            "ギルガルド（シールドフォルム）", "ブリジュラス", "メガフラエッテ",
        ],
        "showdown_team": SWORD828_TEAM,
    },
]


def verify_ev_totals():
    """全チームのEV合計が66以下・各ステータス32以下であることを確認"""
    stat_keys = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"]
    errors = []
    for team in REAL_TEAMS:
        for block in team["showdown_team"].split("\n\n"):
            lines = block.strip().splitlines()
            poke_name = lines[0].split(" @ ")[0] if lines else "?"
            ev_line = next((l for l in lines if l.startswith("EVs:")), None)
            if not ev_line:
                continue
            ev_str = ev_line.replace("EVs:", "").strip()
            total = 0
            for part in ev_str.split("/"):
                part = part.strip()
                for k in stat_keys:
                    if part.endswith(k):
                        val = int(part.split()[0])
                        if val > 32:
                            errors.append(f"{poke_name}: {k}={val} > 32")
                        total += val
                        break
            if total > 66:
                errors.append(f"{poke_name}: total EVs={total} > 66")
    return errors


def main():
    print("=== Step E: 実R2000+構築 → Showdown形式変換 ===\n")

    errors = verify_ev_totals()
    if errors:
        print("[ERROR] EV検証失敗:")
        for e in errors:
            print(f"  {e}")
        return
    print("[OK] 全チームのEV合計・上限チェック通過\n")

    out_path = OUT_DIR / "real_mb_team_pool.json"
    out_path.write_text(
        json.dumps(REAL_TEAMS, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"保存先: {out_path}")

    print(f"\n=== チームプレビュー ===")
    for t in REAL_TEAMS:
        print(f"\n【{t['label']}】")
        print(f"メンバー: {', '.join(t['members_ja'])}")
        print(t["showdown_team"][:200] + "...")


if __name__ == "__main__":
    main()
