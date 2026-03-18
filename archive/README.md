# Cubica Game Platform

Monorepository for the generative game platform Cubica. The project aggregates services, SDKs, templates and documentation required to deliver the MVP described in GAME_PLATFORM_IMPLEMENTATION_PLAN.md.

## Getting Started
- Explore PROJECT_OVERVIEW.md to understand the target architecture.
- Check PROJECT_STRUCTURE.md for a guided tour of directories.
- Review docs/tasks/ROADMAP.md for the delivery roadmap.

### Developing on Windows
- Keep a working copy in `C:\Work\Tallent\Cubica` and run tooling through PowerShell (`pwsh`).
- Verify the toolchain with `node -v`, `python -m pip --version`, and `docker compose version` before running services.
- Commit or stash before switching branches to keep the working copy clean.

### WSL (archived)
- WSL setup is currently paused; refer to `docs/legacy/dev-environment-wsl.md` if support is reinstated.

## Development Workflow
- `main` becomes a protected branch after the first push: block direct commits, require status checks, at least one approval; configure in repo settings > Branches > Add rule for `main`.
- Feature work lives on branches named `feature/<component>-<topic>` (for urgent fixes use `hotfix/<component>-<topic>`); keep branches short-lived.
- Before opening a PR, rebase onto the latest `main`, run local tests/linters, and execute `pwsh -File scripts/ci/validate-legacy.ps1` (or the cross-platform `python scripts/ci/validate-legacy.py`).
- GitHub Actions workflow `.github/workflows/ci.yml` runs both validators on push/PR.
- Local bootstrap scripts: `scripts/dev/bootstrap.ps1` (PowerShell) and `scripts/dev/bootstrap.sh` (bash) prepare dependencies and fixtures.
- Review requirements, mandatory checks, and roles are described in `docs/processes/review-policy.md`.

---