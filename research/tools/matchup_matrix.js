'use strict';
/**
 * フェーズ7b: 1v1マッチアップ行列 v0
 * research/DESIGN_SIM.md ツール7
 *
 * 自軍6体 × メタセット全46セット(meta_sets.json)の1v1勝率行列を生成する。
 * バトル駆動: gen9championscustomgame + battle.makeChoices() 直接駆動(BattleStream不使用)。
 * ポリシーv0: 両者同一・完全情報・貪欲+ルールの手順。
 *
 * ポリシーv0 重み (校正対象・初期値はClaude仮置き — 変更時は POLICY_VERSION を上げること):
 *   W_RANK          = 0.15   ランク変化1段階あたりの価値 (自軍HP%換算の補正単位)
 *   W_STATUS_SLEEP  = 0.30   眠り付与の価値 (Champions: 期待1.67ターン、本編2より低め)
 *   W_STATUS_PARA   = 0.10   まひ付与の価値 (Champions: 12.5%行動不能、本編25%より低め)
 *   W_STATUS_BURN   = 0.12   やけど付与の価値 (物理攻撃半減+1/16残ダメ/ターン)
 *   W_STATUS_POISON = 0.08   どく付与の価値 (1/8残ダメ/ターン)
 *   W_STATUS_FREEZE = 0.15   こおり付与の価値 (Champions固有: 3ターン+1/4確率解除)
 *   W_PROTECT_PENALTY = -0.50  まもる連続使用ペナルティ (requestでdisabledにならないため手動管理)
 *   W_SETUP_SAFE    = 0.25   積み技の価値(安全に積める場合)
 *   W_RECOVERY      = 0.20   回復技の価値(HP閾値を下回っている場合)
 *
 * 使い方:
 *   node research/tools/matchup_matrix.js [--n 500] [--team <path>]
 *     [--only <speciesId>] [--out <path>] [--report] [--seed-base 0]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const META_SETS_PATH = path.join(__dirname, '..', 'data', 'meta_sets.json');
const SIM_CONFIG_PATH = path.join(__dirname, '..', 'data', 'sim_config.json');
const DEFAULT_TEAM_PATH = path.join(__dirname, '..', 'teams', 'v2-blaziken-speed.txt');
const DEFAULT_OUT_PATH = path.join(__dirname, '..', 'data', 'matchup_matrix.json');
const DEFAULT_REPORT_PATH = path.join(__dirname, '..', 'data', 'matchup_matrix_report.md');

// ---------------------------------------------------------------------------
// ポリシーv0 定数 (校正対象。初期値はClaude仮置き)
// ---------------------------------------------------------------------------
const POLICY_VERSION = 'v0.2';
const W_RANK = 0.15;
const W_STATUS_SLEEP = 0.30;
const W_STATUS_PARA = 0.10;
const W_STATUS_BURN = 0.12;
const W_STATUS_POISON = 0.08;
const W_STATUS_FREEZE = 0.15;
const W_PROTECT_PENALTY = -0.50;
const W_SETUP_SAFE = 0.35;   // v0.1: 正規化後のスコール(0-1)に対して積みが競合できるよう引き上げ
const W_RECOVERY = 0.25;     // v0.1: 正規化後スケールでの回復価値

const FORMAT_ID = 'gen9championscustomgame';
const LEVEL = 50;
const MAX_TURNS = 200;

// まもる系技のIDセット (request ではdisabledにならないため手動判定)
const STALLING_MOVES = new Set([
  'protect', 'kingsshield', 'banefulbunker', 'spikyshield', 'craftyshield',
  'silktrap', 'obstruct', 'detect', 'endure', 'wideguard', 'quickguard', 'matblock',
]);

// ---------------------------------------------------------------------------
// Sim / Dex ロード
// ---------------------------------------------------------------------------

let SimCache = null;
let DexCache = null;

function getSim() {
  if (!SimCache) {
    try {
      SimCache = require(path.join(ROOT, 'dist', 'sim'));
    } catch (e) {
      throw new Error(`dist/sim が読み込めません。'node build' を実行してください。(${e.message})`);
    }
  }
  return SimCache;
}

function getDex() {
  if (!DexCache) {
    const Sim = getSim();
    DexCache = Sim.Dex.mod('champions');
  }
  return DexCache;
}

// ---------------------------------------------------------------------------
// CLI引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'report' || key === 'verbose') { out[key] = true; continue; }
    out[key] = argv[++i];
  }
  return out;
}

// ---------------------------------------------------------------------------
// meta_sets.json 正規化 (move_value.js の normalizeMetaEntry と同一)
// ---------------------------------------------------------------------------

function loadMetaSets() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(META_SETS_PATH, 'utf8'));
  } catch (e) {
    throw new Error(`meta_sets.json が読み込めません(${e.message})`);
  }
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('_')) continue;
    out[key] = value;
  }
  return out;
}

function normalizeMetaEntry(speciesId, entry) {
  if (Array.isArray(entry.sets)) {
    return entry.sets.map(s => ({
      weight: s.weight,
      setConfig: {
        species: s.battleSpecies || entry.battleSpecies || speciesId,
        ability: s.ability,
        item: s.item,
        nature: s.nature,
        sp: s.sp,
      },
      moves: s.moves || [],
      source: s.source || '',
    }));
  }
  return [{
    weight: 1.0,
    setConfig: {
      species: entry.battleSpecies || speciesId,
      ability: entry.ability,
      item: entry.item,
      nature: entry.nature,
      sp: entry.sp,
    },
    moves: entry.moves || [],
    source: entry.source || '',
  }];
}

// ---------------------------------------------------------------------------
// チームパーサ (speed_tiers.js の parseShowdownTeam と同一)
// ---------------------------------------------------------------------------

const STAT_ABBR_REV = { HP: 'hp', Atk: 'atk', Def: 'def', SpA: 'spa', SpD: 'spd', Spe: 'spe' };

function parseShowdownTeam(text) {
  const blocks = text.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split(/\r?\n/);
    const firstLine = lines[0];
    let nameRaw = firstLine;
    let item = null;
    const atIdx = firstLine.indexOf('@');
    if (atIdx !== -1) {
      nameRaw = firstLine.slice(0, atIdx).trim();
      item = firstLine.slice(atIdx + 1).trim();
    }
    nameRaw = nameRaw.replace(/\s*\((?:M|F)\)\s*$/, '').trim();
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    let nature = null;
    let ability = null;
    const moves = [];
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      const natureMatch = /^(\w+)\s+Nature$/.exec(trimmed);
      if (natureMatch) nature = natureMatch[1];
      const abilityMatch = /^Ability:\s*(.+)$/.exec(trimmed);
      if (abilityMatch) ability = abilityMatch[1].trim();
      const evsMatch = /^EVs:\s*(.+)$/.exec(trimmed);
      if (evsMatch) {
        for (const part of evsMatch[1].split('/')) {
          const pm = /^\s*(\d+)\s*(\w+)\s*$/.exec(part);
          if (pm && STAT_ABBR_REV[pm[2]]) evs[STAT_ABBR_REV[pm[2]]] = Number(pm[1]);
        }
      }
      const moveMatch = /^-\s*(.+)$/.exec(trimmed);
      if (moveMatch) moves.push(moveMatch[1].trim());
    }
    return { name: nameRaw, item, nature, evs, ability, moves };
  });
}

// ---------------------------------------------------------------------------
// 自軍チーム読み込み
// ---------------------------------------------------------------------------

/**
 * チームメンバーをバトル用スペック(base form + item)に変換する。
 * メガストーン持ちはbase種族名を維持し、simがメガ変換を処理する。
 */
