# legacy — 2026-06の旧Python分析一式

リポジトリルートに散在していた初期の研究スクリプトと出力を 2026-07-07 にここへ移動した。
**現行のJSツール群(`research/tools/`)はこのフォルダを一切参照しない。**
経緯は `research/RESEARCH_PROGRESS.md` を参照。

## 内容

- `analyze_meta.py` / `analyze_humandata.py` — 静的メタ解析(出力: `analysis_output/`)
- `build_bss_teams.py` / `build_real_mb_teams.py` — シミュレーション用チームプール生成
- `simulate_battles.py` / `simulate_bss.py` / `test_battle.py` — 初期の対戦シミュレーション
- `fetch_jp_names.py` — 日本語名対応表の生成(出力は `research/data/jp_names_cache.json` へ移動済み)
- `battle_stats.*` / `bss_regmb_pokemon*.csv` — 上記の出力スナップショット
- `analysis_output/` — 静的解析の出力(アイテム対応表2つのみ `research/data/` へ移動済み)

## 注意

- スクリプトはリポジトリルートからの相対パス(`humandata/`、`analysis_output/`、
  `jp_names_cache.json` 等)を前提に書かれていた。**移動後のパスでは動かない**。
  再実行が必要になったらパスを書き換えること(基本的には再実行せず、
  現行ツールで置き換える)。
- `humandata/` は `research/data/humandata/` へ移動した(usage/ CSVの旧スナップショット)。
