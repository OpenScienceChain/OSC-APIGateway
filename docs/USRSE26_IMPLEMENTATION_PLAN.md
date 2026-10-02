# OSC-IS Modernization and USRSE'26 Implementation Plan

Implementation evidence and remaining work are tracked in
[`USRSE26_IMPLEMENTATION_STATUS.md`](USRSE26_IMPLEMENTATION_STATUS.md).

## Purpose

This plan covers only the OSC-IS platform. It preserves the current working
release while producing measurable software-engineering evidence for the
USRSE'26 talk: reliable CI, canonical and tested chaincode, multi-organization
provenance, reproducible deployment, controlled failure testing, and a clearer
entry experience for users.

The presentation will use DevOps, IaC, testing, and the evolution from direct
Fabric access to the adapter and OSC-API boundary as its main narrative. UX and
AI-assisted development are supporting case studies rather than the headline.

## Repository Boundaries

| Repository                | Responsibility                                          | Change policy                   |
| ------------------------- | ------------------------------------------------------- | ------------------------------- |
| `OSC-WebApp`              | Angular UI, landing page, Cypress                       | Active implementation           |
| `OSC-APIGateway`          | Portal API, users, organizations, PostgreSQL, messaging | Active implementation           |
| `OSC-Artifact-Submission` | Workers and ledger adapter                              | Active implementation           |
| `OSC-Chaincode`           | Canonical Go chaincode                                  | Active implementation           |
| `OSC-IS-Infra`            | Terraform, AWS lifecycle, system tests                  | Active implementation           |
| `OSC-Network`             | Disposable Fabric test harness                          | Minimal harness changes only    |
| `OSC-API`                 | Organization-level Fabric API                           | Protected; test unchanged first |
| `OSC-Docker`              | Existing VM/Compose Fabric deployment                   | Protected; retain as fallback   |

`OSC-API` and `OSC-Docker` receive no planned runtime or architectural
refactoring. A change to either requires a failing compatibility test and a
separate, narrowly scoped `compatibility/<reason>` pull request.

## Baseline and Governance

1. Tag the exact known-working repository commits as
   `usrse26-baseline-2026-07-31`.
2. Store repository SHAs, image digests, database migration level, Fabric
   version, and chaincode sequence in an Infra release manifest.
3. Retain the baseline images and a tested baseline demo path for the talk.
4. Require pull requests, reviews, green CI, and resolved conversations.
5. Remove workflows that merge branches automatically.
6. Permit untrusted fork pull requests to run only checks that need no secrets.
7. Trust GitHub OIDC only from protected OpenScienceChain environments; never
   store AWS access keys in GitHub or a VM.

## CI and Security

Run the replacement checks alongside SonarCloud for five representative pull
requests, then remove SonarCloud from WebApp and APIGateway.

| Repository          | Required checks                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| WebApp              | Node 20.19, ESLint, Angular build, unit coverage, Cypress, npm audit, CodeQL                               |
| APIGateway          | Node 20, ESLint, TypeScript build, Jest and e2e coverage, npm audit, CodeQL, container scan                |
| Artifact Submission | Python 3.11, Ruff, mypy, Bandit, pip-audit, pytest coverage, Compose validation, container scan            |
| Chaincode           | Go 1.25/1.26, gofmt, vet, staticcheck, gosec, govulncheck, race tests, coverage, CodeQL, Fabric smoke test |
| Infra               | Terraform fmt/validate, tflint, Checkov, policy checks, plan artifact, system tests                        |
| Network             | Minimal rendering and pinned-chaincode harness checks                                                      |
| API and Docker      | Read-only checkout from Infra for syntax, image, Compose, shell, and vulnerability checks                  |

Before production enforcement, third-party Actions are pinned to immutable
commit SHAs. Checks must not hide failures with `|| true`, unsafe
`continue-on-error`, mutable `@master` references, or commit-message
conditions. Release images include SBOMs, vulnerability reports, immutable
digests, and provenance attestations.

## Canonical Chaincode

`OSC-Chaincode` is the only source of smart-contract implementation. The stale
source copy in OSC-Network is replaced by an `OSC_CHAINCODE_REF` checkout into
an ignored generated directory.

Implementation order:

