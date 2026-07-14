'use strict';
/**
 * Champions BSS Reg M-B 技価値評価 (research/DESIGN.md ツール6)
 * 6a: 攻撃技比較 / 6b: おにび・でんじは・つるぎのまい・確定追加効果つき攻撃技・行動制約系 実装済み。
 * 6c(ステルスロック・どくびし・壁・設置技ライダー)は未実装。
 *
 * 「技スロット1枠に候補技を入れたら、上位構築の脅威との関係がどう変わるか」を定量化する。
 *
 * 使い方:
 *   node research/tools/move_value.js --pokemon Corviknight \
 *     --candidates "Iron Head,Will-O-Wisp,Thunder Wave,Swords Dance" \
 *     [--team research/teams/v1-blaziken-core.txt] [--top 15] [--no-accuracy] [--out research/reports/xxx.md]
 *
 * --pokemon はチームファイル内の1体の名前(種族名、大文字小文字区別なし)。
 * --candidates はカンマ区切りの技名リスト。技のカテゴリ/効果をdexから自動判別し、
 * 以下のモデルにディスパッチする(DESIGN.md「評価モデル(技カテゴリ別)」参照):
 *   - 攻撃技: 既存技構成での最良確定数との比較(6a)
 *   - 火傷付与技(おにび等): 損益分岐ターン数モデル
 *   - まひ付与技(でんじは等): 素早さ逆転リスト + 1/8まひ率
 *   - 自分に能力上昇を積む変化技(つるぎのまい等): 積み後の確定数変化 + 被弾チェック
 *   - 眠り付与技: ネットテンポモデル(Champions固有の眠りターン数期待値5/3を使用)
 *   - あくび: 分岐ネットテンポモデル
 *   - ちょうはつ/アンコール/みちづれ: 部分指標(速度関係・変化技依存度・learnsetベースの脅威列挙)
 *   - 確定(chance:100)のランク変化を伴う攻撃技(がんせきふうじ・バークアウト等): 攻撃技モデル+
 *     該当する変化技モデルの簡易版をハイブリッドで追記
 *   - 相手を対象にした純粋なランク変化技(スクリーチ等、上記以外): 同様のランク変化モデルを直接適用
 *   - それ以外(壁・設置技等): 6c未実装として明示スキップ
 *
 * 対象の上位N体は research/data/meta_sets.json に登録済みの種のみ(未登録はスキップし、一覧に明示)。
 *
 * 注意:
 * - 素早さ比較(でんじは/アンコール/みちづれ等)は sim のバトルを経由せず、
 *   speed_tiers.js の calcStat(検証済みのChampions実数値式)+ 通常のポケモン共通仕様である
 *   まひ50%/ランク段階倍率を直接計算する(参考値。speed_tiers.jsのスカーフ概算と同じ位置づけ)。
 *   ダメージ計算(確定数)は全て calcMatchup 経由でsimに計算させている。
 * - `--switches` は6c(ステルスロック等のチーム文脈モデル)向けの予約フラグで現時点では未使用。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TEAMS_DIR = path.join(__dirname, '..', 'teams');
const META_SETS_PATH = path.join(__dirname, '..', 'data', 'meta_sets.json');

const { calcMatchup, hitsToKO } = require('./damage_calc');
const { loadTeams, adoptionRate } = require('./load_top_teams');
const { parseShowdownTeam, calcStat, calcHp } = require('./speed_tiers');

let dexCache = null;
function getDex() {
	if (!dexCache) {
		let Dex;
		try {
			({ Dex } = require(path.join(ROOT, 'dist', 'sim', 'dex')));
		} catch (e) {
			throw new Error(
				`dist/sim/dex が読み込めません。'node build' を実行してからもう一度試してください。(${e.message})`
			);
		}
		dexCache = Dex.mod('champions');
	}
	return dexCache;
}

// Champions固有の状態異常仕様(README.md / DESIGN.md で検証済み。data/mods/champions/conditions.ts)
const CHAMPIONS_SLEEP_EXPECTED_TURNS = 5 / 3; // sample([2,3,3])-1 の期待値(本編は1~3様一様、期待値2)
const CHAMPIONS_PARALYSIS_FULL_CHANCE = 1 / 8; // 本編25%の半分(素早さ半減は本編どおり)
const PARALYSIS_SPEED_MULT = 0.5;
const BURN_RESIDUAL_FRACTION = 1 / 16; // 本編どおり(championsで変更されていない)

// 6cで未実装(6bまでの完了時点)。DESIGN.md「行動制約系」節に対応モデルがないねばりつく等が該当。
const UNIMPLEMENTED_FIELD_MOVES = new Set(['stickyweb']);
// 設置技ライダー: dexのsecondaries/selfからは自動検出できないため対応表をハードコード(DESIGN.md指示)。
const HAZARD_RIDER_MAP = { ceaselessedge: 'spikes', stoneaxe: 'stealthrock' };

// ---------------------------------------------------------------------------
// CLI引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const BOOLEAN_FLAGS = new Set(['no-accuracy', 'help']);
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg.startsWith('--')) continue;
		const key = arg.slice(2);
		if (BOOLEAN_FLAGS.has(key)) {
			out[key] = true;
			continue;
		}
		out[key] = argv[++i];
	}
	return out;
}

// ---------------------------------------------------------------------------
// 自軍チーム読み込み
// ---------------------------------------------------------------------------

function findLatestTeamFile() {
	const files = fs.readdirSync(TEAMS_DIR).filter(f => f.endsWith('.txt'));
	if (!files.length) return null;
	const withStat = files.map(f => ({ f, mtime: fs.statSync(path.join(TEAMS_DIR, f)).mtimeMs }));
	withStat.sort((a, b) => b.mtime - a.mtime);
	return path.join(TEAMS_DIR, withStat[0].f);
}

/** parseShowdownTeamの1メンバーをcalcMatchup用のsetConfigに変換する(メガストーン所持を反映)。 */
function memberToSetConfig(dex, member) {
	const species = dex.species.get(member.name);
	if (!species.exists) throw new Error(`種族が見つかりません: ${member.name}`);
	let battleSpeciesName = species.name;
	if (member.item) {
		const item = dex.items.get(member.item);
		if (item.exists && item.megaStone && item.megaStone[species.name]) {
			battleSpeciesName = item.megaStone[species.name];
		}
	}
	return {
		species: battleSpeciesName,
		ability: member.ability || undefined,
		item: member.item || '',
		nature: member.nature || 'Serious',
		sp: member.evs,
	};
}

/** チームファイルから対象ポケモンを探し、calcMatchup用のsetConfigに変換する。 */
function loadAttackerFromTeam(dex, teamPath, pokemonName) {
	const text = fs.readFileSync(teamPath, 'utf8');
	const members = parseShowdownTeam(text);
	const member = members.find(m => m.name.toLowerCase() === pokemonName.toLowerCase());
	if (!member) {
		throw new Error(
			`${pokemonName} がチームファイルに見つかりません(${path.relative(ROOT, teamPath)})。` +
			`チーム内の名前: ${members.map(m => m.name).join(', ')}`
		);
	}
	return { memberName: member.name, setConfig: memberToSetConfig(dex, member), moves: member.moves || [] };
}

/** チームファイルの全メンバーを {name, setConfig, moves} の配列にする(おにび/でんじはなど自軍全体を見るモデル用)。 */
function loadAllTeamMembers(dex, teamPath) {
	const text = fs.readFileSync(teamPath, 'utf8');
	const members = parseShowdownTeam(text);
	return members.map(member => ({ name: member.name, setConfig: memberToSetConfig(dex, member), moves: member.moves || [] }));
}

// ---------------------------------------------------------------------------
// 上位脅威(meta_sets.json)読み込み
// ---------------------------------------------------------------------------

