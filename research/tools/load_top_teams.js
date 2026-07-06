'use strict';
/**
 * Champions BSS Reg M-B 上位構築ローダー (research/DESIGN.md ツール1)
 *
 * research/usage/s{N}_single_ranked_teams_YYYY-MM-DD.csv の最新ファイルを読み、
 * 採用率・持ち物分布・同時採用率などを導出する。
 *
 * 使い方:
 *   node research/tools/load_top_teams.js              # サマリーレポートを表示
 *   node research/tools/load_top_teams.js --min-rating 2400
 *
 * 他のツールから使う場合:
 *   const { loadTeams, adoptionRate, itemDistribution, coOccurrence } = require('./load_top_teams');
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const USAGE_DIR = path.join(__dirname, '..', 'usage');
const ANALYSIS_DIR = path.join(ROOT, 'analysis_output');
const SPECIES_OVERRIDES_PATH = path.join(__dirname, 'species_ja_map.json');
const ITEM_EXTRA_PATH = path.join(__dirname, 'item_ja_map_extra.json');

const CSV_NAME_RE = /^s\d+_single_ranked_teams_(\d{4}-\d{2}-\d{2})\.csv$/;

// ---------------------------------------------------------------------------
// CSV discovery + parsing
// ---------------------------------------------------------------------------

function findLatestCsv(dir = USAGE_DIR) {
	let files;
	try {
		files = fs.readdirSync(dir);
	} catch (e) {
		throw new Error(`usage フォルダが見つかりません: ${dir}`);
	}
	const matches = files
		.map(name => {
			const m = CSV_NAME_RE.exec(name);
			return m ? { name, date: m[1] } : null;
		})
		.filter(Boolean);
	if (!matches.length) {
		throw new Error(
			`${dir} にCSVが見つかりません。ポケモンバトルデータベースから手動エクスポートした ` +
			`s{シーズン}_single_ranked_teams_YYYY-MM-DD.csv 形式のファイルを置いてください。`
		);
	}
	matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
	return path.join(dir, matches[0].name);
}

// RFC4180風の簡易CSVパーサ(ダブルクォート・カンマ内包・""エスケープに対応)
function parseCsv(text) {
	// BOM除去
	if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
		} else if (c === '"') {
			inQuotes = true;
		} else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
		} else if (c === '\r') {
			// skip, \n がすぐ後に来る想定
		} else {
			field += c;
		}
	}
	if (field.length || row.length) {
		row.push(field);
		rows.push(row);
	}
	// 末尾の空行を除去
	while (rows.length && rows[rows.length - 1].every(f => f === '')) rows.pop();

	const header = rows[0];
	return rows.slice(1).map(r => {
		const obj = {};
		for (let i = 0; i < header.length; i++) obj[header[i]] = r[i] !== undefined ? r[i] : '';
		return obj;
	});
}

// ---------------------------------------------------------------------------
// 日本語名 -> Showdown ID 解決
// ---------------------------------------------------------------------------

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

let speciesByNumCache = null;
function getSpeciesByNum() {
	if (!speciesByNumCache) {
		const dex = getDex();
		speciesByNumCache = new Map();
		for (const s of dex.species.all()) {
			if (!speciesByNumCache.has(s.num)) speciesByNumCache.set(s.num, []);
			speciesByNumCache.get(s.num).push(s);
		}
	}
	return speciesByNumCache;
}

function loadJsonSafe(filePath, fallback) {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf8'));
	} catch (e) {
		return fallback;
	}
}

let speciesOverridesCache = null;
function getSpeciesOverrides() {
	if (!speciesOverridesCache) {
		speciesOverridesCache = loadJsonSafe(SPECIES_OVERRIDES_PATH, {});
	}
	return speciesOverridesCache;
}

/**
 * CSVの1スロット分(ポケモンID・日本語名・日本語フォルム名)からShowdown種族IDを解決する。
 * 解決できない場合は null を返す(呼び出し側で警告を出すこと)。
 *
 * 解決順序:
 *   1. species_ja_map.json の明示オーバーライド(名前|フォルム名 一致)
 *   2. フォルム指定なしの場合: 全国図鑑番号が一致し forme が空("通常フォルム")の種族
 *   3. 全国図鑑番号が一致する種族が1つだけならそれ
 * (メガシンカ・キョダイマックスは「ベース種族+メガストーン所持」として表現される前提のため、
 *  フォルム指定なしの場合は常にベースフォルムに解決する)
 */