1. Add characterization tests for every public transaction.
2. Move generated mocks and test-only helpers out of production coverage.
3. Split artifact logic into read, write, history, indexing, validation, and
   private-data modules without changing transaction names or ledger keys.
4. Check all state/private-data writes and iterator errors.
5. Cover workflows, schemas, IAM, OU/MSP authorization, pagination, invalid
   transient data, hashes, and private-data access.
6. Raise production coverage from the measured 24.8 percent baseline to at
   least 60 percent, with workflow coverage at least 80 percent.
7. Add v2 artifact and workflow transactions with caller-generated `eventId`
   receipts. Identical retries return the prior result; event-ID reuse with
   different content fails.
8. Preserve v1 behavior for OSC-API compatibility.
9. Publish a normal Fabric lifecycle package and a non-root CCaaS OCI image.
10. Pin Fabric 2.5.15 and record source SHA, image digest, package ID, version,
    sequence, policy, and collection configuration.

## Multi-Organization Model

The initial deployment contains two organizations:

| Portal organization         | Fabric MSP | Ledger group     | Default schema            |
| --------------------------- | ---------- | ---------------- | ------------------------- |
| `NSG: Neuroscience Gateway` | `Org1MSP`  | `NSG`            | `nsg.dataset`             |
| `Citizen Science`           | `Org2MSP`  | `CitizenScience` | `citizen.science.dataset` |

Gateway implementation:

1. Add organization `slug`, `mspId`, `ledgerGroupName`, `defaultSchemaName`,
   and `status` fields.
2. Backfill existing users and records into `osc-portal` through TypeORM
   migrations and disable production `synchronize`.
3. Bind regular users to one organization. A global administrator must select
   an organization explicitly when acting across organizations.
4. Add trusted `org_id` and `org_slug` JWT claims.
5. Derive organization, group, schema, and API user from authenticated server
   state, never an ordinary request body.
6. Provision each human ledger identity asynchronously. Until ready, writes
   return `409 ledger_identity_pending` while safe reads remain available.
7. Add a PostgreSQL outbox so database state and RabbitMQ publication cannot
   silently diverge.
8. Publish message envelope v2 with version, event ID, correlation ID, event
   type, timestamp, actor, organization, and payload.

## Adapter and Backend Portability

The adapter remains in ECS and is the only application-facing ledger boundary.
The legacy fabric bridge is not revived.

The adapter accepts the existing submit, update, workflow, history, and health
operations and adds readiness. Its protected route configuration contains one
existing OSC-API URL, token, group, schema, and ledger API user mapping per
organization.

Supported modes:

- `aws_eks`: Fabric, chaincode, and two unchanged OSC-API instances run in AWS.
- `external_vm`: the AWS application stack calls the two-organization
  Fabric/OSC-API deployment on the self-hosted VM.

Only one ledger is authoritative for writes. There is no dual writing or split
Raft network. A stateful switch requires block and chaincode parity, drained
queues, sampled-history comparison, and a read-only cutover window.

After adapter contract parity is verified, remove the dormant bridge service,
revoke its S3 identity access, rotate the identities, retain one encrypted
rollback copy, and delete the historical bucket only after explicit approval.

## AWS Target

New AWS definitions live in `OSC-IS-Infra`, not `OSC-Docker`.

- Account `269624229733`, region `us-west-2`.
- EKS 1.35 with private access and temporary public API access restricted to
  the workflow runner's `/32` address during a disposable test deployment.
- Three on-demand `t3.large` nodes across three Availability Zones.
- Two peer organizations, one peer and CouchDB per organization.
- One orderer organization with three Raft orderers.
- Enrollment/TLS CAs scaled down after bootstrap.
- One CCaaS and one unchanged OSC-API deployment per peer organization.
- Encrypted gp3 storage, KMS-protected secrets, default-deny network policy,
  non-root containers, and no public Fabric endpoints.
- Internal HTTPS routing from the ECS adapter to each OSC-API instance.
- Pinned images mirrored to ECR by digest.
- CloudWatch logs and health alarms.

OSC-API is built and contract-tested unchanged against Fabric 2.5.15. If it
passes, its digest is frozen. If it fails because of its Fabric 2.3 CLI, the
only permitted repair is the smallest peer-binary/base-image compatibility
update; endpoints, authentication, and PHP behavior stay unchanged.