function memberToBattleSpec(member) {
  return {
    species: member.name,
    ability: member.ability || '',
    item: member.item || '',
    nature: member.nature || 'Serious',
    evs: member.evs,
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: LEVEL,
    moves: member.moves,
  };
}

/**
 * チームメンバーをダメージ計算用スペック(mega form優先)に変換する。
 * calcMatchupに渡す用途。
 */
function memberToDamageCalcSpec(dex, member) {
  const species = dex.species.get(member.name);
  let speciesName = species.name;
  if (member.item) {
    const item = dex.items.get(member.item);
    if (item.exists && item.megaStone && item.megaStone[species.name]) {
      speciesName = item.megaStone[species.name];
    }
  }
  return {
    species: speciesName,
    ability: member.ability || undefined,
    item: member.item || '',
    nature: member.nature || 'Serious',
    sp: member.evs,
  };
}

function loadMyTeam(teamPath, dex) {
  const text = fs.readFileSync(teamPath, 'utf8');
  const members = parseShowdownTeam(text);
  return members.map(m => ({
    speciesId: dex.species.get(m.name).id,
    displayName: m.name,
    battleSpec: memberToBattleSpec(m),
    damageCalcSpec: memberToDamageCalcSpec(dex, m),
    moves: m.moves,
  }));
}

// ---------------------------------------------------------------------------
// メタセット → バトル用スペック変換
// ---------------------------------------------------------------------------

/**
 * メタセットをバトル用スペック(base form + item)に変換する。
 * battleSpecies が設定されているポケモン(lopunny→lopunnymega等)も
 * バトルではbase種族+アイテムで開始させてsimにメガを処理させる。
 */
function metaSetToBattleSpec(speciesId, s) {
  return {
    species: speciesId,    // base種族ID (lopunny, not lopunnymega)
    ability: s.ability || '',
    item: s.item || '',
    nature: s.nature || 'Serious',
    evs: s.sp || {},
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: LEVEL,
    moves: s.moves || [],
  };
}

// ---------------------------------------------------------------------------
// ダメージ計算 (damage_calc.js の calcMatchup を流用)
// ---------------------------------------------------------------------------

const { calcMatchup } = require('./damage_calc');

// ---------------------------------------------------------------------------
// ブースト倍率
// ---------------------------------------------------------------------------

function boostFactor(stage) {
  if (stage >= 0) return (2 + stage) / 2;
  return 2 / (2 - stage);
}

// ---------------------------------------------------------------------------
// マルチヒット技の期待ヒット数
// ---------------------------------------------------------------------------

function estimateHitMult(moveDef) {
  const mh = moveDef.multihit;
  if (!mh) return 1;
  if (typeof mh === 'number') return mh;
  if (Array.isArray(mh)) return (mh[0] + mh[1]) / 2;
  return 1;
}

// ---------------------------------------------------------------------------
// 技の命中率 (true=必中 → 100)
// ---------------------------------------------------------------------------

function moveAccuracy(moveDef) {
  if (moveDef.accuracy === true || moveDef.accuracy == null) return 100;
  return moveDef.accuracy;
}

// ---------------------------------------------------------------------------
// 状態異常付与価値
// ---------------------------------------------------------------------------

