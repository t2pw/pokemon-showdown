'use strict';
/**
 * Champions BSS Reg M-B ダメージ計算 (research/DESIGN.md ツール2)
 *
 * 一般のダメージ計算サイトはChampions独自の実数値式(HP=種族値+SP+75、他=(種族値+SP+20)×性格補正)
 * に対応していないため、simエンジン(dist/sim)を直接使って正確なダメージを計算する。
 * 式を自前で再実装しない = 本体の仕様変更(技のダメージ処理・特性処理等)に自動追従する。
 * タイプ変化特性(ピクシレート等)はModifyTypeイベントを実行して反映する。
 *
 * 使い方:
 *   node research/tools/damage_calc.js \
 *     --attacker Blaziken-Mega --attacker-nature Adamant --attacker-sp 32,0,2,0,32,0 \
 *     --defender Hippowdon --defender-nature Impish --defender-sp 32,0,32,0,0,0 \
 *     --move "Flare Blitz" \
 *     [--attacker-ability Blaze] [--attacker-item Leftovers] \
 *     [--defender-ability "Sand Force"] [--defender-item Leftovers] \
 *     [--weather sand] [--terrain misty] [--screens reflect,lightscreen] \
 *     [--attacker-boosts atk:1,spe:1] [--defender-boosts def:-1] \
 *     [--attacker-status brn] [--attacker-tera Fire] [--defender-tera Water] \
 *     [--crit] [--level 50] [--json]
 *
 * --attacker-sp / --defender-sp は Stat Points を HP,Atk,Def,SpA,SpD,Spe の順でカンマ区切り
 * (Championsは1ステータス最大32、合計66)。省略した末尾は0。
 * --level は省略時 50(Flat Rules の Adjust Level = 50 に合わせたデフォルト)。
 *
 * 注意: 定数ダメージ技・回復技・複数回攻撃技の乱数合成、命中率は考慮しない単純計算。
 *
 * 他のツールから使う場合(research/DESIGN.md ツール6):
 *   const { calcMatchup } = require('./damage_calc');
 *   const result = calcMatchup({
 *     attacker: { species: 'Garchomp', nature: 'Jolly', sp: { atk: 32, spe: 32 }, item: 'Focus Sash' },
 *     defender: { species: 'Hippowdon', nature: 'Impish', sp: { hp: 32, def: 32 } },
 *     move: 'Earthquake', level: 50,
 *   });
 *   // result.rolls / result.koSummary など、CLIの --json 出力と同じ形。
 */

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

let SimCache = null;
function getSim() {
	if (!SimCache) {
		try {
			SimCache = require(path.join(ROOT, 'dist', 'sim'));
		} catch (e) {
			throw new Error(`dist/sim が読み込めません。'node build' を実行してからもう一度試してください。(${e.message})`);
		}
	}
	return SimCache;
}

const FORMAT_ID = 'gen9championscustomgame'; // champions modの実数値式/PP上限を使うが、
// Reg M-B本来のTeam Preview/Bring6等の制約は1体計算には不要なため Custom Game を使う。

const WEATHER_ALIASES = {
	sand: 'sandstorm', sandstorm: 'sandstorm',
	rain: 'raindance', raindance: 'raindance',
	sun: 'sunnyday', sunnyday: 'sunnyday',
	snow: 'snowscape', snowscape: 'snowscape', hail: 'hail',
};
const TERRAIN_ALIASES = {
	misty: 'mistyterrain', mistyterrain: 'mistyterrain',
	electric: 'electricterrain', electricterrain: 'electricterrain',
	grassy: 'grassyterrain', grassyterrain: 'grassyterrain',
	psychic: 'psychicterrain', psychicterrain: 'psychicterrain',
};
const SCREEN_ALIASES = {
	reflect: 'reflect',
	lightscreen: 'lightscreen', light: 'lightscreen',
	auroraveil: 'auroraveil', aurora: 'auroraveil',
};

// ---------------------------------------------------------------------------
// CLI引数パース
// ---------------------------------------------------------------------------