function loadMetaSets() {
	let raw;
	try {
		raw = JSON.parse(fs.readFileSync(META_SETS_PATH, 'utf8'));
	} catch (e) {
		throw new Error(`research/data/meta_sets.json が読み込めません(${e.message})`);
	}
	const out = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key.startsWith('_')) continue;
		out[key] = value;
	}
	return out;
}

/** meta_sets.json の1エントリをcalcMatchup用のsetConfigに変換する(v1形式専用)。 */
function metaEntryToSetConfig(speciesId, entry) {
	return {
		species: entry.battleSpecies || speciesId,
		ability: entry.ability,
		item: entry.item,
		nature: entry.nature,
		sp: entry.sp,
	};
}

/**
 * meta_sets.json のエントリを正規化し、{ weight, setConfig, mainPhysical, mainSpecial, moves } の配列を返す。
 * v1形式(フィールド直置き): weight 1.0 の単一セット。
 * v2形式({ sets: [...] }): 各セットに weight が付く。
 * v2 では battleSpecies がセット単位で付くことがある(gyarados 等)。
 */
function normalizeMetaEntry(speciesId, entry) {
	if (Array.isArray(entry.sets)) {
		// v2: 種内で合計1.0になるweightを持つセットの配列
		return entry.sets.map(s => ({
			weight: s.weight,
			setConfig: {
				species: s.battleSpecies || entry.battleSpecies || speciesId,
				ability: s.ability,
				item: s.item,
				nature: s.nature,
				sp: s.sp,
			},
			mainPhysical: s.mainPhysical || null,
			mainSpecial: s.mainSpecial || null,
			moves: s.moves || [],
		}));
	}
	// v1形式: フィールド直置き、weight 1.0 として扱う
	return [{
		weight: 1.0,
		setConfig: metaEntryToSetConfig(speciesId, entry),
		mainPhysical: entry.mainPhysical || null,
		mainSpecial: entry.mainSpecial || null,
		moves: entry.moves || [],
	}];
}

/** 採用率上位N体のうち meta_sets.json に登録済みのものだけを返す。未登録は warnings に積む。 */
function selectTopDefenders(topN, warnings) {
	const { teams } = loadTeams();
	const ranked = adoptionRate(teams).filter(e => !e.speciesId.startsWith('unresolved:'));
	const metaSets = loadMetaSets();

	const defenders = [];
	for (const { speciesId, pct } of ranked) {
		if (defenders.length >= topN) break;
		const entry = metaSets[speciesId];
		if (!entry) {
			warnings.push(`${speciesId}(採用率${pct.toFixed(1)}%)は research/data/meta_sets.json 未登録のためスキップ`);
			continue;
		}
		defenders.push({ speciesId, pct, entry, sets: normalizeMetaEntry(speciesId, entry) });
	}
	return defenders;
}

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

/** 16乱数配列から「保証されるKOターン数」(=worst caseのhitsToKO)を返す。ダメージ0ならInfinity。 */
function guaranteedHits(rolls, hp) {
	const hits = hitsToKO(rolls, hp);
	return Math.max(...hits);
}

function rollSummary(rolls, hp) {
	const hits = hitsToKO(rolls, hp);
	const min = Math.min(...hits);
	const max = Math.max(...hits);
	if (min === max) return `確定${min}発`;
	return `乱数${min}〜${max}発`;
}

