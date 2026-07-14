#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseHtml(htmlContent) {
    const pokemonList = [];

    // Regular expression to match pokemon entries
    // Pattern: <div class="pokemon-rank ...>... RANK ...</div> ... <div class="pokemon-name">NAME</div>
    // Also try to capture dex number like dex-0445-00
    const pattern = /<div class="column is-half-tablet[^>]*data-pokemon-item=""[^>]*>[\s\S]*?<div class="pokemon-rank[^>]*>([\s\S]*?)(\d+)[\s\S]*?dex-(\d+)-(\d+)[^>]*[^<]*<\/i>[\s\S]*?<div class="pokemon-name">([^<]+)<\/div>/g;

    let match;
    while ((match = pattern.exec(htmlContent)) !== null) {
        const rank = parseInt(match[2], 10);
        const dexNum = match[3];  // e.g. "0445"
        const formNum = match[4];  // e.g. "00"
        const name = match[5].trim();
        pokemonList.push({
            rank,
            name,
            dexNum,
            formNum,
            usage_pct: ""  // Not available in saved HTML
        });
    }

    return pokemonList.sort((a, b) => a.rank - b.rank);
}

function loadSpeciesMap(mapFile) {
    const content = fs.readFileSync(mapFile, 'utf-8');
    return JSON.parse(content);
}

function buildJpNameMap(jpNamesCache) {
    // Reverse the jp_names_cache to map Japanese names to species_ids
    const nameToId = {};
    for (const key in jpNamesCache) {
        const name = jpNamesCache[key];
        if (name) {
            // Extract numeric ID from "species_XXX"
            const match = key.match(/species_(\d+)/);
            if (match) {
                nameToId[name] = match[1];
            }
        }
    }
    return nameToId;
}

function resolveSpeciesId(nameJa, speciesMap, nameToIdMap) {
    // First try species_ja_map.json (for complex forms)
    // Direct match
    if (speciesMap[nameJa]) {
        return speciesMap[nameJa];
    }

    // Handle special cases for forms
    // Pattern: "名前 (フォーム)" or "名前|フォーム" or just "フォーム名"

    // Extract base name (without parentheses or form indicators)
    let baseName = nameJa;
    let formName = null;

    // Handle parentheses forms like "ヒートロトム" or "ゾロアーク (ヒスイ)"
    const parenMatch = nameJa.match(/^(.*?)\s*\((.*?)\)$/);
    if (parenMatch) {
        baseName = parenMatch[1].trim();
        formName = parenMatch[2].trim();
    }

    // Handle colon forms like "ケンタロス:格"
    const colonMatch = nameJa.match(/^(.*?):(.*)$/);
    if (colonMatch) {
        baseName = colonMatch[1].trim();
        formName = colonMatch[2].trim();
    }

    // Try all keys in species_ja_map
    for (const key in speciesMap) {
        const parts = key.split("|");

        if (parts.length === 1) {
            // Simple name match
            if (parts[0] === nameJa) {
                return speciesMap[key];
            }
        } else if (parts.length === 2) {
            const keyBase = parts[0].trim();
            const keyForm = parts[1].trim();

            // Check if base name matches
            if (keyBase === baseName || keyBase === nameJa.split("(")[0].split(":")[0].trim()) {
                // Check form
                if (formName && keyForm.includes(formName)) {
                    return speciesMap[key];
                }
                // Special case: if key form is in the original name
                if (nameJa.includes(keyForm) || nameJa.includes(keyForm.replace("のすがた", ""))) {
                    return speciesMap[key];
                }
                // For simple forms without parentheses (like ヒートロトム)
                if (nameJa === keyBase && !nameJa.includes("(") && !nameJa.includes(":")) {
                    // This is a form name like "ヒートロトム" that should match "ロトム|ヒートロトム"
                    if (keyForm === nameJa) {
                        return speciesMap[key];
                    }
                }
            }
        }
    }

    // Try jp_names_cache as fallback (returns numeric ID, not showdown ID)
    // This is commented out since we want species_id to be empty if not in species_ja_map
    // if (nameToIdMap[nameJa]) {
    //     return nameToIdMap[nameJa];
    // }

    // No match found - return empty string
    return "";
}

function main() {
    const htmlFile = path.join("C:\\Users\\snaga\\pokemon-showdown\\research\\usage", "ポケモン使用率ランキング シーズンM-3（シングルバトル）｜バトルデータベース チャンピオンズ.html");
    const outputCsv = path.join("C:\\Users\\snaga\\pokemon-showdown\\research\\data", "usage_m3_single.csv");
    const speciesMapFile = path.join("C:\\Users\\snaga\\pokemon-showdown\\research\\tools", "species_ja_map.json");
    const jpNamesCacheFile = path.join("C:\\Users\\snaga\\pokemon-showdown\\research\\data", "jp_names_cache.json");

    // Ensure output directory exists
    const outputDir = path.dirname(outputCsv);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Load HTML
    console.log(`Reading HTML file: ${htmlFile}`);
    const htmlContent = fs.readFileSync(htmlFile, 'utf-8');

    // Load species map
    console.log(`Loading species map: ${speciesMapFile}`);
    let speciesMap = {};
    try {
        speciesMap = loadSpeciesMap(speciesMapFile);
    } catch (e) {
        console.error(`Error loading species map: ${e.message}`);
    }

    // Load JP names cache
    console.log(`Loading JP names cache: ${jpNamesCacheFile}`);
    let jpNamesCache = {};
    let nameToIdMap = {};
    try {
        jpNamesCache = loadSpeciesMap(jpNamesCacheFile);
        nameToIdMap = buildJpNameMap(jpNamesCache);
    } catch (e) {
        console.error(`Error loading JP names cache: ${e.message}`);
    }

    // Extract pokemon data
    console.log("Extracting pokemon data...");
    const pokemonData = parseHtml(htmlContent);

    console.log(`Extracted ${pokemonData.length} pokemon entries`);

    // Resolve species IDs
    console.log("Resolving species IDs...");
    const outputRows = [];
    const unresolvedNames = new Set();

    for (const entry of pokemonData) {
        const speciesId = resolveSpeciesId(entry.name, speciesMap, nameToIdMap);
        if (!speciesId) {
            unresolvedNames.add(entry.name);
        }

        outputRows.push([entry.rank, entry.name, speciesId, entry.usage_pct]);
    }

    // Write CSV
    console.log(`Writing output to: ${outputCsv}`);

    const csvLines = ["rank,name_ja,species_id,usage_pct"];
    for (const row of outputRows) {
        const name = row[1].replace(/"/g, '""');  // Escape quotes
        csvLines.push(`${row[0]},"${name}",${row[2]},${row[3]}`);
    }

    fs.writeFileSync(outputCsv, csvLines.join('\n'), 'utf-8');

    // Print summary
    console.log("\nExtraction Summary:");
    console.log(`- Total entries: ${pokemonData.length}`);
    console.log(`- Successfully resolved species_id: ${outputRows.filter(r => r[2]).length}`);
    console.log(`- Unresolved names: ${unresolvedNames.size}`);

    if (unresolvedNames.size > 0) {
        console.log("\nUnresolved pokemon names:");
        for (const name of Array.from(unresolvedNames).sort()) {
            console.log(`  - ${name}`);
        }
    }

    console.log("\nTop 20 entries:");
    for (let i = 0; i < Math.min(20, outputRows.length); i++) {
        const row = outputRows[i];
        console.log(`  ${String(row[0]).padStart(3, ' ')}. ${row[1].padEnd(20)} (species_id: ${String(row[2]).padEnd(20)}, usage: ${row[3]}%)`);
    }
}

main();