function parseArgs(argv) {
	const BOOLEAN_FLAGS = new Set(['crit', 'json', 'help']);
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

const SP_ORDER = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

/** Stat Pointsオブジェクトを検証する(1ステ最大32・合計最大66、Championsのルール)。 */
function validateSp(sp) {
	const total = SP_ORDER.reduce((a, k) => a + (sp[k] || 0), 0);
	for (const stat of SP_ORDER) {
		if ((sp[stat] || 0) > 32) throw new Error(`Stat Pointsは1ステータス最大32です(${stat}=${sp[stat]})`);
	}
	if (total > 66) throw new Error(`Stat Pointsの合計は最大66です(合計${total})`);
	return sp;
}

/** 部分的なSPオブジェクト(未指定キーは0扱い)を検証済みの完全なオブジェクトにする。 */
function normalizeSp(sp) {
	const out = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...sp };
	return validateSp(out);
}

function parseSp(str) {
	const sp = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
	if (!str) return sp;
	str.split(',').forEach((v, i) => {
		if (SP_ORDER[i]) sp[SP_ORDER[i]] = Number(v) || 0;
	});
	return validateSp(sp);
}

function parseBoosts(str) {
	const boosts = {};
	if (!str) return boosts;
	for (const pair of str.split(',')) {
		const [stat, val] = pair.split(':');
		if (stat && val !== undefined) boosts[stat.trim()] = Number(val);
	}
	return boosts;
}

// ---------------------------------------------------------------------------
// バトル構築
// ---------------------------------------------------------------------------

/**
 * setConfig: { species, ability?, item?, nature?, sp?, gender?, boosts?, status?, tera? }
 * (attacker/defender共通形。calcMatchup / CLI 双方から使う)
 */
function buildSet(dex, setConfig, moveName, level) {
	if (!setConfig || !setConfig.species) throw new Error('species は必須です');
	const species = dex.species.get(setConfig.species);
	if (!species.exists) throw new Error(`種族が見つかりません: ${setConfig.species}`);

	const ability = setConfig.ability || species.abilities['0'];
	const sp = normalizeSp(setConfig.sp);

	return {
		species: species.name,
		name: species.name,
		ability,
		item: setConfig.item || '',
		nature: setConfig.nature || 'Serious',
		evs: sp,
		ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
		level,
		gender: setConfig.gender || 'N',
		moves: moveName ? [moveName] : ['splash'],
	};
}

function applyPokemonState(battle, pokemon, setConfig) {
	const boosts = (setConfig && setConfig.boosts) || {};
	for (const stat in boosts) pokemon.boosts[stat] = boosts[stat];

	const status = setConfig && setConfig.status;
	if (status) pokemon.setStatus(status);

	const tera = setConfig && setConfig.tera;
	if (tera) {
		const type = battle.dex.types.get(tera);
		if (!type.exists) throw new Error(`無効なテラスタイプ: ${tera}`);
		pokemon.terastallized = type.name;
	}
}

function createBattle() {
	const Sim = getSim();
	const { Dex } = Sim;
	const dex = Dex.mod('champions');
	const format = Dex.formats.get(FORMAT_ID, true);
	if (format.effectType !== 'Format') throw new Error(`フォーマットが見つかりません: ${FORMAT_ID}`);
	return { Sim, Dex, dex, format };
}

// ---------------------------------------------------------------------------
// ダメージ計算本体
// ---------------------------------------------------------------------------

/**
 * 16乱数のダメージを計算する。willCrit を固定して呼ぶことで、
 * moveHitData(急所判定)が呼び出しごとに再生成される新しい ActiveMove を都度使う
 * (Dex.getActiveMove は文字列/非ActiveMoveを渡すたびに deep clone するため安全)。
 *
 * 半減の実(チョプル等)は getDamage 内の ModifyDamage で eatItem() を呼び
 * バトル状態を書き換えるため、素通しだと1乱数目しか半減されない。
 * 各乱数の後にアイテムを復元して「毎回、実を持った状態」で計算する。
 */