function statusInflictValue(status) {
  switch (status) {
    case 'slp': return W_STATUS_SLEEP;
    case 'par': return W_STATUS_PARA;
    case 'brn': return W_STATUS_BURN;
    case 'psn': case 'tox': return W_STATUS_POISON;
    case 'frz': return W_STATUS_FREEZE;
    default: return 0.02;
  }
}

// ---------------------------------------------------------------------------
// ダメージテーブル事前計算
// ---------------------------------------------------------------------------

/**
 * 1ペア(myDamageCalcSpec × myMoves, oppDamageCalcSpec × oppMoves)の
 * ダメージテーブルを事前計算する。
 *
 * 戻り値: {
 *   myToOpp: { [moveName]: { mid, max, accuracy, hitMult, isStatus, category } }
 *   oppToMy: { [moveName]: { mid, max, accuracy, hitMult, isStatus, category } }
 * }
 *
 * midは16乱数の中間値(絶対ダメージ、HP単位)。
 * maxは最大ダメージ(OHKO判定に使用)。
 * accuracy: 命中率0-100。
 * hitMult: 期待ヒット数(マルチヒット用)。
 * isStatus: true = ダメージなし。
 */
function preComputeDamageTables(dex, myDamageCalcSpec, myMoves, oppDamageCalcSpec, oppMoves) {
  function computeTable(attackerSpec, attackerMoves, defenderSpec) {
    const table = {};
    for (const moveName of attackerMoves) {
      const moveDef = dex.moves.get(moveName);
      if (!moveDef.exists) {
        table[moveDef.id || moveName.toLowerCase().replace(/\s/g, '')] = {
          mid: 0, max: 0, accuracy: 100, hitMult: 1, isStatus: true, category: 'Status',
        };
        continue;
      }
      const moveId = moveDef.id;
      if (moveDef.category === 'Status') {
        table[moveId] = { mid: 0, max: 0, accuracy: moveAccuracy(moveDef), hitMult: 1, isStatus: true, category: 'Status' };
        continue;
      }
      // ダメージ技: calcMatchup を使って推定
      try {
        const result = calcMatchup({
          attacker: attackerSpec,
          defender: defenderSpec,
          move: moveName,
          level: LEVEL,
        });
        const mid = (result.min + result.max) / 2;
        const hitMult = estimateHitMult(moveDef);
        table[moveId] = {
          mid,
          max: result.max,
          accuracy: moveAccuracy(moveDef),
          hitMult,
          isStatus: false,
          category: moveDef.category,
        };
      } catch (_e) {
        // calcMatchupが失敗する技(固定ダメージ、特殊効果等)は0ダメージとして扱う
        table[moveId] = {
          mid: 0, max: 0, accuracy: moveAccuracy(moveDef), hitMult: 1, isStatus: true, category: moveDef.category,
        };
      }
    }
    return table;
  }

  return {
    myToOpp: computeTable(myDamageCalcSpec, myMoves, oppDamageCalcSpec),
    oppToMy: computeTable(oppDamageCalcSpec, oppMoves, myDamageCalcSpec),
  };
}

// ---------------------------------------------------------------------------
// ポリシーv0
// ---------------------------------------------------------------------------

/**
 * 相手の最大ダメージ(絶対HP単位)を推定する。
 * max rollを使用した保守的な見積もり。oppToMyテーブル + 相手のブースト補正を使用。
 * v0.2修正: 旧実装は info.mid(平均値)を使用しており「最大ダメージ」として過小評価していた。
 *   正しくは info.max を使用して最悪ケースを見積もる(積み技安全条件の保守的評価)。
 */
function estimateOppMaxDamage(oppToMyTable, oppPoke, myPoke, dex) {
  let maxDmg = 0;
  for (const [moveId, info] of Object.entries(oppToMyTable)) {
    if (info.isStatus || info.max === 0) continue;
    const moveDef = dex.moves.get(moveId);
    if (!moveDef.exists || moveDef.category === 'Status') continue;

    let atkBoost = 0, defBoost = 0;
    if (moveDef.category === 'Physical') {
      // Body Press は自分のdefを攻撃に使う特例
      atkBoost = moveDef.id === 'bodypress' ? (oppPoke.boosts.def || 0) : (oppPoke.boosts.atk || 0);
      defBoost = myPoke.boosts.def || 0;
    } else {
      atkBoost = oppPoke.boosts.spa || 0;
      defBoost = myPoke.boosts.spd || 0;
    }

    // max rollを使用(保守的最悪ケース推定)。命中率は期待値として加味する。
    const adj = info.max * boostFactor(atkBoost) / boostFactor(defBoost);
    const effDmg = adj * (info.accuracy / 100) * info.hitMult;
    maxDmg = Math.max(maxDmg, effDmg);
  }
  return maxDmg;
}

/**
 * 自分の最大ダメージ(OHKO判定用: accuracy加味なし・max rollを使用)を返す。
 */
function findOhkoMove(myToOppTable, oppCurrentHp, myPoke, oppPoke, dex) {
  // maxDmg(boost調整) >= oppCurrentHp で確定1発
  const candidates = [];
  for (const [moveId, info] of Object.entries(myToOppTable)) {
    if (info.isStatus || info.max === 0) continue;
    const moveDef = dex.moves.get(moveId);
    if (!moveDef.exists || moveDef.category === 'Status') continue;

    let atkBoost = 0, defBoost = 0;
    if (moveDef.category === 'Physical') {
      atkBoost = moveDef.id === 'bodypress' ? (myPoke.boosts.def || 0) : (myPoke.boosts.atk || 0);
      defBoost = oppPoke.boosts.def || 0;
    } else {
      atkBoost = myPoke.boosts.spa || 0;
      defBoost = oppPoke.boosts.spd || 0;
    }

    const adjMax = info.max * boostFactor(atkBoost) / boostFactor(defBoost) * info.hitMult;
    if (adjMax >= oppCurrentHp) {
      candidates.push({ moveId, accuracy: info.accuracy });
    }
  }
  if (candidates.length === 0) return null;
  // 命中率優先でソート
  candidates.sort((a, b) => b.accuracy - a.accuracy);
  return candidates[0].moveId;
}

