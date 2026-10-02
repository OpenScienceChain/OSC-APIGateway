# USRSE'26 Implementation Status

**Recorded:** July 31, 2026  
**AWS account:** `269624229733`  
**AWS region:** `us-west-2`

This record separates locally proven behavior from cloud definitions that are
ready for review but have not been applied. No AWS resources were created by
this implementation.

## Repository Results

| Repository                | Implemented                                                                                                                                                  | Verification                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OSC-APIGateway`          | Replacement CI, multi-organization routing, JWT organization claims, bounded sessions, transactional message outbox, migrations, curated Postman smoke tests | Build passes; 214 tests pass; 69.28% statement coverage; critical production audit gate passes                                                    |
| `OSC-WebApp`              | Replacement CI, provenance landing page, exact JWT-expiry enforcement, optional local Cypress session handoff                                                | Production build passes; 230 unit tests and 3 public Cypress tests pass; 88.51% statement coverage; desktop, 390 px, and 320 px layouts inspected |
| `OSC-Artifact-Submission` | Consolidated CI, organization-aware adapter routing, RabbitMQ TLS, Python 3.11 images, worker contract v2                                                    | Adapter 76 tests; submission worker 40; listener 41; history worker 13; legacy bridge 8; Docker builds pass                                       |
| `OSC-Chaincode`           | Consolidated Go CI, idempotent workflow writes, collision handling, ledger error propagation, no fatal process exits                                         | Go tests, vet, and Linux race tests pass; production package coverage is 32.6%                                                                    |
| `OSC-IS-Infra`            | Terraform CI/deploy split, optional Amazon MQ, disposable EKS/Fabric profile, OIDC workflows, Docker failure harness                                         | Root and Fabric Terraform validate; workflow YAML and Compose render; Docker failure suite passes                                                 |
| `OSC-Network`             | None                                                                                                                                                         | Intentionally left unchanged as a test-only repository                                                                                            |
| `OSC-API`                 | None                                                                                                                                                         | Intentionally left unchanged behind the adapter boundary                                                                                          |
| `OSC-Docker`              | None                                                                                                                                                         | Intentionally preserved as the hybrid/VM fallback                                                                                                 |

## Demonstration Organizations

The maintained Postman setup and smoke collection use these organizations:

| Display name                | Ledger group     | Ledger API user          | Artifact schema           |
| --------------------------- | ---------------- | ------------------------ | ------------------------- |
| `NSG: Neuroscience Gateway` | `NSG`            | `nsg-portal`             | `nsg.dataset`             |
| `Citizen Science`           | `CitizenScience` | `citizen-science-portal` | `citizen.science.dataset` |

The smoke contract creates one user and one artifact in each organization and
then proves that a Citizen Science identity cannot update the NSG artifact.
Passwords remain in an uncommitted local Postman environment.

## Session Lifetime Fix

The prior Gateway configured `JWT_EXPIRES_IN` on `JwtModule` but also registered
a second bare `JwtService`. Login used the bare service and signed tokens without
an `exp` claim. The duplicate provider is removed and login now explicitly signs
with `JWT_EXPIRES_IN`, whose default and example value is two hours.

The WebApp now rejects expired tokens, tokens without `exp`, and legacy tokens
without expiration metadata. Existing unbounded sessions are cleared once after
deployment. Cypress can reuse a locally supplied `CYPRESS_AUTH_TOKEN`, but only
when it contains a valid future expiration.

## Docker Evidence

`OSC-IS-Infra/system-tests` builds and runs a real RabbitMQ broker, organization-
aware adapter, submission worker, and mock ledger API. The passing sequence is:

1. Submit an organization-scoped v2 message successfully.
2. Stop the worker, publish two messages, verify queue depth two, restart it,
   and verify both complete.
3. Stop the adapter, publish a message, and verify an explicit failed result.
4. Restart the adapter and verify the next submission succeeds.
5. Remove the disposable containers and volumes.

This test intentionally does not require Globus, a human login, AWS keys, or a
running Fabric network.

## AWS Definitions Ready For Review

- Root Terraform can select existing RabbitMQ EC2 or private Amazon MQ RabbitMQ
  3.13 on `mq.m7g.medium`, with generated credentials in Secrets Manager and
  AMQPS 5671.
- The disposable Fabric profile defines EKS 1.35, three `t3.large` nodes, KMS,
  encrypted storage, control-plane logs, GitHub OIDC access, two peer
  organizations, and three Raft orderers.
- Fabric is pinned to 2.5.15 and canonical chaincode is checked out from
  `OSC-Chaincode` at an explicit ref.
- Creation and deployment are manual protected workflows. Destruction remains
  explicit, with an eight-hour expiration marker for cleanup policy.
- Estimated EKS control-plane plus node compute is about USD 0.35/hour. Amazon
  MQ adds about USD 0.14/hour, before EBS, logs, NAT, and transfer.

## Deliberately Not Executed

- No Terraform apply, EKS cluster, Amazon MQ broker, ECS deployment, or budget
  resource was created.
- The Fabric-on-EKS workflow was not run because it creates paid resources.
- The Postman collection was validated as JSON but not executed because no
  complete local Gateway/PostgreSQL stack and user credentials were supplied.
- Cypress public landing-page flows and responsive browser inspection passed.
  Authenticated application flows were not run against real user accounts; the
  local session handoff is ready for an authenticated developer run.

## Remaining Controlled Work

1. Review and merge the cross-repository changes in dependency order: chaincode,
   Artifact Submission, Gateway, WebApp, then Infra.
2. Pin every third-party GitHub Action to a reviewed immutable commit SHA before
   making checks required on protected branches.
3. Raise chaincode production coverage from 32.6% toward the planned 60% target,
   concentrating on IAM, schemas, history, pagination, and private data.
4. Plan Angular 19 to a supported fixed major and Nest 10 to Nest 11 separately.
   Current critical audit gates pass, but high-severity advisories requiring
   breaking framework upgrades remain visible.
5. Run the Postman and Cypress scenarios locally with the NSG and Citizen
   Science identities, then retain JUnit/Newman/Cypress evidence.
6. Obtain review for the AWS plan, configure the GitHub OIDC role and protected
   environments, perform one time-boxed apply/deploy/test/destroy rehearsal,
   and confirm the AWS account returns to zero test resources.
