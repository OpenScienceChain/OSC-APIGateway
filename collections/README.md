# OSC-IS API collections

Use `OSC-IS Core Smoke.postman_collection.json` for deployment verification.
It replaces the old course-era suites as the maintained contract without
deleting them while historical coverage is still being reviewed.

1. Import the collection and `OSC-IS Core Smoke.postman_environment.example.json`.
2. Duplicate the environment locally and enter the three passwords. Do not
   commit that local environment.
3. On an empty database, run **Public readiness** and **Clean-stack setup**.
4. After each deployment, run **Public readiness** and
   **Multi-organization smoke**.

The setup creates the two demonstration organizations:

- `NSG: Neuroscience Gateway`, routed to ledger group `NSG`.
- `Citizen Science`, routed to ledger group `CitizenScience`.

The smoke folder verifies bounded JWT expiry, per-organization JWT claims,
submission routing, public discovery, and rejection of a cross-organization
update. Runtime IDs and tokens are collection variables; credentials exist
only in the developer's local environment.
