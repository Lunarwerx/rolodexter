# Release And Distribution Notes

Last checked: 2026-06-28.

## Current Package Status

RoloDexter is currently a Python package published on PyPI:

- PyPI project: <https://pypi.org/project/rolodexter/>
- Current published version checked from PyPI: `2.8.0`
- Local package version in `pyproject.toml`: `2.8.1` release candidate
- Python requirement: `>=3.10`
- NPM package source: `packages/js`
- NPM package version: `0.1.0` pre-publish package candidate

## Release Policy

After a meaningful maintenance stint or behavior change, do not leave the repository in a "changed but unreleased" state indefinitely.

Before publishing a new version:

1. Run the full local quality gate:

   ```powershell
   $env:PYTHONPATH='src'; python -m ruff check src tests
   $env:PYTHONPATH='src'; python -m pytest -q
   ```

2. Confirm package metadata and docs are current:

   - `pyproject.toml` version
   - `CHANGELOG.md`
   - README examples and feature wording
   - Any generated/cache behavior notes

3. Bump the version using semver intent:

   - Patch: bug fixes and internal maintenance with compatible behavior
   - Minor: new public features or meaningful API additions
   - Major: breaking API or behavior changes

4. Build and inspect the package before publishing:

   ```powershell
   python -m build
   python -m twine check dist/*
   ```

5. Publish only after lint, tests, build, and metadata checks pass.

For the JavaScript/TypeScript package:

```powershell
cd packages/js
npm ci
npm run typecheck
npm test
npm pack --dry-run
```

## NPM Package Possibility

Yes, RoloDexter can also become an NPM package, but the best path depends on the intended JavaScript audience.

Recommended approach:

- Create a real TypeScript package that mirrors the Python core behavior and ships types.
- Keep the canonical alias/pattern data in a shared JSON source so Python and NPM packages do not drift.
- Add cross-language golden tests using the same fixture corpus for Python and TypeScript.
- Publish Python to PyPI and JavaScript/TypeScript to NPM with matching version numbers when behavior is equivalent.

Other options:

- A thin NPM CLI wrapper around Python is faster to create, but it is less useful for browser/serverless users and requires Python at runtime.
- A generated/WASM approach is possible, but probably too heavy for this package right now.

The initial NPM package lives under `packages/js`. It syncs
`src/rolodexter/patterns.json` before build so Python remains the canonical
alias source in this repository. Publish it as `0.x` until behavior parity with
the Python package is broad enough to share the same release version.

## Dependabot

Dependabot is configured in `.github/dependabot.yml` for:

- Python dependencies in `pyproject.toml`
- GitHub Actions in workflow files

It is useful here because it keeps CI and publishing actions current and opens small reviewable dependency PRs. Keep it unless the noise becomes more expensive than the maintenance value.

Current Dependabot handling on 2026-06-28:

- Merged PR #5: `actions/setup-python` from 5 to 6. Checks were green.
- Merged PR #7: `actions/upload-artifact` from 4 to 7. Checks were green.
- Merged PR #8: `codecov/codecov-action` from 4 to 7. Checks were green.
- Merged PR #9: `actions/checkout` from 4 to 7. The initial failures were from
  mypy/dependency typing drift, not checkout itself; CI was fixed and rerun
  green before merge.

Dependabot rule of thumb:

- Merge small dependency PRs when they are mergeable, scoped, and green across the full required CI matrix.
- Do not merge dependency PRs with red CI just because they are dependency updates.
- For GitHub Actions bumps, inspect workflow diffs and CI logs before merging.
