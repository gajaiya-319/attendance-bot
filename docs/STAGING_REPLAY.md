# Staging Replay

The staging replay gate executes production attendance and payroll logic without
connecting to Discord or Google Sheets. Payroll mutations use an in-memory sheet.
Runtime attendance input is read-only and anonymized before projection.

## Commands

```powershell
npm.cmd run staging:replay
npm.cmd run staging:replay:runtime
npm.cmd run test:staging-replay
```

Reports are written below `outputs/` and are excluded from Git.

## Deployment Gate

`npm run predeploy` runs the critical fixture suite. The VPS deployment then runs
the same suite plus an anonymized replay of `attendanceData.json`. A failed replay
causes the deployment script to restore the previous release.

The daily disaster-recovery cron also executes the runtime replay before external,
security, recovery, backup, and restore checks.

## Critical Scenarios

- Day shift with 55 minutes of overtime.
- Night shift overtime crossing midnight.
- Absent status converted to a late clock-in.
- Concurrent duplicate death-penalty approval.
- Regular and overtime End Adena accumulation.
- Approval followed by cancellation restoring the prior value.

## Safety Guarantees

- No Discord client is created.
- No Google credentials are loaded.
- No external write path is available to the payroll harness.
- Runtime identities and session identifiers are replaced with stable hashes.
- Reports contain aggregate runtime results only.
- Input event arrays are checked for mutation.
- Reversed input order must produce the same projection.

Add future regression cases to `fixtures/staging-replay-critical.json`. A scenario
becomes a deployment requirement as soon as it is committed to that fixture.
