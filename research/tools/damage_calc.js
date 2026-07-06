'use strict';
/**
 * Champions BSS Reg M-B ダメージ計算 (research/DESIGN.md ツール2)
 *
 * 一般のダメージ計算サイトはChampions独自の実数値式(HP=種族値+SP+75、他=(種族値+SP+20)×性格補正)
 * に対応していないため、simエンジン(dist/sim)を直接使って正確なダメージを計算する。
 * 式を自前で再実装しない = 本体の仕様変更(技のダメージ処理・特性処理等)に自動追従する。
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

function parseSp(str) {
	const sp = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
	if (!str) return sp;
	const order = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
	str.split(',').forEach((v, i) => {
		if (order[i]) sp[order[i]] = Number(v) || 0;
	});
	const total = Object.values(sp).reduce((a, b) => a + b, 0);
	for (const stat of order) {
		if (sp[stat] > 32) throw new Error(`Stat Pointsは1ステータス最大32です(${stat}=${sp[stat]})`);
	}
	if (total > 66) throw new Error(`Stat Pointsの合計は最大66です(合計${total})`);
	return sp;
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

function buildSet(dex, opts, prefix, level) {
	const speciesId = opts[prefix];
	if (!speciesId) throw new Error(`--${prefix} は必須です`);
	const species = dex.species.get(speciesId);
	if (!species.exists) throw new Error(`種族が見つかりません: ${speciesId}`);

	const ability = opts[`${prefix}-ability`] || species.abilities['0'];
	const sp = parseSp(opts[`${prefix}-sp`]);
	const moveArg = opts.move;

	return {
		species: species.name,
		name: species.name,
		ability,
		item: opts[`${prefix}-item`] || '',
		nature: opts[`${prefix}-nature`] || 'Serious',
		evs: sp,
		ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
		level,
		gender: opts[`${prefix}-gender`] || 'N',
		moves: prefix === 'attacker' ? [moveArg] : ['splash'],
	};
}

function applyFieldAndState(battle, pokemon, opts, prefix) {
	const boosts = parseBoosts(opts[`${prefix}-boosts`]);
	for (const stat in boosts) pokemon.boosts[stat] = boosts[stat];

	const status = opts[`${prefix}-status`];
	if (status) pokemon.setStatus(status);

	const tera = opts[`${prefix}-tera`];
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
 */
function calcRolls(battle, attacker, defender, moveName, willCrit) {
	const rolls = [];
	for (let i = 100; i >= 85; i--) {
		battle.randomizer = baseDamage => battle.trunc(battle.trunc(baseDamage * i) / 100);
		const move = battle.dex.getActiveMove(moveName);
		move.willCrit = willCrit;
		const dmg = battle.actions.getDamage(attacker, defender, move);
		rolls.push(typeof dmg === 'number' ? dmg : 0);
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
	const { dex, format } = createBattle();
	const Sim = getSim();

	const p1set = buildSet(dex, opts, 'attacker', level);
	const p2set = buildSet(dex, opts, 'defender', level);

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

	const weather = opts.weather && WEATHER_ALIASES[opts.weather.toLowerCase()];
	if (opts.weather && !weather) throw new Error(`未対応の天候: ${opts.weather}`);
	if (weather) battle.field.setWeather(weather, 'debug');

	const terrain = opts.terrain && TERRAIN_ALIASES[opts.terrain.toLowerCase()];
	if (opts.terrain && !terrain) throw new Error(`未対応のフィールド: ${opts.terrain}`);
	if (terrain) battle.field.setTerrain(terrain, 'debug');

	if (opts.screens) {
		for (const raw of opts.screens.split(',')) {
			const id = SCREEN_ALIASES[raw.trim().toLowerCase()];
			if (!id) throw new Error(`未対応の壁: ${raw}`);
			defender.side.addSideCondition(id, 'debug');
		}
	}

	applyFieldAndState(battle, attacker, opts, 'attacker');
	applyFieldAndState(battle, defender, opts, 'defender');

	const moveName = opts.move;
	const move = dex.moves.get(moveName);
	if (!move.exists) throw new Error(`技が見つかりません: ${moveName}`);

	const rolls = calcRolls(battle, attacker, defender, moveName, !!opts.crit);
	const maxhp = defender.maxhp;
	const hp = Number(opts['defender-hp']) || maxhp;
	const hits = hitsToKO(rolls, hp);

	const result = {
		move: move.name,
		attacker: { species: attacker.species.name, ability: attacker.ability, item: attacker.item || null, stats: attacker.storedStats, level: attacker.level },
		defender: { species: defender.species.name, ability: defender.ability, item: defender.item || null, stats: defender.storedStats, level: defender.level, maxhp, hpUsedForKoCalc: hp },
		crit: !!opts.crit,
		field: { weather: weather || null, terrain: terrain || null, screens: opts.screens || null },
		rolls,
		min: Math.min(...rolls),
		max: Math.max(...rolls),
		minPct: (Math.min(...rolls) / hp) * 100,
		maxPct: (Math.max(...rolls) / hp) * 100,
		koSummary: summarizeHits(hits),
	};

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
	console.log(`ダメージ: ${result.min}〜${result.max} (${result.minPct.toFixed(1)}%〜${result.maxPct.toFixed(1)}%, 防御側HP実数値${hp}基準)`);
	console.log(`16乱数: ${rolls.join(', ')}`);
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

module.exports = { run, parseArgs, parseSp, parseBoosts, calcRolls, hitsToKO, summarizeHits };
