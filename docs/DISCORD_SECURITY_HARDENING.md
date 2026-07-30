# Discord Security Hardening

This runbook removes the two remaining Discord security advisories without changing the manual End Adena approval policy.

## Sensitive Command Authorization

Sensitive commands and approval reactions use explicit principals only:

- `OWNER_IDS`
- `OPS_MANAGER_ROLE_IDS`
- `LIVE_EXCEPTION_MANAGER_ROLE_IDS`
- `ANNOUNCEMENT_MANAGER_ROLE_IDS`
- `DAYOFF_MANAGER_ROLE_IDS` and `DAYOFF_REVIEWER_ID`
- `END_ADENA_REVIEWER_ROLE_IDS` and `END_ADENA_SUMMARY_OWNER_ROLE_IDS`

Keep `ALLOW_DISCORD_ADMIN_COMMANDS=false`. Discord `Administrator` and `Manage Messages` are not command authorization substitutes. The security audit verifies this policy and confirms that every configured privileged role exists in the guild.

## Required Role Permissions

Generate the authoritative permission profile from the running source:

```powershell
npm run ops:discord-permissions
```

The bot role needs these guild permissions:

- Manage Roles
- Manage Nicknames

Critical text channels need:

- View Channel
- Send Messages
- Read Message History
- Embed Links

Review channels additionally need:

- Add Reactions
- Manage Messages

Do not grant Administrator, Manage Server, Manage Channels, Manage Webhooks, Ban Members, Kick Members, or Moderate Members. Keep the bot role above every worker role it manages.

## Private Installation

In the Discord Developer Portal, open the Attendance Bot application and disable Public Bot. This setting is intentionally not changed by bot-token automation.

## Verification

After both Discord settings are changed, run on the VPS:

```bash
npm run ops:security-audit
npm run ops:health
```

The target result is `criticalCount: 0`, `advisoryCount: 0`, and `Security: ok`. If a critical permission check fails, restore only the named missing permission and rerun the audit. Do not restore Administrator as a permanent fix.
