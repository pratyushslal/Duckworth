# Duckworth browser checks

These checks are mutation tests. Run them through the disposable API-test factory so the web origin, lease, instance identity, household, database, and cleanup are created together:

```powershell
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- `
  python duckworth-web/e2e/foundation_check.py
```

The runner supplies the E2E origin and household variables. The harness checks the server-proven `api-test` instance identity before it opens the app, while the local web proxy adds the instance-bound mutation lease. The database is deleted after the command. An explicitly configured persistent `sandbox` origin remains supported for non-destructive development checks, but family-live and `household-demo` are always rejected.
