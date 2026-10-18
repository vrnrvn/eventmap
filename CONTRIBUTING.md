# Contributing

Follow README.md for local setup. Use only synthetic people, events, attendance,
messages, and images in shared development fixtures. Do not connect submission
or evaluation sessions to a production/customer database.

Keep changes focused and preserve history. Use a commit email linked to your
GitHub account. Original contributions are licensed under the repository's MIT
license. Include source attribution and licenses for third-party material.

Run app/admin typechecks and relevant workflow checks. For schema changes, verify
`npm run backend:reset`, regenerate types with `npm run backend:types`, then run
`npm run test:backend`.

Do not commit environment files, real database exports, Google/Firebase config,
push credentials, CLI temporary state, or service-role keys. Run the submission
audit before sharing. Report credentials privately without posting their values.
