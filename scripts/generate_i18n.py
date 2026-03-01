#!/usr/bin/env python3
"""Rolodexter i18n generator — dynamically derives everything from patterns.json.

Reads ``src/rolodexter/_data/patterns.json`` to get:
  - Which languages to generate  (``i18n_config.languages``)
  - Which fields to translate     (all keys under ``fields``)
  - English aliases to exclude    (all values under ``fields``)

Field phrases are derived automatically: ``first_name`` -> ``"first name"``.

Requirements (dev-only, for auto-translation):
    pip install deep-translator unidecode

Usage:
    python scripts/generate_i18n.py                        # all languages, parallel
    python scripts/generate_i18n.py --languages es,fr,de   # specific languages
    python scripts/generate_i18n.py --no-translate          # skip translation API
    python scripts/generate_i18n.py --dry-run               # preview only
    python scripts/generate_i18n.py --workers 10            # translation parallelism
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# Paths
ROOT = Path(__file__).resolve().parent.parent
MASTER_PATH = ROOT / "src" / "rolodexter" / "_data" / "patterns.json"
I18N_DIR = ROOT / "src" / "rolodexter" / "_data" / "i18n"


def _try_unidecode(text: str) -> str | None:
    try:
        from unidecode import unidecode
        result = unidecode(text).strip()
        return result if result and result != text else None
    except ImportError:
        return None


def _to_alias_variants(text: str) -> set[str]:
    """Expand a translated phrase into underscore/concat/hyphen/ASCII variants."""
    variants: set[str] = set()
    low = text.lower().strip()
    if len(low) < 2:
        return variants
    variants.add(low)
    underscored = re.sub(r"\s+", "_", low)
    variants.add(underscored)
    concat = re.sub(r"[\s_\-]+", "", low)
    if len(concat) > 1:
        variants.add(concat)
    hyphenated = re.sub(r"\s+", "-", low)
    if hyphenated != low:
        variants.add(hyphenated)
    ascii_ver = _try_unidecode(low)
    if ascii_ver:
        variants.add(ascii_ver)
        variants.add(re.sub(r"\s+", "_", ascii_ver))
        ascii_concat = re.sub(r"[\s_\-]+", "", ascii_ver)
        if len(ascii_concat) > 1:
            variants.add(ascii_concat)
    return {v for v in variants if len(v) > 1}


def _translate_batch(phrases: list, lang_code: str) -> list:
    """Translate a list of phrases via GoogleTranslator batch API."""
    try:
        from deep_translator import GoogleTranslator
        translator = GoogleTranslator(source="en", target=lang_code)
        results = translator.translate_batch(phrases)
        return [r.strip() if r else None for r in results]
    except Exception:
        results = []
        for phrase in phrases:
            try:
                from deep_translator import GoogleTranslator
                r = GoogleTranslator(source="en", target=lang_code).translate(phrase)
                results.append(r.strip() if r else None)
                time.sleep(0.05)
            except Exception:
                results.append(None)
        return results


def derive_field_phrases(master: dict) -> dict:
    """Derive human-readable phrases from field canonical names.

    ``first_name`` -> ``"first name"``  (replace underscores with spaces)
    Automatically includes every field in patterns.json["fields"].
    """
    skip = {
        "utm_parameters", "metadata", "score", "owner", "tags",
        "lead_status", "lifecycle_stage", "email_opt_out",
        "created_at", "updated_at", "last_contacted",
        "currency", "source",
    }
    return {
        canonical: canonical.replace("_", " ")
        for canonical in master.get("fields", {})
        if canonical not in skip
    }


def generate_language(
    lang_code: str,
    lang_name: str,
    field_phrases: dict,
    english_aliases: set,
    master_version: str,
    file_code: str,
    *,
    translate: bool = True,
) -> dict:
    """Generate the i18n data dict for one language."""
    fields: dict = {}
    if translate:
        canonicals = list(field_phrases.keys())
        phrases = [field_phrases[c] for c in canonicals]
        translations = _translate_batch(phrases, lang_code)
        for canonical, translated in zip(canonicals, translations, strict=False):
            if not translated:
                continue
            variants = _to_alias_variants(translated)
            filtered = sorted(v for v in variants if v not in english_aliases and len(v) > 1)
            if filtered:
                fields[canonical] = filtered
    return {
        "language_code": file_code,
        "language_name": lang_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_version": master_version,
        "fields": fields,
    }


def write_language_file(lang_data: dict, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{lang_data['language_code']}.json"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(lang_data, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate i18n language files for rolodexter from patterns.json.",
    )
    parser.add_argument("--languages", help="Comma-separated language codes (default: all)")
    parser.add_argument("--output", default=str(I18N_DIR), help="Output directory")
    parser.add_argument("--no-translate", action="store_true", help="Skip translation API")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    parser.add_argument("--workers", type=int, default=6, help="Parallel language workers (default: 6)")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    with open(MASTER_PATH, encoding="utf-8") as fh:
        master = json.load(fh)

    i18n_cfg = master.get("i18n_config", {})
    all_languages: dict = i18n_cfg.get("languages", {})
    file_code_overrides: dict = i18n_cfg.get("file_code_overrides", {})
    translate_code_overrides: dict = i18n_cfg.get("translate_code_overrides", {})

    if not all_languages:
        print("ERROR: patterns.json has no i18n_config.languages section.")
        sys.exit(1)

    if args.languages:
        requested = {c.strip() for c in args.languages.split(",")}
        target_langs = {k: v for k, v in all_languages.items() if k in requested}
        if not target_langs:
            print(f"ERROR: No match for: {args.languages}")
            print(f"Available: {', '.join(all_languages)}")
            sys.exit(1)
    else:
        target_langs = all_languages

    # Derive translatable field phrases dynamically from patterns.json["fields"] keys
    field_phrases = derive_field_phrases(master)

    # English aliases to exclude from i18n output
    english_aliases: set = set()
    for alias_list in master.get("fields", {}).values():
        for alias in alias_list:
            english_aliases.add(alias.lower().strip())

    do_translate = not args.no_translate
    if do_translate:
        try:
            from deep_translator import GoogleTranslator  # noqa: F401
        except ImportError:
            print("WARNING: deep-translator not installed. Run: pip install deep-translator")
            do_translate = False

    try:
        from unidecode import unidecode  # noqa: F401
    except ImportError:
        if args.verbose:
            print("NOTE: unidecode not installed (romanization limited). pip install unidecode")

    output_dir = Path(args.output)
    master_version = master.get("version", "unknown")

    print(f"\nGenerating {len(target_langs)} language(s) from patterns.json v{master_version}")
    print(f"  Fields : {len(field_phrases)} (derived from fields keys in patterns.json)")
    print(f"  English aliases excluded : {len(english_aliases)}")
    print(f"  Translation : {'enabled — batch + parallel' if do_translate else 'disabled'}")
    if do_translate:
        print(f"  Workers : {args.workers}")
    print(f"  Output  : {output_dir}\n")

    def _process(lang_code: str, lang_name: str) -> tuple:
        file_code = file_code_overrides.get(lang_code, lang_code)
        translate_code = translate_code_overrides.get(lang_code, lang_code)
        data = generate_language(
            translate_code, lang_name, field_phrases, english_aliases,
            master_version, file_code, translate=do_translate,
        )
        return lang_code, data

    results: dict = {}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(_process, code, name): code for code, name in target_langs.items()}
        for future in as_completed(futures):
            lang_code, data = future.result()
            results[lang_code] = data
            fc = data["language_code"]
            n_fields = len(data["fields"])
            n_aliases = sum(len(v) for v in data["fields"].values())
            status = f"{n_fields} fields, {n_aliases} aliases"
            if args.dry_run:
                print(f"  [{fc}] {data['language_name']}: {status} (dry run)")
                if args.verbose:
                    for canon, aliases in sorted(data["fields"].items()):
                        print(f"    {canon}: {aliases}")
            else:
                path = write_language_file(data, output_dir)
                print(f"  [{fc}] {data['language_name']}: {status} -> {path.name}")

    msg = "Dry run complete" if args.dry_run else "Done"
    print(f"\n{msg} — {len(results)} file(s).")


if __name__ == "__main__":
    main()
