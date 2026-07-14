# 1v1マッチアップ行列 レポート

生成日時: 2026-07-09T08:21:39.387Z  
ポリシーバージョン: v0.2  
N (試行数/ペア): 500  
チームファイル: research/teams/v2-blaziken-speed.txt  

> **注意**: これは校正済みポリシー同士の勝率であり、上手い人間同士の近似にすぎない。
> ポリシーの校正状況・限界については DESIGN_SIM.md「リスクと限界」節を参照。

## ポリシーv0 重み (未校正・初期値)

| 重み変数 | 値 | 意味 |
|---|---|---|
| W_RANK | 0.15 | |
| W_STATUS_SLEEP | 0.3 | |
| W_STATUS_PARA | 0.1 | |
| W_STATUS_BURN | 0.12 | |
| W_STATUS_POISON | 0.08 | |
| W_STATUS_FREEZE | 0.15 | |
| W_PROTECT_PENALTY | -0.5 | |
| W_SETUP_SAFE | 0.35 | |
| W_RECOVERY | 0.25 | |

## 勝率表 (自軍 × メタセット)

セル形式: **勝率% (95%CI下限-上限)**

| 自軍\相手 | garchomp_s0 | garchomp_s1 | garchomp_s2 | garchomp_s3 | archaludon_s0 | archaludon_s1 | archaludon_s2 | archaludon_s3 | lopunny_s0 | lopunny_s1 | lopunny_s2 | basculegion_s0 | basculegion_s1 | basculegion_s2 | hippowdon_s0 | hippowdon_s1 | hippowdon_s2 | mimikyu_s0 | mimikyu_s1 | mimikyu_s2 | mimikyu_s3 | meowscarada_s0 | meowscarada_s1 | floetteeternal_s0 | floetteeternal_s1 | floetteeternal_s2 | primarina_s0 | primarina_s1 | primarina_s2 | corviknight_s0 | corviknight_s1 | aegislash_s0 | aegislash_s1 | aegislash_s2 | delphox_s0 | delphox_s1 | delphox_s2 | gyarados_s0 | gyarados_s1 | gyarados_s2 | glimmora_s0 | glimmora_s1 | glimmora_s2 | samurotthisui_s0 | samurotthisui_s1 | samurotthisui_s2 | metagross_s0 | metagross_s1 | metagross_s2 | charizard_s0 | charizard_s1 | charizard_s2 | raichu_s0 | raichu_s1 | blaziken_s0 | ninetalesalola_s0 | ninetalesalola_s1 | ninetalesalola_s2 | hydreigon_s0 | hydreigon_s1 | staraptor_s0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| blaziken | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **95.8%** (94.0-97.6) | **100.0%** (100.0-100.0) | **81.2%** (77.8-84.6) | **81.4%** (78.0-84.8) | **95.8%** (94.0-97.6) | **0.0%** (0.0-0.0) | **5.2%** (3.3-7.1) | **0.0%** (0.0-0.0) | **0.2%** (0.0-0.6) | **8.6%** (6.1-11.1) | **0.8%** (0.0-1.6) | **84.4%** (81.2-87.6) | **96.8%** (95.3-98.3) | **85.8%** (82.7-88.9) | **87.4%** (84.5-90.3) | **100.0%** (100.0-100.0) | **90.0%** (87.4-92.6) | **4.6%** (2.8-6.4) | **48.4%** (44.0-52.8) | **3.6%** (2.0-5.2) | **4.8%** (2.9-6.7) | **5.2%** (3.3-7.1) | **5.0%** (3.1-6.9) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **96.2%** (94.5-97.9) | **48.4%** (44.0-52.8) | **48.6%** (44.2-53.0) | **37.4%** (33.2-41.6) | **4.8%** (2.9-6.7) | **100.0%** (100.0-100.0) | **5.0%** (3.1-6.9) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **5.0%** (3.1-6.9) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **84.0%** (80.8-87.2) | **84.0%** (80.8-87.2) | **42.8%** (38.5-47.1) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **96.4%** (94.8-98.0) | **95.8%** (94.0-97.6) | **0.0%** (0.0-0.0) |
| corviknight | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **95.8%** (94.0-97.6) | **95.8%** (94.0-97.6) | **99.8%** (99.4-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **1.8%** (0.6-3.0) | **83.8%** (80.6-87.0) | **84.8%** (81.7-87.9) | **100.0%** (100.0-100.0) | **8.6%** (6.1-11.1) | **12.6%** (9.7-15.5) | **3.0%** (1.5-4.5) | **8.0%** (5.6-10.4) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **49.6%** (45.2-54.0) | **82.6%** (79.3-85.9) | **0.0%** (0.0-0.0) | **79.4%** (75.9-82.9) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **78.0%** (74.4-81.6) | **77.0%** (73.3-80.7) | **91.2%** (88.7-93.7) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **99.0%** (98.1-99.9) | **9.0%** (6.5-11.5) | **99.4%** (98.7-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.2%** (0.0-0.6) | **98.4%** (97.3-99.5) | **1.0%** (0.1-1.9) | **97.4%** (96.0-98.8) | **0.0%** (0.0-0.0) | **25.2%** (21.4-29.0) | **100.0%** (100.0-100.0) |
| primarina | **40.4%** (36.1-44.7) | **96.6%** (95.0-98.2) | **90.2%** (87.6-92.8) | **96.2%** (94.5-97.9) | **98.0%** (96.8-99.2) | **97.8%** (96.5-99.1) | **98.8%** (97.8-99.8) | **98.4%** (97.3-99.5) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **95.8%** (94.0-97.6) | **85.6%** (82.5-88.7) | **95.6%** (93.8-97.4) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **26.2%** (22.3-30.1) | **69.6%** (65.6-73.6) | **27.6%** (23.7-31.5) | **27.2%** (23.3-31.1) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **52.6%** (48.2-57.0) | **37.6%** (33.4-41.8) | **55.0%** (50.6-59.4) | **50.2%** (45.8-54.6) | **51.8%** (47.4-56.2) | **52.0%** (47.6-56.4) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **85.0%** (81.9-88.1) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **94.6%** (92.6-96.6) | **94.0%** (91.9-96.1) | **93.4%** (91.2-95.6) | **77.4%** (73.7-81.1) | **2.4%** (1.1-3.7) | **96.4%** (94.8-98.0) | **7.0%** (4.8-9.2) | **80.6%** (77.1-84.1) | **0.0%** (0.0-0.0) | **97.8%** (96.5-99.1) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **2.0%** (0.8-3.2) | **0.0%** (0.0-0.0) | **8.4%** (6.0-10.8) | **8.2%** (5.8-10.6) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **99.6%** (99.0-100.0) | **99.8%** (99.4-100.0) | **99.2%** (98.4-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **95.6%** (93.8-97.4) |
| garchomp | **51.4%** (47.0-55.8) | **90.2%** (87.6-92.8) | **38.8%** (34.5-43.1) | **45.0%** (40.6-49.4) | **70.6%** (66.6-74.6) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **3.8%** (2.1-5.5) | **21.6%** (18.0-25.2) | **3.8%** (2.1-5.5) | **79.8%** (76.3-83.3) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **13.2%** (10.2-16.2) | **2.2%** (0.9-3.5) | **10.0%** (7.4-12.6) | **10.2%** (7.5-12.9) | **10.2%** (7.5-12.9) | **10.0%** (7.4-12.6) | **84.2%** (81.0-87.4) | **90.0%** (87.4-92.6) | **51.2%** (46.8-55.6) | **100.0%** (100.0-100.0) | **49.0%** (44.6-53.4) | **60.4%** (56.1-64.7) | **59.8%** (55.5-64.1) | **59.0%** (54.7-63.3) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **90.2%** (87.6-92.8) | **96.2%** (94.5-97.9) | **90.6%** (88.0-93.2) | **93.0%** (90.8-95.2) | **100.0%** (100.0-100.0) | **0.4%** (0.0-1.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **18.6%** (15.2-22.0) | **96.2%** (94.5-97.9) | **100.0%** (100.0-100.0) | **42.2%** (37.9-46.5) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **99.8%** (99.4-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **88.8%** (86.0-91.6) | **86.6%** (83.6-89.6) | **89.8%** (87.1-92.5) |
| archaludon | **0.0%** (0.0-0.0) | **86.6%** (83.6-89.6) | **63.6%** (59.4-67.8) | **61.0%** (56.7-65.3) | **24.2%** (20.4-28.0) | **23.6%** (19.9-27.3) | **26.8%** (22.9-30.7) | **69.6%** (65.6-73.6) | **18.6%** (15.2-22.0) | **17.8%** (14.4-21.2) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **98.6%** (97.6-99.6) | **99.8%** (99.4-100.0) | **64.2%** (60.0-68.4) | **14.6%** (11.5-17.7) | **10.4%** (7.7-13.1) | **100.0%** (100.0-100.0) | **98.6%** (97.6-99.6) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.6%** (0.0-1.3) | **32.2%** (28.1-36.3) | **0.6%** (0.0-1.3) | **0.8%** (0.0-1.6) | **2.6%** (1.2-4.0) | **2.6%** (1.2-4.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **71.2%** (67.2-75.2) | **73.6%** (69.7-77.5) | **0.6%** (0.0-1.3) | **1.6%** (0.5-2.7) | **1.6%** (0.5-2.7) | **0.8%** (0.0-1.6) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **88.0%** (85.2-90.8) | **0.0%** (0.0-0.0) | **0.4%** (0.0-1.0) | **22.2%** (18.6-25.8) | **42.6%** (38.3-46.9) | **92.6%** (90.3-94.9) | **70.8%** (66.8-74.8) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **77.8%** (74.2-81.4) | **0.0%** (0.0-0.0) | **1.2%** (0.2-2.2) | **68.4%** (64.3-72.5) | **4.2%** (2.4-6.0) | **4.2%** (2.4-6.0) | **86.0%** (83.0-89.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **93.4%** (91.2-95.6) | **92.4%** (90.1-94.7) | **6.0%** (3.9-8.1) |
| gengar | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **33.4%** (29.3-37.5) | **29.2%** (25.2-33.2) | **59.6%** (55.3-63.9) | **12.2%** (9.3-15.1) | **80.0%** (76.5-83.5) | **13.0%** (10.1-15.9) | **74.4%** (70.6-78.2) | **48.4%** (44.0-52.8) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **14.4%** (11.3-17.5) | **22.8%** (19.1-26.5) | **100.0%** (100.0-100.0) | **47.2%** (42.8-51.6) | **100.0%** (100.0-100.0) | **68.6%** (64.5-72.7) | **70.0%** (66.0-74.0) | **68.6%** (64.5-72.7) | **100.0%** (100.0-100.0) | **98.6%** (97.6-99.6) | **4.2%** (2.4-6.0) | **4.2%** (2.4-6.0) | **4.0%** (2.3-5.7) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **36.6%** (32.4-40.8) | **82.2%** (78.8-85.6) | **82.4%** (79.1-85.7) | **91.4%** (88.9-93.9) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **4.6%** (2.8-6.4) | **94.0%** (91.9-96.1) | **94.0%** (91.9-96.1) | **93.8%** (91.7-95.9) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **100.0%** (100.0-100.0) | **13.0%** (10.1-15.9) | **10.8%** (8.1-13.5) | **4.0%** (2.3-5.7) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **100.0%** (100.0-100.0) | **0.0%** (0.0-0.0) | **0.0%** (0.0-0.0) | **3.0%** (1.5-4.5) |

## 自軍各体のメタ加重勝率

セット重み × 採用率(全種均等1/15として近似)で加重平均。

| 自軍ポケモン | 加重勝率% | 95%CI |
|---|---|---|
| blaziken | 52.6% | ±0.3% |
| corviknight | 47.5% | ±0.2% |
| primarina | 67.0% | ±0.3% |
| garchomp | 66.5% | ±0.3% |
| archaludon | 42.4% | ±0.3% |
| gengar | 34.7% | ±0.3% |

## メタセット一覧 (カラム対応)

| キー | 種族 | 重み | 技構成 |
|---|---|---|---|
| garchomp_s0 | garchomp | 0.42 | Earthquake, Scale Shot, Stealth Rock, Rock Tomb |
| garchomp_s1 | garchomp | 0.25 | Earthquake, Outrage, Rock Slide, Scale Shot |
| garchomp_s2 | garchomp | 0.20 | Earthquake, Dragon Tail, Stealth Rock, Spikes |
| garchomp_s3 | garchomp | 0.13 | Earthquake, Dragon Tail, Stealth Rock, Spikes |
| archaludon_s0 | archaludon | 0.38 | Draco Meteor, Flash Cannon, Dragon Tail, Stealth Rock |
| archaludon_s1 | archaludon | 0.24 | Draco Meteor, Flash Cannon, Roar, Stealth Rock |
| archaludon_s2 | archaludon | 0.24 | Draco Meteor, Flash Cannon, Dragon Pulse, Stealth Rock |
| archaludon_s3 | archaludon | 0.14 | Draco Meteor, Flash Cannon, Dragon Pulse, Snarl |
| lopunny_s0 | Lopunny-Mega | 0.40 | Fake Out, High Jump Kick, Ice Punch, U-turn |
| lopunny_s1 | Lopunny-Mega | 0.30 | Fake Out, High Jump Kick, Triple Axel, Swords Dance |
| lopunny_s2 | Lopunny-Mega | 0.30 | Fake Out, Close Combat, Ice Punch, Mach Punch |
| basculegion_s0 | basculegion | 0.40 | Last Respects, Wave Crash, Aqua Jet, Flip Turn |
| basculegion_s1 | basculegion | 0.40 | Last Respects, Wave Crash, Aqua Jet, Flip Turn |
| basculegion_s2 | basculegion | 0.20 | Agility, Wave Crash, Last Respects, Aqua Jet |
| hippowdon_s0 | hippowdon | 0.40 | Earthquake, Yawn, Stealth Rock, Slack Off |
| hippowdon_s1 | hippowdon | 0.35 | Earthquake, Yawn, Stealth Rock, Protect |
| hippowdon_s2 | hippowdon | 0.25 | Earthquake, Yawn, Stealth Rock, Whirlwind |
| mimikyu_s0 | mimikyu | 0.50 | Swords Dance, Play Rough, Shadow Sneak, Shadow Claw |
| mimikyu_s1 | mimikyu | 0.17 | Swords Dance, Play Rough, Shadow Sneak, Shadow Claw |
| mimikyu_s2 | mimikyu | 0.18 | Swords Dance, Play Rough, Shadow Sneak, Trick Room |
| mimikyu_s3 | mimikyu | 0.15 | Swords Dance, Play Rough, Shadow Sneak, Curse |
| meowscarada_s0 | meowscarada | 0.70 | Flower Trick, Triple Axel, U-turn, Knock Off |
| meowscarada_s1 | meowscarada | 0.30 | Flower Trick, Knock Off, Sucker Punch, Thunder Punch |
| floetteeternal_s0 | Floette-Mega | 0.55 | Moonblast, Draining Kiss, Calm Mind, Substitute |
| floetteeternal_s1 | Floette-Mega | 0.25 | Light of Ruin, Psychic, Calm Mind, Wish |
| floetteeternal_s2 | Floette-Mega | 0.20 | Moonblast, Calm Mind, Baton Pass, Substitute |
| primarina_s0 | primarina | 0.40 | Sparkling Aria, Moonblast, Aqua Jet, Encore |
| primarina_s1 | primarina | 0.35 | Sparkling Aria, Moonblast, Aqua Jet, Calm Mind |
| primarina_s2 | primarina | 0.25 | Sparkling Aria, Moonblast, Flip Turn, Encore |
| corviknight_s0 | corviknight | 0.70 | Body Press, U-turn, Iron Defense, Roost |
| corviknight_s1 | corviknight | 0.30 | Iron Head, Body Press, Iron Defense, Roost |
| aegislash_s0 | aegislash | 0.55 | Shadow Claw, Sacred Sword, Shadow Sneak, King's Shield |
| aegislash_s1 | aegislash | 0.20 | Shadow Claw, Sacred Sword, Shadow Sneak, King's Shield |
| aegislash_s2 | aegislash | 0.25 | Shadow Ball, Flash Cannon, King's Shield, Substitute |
| delphox_s0 | Delphox-Mega | 0.40 | Flamethrower, Psychic, Nasty Plot, Substitute |
| delphox_s1 | Delphox-Mega | 0.35 | Flamethrower, Psyshock, Nasty Plot, Encore |
| delphox_s2 | Delphox-Mega | 0.25 | Flamethrower, Psychic, Substitute, Encore |
| gyarados_s0 | Gyarados-Mega | 0.42 | Waterfall, Dragon Dance, Earthquake, Ice Fang |
| gyarados_s1 | Gyarados-Mega | 0.30 | Waterfall, Dragon Dance, Earthquake, Power Whip |
| gyarados_s2 | gyarados | 0.28 | Waterfall, Ice Fang, Taunt, Dragon Dance |
| glimmora_s0 | glimmora | 0.42 | Power Gem, Earth Power, Stealth Rock, Sludge Wave |
| glimmora_s1 | glimmora | 0.36 | Power Gem, Earth Power, Stealth Rock, Energy Ball |
| glimmora_s2 | Glimmora-Mega | 0.22 | Power Gem, Sludge Wave, Earth Power, Stealth Rock |
| samurotthisui_s0 | samurotthisui | 0.40 | Ceaseless Edge, Razor Shell, Sacred Sword, Sucker Punch |
| samurotthisui_s1 | samurotthisui | 0.35 | Ceaseless Edge, Razor Shell, Sacred Sword, Sucker Punch |
| samurotthisui_s2 | samurotthisui | 0.25 | Ceaseless Edge, Razor Shell, Sacred Sword, Flip Turn |
| metagross_s0 | Metagross-Mega | 0.55 | Psychic Fangs, Bullet Punch, Earthquake, Ice Punch |
| metagross_s1 | Metagross-Mega | 0.25 | Psychic Fangs, Bullet Punch, Earthquake, Thunder Punch |
| metagross_s2 | Metagross-Mega | 0.20 | Psychic Fangs, Bullet Punch, Ice Punch, Iron Head |
| charizard_s0 | Charizard-Mega-Y | 0.45 | Flamethrower, Weather Ball, Solar Beam, Air Slash |
| charizard_s1 | Charizard-Mega-Y | 0.30 | Flamethrower, Weather Ball, Solar Beam, Overheat |
| charizard_s2 | Charizard-Mega-Y | 0.25 | Weather Ball, Solar Beam, Roost, Dragon Pulse |
| raichu_s0 | Raichu-Mega-Y | 0.55 | Zap Cannon, Focus Blast, Grass Knot, Substitute |
| raichu_s1 | Raichu-Mega-Y | 0.45 | Zap Cannon, Focus Blast, Alluring Voice, Grass Knot |
| blaziken_s0 | Blaziken-Mega | 1.00 | Protect, Swords Dance, Flare Blitz, Close Combat |
| ninetalesalola_s0 | ninetalesalola | 0.40 | Aurora Veil, Freeze-Dry, Moonblast, Encore |
| ninetalesalola_s1 | ninetalesalola | 0.30 | Aurora Veil, Freeze-Dry, Blizzard, Encore |
| ninetalesalola_s2 | ninetalesalola | 0.30 | Aurora Veil, Freeze-Dry, Moonblast, Pain Split |
| hydreigon_s0 | hydreigon | 0.60 | Dark Pulse, Draco Meteor, Flamethrower, U-turn |
| hydreigon_s1 | hydreigon | 0.40 | Dark Pulse, Draco Meteor, Fire Blast, U-turn |
| staraptor_s0 | Staraptor-Mega | 1.00 | Close Combat, Brave Bird, Roost, Quick Attack |
