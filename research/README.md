# Champions BSS Reg M-B 研究フォルダ

パーティ構築・選出方針の相談を、正確なデータに基づいて行うための作業フォルダ。
実装仕様は [DESIGN.md](DESIGN.md) を参照。

## フォルダ構成

```
research/
  README.md        このファイル(規約・運用ルール)
  DESIGN.md        ツール実装仕様書(Opus/Sonnetセッション向け)
  DESIGN_SIM.md    シミュレーション評価系(ツール7〜9)の設計案
  party_notes_for_claude.md  パーティ議論の経緯・検討済み案・未解決の論点
  RESEARCH_PROGRESS.md       シミュレーション研究の進捗ログ
  usage/           使用率データ(手動エクスポートしたCSVを置く)
  teams/           チーム定義(Showdownエクスポート形式)+ CHANGELOG.md
  tools/           分析スクリプト(DESIGN.mdの仕様に従って実装)
  data/            ツールが読むデータ(meta_sets.json、日本語名対応表、
                   humandata/ = 上位構築の旧JSONスナップショット)
  legacy/          2026-06の旧Python分析一式(スクリプト+出力。現行ツールは
                   使っていない。再実行時はパスの書き換えが必要な点に注意)
```

## 運用ルール(重要)

1. **スクレイピング禁止**: ポケモンバトルデータベース等の個人サイトへのプログラムによる
   自動アクセスは行わない。データはユーザーが手動でエクスポートして `usage/` に置く。
   WebSearch / WebFetch での個別ページ参照のみ可。
2. **実装前に方針確認**: 新しいデータ収集手法や大規模変更は、実装前に方針を提示して
   ユーザーの確認を取る。
3. **チーム変更は履歴を残す**: チームを変えるときは新しいバージョンのファイルを作り、
   `teams/CHANGELOG.md` に「何を・なぜ変えたか」を1行以上で記録する。

## 上位構築CSVの規約 (`usage/`)

データ源はポケモンバトルデータベースの上位構築スプレッドシート(ユーザーが手動エクスポート)。
**使用率の集計値ではなく、構築単位のデータ**。使用率・同時採用率・持ち物分布は読み込み側で導出する。

- ファイル名: `s{シーズン}_single_ranked_teams_YYYY-MM-DD.csv`(エクスポート日)。最新日付を正とする。
- 文字コード: UTF-8(BOM付きの場合あり — 読み込み時に `utf-8-sig` を使う)
- 実際の列構成(2026-07-06のS2データで確認):
  - `順位`, `レート`
  - 各スロット i=1..6 について: `ポケモンID_i`(全国図鑑No-フォルムNo、例 `0670-05`)、
    `ポケモン_i`(日本語名)、`フォルム_i`、`タイプ1_i`、`タイプ2_i`、`カテゴリー_i`、
    `テラスタイプ_i`(Championsでは空)、`持ち物_i`(日本語名、例 `ハッサムナイト`)
- 日本語名→英名は種が `tools/species_ja_map.json`(補助: `data/jp_names_cache.json`)、
  アイテムは `data/ja_item_map_raw.json` / `data/mega_stone_map.json` /
  `tools/item_ja_map_extra.json` を利用。
- 同一データの旧スナップショット(JSON)が `data/humandata/s2_single_ranked_teams.json` にある。

## データ取得についての制約(2026-07-06確認)

`champs.pokedb.tokyo/robots.txt` は **ClaudeBot / Claude-SearchBot をサイト全体で拒否**している
(GPTBot等の主要AIボットも同様)。したがってClaudeによるWebFetchでの直接参照も不可。
最新データの取得は必ずユーザーの手動エクスポート経由で行い、UAを偽装した回避は行わない。

## Champions BSS Reg M-B の基本事実(検証済み)

- フォーマットID: `gen9championsbssregmb`(mod: `champions`, ルール: Flat Rules + VGC Timer)
- **実数値計算は本編と全く異なる**(レベル非依存)。`data/mods/champions/scripts.ts` の `statModify`:
  - HP = 種族値 + Stat Points + 75
  - その他 = (種族値 + Stat Points + 20) × 性格補正(1.1 / 0.9)
  - Stat Points: 1ステータス最大32、合計66。個体値は全31固定。
- **全ての技のPPは最大20に制限される**(champions mod の init で一律キャップ)
- **状態異常の仕様が本編と異なる**(`data/mods/champions/conditions.ts`、2026-07-06検証):
  - ねむり: 行動不能は **1ターン(1/3)か2ターン(2/3)、最大2ターン**(期待値5/3 ≒ 1.67)。
    本編の1〜3ターン均等(期待値2)より短い
  - まひ: 行動不能は **1/8 (12.5%)**(本編25%の半分)。素早さ半減は本編どおり
  - こおり: カウンタ3ターン+毎ターン1/4で解除(本編と異なる)
- 禁止アイテム: こだわりハチマキ/メガネ、とつげきチョッキ、ゴツゴツメット、あつぞこブーツ
  (こだわりスカーフ、たべのこし、オボン、きあいのタスキ、いのちのたま、メガストーンは使用可)
- Item Clause = 1(パーティ内でアイテム重複禁止)
- 2026-06-24 の「Mega Blaziken / Light Clay BAN」は **Champions OU(Smogonティア)のみ**。
  BSS Reg M-B はゲーム内Flat Rules準拠なのでメガバシャーモは使用可(validator で確認済み)。
- 固有仕様: ゴールドラッシュは命中95・特攻2段階下降、ふんどのこぶしは交代で威力リセット、
  メタグロスにヘビーボンバーなし、オーロンゲにでんじはなし。

## よく使うコマンド

```bash
# チームの合法性チェック(exit 0 = 合法)
node pokemon-showdown validate-team gen9championsbssregmb < research/teams/v1-blaziken-core.txt

# upstream を pull したあとは再ビルド(dist/ が古いと検証結果がずれる)
node build
```

## 関連ファイル

- `party_notes_for_claude.md` — パーティ議論の経緯・検討済み案・未解決の論点
- `legacy/` — 2026-06の旧Python分析(スクリプト+ `legacy/analysis_output/` の出力)
- `RESEARCH_PROGRESS.md` — シミュレーション研究の進捗ログ
- `data/jp_names_cache.json` — 日本語名 → 英語名の対応表
