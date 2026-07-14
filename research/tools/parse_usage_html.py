#!/usr/bin/env python3
"""
Parse Pokemon usage ranking from locally saved HTML file.
Extracts rank, Japanese name, and usage percentage (if available).
"""

import json
import re
import sys
from pathlib import Path
from html import unescape

def load_species_map(map_file):
    """Load the species name to ID mapping."""
    with open(map_file, 'r', encoding='utf-8') as f:
        return json.load(f)

def extract_pokemon_data(html_content):
    """
    Extract pokemon rank and name from HTML.
    Returns list of tuples: (rank, name_ja, usage_pct or None)

    Note: Usage percentage is not included in the saved HTML.
    """
    pokemon_list = []

    # Pattern: <div class="column is-half-tablet.*?data-pokemon-item="".*?</div>\s*</div>
    # Each pokemon is in a column div with data-pokemon-item attribute
    pattern = r'<div class="column is-half-tablet[^"]*"[^>]*data-pokemon-item=""[^>]*>.*?</div>\s*</div>'
    items = re.findall(pattern, html_content, re.DOTALL)

    print(f"Found {len(items)} pokemon items in HTML")

    for item in items:
        # Extract rank
        rank_match = re.search(r'<div class="pokemon-rank[^"]*">([^<]*?)(\d+)', item)
        if not rank_match:
            continue
        rank = int(rank_match.group(2))

        # Extract pokemon name
        name_match = re.search(r'<div class="pokemon-name">([^<]+)</div>', item)
        if not name_match:
            continue
        name = unescape(name_match.group(1))

        # Usage percentage is not available in the saved HTML
        # (would require JavaScript execution or API call)
        usage_pct = None

        pokemon_list.append((rank, name, usage_pct))

    return sorted(pokemon_list, key=lambda x: x[0])

def resolve_species_id(name_ja, species_map, dex_map=None):
    """
    Resolve Japanese name to species_id using the species_ja_map.json.
    Returns species_id or empty string if not found.
    """
    # Try direct match first
    if name_ja in species_map:
        return species_map[name_ja]

    # Try with form separator (pipe character)
    # The HTML might include form information in the name
    if '|' in name_ja:
        if name_ja in species_map:
            return species_map[name_ja]

    # For names with parentheses like "ヒートロトム" or "ゾロアーク (ヒスイ)"
    # Extract base name and try to find in map
    base_name = re.split(r'[|(]', name_ja)[0].strip()

    # Try searching in map for keys starting with base_name
    for key in species_map:
        if key.startswith(base_name + '|'):
            # For forms like "ロトム|ヒートロトム", extract the form part
            # and try to match with the full name
            parts = key.split('|')
            if len(parts) == 2:
                form_part = parts[1]
                # Check if form name appears in the pokemon name
                if form_part in name_ja or form_part.replace('のすがた', '') in name_ja:
                    return species_map[key]

    # If still not found, return empty string
    return ""

def main():
    # Define paths
    html_file = Path("/Users/snaga/pokemon-showdown/research/usage").expanduser() / "ポケモン使用率ランキング シーズンM-3（シングルバトル）｜バトルデータベース チャンピオンズ.html"
    output_csv = Path("/Users/snaga/pokemon-showdown/research/data") / "usage_m3_single.csv"
    species_map_file = Path("/Users/snaga/pokemon-showdown/research/tools") / "species_ja_map.json"

    # Handle Windows paths
    if not html_file.exists():
        html_file = Path("C:\\Users\\snaga\\pokemon-showdown\\research\\usage") / "ポケモン使用率ランキング シーズンM-3（シングルバトル）｜バトルデータベース チャンピオンズ.html"
    if not output_csv.exists():
        output_csv = Path("C:\\Users\\snaga\\pokemon-showdown\\research\\data") / "usage_m3_single.csv"
    if not species_map_file.exists():
        species_map_file = Path("C:\\Users\\snaga\\pokemon-showdown\\research\\tools") / "species_ja_map.json"

    # Load HTML
    print(f"Reading HTML file: {html_file}")
    with open(html_file, 'r', encoding='utf-8') as f:
        html_content = f.read()

    # Load species map
    print(f"Loading species map: {species_map_file}")
    species_map = load_species_map(species_map_file)

    # Extract pokemon data
    print("Extracting pokemon data...")
    pokemon_data = extract_pokemon_data(html_content)

    print(f"Extracted {len(pokemon_data)} pokemon entries")

    # Load map for reverse lookups (numeric dex -> species_id)
    # This would require a dex file, for now we'll work with the species_map only

    # Resolve species IDs
    print("Resolving species IDs...")
    output_rows = []
    unresolved_names = []

    for rank, name_ja, usage_pct in pokemon_data:
        species_id = resolve_species_id(name_ja, species_map)
        if not species_id:
            unresolved_names.append(name_ja)

        usage_str = f"{usage_pct:.2f}" if usage_pct is not None else ""
        output_rows.append([rank, name_ja, species_id, usage_str])

    # Write CSV
    print(f"Writing output to: {output_csv}")
    output_csv.parent.mkdir(parents=True, exist_ok=True)

    with open(output_csv, 'w', encoding='utf-8') as f:
        f.write("rank,name_ja,species_id,usage_pct\n")
        for row in output_rows:
            # Escape quotes in names if needed
            name = row[1].replace('"', '""')
            f.write(f'{row[0]},"{name}",{row[2]},{row[3]}\n')

    # Print summary
    print(f"\nExtraction Summary:")
    print(f"- Total entries: {len(pokemon_data)}")
    print(f"- Successfully resolved species_id: {len([r for r in output_rows if r[2]])}")
    print(f"- Unresolved names: {len(unresolved_names)}")

    if unresolved_names:
        print(f"\nUnresolved pokemon names:")
        for name in unresolved_names:
            print(f"  - {name}")

    print(f"\nTop 20 entries:")
    for row in output_rows[:20]:
        print(f"  {row[0]:3d}. {row[1]:20s} (species_id: {row[2]:20s}, usage: {row[3]}%)")

if __name__ == "__main__":
    main()