/**
 * 技の推定ダメージ(効果量: 相手maxHP%単位、期待値)を返す。
 * accuracy・hitMultを加味した期待値。
 */
function estimateMoveDmgPct(moveId, info, myPoke, oppPoke, oppMaxHp, dex) {
  if (info.isStatus || info.mid === 0) return 0;
  const moveDef = dex.moves.get(moveId);
  if (!moveDef.exists || moveDef.category === 'Status') return 0;

  let atkBoost = 0, defBoost = 0;
  if (moveDef.category === 'Physical') {
    atkBoost = moveDef.id === 'bodypress' ? (myPoke.boosts.def || 0) : (myPoke.boosts.atk || 0);
    defBoost = oppPoke.boosts.def || 0;
  } else {
    atkBoost = myPoke.boosts.spa || 0;
    defBoost = oppPoke.boosts.spd || 0;
  }

  const adj = info.mid * boostFactor(atkBoost) / boostFactor(defBoost);
  const effDmg = adj * (info.accuracy / 100) * info.hitMult;
  return (effDmg / oppMaxHp) * 100;
}

/**
 * ステータス技の価値評価。
 * moveDef の各フィールドを調べて適切な価値を返す。
 */
function evaluateStatusMove(moveDef, myPoke, oppPoke, oppMaxDmg, precomp, state, dex) {
  const moveId = moveDef.id;

  // まもる / キングシールド系
  if (STALLING_MOVES.has(moveId)) {
    return state.usedProtectLastTurn ? W_PROTECT_PENALTY : 0.05;
  }

  // 回復技: heal フィールドで判定
  const healFraction = moveDef.heal ? moveDef.heal[0] / moveDef.heal[1]
    : (moveDef.self && moveDef.self.heal) ? moveDef.self.heal[0] / moveDef.self.heal[1]
    : 0;
  if (healFraction > 0) {
    // v0.1修正: 割合ベース閾値に変更。旧: oppMaxDmg*2(ドラテ等の小打点消耗戦で機能しなかった)
    // 新: 残HP < (回復量 + バッファ10%) × maxHP で発動 (例: はねやすめなら60%以下で発動)
    const recoveryThreshold = myPoke.maxhp * (healFraction + 0.10);
    if (myPoke.hp < recoveryThreshold) {
      return W_RECOVERY;
    }
    return -0.05; // HPに余裕がある場合は回復より攻撃
  }

  // 積み技: moveDef.boosts で判定 (v0.1修正: 旧コードは moveDef.self.boosts を見ていたが
  //   これはクローズコンバット等の「ダメージ技の副作用で自分のステータスが下がる」用フィールド。
  //   鉄壁・つるぎのまい等の自己ランク上昇技は moveDef.boosts (トップレベル) を使う)
  if (moveDef.boosts) {
    const boosts = moveDef.boosts;

    // 安全条件: 次ターン相手最大打点で落ちないか
    if (oppMaxDmg >= myPoke.hp) {
      return -0.30; // 積んでも次ターン落ちる
    }

    // 自分の技セットの中で、このブーストが攻撃力向上に寄与するか判定。
    // overrideOffensiveStat (ボディプレス: def, パワーウィップ等: デフォルト) を考慮して
    // 各攻撃技に対するゲインファクターを計算する。
    let bestGainFactor = 1.0;
    let anyOffensiveGain = false;

    for (const [mId, info] of Object.entries(precomp.myToOpp)) {
      if (info.isStatus || info.mid === 0) continue;
      const movD = dex.moves.get(mId);
      if (!movD.exists || movD.category === 'Status') continue;

      // この技が参照する攻撃スタット (overrideOffensiveStat がある場合はそちら優先)
      const offStat = movD.overrideOffensiveStat ||
        (movD.category === 'Physical' ? 'atk' : 'spa');
      const boostGain = boosts[offStat] || 0;
      if (boostGain <= 0) continue;

      anyOffensiveGain = true;
      const currentOffBoost = myPoke.boosts[offStat] || 0;
      if (currentOffBoost >= 6) continue; // このstatは既に最大
      const actualGain = Math.min(boostGain, 6 - currentOffBoost);
      const gf = boostFactor(currentOffBoost + actualGain) / boostFactor(currentOffBoost);
      if (gf > bestGainFactor) bestGainFactor = gf;
    }

    if (!anyOffensiveGain) {
      // 防御・速度など純粋な耐久/素早さ積み: 控えめな価値
      if ((boosts.def || 0) + (boosts.spd || 0) > 0) return W_SETUP_SAFE * 0.20;
      if ((boosts.spe || 0) > 0) return W_SETUP_SAFE * 0.15;
      return 0.05;
    }

    // ゲインファクターによる段階評価 (スコールは正規化済み 0-1 スケール)
    if (bestGainFactor >= 2.0) return W_SETUP_SAFE;           // ×2以上: 価値大
    if (bestGainFactor >= 1.5) return W_SETUP_SAFE * 0.6;     // ×1.5以上
    return W_SETUP_SAFE * 0.3;                                 // それ以下
  }

  // 状態異常付与技 (primary status)
  if (moveDef.status) {
    if (oppPoke.status) return -0.05; // 既に状態異常
    return statusInflictValue(moveDef.status) * (moveAccuracy(moveDef) / 100);
  }

  // あくび (volatileStatus: 'yawn') → 眠り誘発
  if (moveDef.volatileStatus === 'yawn') {
    if (oppPoke.status || (oppPoke.volatiles && oppPoke.volatiles.yawn)) return -0.05;
    return W_STATUS_SLEEP * 0.8 * (moveAccuracy(moveDef) / 100);
  }

  // ちょうはつ・アンコール等: 簡易価値
  if (moveId === 'taunt' || moveId === 'encore') return 0.08;

  // ステルスロック・まきびし等: 1v1では効果なし(交代が発生しない)
  if (moveDef.sideCondition) return -0.10;

  // その他: ほぼ価値なし
  return 0.01;
}