Replace RabbitMQ EC2 and its NLB with a private Amazon MQ RabbitMQ 3.13
single-instance `mq.m7g.medium` broker using AMQPS 5671. Store credentials in
Secrets Manager and bootstrap durable exchanges, queues, bindings, retries,
DLXs, and DLQs through an idempotent management-API script.

Protected workflows provide infrastructure creation, system testing, and
destruction. Deployment uses GitHub OIDC; each runtime receives a maximum
eight-hour lease and a scheduled cleanup check.

## Landing Page and UX

Create an Angular `HomeComponent` at `/` that:

- identifies OSC-IS and the value of provenance immediately;
- illustrates a real artifact-to-workflow-to-history path;
- provides pathways for researchers, collaborators, stewards/PIs, and admins;
- shows real public artifact/workflow previews with loading, empty, failure,
  and permission states;
- preserves existing artifact and workflow routes;
- meets responsive, keyboard, reduced-motion, and WCAG AA expectations.

Cypress covers public discovery, login, organization context, submissions,
history, and authorization failures using seeded test accounts. Three to five
representative users provide task-completion and confusion-point evidence.

## Integration and Failure Testing

Consolidate the roughly 482 Postman requests into one canonical collection of
no more than 35 useful requests covering health, authentication, organizations,
users, artifacts, workflows, history, authorization, retries, and admin tasks.

Infra owns three cross-repository profiles:

- `fast`: PostgreSQL, RabbitMQ, Gateway, workers, adapter, mock OSC-API.
- `fabric`: local two-org Fabric using canonical chaincode and unchanged API.
- `ui`: Fabric profile plus WebApp and Cypress.

Acceptance scenarios include organization isolation, public/private field
visibility, prohibited cross-org updates, idempotent retries, DLQ behavior,
adapter/API/peer/chaincode/database outages, one-orderer loss, chaincode-pod
recovery, and identical adapter contracts in AWS and VM modes.

Every run exports JUnit, coverage, Newman, Cypress, timing, failure-injection,
and cost evidence. Correlation IDs connect Gateway, broker, worker, adapter,
OSC-API, and chaincode records.

## Delivery Schedule

| Window                 | Deliverable                                                |
| ---------------------- | ---------------------------------------------------------- |
| August 3-7             | Baseline, ADRs, protections, CI inventory                  |
| August 10-21           | CI replacement, Sonar removal, chaincode tests/refactoring |
| August 24-September 4  | Multi-org Gateway, adapter, messaging, landing page        |
| September 7-18         | Amazon MQ, EKS, Fabric, API compatibility, VM profile      |
| September 21-October 2 | Integration, Postman, Cypress, controlled failures         |
| October 5-9            | Evidence and presentation figures                          |
| October 12             | Code freeze and final tags                                 |
| October 13-16          | Live and fallback rehearsals                               |
| October 19-21          | USRSE'26                                                   |

## Talk and Completion Criteria

The 15-minute talk presents the provenance problem, inherited engineering pain,
the bridge-to-adapter tradeoff, canonical chaincode, CI/IaC, two-organization
isolation, controlled failures, measured UX, cost, and lessons from reviewed
AI-assisted development.

Implementation is complete when:

- protected repositories remain unchanged unless their compatibility gate
  produces a documented minimal exception;
- active repositories have required CI without SonarCloud or automatic merges;
- chaincode is canonical and reaches at least 60 percent production coverage;
- local, AWS, and VM paths use the same signed chaincode release;
- no worker, adapter, workflow, or VM holds static AWS credentials;
- two organizations demonstrate correct authorization, provenance, privacy,
  retries, and history;
- AWS deployment, evidence collection, and hibernation are reproducible;
- the conference has both a tested live demo and a baseline fallback.

The EKS compute estimate is approximately USD 0.35 per hour. Including the
single-instance Amazon MQ broker brings the running baseline to approximately
USD 0.49 per hour before EBS, logs, NAT, or transfer. Configure AWS Budget
warnings at USD 100 and critical alerts at USD 150, and enforce eight-hour
leases.
