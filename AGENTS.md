# Geospan Agent Instructions

## Shared Agent Version Updates

Read `.agents/shared/orchestrator.md` for shared workflows and `.agents/shared/deployment-profile.md` before deployment or release work. Keep repository-specific instructions and safety boundaries in this root file.

The `.agents` directory is a Git submodule of `GeospanAI/.agents`, pinned to a reviewed commit on its `Production` branch. Initialise the recorded version with `git submodule update --init -- .agents`. Keep shared role changes in the upstream repository.

Dependabot checks for newer shared workflow versions each Monday at 09:00 in `Australia/Sydney` and opens a PR into `Development`. Review and CI gates apply; the pinned version changes after merge. The schedule becomes active when `.github/dependabot.yml` reaches this repository's default branch through normal promotion and the organisation allows Dependabot to read the private `GeospanAI/.agents` repository.

For a manual update with the Geospan CLI installed, run `geospan agent update-workflows --repo .` from this repository. The Git equivalent is `git submodule update --remote --checkout -- .agents`. Review `git diff --submodule=log -- .agents`, then stage and commit the pointer when ready. AI agents use the approved GitHub OAuth 2.0 connector for hosted operations; do not add personal service keys.
