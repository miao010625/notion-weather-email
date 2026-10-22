# Security and privacy

Store connection tokens, recipients, coordinates, and source IDs in your own Apps Script project's Script Properties. Never commit them, paste them into issues, or include them in screenshots. Project editors can read Script Properties and execution logs; keep the project private.

Use a Notion connection with read access only to the required database. This script does not need access to unrelated workspaces or Google calendars. Email is sent as the Google account that authorizes the script and installs the trigger.

Forecast requests send coordinates and a time zone to Open-Meteo. Use approximate city coordinates where sufficient. The briefing itself contains Notion titles and dates and is sent to the address you configure. Preview logs also contain those agenda details. This is not end-to-end encrypted email.

Do not attach execution logs or real configuration files to bug reports. Reproduce problems with synthetic titles, `example.com` addresses, and placeholder IDs. If a credential is exposed, revoke it at its provider and replace the private Script Property.

To report a vulnerability, use the repository's private vulnerability reporting option if available. Otherwise open an issue asking for a private reporting channel without including exploit details, credentials, or personal data.
