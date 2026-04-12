# Contributing

Please read the full contribution guide before opening an issue or pull request:

- `docs/contributing.md`
- `docs/testing-and-ci.md`
- `docs/documentation-standards.md`

Important project rules:

1. The only official public integration packages are `@tavern/sdk` and `@tavern/client-helpers`.
2. `@tavern/shared` is an internal package, not a public integration surface.
3. If engine internals, API routes, SSE payloads, OpenAPI output, Tool Calling behavior, MCP behavior, or other client-visible semantics change, you must also check whether the official packages and related docs need to be updated in the same PR.
4. Do not leave `apps/web` on a local workaround when the change belongs in the official integration layer.

Quick checks before opening a PR:

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test:ci`
4. `pnpm build`
5. `pnpm smoke:api`
6. If SDK or integration surfaces changed: `pnpm --filter @tavern/sdk typecheck`
7. If SDK changes may affect the web app: `pnpm --filter @tavern/web typecheck`
8. If only docs changed: `pnpm docs:lint`
9. If only docs changed: `pnpm docs:build`

Docs-only PRs still show the standard required checks in GitHub.
`Typecheck`, `API Smoke`, and the three `Test` shards may
complete via the lightweight path.
