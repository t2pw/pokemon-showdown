import asyncio
from poke_env import RandomPlayer, LocalhostServerConfiguration

# Champions BSS Reg M-B はチーム持ち込みが必要なため、
# まず接続確認はランダムバトルで行う
RANDOM_FORMAT = "gen9championsrandombattle"
N_BATTLES = 5


async def main():
    player_1 = RandomPlayer(
        battle_format=RANDOM_FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=1,
    )
    player_2 = RandomPlayer(
        battle_format=RANDOM_FORMAT,
        server_configuration=LocalhostServerConfiguration,
        max_concurrent_battles=1,
    )

    print(f"サーバー: {LocalhostServerConfiguration.websocket_url}")
    print(f"フォーマット: {RANDOM_FORMAT}")
    print(f"{N_BATTLES}試合のテストを開始します...\n")

    try:
        await player_1.battle_against(player_2, n_battles=N_BATTLES)
    except Exception as e:
        print(f"[ERROR] 対戦中にエラーが発生しました: {e}")
        return

    print("--- 接続テスト結果 ---")
    print(f"Player 1 勝利数: {player_1.n_won_battles} / {N_BATTLES}")
    print(f"Player 2 勝利数: {player_2.n_won_battles} / {N_BATTLES}")
    print(f"完了した対戦数: {player_1.n_finished_battles}")

    if player_1.n_finished_battles == N_BATTLES:
        print("\n[OK] ローカルサーバーへの接続・対戦が正常に動作しています。")
    else:
        print("\n[WARN] 一部の対戦が完了しませんでした。")


if __name__ == "__main__":
    asyncio.run(main())
