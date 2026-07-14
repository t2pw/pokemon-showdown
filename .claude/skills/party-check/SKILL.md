---
name: party-check
description: Champions BSS Reg M-Bのパーティ相談を行う前の定型準備(最新データ読み込み・合法性検証・脅威分析)を実行し、統一フォーマットで選出案を出す
---

Champions BSS Reg M-B（`gen9championsbssregmb`）のパーティ相談で、毎回同じ準備を
確実に行うための手順。research/DESIGN.md ツール5の仕様に基づく。

このスキルが呼ばれたら、以下を**すべて**実行してから相談の応答を作ること。
既存ツール（ツール1〜3）は完成済みなので式を再実装せず必ず呼び出す。

## 手順

### 1. 前提データを読む
- `research/usage/` 内で最新日付の `s{N}_single_ranked_teams_YYYY-MM-DD.csv`
  （`research/tools/load_top_teams.js` の `findLatestCsv()` が自動選択する）
- `research/teams/` 内で最新のチームファイル（`.txt`）
- `research/party_notes_for_claude.md`（ユーザーの議論の経緯・懸念事項）
- `research/teams/CHANGELOG.md`（確定済み/提案中の区別、未解決の論点）

これらを読まずに相談に応じない。特にCHANGELOGの「未解決の論点」は
毎回の相談で解消状況を更新すること。

### 2. チームの合法性を検証する
```
node pokemon-showdown validate-team gen9championsbssregmb < research/teams/<最新ファイル>
```
exit 0 以外（違反あり）の場合は、相談の本題に入る前に必ず報告する。

### 3. 上位脅威と自軍の相性を数値で確認する
- `node research/tools/load_top_teams.js` で採用率上位を確認（デフォルトで上位20件表示、
  必要なら `--min-rating` で高レート帯に絞る）。上位15体程度を「主要脅威」として扱う。
- 素早さ関係: `research/speed_tiers.md` を読む（古ければ
  `node research/tools/speed_tiers.js` を再実行して最新化）。自軍6体 vs 上位脅威の
  実速度・スカーフ/積み後の逆転可能性を確認する。
- 主要ダメージライン: 自軍の主要技 vs 上位脅威、および上位脅威の主要技 vs 自軍について
  `research/tools/damage_calc.js` で確定数・乱数幅を計算する。例:
  ```
  node research/tools/damage_calc.js --attacker Garchomp --attacker-nature Jolly \
    --attacker-sp 2,32,0,0,0,32 --attacker-ability "Rough Skin" --attacker-item "Focus Sash" \
    --defender Hippowdon --defender-nature Impish --defender-sp 32,0,32,0,2,0 \
    --defender-ability "Sand Stream" --defender-item Leftovers --move Earthquake
  ```
  攻撃側・受け側とも自軍/相手の実際のセット(性格・SP・アイテム・特性)に合わせて呼ぶこと。
  相手のセットが不明な場合は上位構築CSVで見られる典型セットを仮定し、その旨を明記する。
- 一方的な推測でなく、上記3ツールが返した具体的な数値（実速度・ダメージ%・確定/乱数N発）
  を根拠として引用すること。

### 4. 出力フォーマット
相談の応答は以下の3部構成にする:

**(a) 上位脅威ごとの有利/不利と根拠数値**
上位脅威（上位15体目安）ごとに、自軍のどのポケモンで対応するか、有利/不利/五分の
判定と、その根拠となる素早さ・ダメージの具体的な数値を書く。

**(b) 想定される相手の並びごとの選出案**
想定される相手の6体（またはその一部）に対して、自軍から3体を選ぶ選出案と、
簡潔なゲームプラン（先発・対面の崩し方・詰み筋）を書く。複数の相手パターンがあれば
パターンごとに分ける。

**(c) 未解決の論点リスト**
今回の相談で解消しなかった疑問・要検証事項を列挙する。次回の相談やCHANGELOG更新の
種にする。

## 注意
- `research/tools/*.js` は `dist/sim` を直接読み込むため、upstreamをpullした後は
  `node build` を実行してから使うこと（さもないと計算結果が古い仕様のままになる）。
- 使用率データは「上位構築内の採用率」であり、ラダー全体の使用率ではない。
  出力で使う際は母数（例: 上位222構築中）を明記する。
- 個人サイト（champs.pokedb.tokyo等）への自動アクセスは行わない
  （research/README.md の運用ルール、robots.txt でClaudeBot等が拒否されていることを確認済み）。
- チーム変更を提案・確定した場合は `research/teams/CHANGELOG.md` に理由を記録する
  （このスキル自体はCHANGELOGを自動更新しない — 別途Edit/Writeで反映すること）。