function resolveSpecies(pokemonId, nameJa, formeJa) {
	const overrides = getSpeciesOverrides();
	const key = formeJa ? `${nameJa}|${formeJa}` : nameJa;
	if (overrides[key]) return overrides[key];

	const num = parseInt(String(pokemonId).split('-')[0], 10);
	const candidates = getSpeciesByNum().get(num) || [];
	if (!candidates.length) return null;

	if (!formeJa) {
		const base = candidates.find(c => c.forme === '');
		if (base) return base.id;
	}
	if (candidates.length === 1) return candidates[0].id;
	return null;
}

let itemMapCache = null;
function getItemMap() {
	if (!itemMapCache) {
		const raw = loadJsonSafe(path.join(ANALYSIS_DIR, 'ja_item_map_raw.json'), {});
		const mega = loadJsonSafe(path.join(ANALYSIS_DIR, 'mega_stone_map.json'), {});
		const extra = loadJsonSafe(ITEM_EXTRA_PATH, {});
		itemMapCache = Object.assign({}, raw, mega, extra);
	}
	return itemMapCache;
}

function resolveItem(nameJa) {
	if (!nameJa) return null;
	const map = getItemMap();
	if (Object.prototype.hasOwnProperty.call(map, nameJa)) return map[nameJa];
	return undefined; // undefined = 未知(nullの「持ち物なし」とは区別する)
}

// ---------------------------------------------------------------------------
// チーム読み込み
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   sourceFile: string,
 *   teams: Array<{rank: number, rating: number, slots: Array<{speciesId: string|null, nameJa: string, formeJa: string, itemId: string|null|undefined, itemJa: string}>}>,
 *   warnings: string[],
 * }}
 */