/**
 * ポリシーv0 本体。
 * req: battle.p1.activeRequest (active フィールドがある場合のみ呼ぶ)
 * myPoke: battle.p1.active[0]
 * oppPoke: battle.p2.active[0]
 * state: { usedProtectLastTurn }
 * precomp: { myToOpp, oppToMy }
 * 戻り値: { choice: string, selectedMoveId: string|null }
 */
function policyV0(req, myPoke, oppPoke, state, precomp, dex) {
  if (!req || req.wait || !req.active) {
    return { choice: 'move 1', selectedMoveId: null };
  }

  const active = req.active[0];
  if (!active || !active.moves || active.moves.length === 0) {
    return { choice: 'move 1', selectedMoveId: null };
  }

  const canMega = active.canMegaEvo === true;
  const megaSuffix = canMega ? ' mega' : '';

  // 利用可能な技のインデックス(1始まり)と名前のマップ
  const availableMoves = [];
  for (let i = 0; i < active.moves.length; i++) {
    if (!active.moves[i].disabled) {
      const moveName = active.moves[i].move;
      const moveDef = dex.moves.get(moveName);
      availableMoves.push({ idx: i + 1, moveName, moveId: moveDef.id, moveDef });
    }
  }

  if (availableMoves.length === 0) {
    // 全技PP切れ → わるあがき (sim側が処理)
    return { choice: 'move 1' + megaSuffix, selectedMoveId: null };
  }

  const oppCurrentHp = oppPoke ? oppPoke.hp : 1;
  const myCurrentHp = myPoke ? myPoke.hp : 1;
  const myMaxHp = myPoke ? myPoke.maxhp : 1;

  // 相手最大ダメージ (ブースト調整後・期待値)
  const oppMaxDmg = estimateOppMaxDamage(precomp.oppToMy, oppPoke, myPoke, dex);

  // ルール1: 確定1発があれば最優先
  const ohkoMoveId = findOhkoMove(precomp.myToOpp, oppCurrentHp, myPoke, oppPoke, dex);
  if (ohkoMoveId) {
    const entry = availableMoves.find(m => m.moveId === ohkoMoveId);
    if (entry) {
      return { choice: `move ${entry.idx}${megaSuffix}`, selectedMoveId: ohkoMoveId };
    }
  }

  // 各技をスコアリング
  let bestScore = -Infinity;
  let bestEntry = availableMoves[0];

  for (const entry of availableMoves) {
    const { moveId, moveDef } = entry;
    let score;

    if (moveDef.category !== 'Status') {
      // 攻撃技: ダメージ期待値を 0-1 スケールに正規化 (= 相手maxHPに対する割合)
      // v0.1修正: 旧コードは dmgPct(0-100)をそのままスコアにしていたため変化技(0-1スケール)と
      // 単位が100倍ずれており、積み/回復技が実質的に機能しなかった。
      const info = precomp.myToOpp[moveId] || { mid: 0, max: 0, accuracy: 100, hitMult: 1, isStatus: true };
      const dmgPct = estimateMoveDmgPct(moveId, info, myPoke, oppPoke, oppPoke ? oppPoke.maxhp : 1, dex);
      score = dmgPct / 100;

      // 2次効果: 状態異常
      if (moveDef.secondary && moveDef.secondary.status && !oppPoke.status) {
        score += statusInflictValue(moveDef.secondary.status) * (moveDef.secondary.chance / 100);
      }
      // 2次効果: ランク変化 (相手への悪影響)
      if (moveDef.secondary && moveDef.secondary.boosts) {
        let rankVal = 0;
        for (const [stat, stage] of Object.entries(moveDef.secondary.boosts)) {
          rankVal += (-stage) * W_RANK * ((moveDef.secondary.chance || 100) / 100);
        }
        score += rankVal;
      }
      // 自身への確定ランク変化 (がんせきふうじの相手S下降、バークアウト等はsecondaryで対処済み)
      if (moveDef.self && moveDef.self.boosts) {
        let selfRankVal = 0;
        for (const [stat, stage] of Object.entries(moveDef.self.boosts)) {
          selfRankVal += stage * W_RANK;  // 自分のランク上昇は正
        }
        score += selfRankVal;
      }
    } else {
      // 変化技
      score = evaluateStatusMove(moveDef, myPoke, oppPoke, oppMaxDmg, precomp, state, dex);
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  return { choice: `move ${bestEntry.idx}${megaSuffix}`, selectedMoveId: bestEntry.moveId };
}

// ---------------------------------------------------------------------------
// 1試合実行
// ---------------------------------------------------------------------------

/**
 * 1試合のターンログエントリ型。--verbose 時に返される。
 * @typedef {{ turn: number, p1Move: string, p1Hp: string, p2Move: string, p2Hp: string }} TurnLog
 */

/**
 * @param {*} p1BattleSpec
 * @param {*} p2BattleSpec
 * @param {number[]} seed
 * @param {*} precomp
 * @param {*} precompMirror
 * @param {*} dex
 * @param {boolean} [verbose=false] ターンごとの選択ログを収集するか
 * @returns {{ p1Won: boolean, p2Won: boolean, turns: number, winnerHpPct: number, log?: TurnLog[] }}
 */
function runSingleBattle(p1BattleSpec, p2BattleSpec, seed, precomp, precompMirror, dex, verbose) {
  const Sim = getSim();

  const battle = new Sim.Battle({
    formatid: FORMAT_ID,
    seed,
    p1: { team: [p1BattleSpec] },
    p2: { team: [p2BattleSpec] },
    strictChoices: false,
  });

  battle.makeChoices('team 1', 'team 1');

  const p1State = { usedProtectLastTurn: false };
  const p2State = { usedProtectLastTurn: false };

  let turns = 0;
  const log = verbose ? [] : null;

  while (!battle.ended && turns < MAX_TURNS) {
    const req1 = battle.p1.activeRequest;
    const req2 = battle.p2.activeRequest;

    // forceSwitch は1v1では発生しないはずだが念のため対処
    if (req1 && req1.forceSwitch) {
      battle.makeChoices('pass', req2 && req2.forceSwitch ? 'pass' : (req2 && !req2.wait ? 'move 1' : ''));
      turns++;
      continue;
    }
    if (req2 && req2.forceSwitch) {
      battle.makeChoices(req1 && !req1.wait ? 'move 1' : '', 'pass');
      turns++;
      continue;
    }

    const myPoke1 = battle.p1.active[0];
    const oppPoke1 = battle.p2.active[0];

    let c1 = 'move 1';
    let m1Id = null;
    if (req1 && !req1.wait && req1.active) {
      const res = policyV0(req1, myPoke1, oppPoke1, p1State, precomp, dex);
      c1 = res.choice;
      m1Id = res.selectedMoveId;
    }

    let c2 = 'move 1';
    let m2Id = null;
    if (req2 && !req2.wait && req2.active) {
      const res = policyV0(req2, oppPoke1, myPoke1, p2State, precompMirror, dex);
      c2 = res.choice;
      m2Id = res.selectedMoveId;
    }

    if (log) {
      const p1 = myPoke1;
      const p2 = oppPoke1;
      log.push({
        turn: turns + 1,
        p1Move: m1Id || c1,
        p1Hp: p1 ? `${p1.hp}/${p1.maxhp}(${(p1.hp/p1.maxhp*100).toFixed(0)}%)` : '?',
        p1Boosts: p1 ? JSON.stringify(p1.boosts) : '{}',
        p2Move: m2Id || c2,
        p2Hp: p2 ? `${p2.hp}/${p2.maxhp}(${(p2.hp/p2.maxhp*100).toFixed(0)}%)` : '?',
        p2Boosts: p2 ? JSON.stringify(p2.boosts) : '{}',
      });
    }

    p1State.usedProtectLastTurn = m1Id ? STALLING_MOVES.has(m1Id) : false;
    p2State.usedProtectLastTurn = m2Id ? STALLING_MOVES.has(m2Id) : false;

    battle.makeChoices(c1, c2);
    turns++;
  }

  // 結果集計
  const p1Won = battle.winner === 'Player 1';
  const p2Won = battle.winner === 'Player 2';
  const winnerPoke = p1Won ? battle.p1.active[0] : p2Won ? battle.p2.active[0] : null;
  const winnerHpPct = winnerPoke ? (winnerPoke.hp / winnerPoke.maxhp * 100) : 50;

  if (log) {
    return { p1Won, p2Won, turns, winnerHpPct, log };
  }
  return { p1Won, p2Won, turns, winnerHpPct };
}

// ---------------------------------------------------------------------------
// ペア集計 (N試行)
// ---------------------------------------------------------------------------

/**
 * @param {*} myMember
 * @param {string} metaSpeciesId
 * @param {*} metaSet
 * @param {number} n
 * @param {number} seedBase
 * @param {number} [verboseN=0] 最初のN試合についてターンログを出力する
 */
function runPair(myMember, metaSpeciesId, metaSet, n, seedBase, verboseN) {
  const dex = getDex();

  // ダメージテーブル事前計算
  const precomp = preComputeDamageTables(
    dex,
    myMember.damageCalcSpec, myMember.moves,
    metaSet.setConfig,       metaSet.moves,
  );
  const precompMirror = { myToOpp: precomp.oppToMy, oppToMy: precomp.myToOpp };

  // バトルスペック生成
  const p1BattleSpec = myMember.battleSpec;
  const p2BattleSpec = metaSetToBattleSpec(metaSpeciesId, metaSet.setConfig);
  // movesをbattleSpecに追加 (parseShowdownTeamとの整合)
  p2BattleSpec.moves = metaSet.moves;

  let p1Wins = 0;
  let totalTurns = 0;
  const hpDist = new Array(10).fill(0); // 10%刻みバケツ [0-9%, 10-19%, ..., 90-100%]

  for (let i = 0; i < n; i++) {
    // seedはseedBase + ペアごとのオフセット + 試行index で決定
    const seed = [
      (seedBase + i * 4 + 0) & 0xFFFFFFFF,
      (seedBase + i * 4 + 1) & 0xFFFFFFFF,
      (seedBase + i * 4 + 2) & 0xFFFFFFFF,
      (seedBase + i * 4 + 3) & 0xFFFFFFFF,
    ];
    const doVerbose = verboseN && i < verboseN;
    const result = runSingleBattle(p1BattleSpec, p2BattleSpec, seed, precomp, precompMirror, dex, doVerbose);

    if (result.p1Won) p1Wins++;
    totalTurns += result.turns;

    const bucket = Math.min(9, Math.floor(result.winnerHpPct / 10));
    hpDist[bucket]++;

    if (doVerbose && result.log) {
      const winner = result.p1Won ? 'P1(自軍)' : result.p2Won ? 'P2(相手)' : '引き分け';
      console.log(`\n  [Verbose Battle ${i + 1}] winner=${winner} turns=${result.turns}`);
      console.log(`  ${'T'.padEnd(4)} ${'P1 HP'.padEnd(18)} ${'P1 Move'.padEnd(18)} ${'P2 HP'.padEnd(18)} ${'P2 Move'.padEnd(18)}`);
      for (const entry of result.log) {
        console.log(`  ${String(entry.turn).padEnd(4)} ${entry.p1Hp.padEnd(18)} ${entry.p1Move.padEnd(18)} ${entry.p2Hp.padEnd(18)} ${entry.p2Move.padEnd(18)}`);
      }
    }
  }

  const winA = p1Wins / n;
  const avgTurns = totalTurns / n;
  const se = Math.sqrt(Math.max(winA * (1 - winA) / n, 0));
  const ci95Lo = Math.max(0, winA - 1.96 * se);
  const ci95Hi = Math.min(1, winA + 1.96 * se);

  return { winA, n, avgTurns, ci95Lo, ci95Hi, hpDist };
}

// ---------------------------------------------------------------------------
// メタセットのSHA256ハッシュ
// ---------------------------------------------------------------------------

function hashMetaSets() {
  const raw = fs.readFileSync(META_SETS_PATH);
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ---------------------------------------------------------------------------
// レポート生成
// ---------------------------------------------------------------------------

function generateReport(matrix, metaExpanded) {
  const lines = [];
  const myTeamIds = Object.keys(matrix);
  if (myTeamIds.length === 0) return '# 結果なし\n';

  // ヘッダー情報
  const meta = matrix._meta;
  lines.push('# 1v1マッチアップ行列 レポート');
  lines.push('');
  lines.push(`生成日時: ${meta.generatedAt}  `);
  lines.push(`ポリシーバージョン: ${meta.policyVersion}  `);
  lines.push(`N (試行数/ペア): ${meta.N}  `);
  lines.push(`チームファイル: ${meta.teamFile}  `);
  lines.push('');
  lines.push('> **注意**: これは校正済みポリシー同士の勝率であり、上手い人間同士の近似にすぎない。');
  lines.push('> ポリシーの校正状況・限界については DESIGN_SIM.md「リスクと限界」節を参照。');
  lines.push('');

  // ポリシー重みの明記
  lines.push('## ポリシーv0 重み (未校正・初期値)');
  lines.push('');
  lines.push('| 重み変数 | 値 | 意味 |');
  lines.push('|---|---|---|');
  for (const [k, v] of Object.entries(meta.policyWeights)) {
    lines.push(`| ${k} | ${v} | |`);
  }
  lines.push('');

  // 勝率表
  lines.push('## 勝率表 (自軍 × メタセット)');
  lines.push('');
  lines.push('セル形式: **勝率% (95%CI下限-上限)**');
  lines.push('');

  // ヘッダー行
  const colHeaders = metaExpanded.map(m => `${m.speciesId}_s${m.setIdx}`);
  lines.push('| 自軍\\相手 | ' + colHeaders.join(' | ') + ' |');
  lines.push('|' + '---|'.repeat(colHeaders.length + 1));

  const resultEntries = Object.entries(matrix.results || {});
  for (const [myId, row] of resultEntries) {
    const cells = metaExpanded.map(m => {
      const key = `${m.speciesId}_s${m.setIdx}`;
      const r = row[key];
      if (!r) return 'N/A';
      const winPct = (r.winA * 100).toFixed(1);
      const lo = (r.ci95Lo * 100).toFixed(1);
      const hi = (r.ci95Hi * 100).toFixed(1);
      return `**${winPct}%** (${lo}-${hi})`;
    });
    lines.push(`| ${myId} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  // メタ加重勝率
  lines.push('## 自軍各体のメタ加重勝率');
  lines.push('');
  lines.push('セット重み × 採用率(全種均等1/15として近似)で加重平均。');
  lines.push('');
  lines.push('| 自軍ポケモン | 加重勝率% | 95%CI |');
  lines.push('|---|---|---|');

  const totalWeight = metaExpanded.reduce((s, m) => s + m.weight / 15, 0); // 15種均等

  for (const [myId, row] of resultEntries) {
    let weightedWin = 0;
    let weightedVariance = 0;
    let totalW = 0;
    for (const m of metaExpanded) {
      const key = `${m.speciesId}_s${m.setIdx}`;
      const r = row[key];
      if (!r) continue;
      const w = m.weight / 15;
      weightedWin += w * r.winA;
      weightedVariance += w * w * r.winA * (1 - r.winA) / r.n;
      totalW += w;
    }
    if (totalW > 0) {
      const wWin = weightedWin / totalW;
      const wSe = Math.sqrt(weightedVariance) / totalW;
      lines.push(`| ${myId} | ${(wWin * 100).toFixed(1)}% | ±${(wSe * 1.96 * 100).toFixed(1)}% |`);
    }
  }
  lines.push('');

  // メタセット一覧
  lines.push('## メタセット一覧 (カラム対応)');
  lines.push('');
  lines.push('| キー | 種族 | 重み | 技構成 |');
  lines.push('|---|---|---|---|');
  for (const m of metaExpanded) {
    lines.push(`| ${m.speciesId}_s${m.setIdx} | ${m.setConfig.species} | ${m.weight.toFixed(2)} | ${m.moves.join(', ')} |`);
  }

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const n = parseInt(args.n || '500');
  const teamPath = path.resolve(args.team || DEFAULT_TEAM_PATH);
  const outPath = path.resolve(args.out || DEFAULT_OUT_PATH);
  const reportPath = DEFAULT_REPORT_PATH;
  const onlySpecies = args.only || null;
  const seedBase = parseInt(args['seed-base'] || '0');
  const doReport = !!args.report;
  // --verbose: 各ペアの最初の N 試合についてターンごとの選択ログを出力
  // --verbose-n <数>: verbose の試合数 (既定 3)
  const verboseN = args.verbose ? parseInt(args['verbose-n'] || '3') : 0;

  console.log(`matchup_matrix.js ${POLICY_VERSION}  (ポリシー: ${POLICY_VERSION})`);
  console.log(`チーム: ${teamPath}`);
  console.log(`N: ${n}  seedBase: ${seedBase}`);
  if (onlySpecies) console.log(`メタ絞り込み: ${onlySpecies}`);

  // ライブラリ初期化
  const dex = getDex();
  const simConfig = JSON.parse(fs.readFileSync(SIM_CONFIG_PATH, 'utf8'));

  // 自軍チーム読み込み
  const myTeam = loadMyTeam(teamPath, dex);
  console.log(`自軍: ${myTeam.map(m => m.displayName).join(', ')}`);

  // メタセット読み込み・展開
  const metaSetsRaw = loadMetaSets();
  const metaExpanded = []; // { speciesId, setIdx, weight, setConfig, moves }
  for (const [speciesId, entry] of Object.entries(metaSetsRaw)) {
    if (onlySpecies && speciesId !== onlySpecies) continue;
    const sets = normalizeMetaEntry(speciesId, entry);
    sets.forEach((s, idx) => {
      metaExpanded.push({ speciesId, setIdx: idx, weight: s.weight, setConfig: s.setConfig, moves: s.moves });
    });
  }
  console.log(`メタセット: ${metaExpanded.length} 件 (${[...new Set(metaExpanded.map(m => m.speciesId))].length} 種)`);

  const totalPairs = myTeam.length * metaExpanded.length;
  console.log(`総ペア数: ${totalPairs}  総バトル数(目安): ${totalPairs * n}`);
  console.log('');

  const results = {};
  let pairDone = 0;
  const startTime = Date.now();

  for (const myMember of myTeam) {
    results[myMember.speciesId] = {};
    for (const meta of metaExpanded) {
      const key = `${meta.speciesId}_s${meta.setIdx}`;
      process.stdout.write(`  ${myMember.speciesId} vs ${key} (n=${n})... `);
      const t0 = Date.now();

      // seedBaseをペアごとにずらす
      const pairSeedBase = seedBase + pairDone * n * 4;
      try {
        const pairResult = runPair(myMember, meta.speciesId, meta, n, pairSeedBase, verboseN);
        results[myMember.speciesId][key] = pairResult;
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const winPct = (pairResult.winA * 100).toFixed(1);
        const ci = `[${(pairResult.ci95Lo * 100).toFixed(1)}-${(pairResult.ci95Hi * 100).toFixed(1)}]`;
        process.stdout.write(`winA=${winPct}% ${ci} avgTurns=${pairResult.avgTurns.toFixed(1)} (${elapsed}s)\n`);
      } catch (e) {
        process.stdout.write(`ERROR: ${e.message}\n`);
        console.error(e.stack);
        results[myMember.speciesId][key] = { error: e.message };
      }
      pairDone++;
    }
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n完了: ${totalElapsed}s`);

  // _meta の記録
  const output = {
    _meta: {
      generatedAt: new Date().toISOString(),
      policyVersion: POLICY_VERSION,
      policyWeights: { W_RANK, W_STATUS_SLEEP, W_STATUS_PARA, W_STATUS_BURN, W_STATUS_POISON, W_STATUS_FREEZE, W_PROTECT_PENALTY, W_SETUP_SAFE, W_RECOVERY },
      metaSetsHash: hashMetaSets(),
      simConfig,
      seedBase,
      N: n,
      teamFile: path.relative(ROOT, teamPath).replace(/\\/g, '/'),
      myTeam: myTeam.map(m => m.speciesId),
    },
    results,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`出力: ${outPath}`);

  if (doReport) {
    const reportText = generateReport(output, metaExpanded);
    fs.writeFileSync(reportPath, reportText, 'utf8');
    console.log(`レポート: ${reportPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`FATAL: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }
}

module.exports = { runPair, policyV0, preComputeDamageTables, normalizeMetaEntry, parseShowdownTeam };
