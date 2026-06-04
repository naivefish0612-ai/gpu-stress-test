# Governance

GPU Stress Test uses a lightweight maintainer-led governance model. The project accepts public issues, pull requests, and discussion, while final responsibility for direction and releases belongs to the core maintainer.

## Roles

### Users

Users report bugs, request features, and share hardware or browser compatibility information.

### Contributors

Contributors submit pull requests, improve documentation, add validation coverage, and help triage issues.

### Core Maintainers

Core maintainers have merge, release, roadmap, and governance authority. The current maintainer list is in `MAINTAINERS.md`.

## Decision Process

- Small fixes may be reviewed and merged directly by a core maintainer.
- Changes that affect user workflows, defaults, releases, security posture, or compatibility should start with an issue.
- When discussion does not reach clear consensus, the core maintainer records the chosen approach and reasoning.
- Security fixes may be handled privately first, then disclosed with appropriate detail.

## Pull Request Expectations

Before merging, maintainers should check that:

- The change scope is clear and does not include unrelated refactoring.
- Relevant behavior has been tested, syntax-checked, or manually validated.
- User-visible changes update documentation.
- New risks are explained in the PR description.

## Releases

Releases are owned by the core maintainer. Each release should include:

- Version number.
- Summary of important changes.
- Known issues.
- Required upgrade or usage notes.

## Transparency

Technical decisions should usually be recorded in issues, pull requests, or discussions. Details may be limited when security, privacy, abuse, or interpersonal safety is involved.