function loadTeams(csvPath) {
	const filePath = csvPath || findLatestCsv();
	const text = fs.readFileSync(filePath, 'utf8');
	const rows = parseCsv(text);
	const warnings = [];
	const unresolvedSpecies = new Set();
	const unresolvedItems = new Set();

	const teams = rows.map(row => {
		const slots = [];
		for (let i = 1; i <= 6; i++) {
			const pid = row[`ポケモンID_${i}`];
			const nameJa = row[`ポケモン_${i}`];
			if (!pid && !nameJa) continue;
			const formeJa = row[`フォルム_${i}`] || '';
			const itemJa = row[`持ち物_${i}`] || '';
			const speciesId = resolveSpecies(pid, nameJa, formeJa);
			if (!speciesId) unresolvedSpecies.add(`${pid}|${nameJa}|${formeJa}`);
			const itemId = resolveItem(itemJa);
			if (itemId === undefined) unresolvedItems.add(itemJa);
			slots.push({ speciesId, nameJa, formeJa, itemId: itemId === undefined ? null : itemId, itemJa });
		}
		return {
			rank: Number(row['順位']) || null,
			rating: Number(row['レート']) || null,
			slots,
		};
	});

	for (const key of unresolvedSpecies) {
		warnings.push(`未解決の種族: ${key} (research/tools/species_ja_map.json に追記してください)`);
	}
	for (const key of unresolvedItems) {
		warnings.push(`未解決の持ち物: ${key} (research/tools/item_ja_map_extra.json に追記してください)`);
	}

	return { sourceFile: filePath, teams, warnings };
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

function filterByRating(teams, minRating) {
	if (minRating == null) return teams;
	return teams.filter(t => t.rating != null && t.rating >= minRating);
}

/** 種族ごとの採用率(降順)。speciesId が null の未解決スロットは "unresolved:<日本語名>" として集計する。 */
function adoptionRate(teams) {
	const counts = new Map();
	for (const team of teams) {
		for (const slot of team.slots) {
			const key = slot.speciesId || `unresolved:${slot.nameJa}${slot.formeJa ? '(' + slot.formeJa + ')' : ''}`;
			counts.set(key, (counts.get(key) || 0) + 1);
		}
	}
	const total = teams.length;
	return [...counts.entries()]
		.map(([speciesId, count]) => ({ speciesId, count, pct: total ? (count / total) * 100 : 0 }))
		.sort((a, b) => b.count - a.count);
}

/** 指定した種族の持ち物分布(降順)。 */
function itemDistribution(teams, speciesId) {
	const counts = new Map();
	for (const team of teams) {
		for (const slot of team.slots) {
			if (slot.speciesId !== speciesId) continue;
			const key = slot.itemId || (slot.itemJa ? `unresolved:${slot.itemJa}` : '(なし)');
			counts.set(key, (counts.get(key) || 0) + 1);
		}
	}
	const total = [...counts.values()].reduce((a, b) => a + b, 0);
	return [...counts.entries()]
		.map(([itemId, count]) => ({ itemId, count, pct: total ? (count / total) * 100 : 0 }))
		.sort((a, b) => b.count - a.count);
}

/**
 * 種族ペアの同時採用数。topSpeciesIds を渡すとその集合内のペアだけに絞る(省略時は全ペア、
 * 構築数が多いと組み合わせ爆発するので topN 指定を推奨)。
 */
function coOccurrence(teams, topSpeciesIds) {
	const restrict = topSpeciesIds ? new Set(topSpeciesIds) : null;
	const counts = new Map();
	for (const team of teams) {
		const ids = [...new Set(team.slots.map(s => s.speciesId).filter(Boolean))];
		for (let i = 0; i < ids.length; i++) {
			for (let j = i + 1; j < ids.length; j++) {
				let [a, b] = [ids[i], ids[j]];
				if (restrict && (!restrict.has(a) || !restrict.has(b))) continue;
				if (a > b) [a, b] = [b, a];
				const key = `${a}+${b}`;
				counts.set(key, (counts.get(key) || 0) + 1);
			}
		}
	}
	return [...counts.entries()]
		.map(([pair, count]) => {
			const [a, b] = pair.split('+');
			return { a, b, count };
		})
		.sort((x, y) => y.count - x.count);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printReport() {
	const args = process.argv.slice(2);
	let minRating = null;
	const idx = args.indexOf('--min-rating');
	if (idx !== -1 && args[idx + 1]) minRating = Number(args[idx + 1]);

	const { sourceFile, teams: allTeams, warnings } = loadTeams();
	const teams = filterByRating(allTeams, minRating);

	console.log(`データ: ${path.basename(sourceFile)}`);
	console.log(`対象構築数: ${teams.length}${minRating != null ? ` (レート${minRating}以上, 全体${allTeams.length}件中)` : ''}`);
	console.log('');

	console.log(`--- 採用率 上位20 (${teams.length}構築中) ---`);
	for (const { speciesId, count, pct } of adoptionRate(teams).slice(0, 20)) {
		console.log(`${pct.toFixed(1).padStart(5)}%  ${String(count).padStart(3)}  ${speciesId}`);
	}
	console.log('');

	if (warnings.length) {
		console.log(`--- 警告 (${warnings.length}件) ---`);
		for (const w of warnings) console.log(`! ${w}`);
	}
}

if (require.main === module) {
	try {
		printReport();
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}

module.exports = {
	findLatestCsv,
	parseCsv,
	resolveSpecies,
	resolveItem,
	loadTeams,
	filterByRating,
	adoptionRate,
	itemDistribution,
	coOccurrence,
};
