# Next Work Todo

Created: 2026-06-28.

This is the restart list for the next RoloDexter maintenance stint.

## Immediate

- [x] Diagnose the failing Python CI jobs on Dependabot PR #9.
  - PR: <https://github.com/Lunarwerx/rolodexter/pull/9>
  - Change: `actions/checkout` from 4 to 7.
  - Finding: checkout itself works. The first failure was stricter mypy handling
    of `nameparser` ignores; the later failure is NumPy 2.5 stubs being parsed
    while mypy is intentionally configured for the Python 3.10 type target.
  - Local fixes: remove the line-level ignores, add a config-level
    `nameparser.*` mypy override, avoid static pandas stub imports, and pin
    `numpy<2.5` in the dev extra for CI stability.
  - Completed: PR #9 was updated, the full CI matrix passed, and the PR was
    merged on 2026-06-28.

- [x] Sync local branch with the remote main branch after the merged Dependabot PRs.
  - Merged already: PR #5 `actions/setup-python`, PR #7 `actions/upload-artifact`, PR #8 `codecov/codecov-action`.
  - Do this carefully because there are substantial local uncommitted changes from the previous fix pass.
  - Preserve local work; do not reset it away.

- [x] Review, commit, and push the completed Python maintenance fixes.
  - Includes mapper correctness fixes, CLI atomic output, i18n cache behavior, README wording, regression tests, and todo/maintenance docs.
  - Leave or explicitly handle pre-existing untracked scratch files: `cb_better_01.md` and `cb_issues_01.md`.

- [x] Run the full local quality gate before any release decision.
  - Commands:

    ```powershell
    $env:PYTHONPATH='src'; python -m ruff check src/ tests/
    $env:PYTHONPATH='src'; python -m ruff format --check src/ tests/
    $env:PYTHONPATH='src'; python -m mypy src/
    $env:PYTHONPATH='src'; python -m pytest --cov=rolodexter --cov-report=xml --cov-report=term-missing
    ```

## Python Release

- [x] Decide the next Python package version.
  - Current PyPI version when noted: `2.8.0`.
  - Local release-candidate version: `2.8.1`.

- [x] Update release metadata before publishing.
  - `pyproject.toml`
  - `CHANGELOG.md`
  - README, if any final wording changes are needed
  - Any docs under `docs/maintenance` or `docs/todo`

- [x] Build and validate the Python package.

  ```powershell
  python -m build
  python -m twine check dist/*
  ```

  - Local validation used a temp output directory and passed for
    `rolodexter-2.8.1`.

- [ ] Publish to PyPI only after lint, tests, build validation, and CI pass.

## NPM Package Track

- [x] Create a parallel JavaScript/TypeScript package plan.
  - Preferred shape: a TypeScript package under `packages/js`.
  - Publish target: NPM.
  - Keep it parallel to the Python package, not tangled into `src/rolodexter`.

- [x] Extract or formalize shared canonical data.
  - The NPM package should use the same alias/pattern truth table as Python.
  - Avoid Python and JS maintaining separate drifting copies.
  - Done: `packages/js` syncs `src/rolodexter/patterns.json` before build and
    tests that the JS registry sees the same canonical fields.

- [x] Define the initial NPM API.
  - Implemented equivalents:
    - `ContactMapper`
    - `identify(header, { value? })`
    - `mapPayload(payload, options?)`
    - `mapBatch(payloads, options?)`
    - `mapStream(payloads, options?)`
    - `compileSchema(headers, options?)`
  - Ship TypeScript types from day one.

- [x] Decide how much behavior parity v1 needs.
  - Implemented first parity:
    - exact alias matching
    - normalized header matching
    - heuristic email/phone/URL/postal/date/social matching
    - list/tag normalization
    - confidence reporting
    - phone parsing via `libphonenumber-js`
  - Deferred:
    - fuzzy matching equivalent to Python `rapidfuzz`
    - i18n cache generation/loading parity

- [x] Choose high-ROI JS dependencies.
  - Chosen: `libphonenumber-js` for phone parsing/formatting.
  - Deferred: fuzzy matching package choice until parity tests are expanded.
  - Dependency surface kept modest: one runtime dependency.

- [ ] Add cross-language golden tests.
  - Shared fixtures should assert Python and TypeScript produce the same canonical mappings where both claim support.
  - Started: JS tests assert the synced Python pattern table and cover core
    parity cases. Next step is extracting the Python CRM corpora to shared
    fixture JSON.

- [x] Add NPM build/test/package-check automation.
  - `package.json`
  - `tsconfig.json`
  - test runner
  - typecheck script
  - GitHub Actions jobs for JS tests
  - Dependabot npm updates

- [ ] Add NPM publish workflow.
  - Add after NPM credentials or trusted publishing are configured.
  - Keep `0.x` publishing separate from PyPI until broader behavior parity is
    verified.

## Still Worth Doing From Verified Audit

- [ ] Make CLI CSV/JSON processing truly streaming or explicitly bounded.
- [ ] Add row-level CLI fault isolation, such as `--on-error fail|skip|quarantine`.
- [x] Bound embedded phone extraction CPU and memory.
- [ ] Harden i18n generation against network stalls and worker failure propagation.
- [ ] Revisit generic date and numeric-ID heuristics before changing behavior.
- [ ] Prefer user cache for generated i18n files instead of package-local generated data.
- [ ] Add a bounded header-resolution cache for long-lived mapper instances.
