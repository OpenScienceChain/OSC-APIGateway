# OSC-IS Supply-Chain Security

## Scope

These controls cover `OSC-WebApp`, `OSC-APIGateway`, the `fabric-bridge` in
`OSC-Artifact-Submission`, the Python artifact-submission services,
`OSC-Chaincode`, and `OSC-IS-Infra`. They do not change runtime APIs or portal
behavior.

## Supported dependency installation

Do not run `npm install`, a bare `npm ci`, or `npx` in OSC-IS repositories.
The supported commands are:

```powershell
.\scripts\security\secure-install.ps1
```

```bash
bash scripts/security/secure-install.sh
```

Run the Fabric bridge wrapper from `OSC-Artifact-Submission/fabric-bridge`.
The wrapper scans the lockfile before npm starts, installs with lifecycle
scripts disabled, verifies npm registry signatures, rebuilds only the reviewed
package/version allowlist, and scans the installed manifests. CI passes
`--ci` so project-owned development hooks are not prepared on runners.

An unavailable live IOC feed fails closed. A maintainer may use
`--offline-reviewed` only after reviewing the vendored blocklist and recording
why network access is unavailable. This override is not appropriate for CI.

Python production and CI install from the Linux `requirements.lock` with both
`--require-hashes` and `--only-binary=:all:`. Windows development uses
`requirements.windows.lock` with the same flags. The separate locks preserve
platform-specific packages such as `uvloop` and `colorama` without weakening
hash enforcement. Update both in isolated, credential-free Python 3.11
environments with the pinned lock tool recorded in each file, then review the
direct requirement and both generated lock diffs.

## Required repository rules

Configure a GitHub ruleset for `master`, `main`, and `develop` in each affected
repository. Require a pull request, at least one approval, dismissal of stale
approvals, approval of the latest push, and all security/CI checks. Disable
force pushes, branch deletion, and automatic dependency merging.

Require CODEOWNER review when these paths change:

- package manifests and lockfiles
- Python requirement and lock files
- Go and Terraform lockfiles
- `.github/workflows/**` and `.github/dependabot.yml`
- `Dockerfile` and `**/Dockerfile`
- `.npmrc`, `.claude/**`, `.vscode/**`, `scripts/security/**`, and `security/**`

GitHub-hosted configuration is intentionally not changed by local hardening
work. Apply the ruleset only after the local security commits are reviewed.

## Build and deployment boundary

Application build jobs have `contents: read` only. They scan dependencies,
build, test, create CycloneDX SBOMs, scan images, and publish checksummed
artifacts. Deployment jobs verify those checksums before requesting short-lived
AWS credentials through OIDC. Deployment jobs do not check out source, install
dependencies, or build images. ECS receives immutable ECR image digests.

Terraform and Fabric deployment workflows are exceptions because their purpose
is to execute reviewed infrastructure code against AWS. Their actions and
provider selections are immutable, their environments require approval, and
their OIDC sessions are short-lived.

## Incident response

When the scanner, dependency review, secret scanner, or a maintainer identifies
a malware indicator:

1. Stop the install, build, workflow, or deployment immediately. Do not retry
   with scripts enabled and do not use the offline override.
2. Disconnect the affected workstation or self-hosted runner from the network.
   Preserve logs and process information before cleanup.
3. From a known-clean device, inspect the affected system for token-revocation
   monitors and persistence. Remove that persistence before rotating secrets so
   newly issued credentials are not stolen again.
4. Revoke and rotate GitHub tokens, npm tokens, AWS sessions and access keys,
   SSH keys, and any credentials readable by the affected process.
5. Audit GitHub security logs, workflow runs, releases, repository history,
   npm publication history, AWS CloudTrail, ECR pushes, and deployment events
   for the full exposure window.
6. Quarantine suspect commits, packages, caches, artifacts, and images. Do not
   delete evidence until the incident owner approves it.
7. Invalidate GitHub Actions and package-manager caches. Rebuild from a trusted
   commit and freshly verified lockfiles on a clean runner.
8. Document the indicator, affected versions, exposure window, rotated
   credentials, evidence, and recovery decision before restoring deployments.

## Maintenance

The vendored npm blocklist is reviewable data, never executable content. Update
it from the Wiz IOC CSV during an isolated security change, verify the expected
CSV schema and package count, run all scanner tests, and record the upstream
commit or retrieval date in the pull request.

Review lifecycle allowlists one package and exact version at a time. A package
upgrade that changes a lifecycle script must remain separate from grouped
Dependabot updates and receive explicit approval.
