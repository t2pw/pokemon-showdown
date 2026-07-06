'use strict';
/**
 * Champions BSS Reg M-B 素早さライン表 (research/DESIGN.md ツール3)
 *
 * 採用率上位種(ツール1の adoptionRate)+そのメガシンカ後フォルムについて、
 * Champions式の素早さ実数値を SP0/SP32 x 性格上昇/無補正/下降 で一覧化する。
 * 自軍チーム(research/teams/ の最新ファイル)の各メンバーについては実際のSP・性格での
 * 素早さと、スカーフ/積み技の参考値も併記する。
 *
 * 使い方:
 *   node research/tools/speed_tiers.js
 *   → research/speed_tiers.md に出力
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const TEAMS_DIR = path.join(__dirname, '..', 'teams');
const OUT_PATH = path.join(__dirname, '..', 'speed_tiers.md');

const { loadTeams, adoptionRate, findLatestCsv } = require('./load_top_teams');

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

// ---------------------------------------------------------------------------
// Champions式 実数値計算 (data/mods/champions/scripts.ts の statModify を移植)
// mod=1: 性格上昇, mod=0: 無補正, mod=-1: 性格下降。overflowstatmod は
// champions のルールセットに含まれないため未実装(README/DESIGN.md で確認済み)。
// ---------------------------------------------------------------------------
function calcStat(base, sp, mod) {
	const raw = base + sp + 20;
	if (mod === 0) return raw;
	const mult = mod > 0 ? 110 : 90;
	const x16 = (raw * mult) % 65536; // trunc(x, 16)
	return Math.trunc(x16 / 100);
}

function calcHp(base, sp) {
	return base + sp + 75;
}

// ---------------------------------------------------------------------------
// 対象種の選定: 採用率上位30 + そのメガシンカ後フォルム
// ---------------------------------------------------------------------------
function findMegaForme(dex, species) {
	if (!species.otherFormes) return null;
	for (const formeName of species.otherFormes) {
		const forme = dex.species.get(formeName);
		if (forme.exists && forme.isMega) return forme;
	}
	return null;
}

function buildSpeciesList(dex, topN = 30) {
	const { teams } = loadTeams();
	const ranked = adoptionRate(teams).filter(e => !e.speciesId.startsWith('unresolved:'));
	const top = ranked.slice(0, topN);

	const rows = [];
	const seen = new Set();
	for (const { speciesId, count, pct } of top) {
		const species = dex.species.get(speciesId);
		if (!species.exists || seen.has(species.id)) continue;
		seen.add(species.id);
		rows.push({ species, adoption: { count, pct } });

		const mega = findMegaForme(dex, species);
		if (mega && !seen.has(mega.id)) {
			seen.add(mega.id);
			rows.push({ species: mega, adoption: { count, pct }, isMegaOf: species.name });
		}
	}
	return rows;
}

// ---------------------------------------------------------------------------
// 自軍チーム: teams/ の最新 .txt をパースして実速度+参考値を出す
// ---------------------------------------------------------------------------
function findLatestTeamFile() {
	const files = fs.readdirSync(TEAMS_DIR).filter(f => f.endsWith('.txt'));
	if (!files.length) return null;
	const withStat = files.map(f => ({ f, mtime: fs.statSync(path.join(TEAMS_DIR, f)).mtimeMs }));
	withStat.sort((a, b) => b.mtime - a.mtime);
	return path.join(TEAMS_DIR, withStat[0].f);
}

const STAT_ABBR = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
const STAT_ABBR_REV = Object.fromEntries(Object.entries(STAT_ABBR).map(([k, v]) => [v, k]));

/** Showdownエクスポート形式のチームテキストを最低限パースする(種族/アイテム/性格/EVsのみ)。 */
function parseShowdownTeam(text) {
	const blocks = text.split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean);
	return blocks.map(block => {
		const lines = block.split(/\r?\n/);
		const firstLine = lines[0];
		const m = /^(.+?)(?:\s+\((\w)\))?\s*(?:@\s*(.+))?$/.exec(firstLine);
		let nameRaw = firstLine;
		let item = null;
		const atIdx = firstLine.indexOf('@');
		if (atIdx !== -1) {
			nameRaw = firstLine.slice(0, atIdx).trim();
			item = firstLine.slice(atIdx + 1).trim();
		}
		// 性別記号 (M)/(F) を除去
		nameRaw = nameRaw.replace(/\s*\((?:M|F)\)\s*$/, '').trim();

		const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
		let nature = null;
		for (const line of lines.slice(1)) {
			const natureMatch = /^(\w+)\s+Nature$/.exec(line.trim());
			if (natureMatch) nature = natureMatch[1];
			const evsMatch = /^EVs:\s*(.+)$/.exec(line.trim());
			if (evsMatch) {
				for (const part of evsMatch[1].split('/')) {
					const pm = /^\s*(\d+)\s*(\w+)\s*$/.exec(part);
					if (pm && STAT_ABBR_REV[pm[2]]) evs[STAT_ABBR_REV[pm[2]]] = Number(pm[1]);
				}
			}
		}
		return { name: nameRaw, item, nature, evs };
	});
}