function calcRolls(battle, attacker, defender, moveName, willCrit) {
	const rolls = [];
	const attackerItem = attacker.item;
	const defenderItem = defender.item;
	for (let i = 100; i >= 85; i--) {
		battle.randomizer = baseDamage => battle.trunc(battle.trunc(baseDamage * i) / 100);
		let move = battle.dex.getActiveMove(moveName);
		move.willCrit = willCrit;
		// useMoveInner と同じ順序でModifyType/ModifyMoveイベントを実行する。
		// これにより、ピクシレート等のタイプ変化特性がダメージ計算に反映される。
		battle.setActiveMove(move, attacker, defender);
		battle.singleEvent('ModifyType', move, null, attacker, defender, move, move);
		battle.singleEvent('ModifyMove', move, null, attacker, defender, move, move);
		move = battle.runEvent('ModifyType', attacker, defender, move, move);
		move = battle.runEvent('ModifyMove', attacker, defender, move, move);
		const dmg = battle.actions.getDamage(attacker, defender, move);
		rolls.push(typeof dmg === 'number' ? dmg : 0);
		if (attacker.item !== attackerItem) attacker.setItem(attackerItem);
		if (defender.item !== defenderItem) defender.setItem(defenderItem);
	}
	return rolls;
}

function hitsToKO(rolls, hp) {
	return rolls.map(dmg => (dmg > 0 ? Math.ceil(hp / dmg) : Infinity));
}

function summarizeHits(hitsArr) {
	const min = Math.min(...hitsArr);
	const max = Math.max(...hitsArr);
	if (min === max) return `確定${min}発`;
	return `乱数${min}〜${max}発(${hitsArr.filter(h => h === min).length}/${hitsArr.length}が${min}発)`;
}

function resolveScreensList(screens) {
	if (!screens) return [];
	return Array.isArray(screens) ? screens : String(screens).split(',');
}

/**
 * 1回のマッチアップ(攻撃側1体 vs 防御側1体、技1つ)のダメージ計算をバトル構築から
 * まとめて行う。CLI (run) からも、他ツール(move_value.js等)からもこれを呼ぶ。
 *
 * config: {
 *   attacker: setConfig, defender: setConfig,  // setConfig は buildSet 参照
 *   move: string, level?: number, crit?: boolean, defenderHp?: number,
 *   field?: { weather?: string, terrain?: string, screens?: string|string[] },
 * }
 * setConfig の boosts/status/tera は defender 側にも同様に適用される。
 */
function calcMatchup(config) {
	const level = config.level || 50;
	const { dex, format } = createBattle();
	const Sim = getSim();

	const p1set = buildSet(dex, config.attacker, config.move, level);
	const p2set = buildSet(dex, config.defender, null, level);

	const battle = new Sim.Battle({
		formatid: format.id,
		format,
		p1: { team: [p1set] },
		p2: { team: [p2set] },
		strictChoices: false,
	});
	battle.makeChoices('team 1', 'team 1');

	const attacker = battle.p1.active[0];
	const defender = battle.p2.active[0];

	const field = config.field || {};
	const weather = field.weather && WEATHER_ALIASES[String(field.weather).toLowerCase()];
	if (field.weather && !weather) throw new Error(`未対応の天候: ${field.weather}`);
	if (weather) battle.field.setWeather(weather, 'debug');

	const terrain = field.terrain && TERRAIN_ALIASES[String(field.terrain).toLowerCase()];
	if (field.terrain && !terrain) throw new Error(`未対応のフィールド: ${field.terrain}`);
	if (terrain) battle.field.setTerrain(terrain, 'debug');

	for (const raw of resolveScreensList(field.screens)) {
		const id = SCREEN_ALIASES[raw.trim().toLowerCase()];
		if (!id) throw new Error(`未対応の壁: ${raw}`);
		defender.side.addSideCondition(id, 'debug');
	}

	applyPokemonState(battle, attacker, config.attacker);
	applyPokemonState(battle, defender, config.defender);

	const moveName = config.move;
	const move = dex.moves.get(moveName);
	if (!move.exists) throw new Error(`技が見つかりません: ${moveName}`);

	const rolls = calcRolls(battle, attacker, defender, moveName, !!config.crit);
	const maxhp = defender.maxhp;
	const hp = config.defenderHp || maxhp;
	const hits = hitsToKO(rolls, hp);

	return {
		move: move.name,
		attacker: { species: attacker.species.name, ability: attacker.ability, item: attacker.item || null, stats: attacker.storedStats, level: attacker.level },
		defender: { species: defender.species.name, ability: defender.ability, item: defender.item || null, stats: defender.storedStats, level: defender.level, maxhp, hpUsedForKoCalc: hp },
		crit: !!config.crit,
		field: { weather: weather || null, terrain: terrain || null, screens: field.screens || null },
		rolls,
		min: Math.min(...rolls),
		max: Math.max(...rolls),
		minPct: (Math.min(...rolls) / hp) * 100,
		maxPct: (Math.max(...rolls) / hp) * 100,
		koSummary: summarizeHits(hits),
	};
}

