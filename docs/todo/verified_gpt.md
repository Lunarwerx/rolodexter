# Verified GPT Todo

Consolidated from `dry_gpt.md`, `slow_gpt.md`, `despoke_gpt.md`, `delete_gpt.md`, and `deviant_gpt.md`.

Kept items were rechecked against the current code before action. Items marked done were implemented in this pass and verified with the test suite.

## Done In This Pass

- [x] Severity: 1/5 - Fix list-field normalization and list collision merging.
  - Verified: `normalize_value("tags", [" vip ", "", "beta"])` bypassed `ListNormalizer`, and duplicate `tags` aliases could produce nested lists.
  - Done: field normalizers now receive non-string values when they support them, and `_merge()` flattens/dedupes list-valued fields.
  - Verification: regression tests in `tests/test_rolodexter.py`; full suite passed.

- [x] Severity: 1/5 - Keep `map_batch()`, `map_stream()`, and `map_payload()` option surfaces in sync for embedded phone extraction.
  - Verified: `map_batch(..., extract_embedded_phones=True)` raised `TypeError`.
  - Done: `map_batch()` now accepts and forwards `extract_embedded_phones`.
  - Verification: regression test in `tests/test_v28_features.py`; full suite passed.

- [x] Severity: 1/5 - Make `compile_schema()` and `map_dataframe()` honor confidence thresholds and strict mode.
  - Verified: `ContactMapper(confidence_threshold=0.99).map_payload({"Compny": "Acme"})` dropped the fuzzy match, while `compile_schema()` and `map_dataframe()` still mapped it.
  - Done: schema/DataFrame paths apply validated thresholds; strict mode raises on dropped low-confidence matches and phone normalization failures.
  - Verification: regression tests in `tests/test_v28_features.py`; full suite passed.

- [x] Severity: 2/5 - Validate confidence thresholds as 0.0 to 1.0.
  - Verified: out-of-range thresholds like `1.1` silently made even exact matches disappear.
  - Done: constructor and per-call thresholds now raise `ValueError` outside `[0.0, 1.0]`.
  - Verification: regression tests in `tests/test_v28_features.py`; full suite passed.

- [x] Severity: 2/5 - Defer value stringification in the mapper hot path.
  - Verified: `map_payload()` stringified every value before knowing whether value-shape heuristics were needed.
  - Done: header-only matches no longer stringify values, and value-shape matching only stringifies scalar values.
  - Verification: full suite passed.

- [x] Severity: 2/5 - Add atomic CLI output semantics for file targets.
  - Verified: CLI `-o/--output` opened the final path before mapping, so strict failures could leave partial files or truncate existing output.
  - Done: file outputs now write to a same-directory temp file and replace the target only after successful completion.
  - Verification: regression tests in `tests/test_v28_features.py`; full suite passed.

- [x] Severity: 2/5 - Keep i18n cache reads read-only and make writes atomic.
  - Verified: cache discovery/read paths created directories and `.probe` files.
  - Done: read/discovery paths only inspect existing dirs; writes select an explicit writable dir and use temp-file replace. i18n dry-run no longer creates cache dirs.
  - Verification: `tests/test_i18n_cache_behavior.py`, i18n-focused tests, and full suite passed.

- [x] Severity: 2/5 - Bound embedded phone extraction CPU and memory.
  - Verified: extraction scanned full candidate strings and could materialize every `PhoneNumberMatcher` match.
  - Done: opt-in embedded extraction now caps scanned text length, matches per field, and matches per payload, and emits `MappingResult.warnings` when limits stop scanning.
  - Verification: regression tests in `tests/test_rolodexter.py`; full suite passed.

- [x] Severity: 3/5 - Update README i18n wording to match cache-only runtime loading.
  - Verified: README still said mapper construction generated translations on demand.
  - Done: README now says caches must be generated first and mapper construction only loads cached aliases.
  - Verification: documentation-only change plus full suite passed.

- [x] Severity: 5/5 - Do not expose the mutable internal alias list.
  - Verified: `PatternRegistry.all_aliases` returned the backing list, so callers could mutate registry internals.
  - Done: `all_aliases` now returns a shallow copy while preserving the public `list[str]` shape.
  - Verification: regression test in `tests/test_rolodexter.py`; full suite passed.

## Verified Next Work

- [ ] Severity: 1/5 - Make CLI CSV/JSON processing truly streaming or explicitly bounded.
  - Verified: JSON input and JSON/CSV output paths still materialize full jobs in memory.
  - Why not done now: true JSON-array streaming and CSV fieldname handling need API/format decisions. Atomic output fixed the failure-safety part without changing output contracts.

- [ ] Severity: 1/5 - Add row-level CLI fault isolation.
  - Verified: one malformed JSONL row or strict normalization failure still aborts the whole import.
  - Next step: add `--on-error fail|skip|quarantine` with row numbers and tests. Atomic output already prevents partial target files on fail.

- [ ] Severity: 2/5 - Harden i18n generation against network stalls and worker failure propagation.
  - Verified: translation calls have no explicit timeout/retry budget and one failed worker can abort unrelated languages.
  - Next step: clamp worker counts, add bounded retries/backoff, and report per-language failures.

- [ ] Severity: 2/5 - Reduce value-only heuristic overclaiming for ambiguous dates and numeric IDs.
  - Verified: generic unknown date values map to `birthday`, and bare numeric strings can map to `phone`.
  - Why not done now: existing tests intentionally assert generic date-to-birthday behavior, so this is a product behavior change.

- [ ] Severity: 2/5 - Stop treating generated i18n cache files as package-local source data.
  - Verified: writable cache selection can still choose the package `i18n/` directory for generation.
  - Next step: prefer the platform user cache for generated translations, remove package-data wildcarding unless prebuilt packs become release artifacts, and adjust tests/docs.

- [ ] Severity: 3/5 - Add a bounded header-resolution cache.
  - Verified: `_header_cache` is unbounded on long-lived mapper instances.
  - Next step: add an optional max-size LRU plus `clear_cache()` / `cache_info()` and stress tests with many unique unknown headers.

- [ ] Severity: 3/5 - Decide the fate of stale tracked `rolodexter.md`.
  - Verified: it appears to be an old prototype document and is not referenced by README, package metadata, or tests.
  - Why not done now: deleting historical tracked docs is low-risk technically but still a project-maintenance choice.

- [ ] Severity: 4/5 - Split i18n generation dependencies from runtime cache loading.
  - Verified: runtime mapper construction does not translate, but the `i18n` extra still bundles generation dependencies.
  - Next step: add an `i18n-generate` extra or similar split, while keeping cached alias loading dependency-light.

## Intentionally Not Kept

- Replace email/date/URL parsing with new dependencies: useful to evaluate later, but not necessary for the verified bug fixes above and would expand the dependency surface.
- Rebuild field metadata/social-platform registries: valid design cleanup, but too broad for this autonomous pass.
- Delete pre-existing untracked `cb_better_01.md` and `cb_issues_01.md`: verified as untracked scratch files, but they predated this turn and were left untouched.
