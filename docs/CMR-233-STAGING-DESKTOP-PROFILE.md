# CMR-233 Staging Desktop Profile

The internal Customer Marketing staging profile keeps its session, database, extensions and local
receipts outside the normal Izzi AI profile. It accepts only the reviewed staging Marketing origin,
the isolated staging Supabase project and a public `anon` client JWT. A service-role key is rejected.

The profile does not register the production `openclaw://` protocol, run the desktop updater or open
Google OAuth. Use email/password for a staging-only account. The normal installed profile and its
production login remain untouched.

Set `IZZI_MARKETING_STAGING_SUPABASE_ANON_KEY` for the current process, then run:

```powershell
pwsh -NoProfile -File apps/desktop/scripts/start-customer-marketing-staging.ps1
```

The launcher validates the key claims and starts the installed executable with the isolated
`IzziAI-Customer-Marketing-Staging` user-data directory. It does not persist the key, create a user,
seed a workspace or perform a provider action.
