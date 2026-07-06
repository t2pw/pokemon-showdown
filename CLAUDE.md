# このリポジトリについて

pokemon-showdown のフォーク。**Champions BSS Reg M-B のパーティ研究・相談**に使っている。
Showdown本体のコード変更が目的ではない。

## セッション開始時に読むもの

- `research/README.md` — 運用ルール(スクレイピング禁止等)と検証済みのChampions仕様
- `research/DESIGN.md` — 分析ツールの実装仕様(実装タスクの場合)
- `research/teams/` + `party_notes_for_claude.md` — 現在のチームと議論の経緯

## 最重要の事実

- フォーマットID: `gen9championsbssregmb`。実数値計算は本編と全く異なる
  (HP = 種族値+SP+75、他 = (種族値+SP+20)×性格。詳細は research/README.md)。
- 一般のダメージ計算サイト・本編BSSの経験則はそのまま使えない。
- チーム合法性チェック: `node pokemon-showdown validate-team gen9championsbssregmb < チームファイル`

## 運用ルール

- 個人サイトへの自動スクレイピング禁止(WebSearch/WebFetchの個別参照のみ可)
- 新しい実装・データ収集手法は着手前に方針を提示してユーザー確認を取る
- チーム変更は `research/teams/CHANGELOG.md` に理由を記録する
