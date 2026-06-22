# Accounting integrations

## Xero

The Xero connector uses Xero's official `xero-node` SDK and OAuth 2.0 authorization-code flow.

Required environment variables:

```text
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_REDIRECT_URI=http://localhost:3004/api/integrations/xero/callback
INTEGRATION_ENCRYPTION_KEY=
```

`INTEGRATION_ENCRYPTION_KEY` must be a base64-encoded 32-byte value or a 64-character
hex value. Generate and store it in the deployment secret manager; never commit it.

Register the exact redirect URI in the Xero developer application. The connector requests:

- `openid profile email offline_access`
- `accounting.transactions.read`
- `accounting.settings.read`
- `accounting.reports.read`
- `accounting.contacts.read`

Before connecting, apply [accounting_integrations_migration.sql](../infra/accounting_integrations_migration.sql)
to the Supabase database.

Connection workflow:

1. Settings calls `/api/integrations/xero/connect` with the scoped tenant and company IDs.
2. ClosePilot stores an encrypted, HTTP-only, ten-minute OAuth context cookie.
3. Xero returns to `/api/integrations/xero/callback`; the SDK validates state and exchanges the code.
4. Access, refresh and identity tokens are encrypted with AES-256-GCM before persistence.
5. If multiple Xero organisations were authorised, the reviewer selects the correct organisation.
6. **Sync now** refreshes expiring tokens and imports trial balance, invoices, bank transactions and manual journals.
7. Synced rows pass through the same ClosePilot import, rule, VAT and workpaper engines as uploaded files.

The implementation follows Xero's official SDK guidance:

- <https://github.com/XeroAPI/xero-node>
- <https://developer.xero.com/documentation/guides/oauth2/overview/>

## QuickBooks and HMRC

Their credential-safe configuration states remain available in Settings. OAuth and data-sync
routes should follow the same encrypted-token and scoped-audit architecture after Xero pilot
validation is complete.
