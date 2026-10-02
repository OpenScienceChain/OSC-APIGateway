# Environment Variables

This document lists all the environment variables required for the OSC API Gateway.

> ⚠️ **The values below are illustrative examples / local-development defaults only.** They are **not** real credentials. Production and staging secrets (database password, JWT secret, API keys) are supplied at runtime from AWS Secrets Manager / the environment and must never be committed. Always override every value below in any non-local environment.

## Database Configuration

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=organization
DB_USER=postgres
DB_PASSWORD=postgres
```

## JWT Configuration

```
JWT_SECRET=your-super-secret-jwt-key-here
JWT_EXPIRES_IN=1h
```

## Admin Users Configuration

```
ADMIN1_USERNAME=admin1
ADMIN1_EMAIL=admin1@example.com
ADMIN1_PASSWORD=admin123
ADMIN1_ROLES=admin

ADMIN2_USERNAME=admin2
ADMIN2_EMAIL=admin2@example.com
ADMIN2_PASSWORD=admin456
ADMIN2_ROLES=admin
```

## Submission Listener Configuration

```
SUBMISSION_LISTENER_API_KEY=your-submission-listener-api-key
SUBMISSION_LISTENER_SERVICE_ROLE=submitter_listener
SUBMISSION_LISTENER_USERNAME=submission_listener
```

## US-RSE 2026 Demonstration

```text
DEMO_ALLOWED_ORIGIN=https://demo.osc-staging.org
DEMO_JWT_SECRET=<random value of at least 32 characters>
DEMO_ANALYTICS_HMAC_SECRET=<different random value of at least 32 characters>
DEMO_CONTROL_API_KEY=<different random value of at least 32 characters>
```

All four values are required by the live demonstration deployment. The three
secret values are server-only and must be injected from AWS Secrets Manager.
`DEMO_ALLOWED_ORIGIN` is also added to the exact CORS allowlist. Never put a
demo secret in browser code, an image, a log, or a task prompt.

## RabbitMQ Configuration

```
RABBITMQ_HOST=localhost
RABBITMQ_PORT=5672
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_PROTOCOL=amqp
RABBITMQ_VHOST=/
RABBITMQ_HEARTBEAT_SECONDS=30
RABBITMQ_ALLOW_INSECURE_LOCAL=false
OUTBOX_MAX_ATTEMPTS=8
```

For Amazon MQ, set `RABBITMQ_PROTOCOL=amqps` and port `5671`.
Certificate verification is always enabled. `RABBITMQ_TLS_SERVERNAME` can
override the expected certificate name and `RABBITMQ_TLS_CA_PATH` can identify
an additional trusted CA bundle. Plain AMQP is rejected in production. In a
non-production container network, it requires the explicit
`RABBITMQ_ALLOW_INSECURE_LOCAL=true` opt-in unless the broker is on localhost.

## Notes

- The RabbitMQ configuration is used to publish durable artifact and workflow commands
- When running with Docker Compose, the `RABBITMQ_HOST` should be set to the RabbitMQ container name
- The API Gateway uses publisher confirms and a transactional outbox. If the broker is unavailable, the database write succeeds and the command remains pending for bounded retry.
- After `OUTBOX_MAX_ATTEMPTS`, an undelivered command is marked `failed` for explicit operator review rather than retried forever.