function setConfigFromOpts(opts, prefix) {
	return {
		species: opts[prefix],
		ability: opts[`${prefix}-ability`],
		item: opts[`${prefix}-item`],
		nature: opts[`${prefix}-nature`],
		sp: parseSp(opts[`${prefix}-sp`]),
		gender: opts[`${prefix}-gender`],
		boosts: parseBoosts(opts[`${prefix}-boosts`]),
		status: opts[`${prefix}-status`],
		tera: opts[`${prefix}-tera`],
	};
}

function run(argv) {
	const opts = parseArgs(argv);
	if (opts.help || !opts.attacker || !opts.defender || !opts.move) {
		console.log(
			'使い方: node research/tools/damage_calc.js --attacker <species> --defender <species> --move <move> [options]\n' +
			'詳細はファイル先頭のコメントを参照。'
		);
		return;
	}

	const level = Number(opts.level) || 50;
	const result = calcMatchup({
		attacker: setConfigFromOpts(opts, 'attacker'),
		defender: setConfigFromOpts(opts, 'defender'),
		move: opts.move,
		level,
		crit: !!opts.crit,
		defenderHp: opts['defender-hp'] ? Number(opts['defender-hp']) : undefined,
		field: { weather: opts.weather, terrain: opts.terrain, screens: opts.screens },
	});

	if (opts.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	console.log(`${result.attacker.species}(${result.attacker.ability}${result.attacker.item ? ' @ ' + result.attacker.item : ''}) の ${result.move}` +
		` -> ${result.defender.species}(${result.defender.ability}${result.defender.item ? ' @ ' + result.defender.item : ''})` +
		`${result.crit ? ' [急所]' : ''}`);
	if (result.field.weather || result.field.terrain || result.field.screens) {
		console.log(`場: ${[result.field.weather, result.field.terrain, result.field.screens].filter(Boolean).join(' / ')}`);
	}
	console.log(`実数値: 攻撃側 ${JSON.stringify(result.attacker.stats)} / 防御側 ${JSON.stringify(result.defender.stats)} (Lv.${level})`);
	console.log(`ダメージ: ${result.min}〜${result.max} (${result.minPct.toFixed(1)}%〜${result.maxPct.toFixed(1)}%, 防御側HP実数値${result.defender.hpUsedForKoCalc}基準)`);
	console.log(`16乱数: ${result.rolls.join(', ')}`);
	console.log(`確定数: ${result.koSummary}`);
}

if (require.main === module) {
	try {
		run(process.argv.slice(2));
	} catch (e) {
		console.error(`エラー: ${e.message}`);
		process.exit(1);
	}
}

module.exports = { run, calcMatchup, parseArgs, parseSp, parseBoosts, calcRolls, hitsToKO, summarizeHits };
