# Gamine and $GAMINE

The project is now named **Gamine**, and its planned token is **$GAMINE**.
Application copy, metadata, wallet sign-in text, docs, package names, engine
rule identifiers and asset paths use the new branding. The payout mint setting
is now `PAYOUT_AGP_MINT` in `web/.env.local`.

The website is **https://trygamine.xyz** and the X page is
**https://x.com/trygamine**. Set `NEXT_PUBLIC_SITE_URL=https://trygamine.xyz`
on the web service, `AUTH_DOMAIN=trygamine.xyz` and
`CORS_ORIGIN=https://trygamine.xyz` on the API service. These deployment settings
are not changed automatically by repository edits. Configure the API hostname
through `NEXT_PUBLIC_API_URL`; do not assume an API subdomain exists.

Old browser session, agent-selection, preference and pending-launch keys are
read and migrated to the `gamine` namespace. Signing out and clearing a
pending launch also remove its old key. Signed pending launch bytes are kept
unchanged. Saved payout plans can still read their previous mint field.

The migration runner copies the previous applied-migration ledger into
`gamine_migrations`, so an existing database does not replay schema changes.
The original agent-ID hash domain and old on-chain memo parsing remain for
compatibility with existing identities and transaction history.

Docker uses `gamine-pgdata` and `gamine` database credentials by default for a
fresh setup. Existing installations must set `POSTGRES_USER`, `POSTGRES_PASSWORD`,
`POSTGRES_DB` and `POSTGRES_VOLUME_NAME` to their existing values, and keep
`DATABASE_URL` consistent, to reuse their database. No database or volume was
modified by the branding edits.

The local checkout remains at its actual `/home/pikoo/Desktop/gamine` path;
renaming the project branding does not move the workspace or its database file.