function avg(arr) {
	return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * ランク補正の倍率(通常のポケモン一般仕様。championsのstatModifyはHP/実数値の式のみを変更しており
 * ランク補正の仕組み自体は変更していない — README/DESIGN.mdに記載なし=非対象と判断)。
 * 素早さ比較・被ダメ軽減率の「参考値」表示にのみ使う。ダメージ確定数はcalcMatchupのboosts経由で
 * simに計算させるため、ここでの数値を最終出力に直接使うのはランク変化そのものが主題の場合のみ。
 */
function stageMultiplier(stage) {
	if (stage >= 0) return (2 + stage) / 2;
	return 2 / (2 - stage);
}

/** natureのspe補正方向(+1/0/-1)を返す。 */
function speModFromNature(dex, natureName) {
	const nature = dex.natures.get(natureName || '');
	if (nature.plus === 'spe') return 1;
	if (nature.minus === 'spe') return -1;
	return 0;
}

/** setConfig(species/nature/sp)からChampions式の素早さ実数値を計算する(参考値、上記コメント参照)。 */
function effectiveSpeed(dex, setConfig) {
	const species = dex.species.get(setConfig.species);
	const mod = speModFromNature(dex, setConfig.nature);
	return calcStat(species.baseStats.spe, (setConfig.sp && setConfig.sp.spe) || 0, mod);
}

/** championsのlearnsetデータで技を習得可能か判定する(メガ/フォルム違いはbaseSpeciesまで遡って確認)。 */
function canLearnMove(dex, speciesId, moveId) {
	const move = dex.moves.get(moveId);
	let cur = dex.species.get(speciesId);
	const seen = new Set();
	while (cur && cur.exists && !seen.has(cur.id)) {
		seen.add(cur.id);
		const learnsetData = dex.species.getLearnsetData(cur.id);
		if (learnsetData && learnsetData.learnset && learnsetData.learnset[move.id]) return true;
		if (!cur.baseSpecies || cur.baseSpecies === cur.name) break;
		cur = dex.species.get(cur.baseSpecies);
	}
	return false;
}

function countStatusMoves(dex, moveNames) {
	return moveNames.filter(m => { const mv = dex.moves.get(m); return mv.exists && mv.category === 'Status'; });
}

// ---------------------------------------------------------------------------
// 確定数比較(6a: 攻撃技)
// ---------------------------------------------------------------------------

/**
 * 攻撃側1体・技1つ vs 上位N体それぞれの確定数を計算する。
 * v2スキーマ(複数セット)の場合は全セットに対して計算し、weightで加重平均した確定数を返す。
 * @returns {Array<{speciesId, pct, rolls, guaranteed, summary}>}
 */
function evaluateMoveAgainstDefenders(attackerSetConfig, moveName, defenders, level) {
	return defenders.map(({ speciesId, pct, entry, sets }) => {
		const perSet = sets.map(s => {
			const result = calcMatchup({ attacker: attackerSetConfig, defender: s.setConfig, move: moveName, level });
			const hp = result.defender.maxhp;
			const g = guaranteedHits(result.rolls, hp);
			return { weight: s.weight, rolls: result.rolls, hp, guaranteed: g, setSum: rollSummary(result.rolls, hp) };
		});
		// 加重平均確定数(v1は weight=1.0 単一セットなので従来と同値)
		const weightedG = perSet.reduce((sum, s) => sum + s.weight * s.guaranteed, 0);
		const mainSet = perSet.reduce((a, b) => a.weight >= b.weight ? a : b);
		// 複数セット種は内訳付きサマリ
		const summary = sets.length === 1
			? mainSet.setSum
			: `加重平均${weightedG.toFixed(1)}発 (${perSet.map(s => `${(s.weight * 100).toFixed(0)}%:${s.guaranteed}発`).join('/')})`;
		return { speciesId, pct, rolls: mainSet.rolls, guaranteed: weightedG, summary };
	});
}

/** defenders各体に対し、defenderSetConfigに追加boostsを適用したうえでmoveNameを撃った結果を返す(v2対応)。 */
function evaluateMoveAgainstBoostedDefenders(attackerSetConfig, moveName, defenders, level, boosts) {
	return defenders.map(({ speciesId, pct, entry, sets }) => {
		const perSet = sets.map(s => {
			const defenderSetConfig = { ...s.setConfig, boosts };
			const result = calcMatchup({ attacker: attackerSetConfig, defender: defenderSetConfig, move: moveName, level });
			const hp = result.defender.maxhp;
			const g = guaranteedHits(result.rolls, hp);
			return { weight: s.weight, rolls: result.rolls, hp, guaranteed: g, setSum: rollSummary(result.rolls, hp) };
		});
		const weightedG = perSet.reduce((sum, s) => sum + s.weight * s.guaranteed, 0);
		const mainSet = perSet.reduce((a, b) => a.weight >= b.weight ? a : b);
		const summary = sets.length === 1
			? mainSet.setSum
			: `加重平均${weightedG.toFixed(1)}発 (${perSet.map(s => `${(s.weight * 100).toFixed(0)}%:${s.guaranteed}発`).join('/')})`;
		return { speciesId, pct, rolls: mainSet.rolls, guaranteed: weightedG, summary };
	});
}

/**
 * 既存の攻撃技構成(複数)それぞれについて上位N体への確定数を計算し、
 * 相手ごとの「既存技の中の最良(最速)確定数」を返す。attackerBoostsを渡すと積み後の比較になる。
 */
function evaluateExistingMoves(attackerSetConfig, existingAttackMoves, defenders, level, attackerBoosts) {
	const attacker = attackerBoosts ? { ...attackerSetConfig, boosts: attackerBoosts } : attackerSetConfig;
	const perMove = existingAttackMoves.map(moveName => ({
		move: moveName,
		results: evaluateMoveAgainstDefenders(attacker, moveName, defenders, level),
	}));

	const bestPerDefender = defenders.map((d, i) => {
		let best = null;
		for (const { move, results } of perMove) {
			const r = results[i];
			if (!best || r.guaranteed < best.guaranteed) best = { move, ...r };
		}
		return best;
	});

	return { perMove, bestPerDefender };
}

/** 既存の攻撃技構成それぞれについて、defender側にboostsを適用した状態での最良確定数を返す(v2対応)。 */
function evaluateExistingMovesVsBoostedDefenders(attackerSetConfig, existingAttackMoves, defenders, level, boosts) {
	return defenders.map(({ speciesId, pct, entry, sets }) => {
		const perSet = sets.map(s => {
			const defenderSetConfig = { ...s.setConfig, boosts };
			let best = null;
			for (const moveName of existingAttackMoves) {
				const result = calcMatchup({ attacker: attackerSetConfig, defender: defenderSetConfig, move: moveName, level });
				const g = guaranteedHits(result.rolls, result.defender.maxhp);
				if (!best || g < best.guaranteed) best = { move: moveName, guaranteed: g, summary: rollSummary(result.rolls, result.defender.maxhp) };
			}
			return { weight: s.weight, best };
		});
		// 加重平均確定数
		const weightedG = perSet.reduce((sum, s) => sum + s.weight * (s.best ? s.best.guaranteed : Infinity), 0);
		const mainSet = perSet.reduce((a, b) => a.weight >= b.weight ? a : b);
		const best = mainSet.best ? { ...mainSet.best, guaranteed: weightedG } : null;
		return { speciesId, pct, best };
	});
}

/** 相手(threatSetConfig)がmoveNameを自軍全体(teamMembers)に撃った場合の平均ダメージ(before/after)をboosts適用の有無で比較する。 */
function averageDamageWithBoost(threatSetConfig, moveName, teamMembers, level, boosts) {
	const without = teamMembers.map(m => avg(calcMatchup({ attacker: threatSetConfig, defender: m.setConfig, move: moveName, level }).rolls));
	const withBoost = teamMembers.map(m => avg(calcMatchup({ attacker: { ...threatSetConfig, boosts }, defender: m.setConfig, move: moveName, level }).rolls));
	return { before: avg(without), after: avg(withBoost) };
}

// ---------------------------------------------------------------------------
// おにび(火傷付与)モデル
// ---------------------------------------------------------------------------

/**
 * DESIGN.md「おにび」節: 損益分岐ターン数 = 自分の最良攻撃1発分の機会損失 ÷
 * (相手の主力物理技ダメージ半減(a) + 最大HP1/16の残飯毒ダメージ(b))。
 * existingAttackMoves が空(=確定追加効果としての簡易評価)の場合は機会損失0として扱う。
 */
function modelBurn(dex, moveName, attackerSetConfig, existingAttackMoves, defenders, teamMembers, level, noAccuracy) {
	const move = dex.moves.get(moveName);
	const accuracy = move.accuracy === true ? 100 : move.accuracy;
	const accuracyFactor = noAccuracy ? 1 : accuracy / 100;
	const lines = [];
	lines.push(`損益分岐ターン数 = 機会損失(自分の最良攻撃1発分) ÷ ((a)被ダメ軽減 + (b)残飯毒ダメージ)。` +
		`命中率${accuracy}%を${noAccuracy ? '無視(--no-accuracy)' : `期待値として係数${accuracyFactor.toFixed(2)}で考慮`}。`);
	lines.push('');

	const immune = [];
	const counterproductive = [];
	const rows = [];

	for (const { speciesId, pct, entry, sets } of defenders) {
		// --- v1/v2 両対応: 全セットを評価し weightで加重平均 ---
		let weightedA = 0, weightedB = 0, weightedOp = 0, activeWeight = 0;
		let anyCounterprod = [];
		let hasMainPhysical = false;
		let skipSpecies = false;

		for (const s of sets) {
			const defSetConfig = s.setConfig;
			const species = dex.species.get(defSetConfig.species);
			// タイプによる無効(同一種のセット間でタイプは変わらないので最初の1セットで判定)
			if (species.types.includes('Fire')) {
				immune.push(`${speciesId}(ほのおタイプ)`);
				skipSpecies = true;
				break;
			}
			// 特性による無効(セットごとに異なる可能性がある)
			if (defSetConfig.ability === 'Water Bubble' || defSetConfig.ability === 'Thermal Exchange') {
				// このセットは無効 — 全セット確認後に合算
				continue;
			}
			if (defSetConfig.ability === 'Guts' || defSetConfig.ability === 'Flare Boost') {
				anyCounterprod.push(`${speciesId}(特性${defSetConfig.ability} — 火傷させると相手を強化してしまう)`);
			}

			const hp = calcHp(species.baseStats.hp, (defSetConfig.sp && defSetConfig.sp.hp) || 0);
			const b = hp * BURN_RESIDUAL_FRACTION;

			let aAvg = 0;
			if (s.mainPhysical) {
				hasMainPhysical = true;
				const reductions = teamMembers.map(member => {
					const without = avg(calcMatchup({ attacker: defSetConfig, defender: member.setConfig, move: s.mainPhysical, level }).rolls);
					const withBurn = avg(calcMatchup({ attacker: { ...defSetConfig, status: 'brn' }, defender: member.setConfig, move: s.mainPhysical, level }).rolls);
					return without - withBurn;
				});
				aAvg = avg(reductions);
			}

			let opportunityCost = 0;
			if (existingAttackMoves.length) {
				const dmgs = existingAttackMoves.map(m => avg(calcMatchup({ attacker: attackerSetConfig, defender: defSetConfig, move: m, level }).rolls));
				opportunityCost = Math.max(...dmgs);
			}

			weightedA += s.weight * aAvg;
			weightedB += s.weight * b;
			weightedOp += s.weight * opportunityCost;
			activeWeight += s.weight;
		}

		if (skipSpecies) continue;
		if (activeWeight === 0) {
			// 全セット特性無効
			immune.push(`${speciesId}(特性Water Bubble/Thermal Exchangeで無効)`);
			continue;
		}
		// 有効セットの加重平均(免疫セット分は期待値0として全weight=1.0分母で評価)
		const aAvg = weightedA / activeWeight;
		const b = weightedB / activeWeight;
		const opportunityCost = existingAttackMoves.length ? weightedOp / activeWeight : 0;
		// activeWeight < 1.0 の場合は有効な確率だけ perTurn が得られる
		const perTurn = (aAvg + b) * accuracyFactor * activeWeight;
		const breakEven = perTurn > 0 ? opportunityCost / perTurn : (opportunityCost > 0 ? Infinity : 0);

		for (const c of anyCounterprod) counterproductive.push(c);
		rows.push({ speciesId, pct, aAvg, b, opportunityCost, breakEven, hasMainPhysical });
	}

	rows.sort((x, y) => x.breakEven - y.breakEven);
	lines.push('| 相手 | 採用率 | 被ダメ軽減(a)/ターン | 残飯毒ダメ(b)/ターン | 機会損失(1発分) | 損益分岐ターン数 |');
	lines.push('| --- | --- | --- | --- | --- | --- |');
	for (const r of rows) {
		lines.push(`| ${r.speciesId}${r.hasMainPhysical ? '' : '(特殊型のためa=0)'} | ${r.pct.toFixed(1)}% | ${r.aAvg.toFixed(1)} | ${r.b.toFixed(1)} | ${r.opportunityCost.toFixed(1)} | ` +
			`${Number.isFinite(r.breakEven) ? r.breakEven.toFixed(1) + 'ターン' : (r.breakEven === 0 ? '即座に得(機会損失なし)' : '∞(元が取れない)')} |`);
	}
	lines.push('');

	if (counterproductive.length) {
		lines.push('**逆効果(火傷させると相手が得をする)**:');
		for (const c of counterproductive) lines.push(`- ${c}`);
		lines.push('');
	}
	if (immune.length) {
		lines.push('**無効**:');
		for (const c of immune) lines.push(`- ${c}`);
		lines.push('');
	}
	return lines;
}

// ---------------------------------------------------------------------------
// でんじは(まひ付与)/ 素早さダウン共通モデル
// ---------------------------------------------------------------------------

/**
 * DESIGN.md「でんじは」節。fullParalysis=true: 状態異常のまひ(素早さ半減+1/8で行動不能)。
 * fullParalysis=false: 攻撃技の確定追加効果などによる素早さのランクダウン(交代で解除、行動不能要素なし)。
 */
function modelSpeedControl(dex, moveName, defenders, teamMembers, level, { fullParalysis, stage }) {
	const speedMult = fullParalysis ? PARALYSIS_SPEED_MULT : stageMultiplier(-Math.abs(stage));
	const lines = [];
	if (fullParalysis) {
		lines.push(`まひ付与: 素早さ${(speedMult * 100).toFixed(0)}%化(本編どおり)。` +
			`行動不能は1/8(12.5%)/ターン(README/DESIGN.md検証済み — 本編25%の半分に弱体化、Champions固有仕様)。`);
	} else {
		lines.push(`素早さ${Math.abs(stage)}段階ダウン(×${speedMult.toFixed(2)})。状態異常ではなく能力ランクなので交代で解除される点に注意。`);
	}
	lines.push('');

	const immune = [];
	const rows = [];
	for (const { speciesId, pct, entry, sets } of defenders) {
		// --- v2対応: 全セットの素早さをweightで加重平均 ---
		let typeImmune = false;
		let activeSetData = [];
		let abilityImmuneWeight = 0;

		for (const s of sets) {
			const species = dex.species.get(s.setConfig.species);
			if (fullParalysis) {
				// タイプ無効は同一種で共通
				if (species.types.includes('Electric') || species.types.includes('Ground')) {
					typeImmune = true;
					break;
				}
				if (s.setConfig.ability === 'Limber') {
					abilityImmuneWeight += s.weight;
					continue;
				}
			}
			activeSetData.push({ weight: s.weight, rawSpeed: effectiveSpeed(dex, s.setConfig) });
		}

		if (typeImmune) { immune.push(`${speciesId}(でんき/じめんタイプで無効)`); continue; }
		if (activeSetData.length === 0) { immune.push(`${speciesId}(特性Limberで無効)`); continue; }

		// 有効セットのweightで正規化した加重平均素早さ
		const activeWeight = activeSetData.reduce((sum, s) => sum + s.weight, 0);
		const rawSpeed = Math.round(activeSetData.reduce((sum, s) => sum + s.weight * s.rawSpeed, 0) / activeWeight);
		const modifiedSpeed = Math.floor(rawSpeed * speedMult);

		const reversals = teamMembers
			.map(member => ({ name: member.name, speed: effectiveSpeed(dex, member.setConfig) }))
			.filter(m => m.speed < rawSpeed && m.speed > modifiedSpeed)
			.map(m => `${m.name}(${m.speed})`);

		rows.push({ speciesId, pct, rawSpeed, modifiedSpeed, reversals });
	}

	lines.push('| 相手 | 採用率 | 通常素早さ | ダウン後 | 逆転する自軍メンバー |');
	lines.push('| --- | --- | --- | --- | --- |');
	for (const r of rows) {
		lines.push(`| ${r.speciesId} | ${r.pct.toFixed(1)}% | ${r.rawSpeed} | ${r.modifiedSpeed} | ${r.reversals.length ? r.reversals.join(', ') : '(なし)'} |`);
	}
	lines.push('');
	if (immune.length) {
		lines.push('**無効**:');
		for (const c of immune) lines.push(`- ${c}`);
		lines.push('');
	}
	return lines;
}

// ---------------------------------------------------------------------------
// つるぎのまい(自分に積む変化技)モデル
// ---------------------------------------------------------------------------

function modelSetup(dex, moveName, attackerSetConfig, existingAttackMoves, defenders, level) {
	const move = dex.moves.get(moveName);
	const boosts = move.boosts || {};
	const lines = [];
	lines.push(`自分に ${Object.entries(boosts).map(([s, v]) => `${s}${v > 0 ? '+' : ''}${v}`).join(', ')} を積んだ状態で` +
		'既存の攻撃技を打った場合の確定数の変化(6aと同じ既存攻撃技構成を使用)。');
	lines.push('');

	if (!existingAttackMoves.length) {
		lines.push('(既存の攻撃技がないため確定数の比較ができません)');
		lines.push('');
		return lines;
	}

	const before = evaluateExistingMoves(attackerSetConfig, existingAttackMoves, defenders, level).bestPerDefender;
	const after = evaluateExistingMoves(attackerSetConfig, existingAttackMoves, defenders, level, boosts).bestPerDefender;

	const improved = [];
	defenders.forEach((d, i) => {
		const b = before[i], a = after[i];
		if (a && b && a.guaranteed < b.guaranteed) improved.push(`${d.speciesId}(採用率${d.pct.toFixed(1)}%): ${b.move} ${b.summary} → ${a.move} ${a.summary}`);
	});
	lines.push(`**確定数が改善する相手(${improved.length}/${defenders.length}体)**:`);
	if (improved.length) { for (const s of improved) lines.push(`- ${s}`); } else { lines.push('(なし)'); }
	lines.push('');

	lines.push('**積むターンの被弾チェック**(相手の主力技のうち最も痛いもの1発を耐えられるか):');
	const myHp = (() => {
		const species = dex.species.get(attackerSetConfig.species);
		return calcHp(species.baseStats.hp, (attackerSetConfig.sp && attackerSetConfig.sp.hp) || 0);
	})();
	for (const { speciesId, pct, entry, sets } of defenders) {
		// --- v2対応: 全セットの最大ダメージをweightで加重平均 ---
		let weightedMaxDmg = 0;
		let hasAnyMove = false;
		let mainMoveName = null;

		for (const s of sets) {
			const threatMoves = [s.mainPhysical, s.mainSpecial].filter(Boolean);
			if (!threatMoves.length) { weightedMaxDmg += 0; continue; }
			hasAnyMove = true;
			const results = threatMoves.map(m => calcMatchup({ attacker: s.setConfig, defender: attackerSetConfig, move: m, level }));
			const worstResult = results.reduce((x, y) => (Math.max(...y.rolls) > Math.max(...x.rolls) ? y : x));
			if (!mainMoveName || s.weight > sets[0].weight) mainMoveName = worstResult.move;
			weightedMaxDmg += s.weight * Math.max(...worstResult.rolls);
		}

		if (!hasAnyMove) { lines.push(`- ${speciesId}: (主力技情報なし)`); continue; }
		const survives = weightedMaxDmg < myHp;
		const dmgLabel = sets.length === 1 ? `${mainMoveName} 最大${Math.round(weightedMaxDmg)}` : `加重平均最大${Math.round(weightedMaxDmg)}`;
		lines.push(`- ${speciesId}(採用率${pct.toFixed(1)}%): ${dmgLabel} / HP${myHp} → ${survives ? '耐える' : '確定で落ちる'}`);
	}
	lines.push('');
	return lines;
}

// ---------------------------------------------------------------------------
// 眠り技 / あくび(ネットテンポモデル)
// ---------------------------------------------------------------------------

function modelSleep(dex, moveName, defenders) {
	const move = dex.moves.get(moveName);
	const accuracy = move.accuracy === true ? 100 : move.accuracy;
	const netTempo = (accuracy / 100) * CHAMPIONS_SLEEP_EXPECTED_TURNS - 1;
	const lines = [];
	lines.push(`ネットテンポ = 命中率(${accuracy}%) × ${CHAMPIONS_SLEEP_EXPECTED_TURNS.toFixed(2)}(Champions固有の眠りターン数期待値、` +
		`本編は1〜3ターン一様=期待値2よりも短い) − 1 = **${netTempo >= 0 ? '+' : ''}${netTempo.toFixed(2)}**`);
	lines.push('1ターンの価値は盤面依存(起点作り中の1ターンと中立盤面の1ターンは等価ではない)点に注意。');
	lines.push('');
	if (move.flags && move.flags.powder) {
		// v2対応: 全セットのうち1セットでも免疫なら「免疫あり」と判定
		const immune = defenders.filter(({ speciesId, sets }) =>
			sets.some(s => {
				const species = dex.species.get(s.setConfig.species);
				return species.types.includes('Grass') || s.setConfig.ability === 'Overcoat';
			})
		);
		lines.push('**粉技のため無効(くさタイプ・特性ぼうじん、上位' + defenders.length + '体中)**:');
		lines.push(immune.length ? immune.map(d => {
			const mainS = d.sets.reduce((a, b) => a.weight >= b.weight ? a : b);
			return `${d.speciesId}${mainS.setConfig.ability === 'Overcoat' ? '(ぼうじん)' : '(くさタイプ)'}`;
		}).join(', ') : '(該当なし)');
		lines.push('');
	}
	return lines;
}

function modelYawn(dex, defenders) {
	const lines = [];
	const stayValue = CHAMPIONS_SLEEP_EXPECTED_TURNS - 1;
	lines.push(`分岐モデル:`);
	lines.push(`- 居座られた場合: ネットテンポ = ${CHAMPIONS_SLEEP_EXPECTED_TURNS.toFixed(2)} − 1 = **+${stayValue.toFixed(2)}**`);
	lines.push('- 交代された場合: ネットテンポ = **±0** + 交代を強制できた分の設置技ダメージ' +
		'(ステルスロック等を採用していれば加点。6c実装後に連動予定)');
	lines.push('どちらに転んでも損しない構造だが、交代分岐は「相手に有利対面を作られるリスク」を含む(定性、数値化しない)。');
	lines.push('');
	const immuneAbilities = ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt', 'Shields Down'];
	// v2対応: 全セットのうち1セットでも免疫特性があれば列挙
	const immune = defenders.filter(({ sets }) => sets.some(s => immuneAbilities.includes(s.setConfig.ability)));
	lines.push(`**特性による無効(上位${defenders.length}体中)**:`);
	lines.push(immune.length ? immune.map(d => {
		const imSet = d.sets.find(s => immuneAbilities.includes(s.setConfig.ability));
		return `${d.speciesId}(特性${imSet.setConfig.ability})`;
	}).join(', ') :
		'(該当なし。ただしエレキ/ミストフィールド・ふみん等の場依存条件は別途確認すること)');
	lines.push('');
	return lines;
}

// ---------------------------------------------------------------------------
// 行動制約系 部分指標(ちょうはつ/アンコール/みちづれ)
// ---------------------------------------------------------------------------

function modelTaunt(dex, attackerSetConfig, defenders, teamMembers) {
	const lines = [];
	lines.push('**攻め(自分がちょうはつを採用する場合)**: 変化技が技構成の半分(2つ)以上を占める上位脅威:');
	// v2対応: 最高weight のセットの技構成を代表として使う
	const heavy = defenders.map(d => {
		const mainSet = d.sets.reduce((a, b) => a.weight >= b.weight ? a : b);
		return { ...d, statusMoves: countStatusMoves(dex, mainSet.moves) };
	}).filter(d => d.statusMoves.length >= 2);
	if (heavy.length) {
		for (const d of heavy) lines.push(`- ${d.speciesId}(採用率${d.pct.toFixed(1)}%): 変化技${d.statusMoves.length}/4(${d.statusMoves.join(', ')})`);
	} else {
		lines.push('(該当なし)');
	}
	lines.push('');

	lines.push('**守り(相手にちょうはつを撃たれる場合)**:');
	lines.push('(a) 上位脅威のうちちょうはつを覚えられる種(learnsetベース。実際に技構成に採用しているかは別問題):');
	// v2対応: 全セットの species のうち1つでも習得可能なら列挙
	const canLearnTaunt = defenders.filter(({ speciesId, sets }) =>
		sets.some(s => canLearnMove(dex, s.setConfig.species, 'taunt')));
	lines.push(canLearnTaunt.length ? canLearnTaunt.map(d => d.speciesId).join(', ') : '(該当なし)');
	lines.push('');
	lines.push('(b) 自軍メンバーの変化技依存度(4技中の変化技数。多いほどちょうはつで機能停止しやすい):');
	for (const member of teamMembers) {
		const statusMoves = countStatusMoves(dex, member.moves);
		lines.push(`- ${member.name}: 変化技${statusMoves.length}/${member.moves.length}${statusMoves.length ? `(${statusMoves.join(', ')})` : ''}`);
	}
	lines.push('');
	return lines;
}

function modelEncore(dex, attackerSetConfig, defenders, teamMembers) {
	const lines = [];
	lines.push('アンコールは自分が先に動けることが前提(既に選択済みの技を固定するため)。--pokemon と上位脅威の速度関係:');
	const mySpeed = effectiveSpeed(dex, attackerSetConfig);
	for (const { speciesId, pct, entry, sets } of defenders) {
		// v2対応: 全セットの素早さをweightで加重平均
		const theirSpeed = Math.round(sets.reduce((sum, s) => sum + s.weight * effectiveSpeed(dex, s.setConfig), 0));
		const verdict = mySpeed > theirSpeed ? '先制できる(有効)' : mySpeed === theirSpeed ? '同速(五分)' : '後攻(基本不発)';
		lines.push(`- ${speciesId}(採用率${pct.toFixed(1)}%): 自分${mySpeed} vs 相手${theirSpeed} → ${verdict}`);
	}
	lines.push('');
	lines.push('守り(相手にアンコールを撃たれる場合)の覚え得る上位脅威:');
	// v2対応: 全セットのうち1つでも習得可能なら列挙
	const canLearn = defenders.filter(({ speciesId, sets }) =>
		sets.some(s => canLearnMove(dex, s.setConfig.species, 'encore')));
	lines.push(canLearn.length ? canLearn.map(d => d.speciesId).join(', ') : '(該当なし)');
	lines.push('');
	return lines;
}

function modelDestinyBond(dex, attackerSetConfig, defenders) {
	const lines = [];
	lines.push('1:1交換技のためテンポモデルには乗らない。みちづれを安全に宣言するには基本的に相手より先に動ける' +
		'(瀕死を見てから安全に選択できる)ことが望ましい。静的な速度関係のみ提示する(定性判断は別途):');
	const mySpeed = effectiveSpeed(dex, attackerSetConfig);
	for (const { speciesId, pct, entry, sets } of defenders) {
		// v2対応: 全セットの素早さをweightで加重平均
		const theirSpeed = Math.round(sets.reduce((sum, s) => sum + s.weight * effectiveSpeed(dex, s.setConfig), 0));
		lines.push(`- ${speciesId}(採用率${pct.toFixed(1)}%): 自分${mySpeed} vs 相手${theirSpeed}${mySpeed > theirSpeed ? '(自分が速い)' : mySpeed === theirSpeed ? '(同速)' : '(相手が速い)'}`);
	}
	lines.push('');
	return lines;
}

// ---------------------------------------------------------------------------
// 確定(chance:100)ランク変化の統一ディスパッチ
// (攻撃技の確定追加効果 = ハイブリッド評価 / 相手対象の純粋な変化技、両方から呼ぶ)
// ---------------------------------------------------------------------------

/**
 * 相手の能力を対象stat/stage分だけ下げる効果の価値を記述する。
 * spe: でんじはモデルの倍率変更版。atk/spa: おにびモデルの変形(自軍への被ダメ軽減)。
 * def/spd: 自分の既存攻撃技の確定数改善チェック。
 */
function describeOpponentStatDrop(dex, stat, stage, attackerSetConfig, existingAttackMoves, defenders, teamMembers, level) {
	const lines = [];
	if (stat === 'spe') {
		lines.push(...modelSpeedControl(dex, null, defenders, teamMembers, level, { fullParalysis: false, stage }));
		return lines;
	}
	if (stat === 'atk' || stat === 'spa') {
		const key = stat === 'atk' ? 'mainPhysical' : 'mainSpecial';
		const mult = stageMultiplier(stage);
		lines.push(`相手の${stat === 'atk' ? '物理' : '特殊'}技ダメージが×${mult.toFixed(2)}になる(自軍全体平均、` +
			`相手の主力${stat === 'atk' ? '物理' : '特殊'}技基準):`);
		lines.push('');
		lines.push('| 相手 | 主力技 | 通常ダメージ平均 | ダウン後ダメージ平均 |');
		lines.push('| --- | --- | --- | --- |');
		for (const { speciesId, pct, entry, sets } of defenders) {
			// v2対応: 全セットをweightで加重平均
			let weightedBefore = 0, weightedAfter = 0, totalW = 0;
			for (const s of sets) {
				const mainMove = s[key];
				if (!mainMove) continue;
				const { before, after } = averageDamageWithBoost(s.setConfig, mainMove, teamMembers, level, { [stat]: stage });
				weightedBefore += s.weight * before;
				weightedAfter += s.weight * after;
				totalW += s.weight;
			}
			if (totalW === 0) { lines.push(`| ${speciesId} | (該当技なし) | - | - |`); continue; }
			// 代表技名は最高weightセットのもの
			const mainSet = sets.reduce((a, b) => a.weight >= b.weight ? a : b);
			const mainMoveName = mainSet[key] || '(複数)';
			lines.push(`| ${speciesId}(${pct.toFixed(1)}%) | ${mainMoveName} | ${(weightedBefore / totalW).toFixed(1)} | ${(weightedAfter / totalW).toFixed(1)} |`);
		}
		lines.push('');
		return lines;
	}
	if (stat === 'def' || stat === 'spd') {
		lines.push(`相手の${stat === 'def' ? '物理防御' : '特殊防御'}ダウン(×${stageMultiplier(stage).toFixed(2)})により、` +
			'自分の既存攻撃技の確定数がどう変わるか:');
		lines.push('');
		if (!existingAttackMoves.length) {
			lines.push('(既存の攻撃技がないため比較できません)');
			lines.push('');
			return lines;
		}
		const before = evaluateExistingMoves(attackerSetConfig, existingAttackMoves, defenders, level).bestPerDefender;
		const after = evaluateExistingMovesVsBoostedDefenders(attackerSetConfig, existingAttackMoves, defenders, level, { [stat]: stage });
		const improved = [];
		defenders.forEach((d, i) => {
			const b = before[i], a = after[i].best;
			if (b && a && a.guaranteed < b.guaranteed) improved.push(`${d.speciesId}(${d.pct.toFixed(1)}%): ${b.move} ${b.summary} → ${a.move} ${a.summary}`);
		});
		lines.push(`確定数が改善する相手(${improved.length}/${defenders.length}体):`);
		if (improved.length) { improved.forEach(s => lines.push(`- ${s}`)); } else { lines.push('(なし)'); }
		lines.push('');
		return lines;
	}
	lines.push(`(${stat}のランク変化モデルは未実装)`);
	lines.push('');
	return lines;
}

/** 攻撃技の確定(chance:100)追加効果を検出し、対応するモデルの簡易版をハイブリッドで追記する。 */
function describeGuaranteedSecondary(dex, move, attackerSetConfig, defenders, teamMembers, level, noAccuracy) {
	const secondaries = (move.secondaries && move.secondaries.length ? move.secondaries : (move.secondary && Object.keys(move.secondary).length ? [move.secondary] : []));
	const guaranteed = secondaries.find(s => s && s.chance === 100 && (s.boosts || s.status));
	if (!guaranteed) return [];

	const label = guaranteed.status ? `状態異常「${guaranteed.status}」` :
		Object.entries(guaranteed.boosts).map(([s, v]) => `${s}${v > 0 ? '+' : ''}${v}`).join(', ');
	const lines = ['', `### 付加効果(確定100%): ${label}`, '', '攻撃技モデルとの合算(ハイブリッド評価)として以下を追記する:', ''];

	if (guaranteed.status === 'brn') {
		// 既に自分の攻撃を撃っている前提のボーナス効果なので機会損失は0として扱う。
		lines.push(...modelBurn(dex, move.id, attackerSetConfig, [], defenders, teamMembers, level, noAccuracy));
	} else if (guaranteed.status === 'par') {
		lines.push(...modelSpeedControl(dex, move.id, defenders, teamMembers, level, { fullParalysis: true }));
	} else if (guaranteed.boosts) {
		for (const [stat, stage] of Object.entries(guaranteed.boosts)) {
			if (stage >= 0) continue;
			lines.push(...describeOpponentStatDrop(dex, stat, stage, attackerSetConfig, [], defenders, teamMembers, level));
		}
	} else {
		lines.push('(この付加効果のモデルは未実装)', '');
	}
	return lines;
}

// ---------------------------------------------------------------------------
// ステルスロック / どくびし / まきびし / 壁 (6c: チーム文脈モデル群)
// ---------------------------------------------------------------------------

/** ステルスロックの被ダメ割合(最大HP比)。0.125 * 2^(岩タイプ相性の指数)、3.125%~50%の範囲。 */
function stealthRockFraction(dex, types) {
	return 0.125 * Math.pow(2, dex.getEffectiveness('Rock', types));
}

/** research/usage/ の生CSV(222構築)から、構築ごとの平均ステルスロック被ダメ率を求める。 */
function computeStealthRockPerTeam(dex, teams) {
	return teams.map(team => {
		const fractions = team.slots
			.map(slot => slot.speciesId && dex.species.get(slot.speciesId))
			.filter(sp => sp && sp.exists)
			.map(sp => stealthRockFraction(dex, sp.types));
		return { rank: team.rank, rating: team.rating, avgFrac: fractions.length ? avg(fractions) : null, count: fractions.length };
	}).filter(t => t.avgFrac !== null);
}

function modelStealthRock(dex, switches) {
	const { teams } = loadTeams();
	const perTeam = computeStealthRockPerTeam(dex, teams);
	const overallAvg = avg(perTeam.map(t => t.avgFrac));
	const sorted = [...perTeam].sort((a, b) => b.avgFrac - a.avgFrac);

	const lines = [];
	lines.push(`上位構築${perTeam.length}件の実際の6体構成(research/usage/の最新CSV)から、各メンバーの複合タイプに対する` +
		'岩弱点ダメージ(最大HPの3.125%〜50%、`0.125 * 2^(岩タイプ相性の指数)`)を構築単位で平均した分布。');
	lines.push('アイテムによる軽減(たつじんのおび等)は無効化技以外考慮しない。' +
		'あつぞこブーツはChampionsで使用禁止のため軽減手段が存在しない前提(README確認済み)。');
	lines.push('');
	lines.push(`**上位構築平均: 交代1回あたり敵HP ${(overallAvg * 100).toFixed(1)}%**`);
	lines.push(`期待交代回数${switches}回想定 → 累計 ${(overallAvg * switches * 100).toFixed(1)}%相当` +
		'(※同一/別の相手への複数回のSRダメージを単純合算しただけの粗い試算。回復・複数回撒き直しは考慮しない)');
	lines.push('');
	lines.push('**特に刺さる構築(上位3、平均ダメージ率が高い順)**:');
	for (const t of sorted.slice(0, 3)) lines.push(`- 順位${t.rank}(レート${t.rating}): 平均${(t.avgFrac * 100).toFixed(1)}%`);
	lines.push('');
	lines.push('**刺さりにくい構築(下位3、平均ダメージ率が低い順)**:');
	for (const t of sorted.slice(-3).reverse()) lines.push(`- 順位${t.rank}(レート${t.rating}): 平均${(t.avgFrac * 100).toFixed(1)}%`);
	lines.push('');
	return lines;
}

function modelToxicSpikes(dex) {
	const { teams } = loadTeams();
	let countedTeams = 0, ratioSum = 0, teamsWithAbsorber = 0, workingTeams = 0;
	for (const team of teams) {
		const speciesList = team.slots.map(s => s.speciesId).filter(Boolean).map(id => dex.species.get(id)).filter(sp => sp.exists);
		if (!speciesList.length) continue;
		countedTeams++;
		const grounded = speciesList.filter(sp => !sp.types.includes('Flying'));
		const groundedPoisonable = grounded.filter(sp => !sp.types.includes('Poison') && !sp.types.includes('Steel'));
		const hasAbsorber = grounded.some(sp => sp.types.includes('Poison'));
		ratioSum += groundedPoisonable.length / speciesList.length;
		if (hasAbsorber) teamsWithAbsorber++;
		if (groundedPoisonable.length >= 1 && !hasAbsorber) workingTeams++;
	}
	const lines = [];
	lines.push('接地判定は「ひこうタイプでない」のみで簡易化(ふゆう特性・ふうせん等の個別要因は未考慮)。' +
		'毒が入るかは「どく/はがねタイプでない」のみで判定(めんえき/ポイズンヒール等の特性は未考慮)。');
	lines.push('');
	lines.push(`- 上位構築${countedTeams}件平均で、接地かつ毒が入るメンバーの割合: ${(ratioSum / countedTeams * 100).toFixed(1)}%`);
	lines.push(`- 接地どくタイプ(吸収役)を1体以上含む構築: ${teamsWithAbsorber}/${countedTeams}件(${(teamsWithAbsorber / countedTeams * 100).toFixed(1)}%)`);
	lines.push(`- **どくびしが機能する構築の割合**(接地毒可メンバー1体以上、かつ吸収役なし): ${workingTeams}/${countedTeams}件(${(workingTeams / countedTeams * 100).toFixed(1)}%)`);
	lines.push('');
	return lines;
}

/** まきびし(1層)の簡易モデル。接地メンバーへ最大HP1/8、タイプ相性は関与しない。 */
function modelSpikes(dex) {
	const { teams } = loadTeams();
	let count = 0, total = 0;
	for (const team of teams) {
		const speciesList = team.slots.map(s => s.speciesId).filter(Boolean).map(id => dex.species.get(id)).filter(sp => sp.exists);
		if (!speciesList.length) continue;
		count++;
		total += (speciesList.filter(sp => !sp.types.includes('Flying')).length / speciesList.length) * 0.125;
	}
	const avgFrac = count ? total / count : 0;
	return [
		`1層設置と仮定(接地メンバーに最大HPの1/8、タイプ相性は関与しない)。上位構築${count}件平均で、` +
		`交代1回あたり敵HP${(avgFrac * 100).toFixed(1)}%相当。`,
		'',
	];
}

/** 壁(リフレクター/ひかりのかべ/オーロラベール)による確定数の変化。 */
function modelScreen(dex, moveName, defenders, teamMembers, level) {
	const move = dex.moves.get(moveName);
	const affectsPhysical = move.id === 'reflect' || move.id === 'auroraveil';
	const affectsSpecial = move.id === 'lightscreen' || move.id === 'auroraveil';
	const lines = [];
	lines.push(`${move.name}展開下で、上位脅威の主力技→自軍各メンバーのダメージの確定数がどう変わるか` +
		'(確定数が変わる=行動回数が1回増える組み合わせを列挙)。');
	if (move.id === 'auroraveil') lines.push('(本編仕様上は霰/雪下限定の技。ここでは展開できた前提での価値のみ試算)');
	lines.push('');

	const rows = [];
	for (const { speciesId, pct, entry, sets } of defenders) {
		// v2対応: 全セットに対して個別に計算し列挙する
		for (const s of sets) {
			const movesToCheck = [];
			if (affectsPhysical && s.mainPhysical) movesToCheck.push(s.mainPhysical);
			if (affectsSpecial && s.mainSpecial) movesToCheck.push(s.mainSpecial);
			const weightLabel = sets.length > 1 ? `[${(s.weight * 100).toFixed(0)}%]` : '';
			for (const moveToCheck of movesToCheck) {
				for (const member of teamMembers) {
					const without = calcMatchup({ attacker: s.setConfig, defender: member.setConfig, move: moveToCheck, level });
					const withScreen = calcMatchup({ attacker: s.setConfig, defender: member.setConfig, move: moveToCheck, level, field: { screens: move.id } });
					const gBefore = guaranteedHits(without.rolls, without.defender.maxhp);
					const gAfter = guaranteedHits(withScreen.rolls, withScreen.defender.maxhp);
					if (gAfter > gBefore) rows.push(`- ${speciesId}${weightLabel}(${pct.toFixed(1)}%)の${moveToCheck} → ${member.name}: ${gBefore}発 → ${gAfter}発`);
				}
			}
		}
	}
	lines.push(`**確定数が変わる組み合わせ(${rows.length}件)**:`);
	if (rows.length) { rows.forEach(r => lines.push(r)); } else { lines.push('(なし)'); }
	lines.push('');
	return lines;
}

// ---------------------------------------------------------------------------
// レポート生成
// ---------------------------------------------------------------------------

function generateReport(config) {
	const dex = getDex();
	const level = Number(config.level) || 50;
	const topN = Number(config.top) || 15;
	const noAccuracy = !!config['no-accuracy'];

	const teamPath = config.team ? path.resolve(ROOT, config.team) : findLatestTeamFile();
	if (!teamPath) throw new Error('research/teams/ にチームファイルが見つかりません');

	const { memberName, setConfig: attackerSetConfig, moves } = loadAttackerFromTeam(dex, teamPath, config.pokemon);
	const teamMembers = loadAllTeamMembers(dex, teamPath);

	const existingAttackMoves = moves.filter(m => {
		const move = dex.moves.get(m);
		return move.exists && move.category !== 'Status';
	});

	const candidates = (config.candidates || '').split(',').map(s => s.trim()).filter(Boolean);
	if (!candidates.length) throw new Error('--candidates は必須です(カンマ区切りで1つ以上指定)');

	const warnings = [];
	const defenders = selectTopDefenders(topN, warnings);

	const { bestPerDefender } = evaluateExistingMoves(attackerSetConfig, existingAttackMoves, defenders, level);

	const lines = [];
	lines.push(`# 技価値評価: ${memberName} の候補技比較`);
	lines.push('');
	lines.push('## 前提');
	lines.push('');
	lines.push(`- 自軍セット: \`${path.relative(ROOT, teamPath)}\` の ${memberName}`);
	lines.push(`- 既存の攻撃技(変化技を除く): ${existingAttackMoves.length ? existingAttackMoves.join(' / ') : '(なし)'}`);
	lines.push(`- 候補技: ${candidates.join(' / ')}`);
	const supervisedCount = defenders.filter(d => {
		const rawSets = Array.isArray(d.entry.sets) ? d.entry.sets : [d.entry];
		return rawSets.some(s => (s.source || '').includes('ユーザー監修'));
	}).length;
	lines.push(`- 比較対象: 上位構築採用率トップ${topN}のうち research/data/meta_sets.json 登録済み${defenders.length}体` +
		`(うちユーザー監修済み${supervisedCount}体、残りはClaude推定 — 各エントリの \`source\` 参照)`);
	lines.push('- 攻撃技の確定数は16乱数の worst case(保証されるKOターン数)。命中率は' + (noAccuracy ? '考慮しない(--no-accuracy指定)' : '変化技モデルでのみ期待値として考慮'));
	lines.push('- 素早さ比較(でんじは/アンコール/みちづれ等)はsimを介さないChampions式実数値の参考計算(まひ50%・ランク倍率は本編共通仕様として直接計算)。');
	if (warnings.length) {
		lines.push('');
		lines.push('未登録のためスキップした上位種:');
		for (const w of warnings) lines.push(`- ${w}`);
	}
	lines.push('');

	for (const candidate of candidates) {
		const move = dex.moves.get(candidate);
		lines.push(`## ${candidate}`);
		lines.push('');
		if (!move.exists) {
			lines.push(`(技が見つかりません: ${candidate})`);
			lines.push('');
			continue;
		}

		if (move.category !== 'Status') {
			// 6a: 攻撃技の確定数比較
			const candidateResults = evaluateMoveAgainstDefenders(attackerSetConfig, candidate, defenders, level);
			const improved = [], same = [], worse = [];
			candidateResults.forEach((r, i) => {
				const best = bestPerDefender[i];
				if (!best || r.guaranteed < best.guaranteed) improved.push({ ...r, before: best });
				else if (r.guaranteed === best.guaranteed) same.push({ ...r, before: best });
				else worse.push({ ...r, before: best });
			});

			if (improved.length) {
				lines.push(`**改善する相手(${improved.length}/${defenders.length}体)**:`);
				for (const r of improved) {
					const beforeDesc = r.before ? `${r.before.move}: ${r.before.summary}` : '(既存の攻撃技なし)';
					lines.push(`- ${r.speciesId}(採用率${r.pct.toFixed(1)}%): ${beforeDesc} → ${candidate}: ${r.summary}`);
				}
			} else {
				lines.push('**改善する相手**: なし');
			}
			lines.push('');
			lines.push(`同等: ${same.length}体 / 既存技より悪化: ${worse.length}体`);

			if (HAZARD_RIDER_MAP[move.id]) {
				const hazard = HAZARD_RIDER_MAP[move.id];
				lines.push('');
				lines.push(`**付加効果**: この技は命中時に確定で「${hazard}」を設置する` +
					'(dexのsecondariesからは自動検出できないためハードコード対応)。設置分の価値(ステルスロックモデル流用):');
				lines.push('');
				lines.push(...(hazard === 'stealthrock' ? modelStealthRock(dex, Number(config.switches) || 2) : modelSpikes(dex)));
			} else {
				lines.push(...describeGuaranteedSecondary(dex, move, attackerSetConfig, defenders, teamMembers, level, noAccuracy));
			}
			lines.push('');
			continue;
		}

		// 変化技: モデルディスパッチ
		if (move.status === 'brn') {
			lines.push(...modelBurn(dex, move.id, attackerSetConfig, existingAttackMoves, defenders, teamMembers, level, noAccuracy));
		} else if (move.status === 'par') {
			lines.push(...modelSpeedControl(dex, move.id, defenders, teamMembers, level, { fullParalysis: true }));
		} else if (move.status === 'slp') {
			lines.push(...modelSleep(dex, move.id, defenders));
		} else if (move.id === 'yawn') {
			lines.push(...modelYawn(dex, defenders));
		} else if (move.id === 'taunt') {
			lines.push(...modelTaunt(dex, attackerSetConfig, defenders, teamMembers));
		} else if (move.id === 'encore') {
			lines.push(...modelEncore(dex, attackerSetConfig, defenders, teamMembers));
		} else if (move.id === 'destinybond') {
			lines.push(...modelDestinyBond(dex, attackerSetConfig, defenders));
		} else if (move.target === 'self' && move.boosts && Object.values(move.boosts).some(v => v > 0)) {
			lines.push(...modelSetup(dex, move.id, attackerSetConfig, existingAttackMoves, defenders, level));
		} else if (move.target !== 'self' && move.boosts && Object.values(move.boosts).some(v => v < 0)) {
			for (const [stat, stage] of Object.entries(move.boosts)) {
				if (stage >= 0) continue;
				lines.push(...describeOpponentStatDrop(dex, stat, stage, attackerSetConfig, existingAttackMoves, defenders, teamMembers, level));
			}
		} else if (move.id === 'stealthrock') {
			lines.push(...modelStealthRock(dex, Number(config.switches) || 2));
		} else if (move.id === 'toxicspikes') {
			lines.push(...modelToxicSpikes(dex));
		} else if (move.id === 'spikes') {
			lines.push(...modelSpikes(dex));
		} else if (move.id === 'reflect' || move.id === 'lightscreen' || move.id === 'auroraveil') {
			lines.push(...modelScreen(dex, move.id, defenders, teamMembers, level));
		} else if (UNIMPLEMENTED_FIELD_MOVES.has(move.id)) {
			lines.push('(このモデルは未実装 — DESIGN.mdの評価モデル一覧に対応がない場効果です)');
			lines.push('');
		} else {
			lines.push('(このモデルは未実装 — DESIGN.md ツール6の評価モデル一覧に対応がない効果です)');
			lines.push('');
		}
	}

	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function run(argv) {
	const opts = parseArgs(argv);
	if (opts.help || !opts.pokemon || !opts.candidates) {
		console.log(
			'使い方: node research/tools/move_value.js --pokemon <name> --candidates "Move1,Move2" ' +
			'[--team <path>] [--top 15] [--no-accuracy] [--out <path>]\n' +
			'詳細はファイル先頭のコメントを参照。'
		);
		return;
	}

	const report = generateReport(opts);

	if (opts.out) {
		const outPath = path.resolve(ROOT, opts.out);
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, report, 'utf8');
		console.log(`書き出し: ${path.relative(ROOT, outPath)}`);
	} else {
		console.log(report);
	}
}

if (require.main === module) {
	try {
		run(process.argv.slice(2));
	} catch (e) {
		console.error(`エラー: ${e.message}`);
		process.exit(1);
	}
}

module.exports = {
	run,
	parseArgs,
	loadAttackerFromTeam,
	loadAllTeamMembers,
	loadMetaSets,
	metaEntryToSetConfig,
	normalizeMetaEntry,
	selectTopDefenders,
	guaranteedHits,
	rollSummary,
	stageMultiplier,
	effectiveSpeed,
	canLearnMove,
	evaluateMoveAgainstDefenders,
	evaluateExistingMoves,
	modelBurn,
	modelSpeedControl,
	modelSetup,
	modelSleep,
	modelYawn,
	modelTaunt,
	modelEncore,
	modelDestinyBond,
	describeOpponentStatDrop,
	describeGuaranteedSecondary,
	stealthRockFraction,
	modelStealthRock,
	modelToxicSpikes,
	modelSpikes,
	modelScreen,
	generateReport,
};