function loadOwnTeamSpeeds(dex) {
	const teamFile = findLatestTeamFile();
	if (!teamFile) return { teamFile: null, members: [] };
	const text = fs.readFileSync(teamFile, 'utf8');
	const parsed = parseShowdownTeam(text);

	const members = parsed.map(m => {
		let species = dex.species.get(m.name);
		let effectiveNote = '';
		if (m.item) {
			const item = dex.items.get(m.item);
			if (item.exists && item.megaStone && item.megaStone[species.name]) {
				species = dex.species.get(item.megaStone[species.name]);
				effectiveNote = `(${m.name} メガシンカ後)`;
			}
		}
		const nature = dex.natures.get(m.nature || '');
		const mod = nature.plus === 'spe' ? 1 : nature.minus === 'spe' ? -1 : 0;
		const speed = calcStat(species.baseStats.spe, m.evs.spe, mod);
		return {
			name: m.name,
			effectiveSpecies: species.name,
			effectiveNote,
			nature: m.nature,
			spSpe: m.evs.spe,
			speed,
			scarf: Math.floor(speed * 1.5),
			plus1: Math.floor(speed * 1.5),
			plus2: Math.floor(speed * 2),
		};
	});
	return { teamFile: path.relative(ROOT, teamFile), members };
}

// ---------------------------------------------------------------------------
// Markdown 出力
// ---------------------------------------------------------------------------
function fmtRow(cols) {
	return `| ${cols.join(' | ')} |`;
}

function generateMarkdown() {
	const dex = getDex();
	const csvPath = findLatestCsv();
	const rows = buildSpeciesList(dex, 30);
	const { teamFile, members } = loadOwnTeamSpeeds(dex);

	const lines = [];
	lines.push('# Champions BSS Reg M-B 素早さライン表');
	lines.push('');
	lines.push(`生成日: 2026-07-06 (このファイルは \`node research/tools/speed_tiers.js\` の再実行で更新される)`);
	lines.push(`採用率データ元: \`${path.relative(ROOT, csvPath)}\``);
	lines.push('');
	lines.push('実数値の式(Champions modの検証済み仕様。個体値31固定・レベル非依存):');
	lines.push('```');
	lines.push('Spe = trunc(trunc((種族値 + SP + 20) * 110, 16bit) / 100)   # 性格↑');
	lines.push('    = 種族値 + SP + 20                                     # 性格無補正');
	lines.push('    = trunc(trunc((種族値 + SP + 20) * 90, 16bit) / 100)   # 性格↓');
	lines.push('```');
	lines.push('');
	lines.push('## 採用率上位種の素早さ実数値(SP0/SP32 x 性格3パターン)');
	lines.push('');
	lines.push('採用率は上位構築中の全スロット登場率(ラダー全体の使用率ではない点に注意)。');
	lines.push('メガシンカ枠は素の種の直後にメガ後フォルムとして必ず記載。');
	lines.push('メガ後フォルムの採用率欄はベース種と同じ値(このCSVはメガストーン所持を');
	lines.push('「ベース種+アイテム」で表現しており、メガ限定の採用数は取れないため)。');
	lines.push('メガ運用率の推定にはツール1の itemDistribution(メガストーン所持率)を使うこと。');
	lines.push('');

	const computed = rows.map(r => {
		const base = r.species.baseStats.spe;
		const v = {
			sp0minus: calcStat(base, 0, -1),
			sp0neutral: calcStat(base, 0, 0),
			sp0plus: calcStat(base, 0, 1),
			sp32minus: calcStat(base, 32, -1),
			sp32neutral: calcStat(base, 32, 0),
			sp32plus: calcStat(base, 32, 1),
		};
		return { ...r, base, v };
	});
	computed.sort((a, b) => b.v.sp32plus - a.v.sp32plus);

	lines.push(fmtRow(['#', '種族', '採用率', '種族値S', 'SP0(↓)', 'SP0(無)', 'SP0(↑)', 'SP32(↓)', 'SP32(無)', 'SP32(↑)']));
	lines.push(fmtRow(['---', '---', '---', '---', '---', '---', '---', '---', '---', '---']));
	computed.forEach((r, i) => {
		const label = r.isMegaOf ? `${r.species.name} (${r.isMegaOf}のメガ後)` : r.species.name;
		lines.push(fmtRow([
			i + 1,
			label,
			`${r.adoption.pct.toFixed(1)}%`,
			r.base,
			r.v.sp0minus,
			r.v.sp0neutral,
			r.v.sp0plus,
			r.v.sp32minus,
			r.v.sp32neutral,
			r.v.sp32plus,
		]));
	});
	lines.push('');

	lines.push('## 自軍チームの素早さ参考値');
	lines.push('');
	if (!teamFile) {
		lines.push('(research/teams/ にチームファイルが見つかりません)');
	} else {
		lines.push(`対象: \`${teamFile}\``);
		lines.push('');
		lines.push('スカーフ/積み技の値は `floor(実速度 * 倍率)` による概算参考値であり、');
		lines.push('16bit補正や連鎖計算(chain modify)は考慮していない(参考値として十分な精度)。');
		lines.push('');
		lines.push(fmtRow(['ポケモン', '性格', 'SP(S)', '実速度', 'スカーフ(x1.5)', '+1(x1.5)', '+2(x2)']));
		lines.push(fmtRow(['---', '---', '---', '---', '---', '---', '---']));
		for (const m of members) {
			const nameCol = m.effectiveNote ? `${m.name} ${m.effectiveNote}` : m.name;
			lines.push(fmtRow([nameCol, m.nature || '(無補正)', m.spSpe, m.speed, m.scarf, m.plus1, m.plus2]));
		}
	}
	lines.push('');

	return lines.join('\n');
}

function run() {
	const md = generateMarkdown();
	fs.writeFileSync(OUT_PATH, md, 'utf8');
	console.log(`書き出し: ${path.relative(ROOT, OUT_PATH)}`);
}

if (require.main === module) {
	try {
		run();
	} catch (e) {
		console.error(e.message);
		process.exit(1);
	}
}

module.exports = { calcStat, calcHp, buildSpeciesList, parseShowdownTeam, loadOwnTeamSpeeds, generateMarkdown };
