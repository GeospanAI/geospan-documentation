# Geospan Agent Instructions

## Shared Agent Version Updates

Read `.agents/shared/orchestrator.md` for shared workflows and `.agents/shared/deployment-profile.md` before deployment or release work. Keep repository-specific instructions and safety boundaries in this root file.

The `.agents` directory is a Git submodule of `GeospanAI/.agents`, pinned to a reviewed commit on its `Production` branch. Initialise the recorded version with `git submodule update --init -- .agents`. Keep shared role changes in the upstream repository.

Before using shared roles, request `agent check-workflows --repo .` through `geospan_run` and follow its approved GitHub OAuth handoff to compare this project's `.agents` pin with shared `Production`. With the Geospan CLI installed, interactive commands check the current project's version automatically; run `geospan agent check-workflows --repo . --refresh` for a fresh check. Checks report available updates without fetching objects, changing files, or opening a PR. Successful checks cache for one hour; unavailable checks let the requested command continue. Updates remain explicit and require review through a PR into `Development`.

For a manual update with the Geospan CLI installed, run `geospan agent update-workflows --repo .` from this repository. The Git equivalent is `git submodule update --remote --checkout -- .agents`. Review `git diff --submodule=log -- .agents`, then stage and commit the pointer when ready. AI agents use the approved GitHub OAuth 2.0 connector for hosted operations; do not add personal service keys.
