# Notion Weather Email

A daily email that brings together your Notion agenda and a local weather forecast. Built for Google Apps Script by **miao010625**.

No server or runtime dependencies are required. The code, configuration guidance, and email templates are in English.

## What it does

- Reads one Notion data source and includes today's all-day, timed, and overlapping multi-day items.
- Fetches temperature, feels-like temperature, daily low/high, humidity, precipitation probability, and maximum UV index from Open-Meteo.
- Sends one plain-text and HTML email per local day to one configured address.
- Provides an explicit preview and starts with sending disabled.
- Uses a lock and persistent delivery state to prevent concurrent or repeated sends.
- Keeps your agenda available if the weather service fails. An incomplete Notion response stops delivery instead of sending a partial agenda.

## Requirements

- A Google account with access to [Apps Script](https://script.google.com/).
- A Notion internal connection with **Read content** access to your source database.
- A Notion source with a title property and a Date property (named `Date` by default).
- An email address you are authorized to send the briefing to.

This version uses Open-Meteo's public endpoint, which is intended for non-commercial use under its [service terms](https://open-meteo.com/en/terms). Weather data requires attribution under CC BY 4.0; attribution is included in each successful forecast. The code's MIT license does not change the weather provider's terms.

## Set up

1. Create a standalone project at [script.google.com](https://script.google.com/).
2. Replace the starter code with the contents of [the script](src/日程天气邮件-Notion-weather-email.gs). The editor's default `Code.gs` filename is fine.
3. In **Project Settings**, enable **Show appsscript.json manifest file in editor**. Replace its contents with [this manifest](src/appsscript.json).
4. Create a Notion internal connection and connect it to your database using the database's **Connections** menu. Give it read access only.
5. Obtain the **data source ID**, which differs from the database ID and from a view ID. See Notion's [data source upgrade guide](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03). Do not paste a whole Notion URL into the ID setting.
6. In **Project Settings → Script Properties**, add the values in the table below. The [example configuration](examples/配置示例-Example-properties.json) is a reference; enter your real values in Script Properties, not in the source or a GitHub file.
7. Run `previewDigest()` and authorize the requested Google permissions. Read the plain-text preview in the execution log. It contains your agenda and configured location label: keep it private.
8. When the preview is correct, change `SEND_ENABLED` to `true` and run `sendDailyDigest()` once. Verify the delivered email before enabling automation.
9. Run `installDailyTrigger()` to schedule subsequent days. Run `removeDailyTrigger()` to stop the schedule, or set `SEND_ENABLED=false` to disable sending.

Google time-driven triggers run approximately around the configured hour, rather than at an exact minute. They execute as the Google account that installs them. See Google's [trigger documentation](https://developers.google.com/apps-script/guides/triggers/installable).

## Script Properties

All values are strings. There are no embedded production credentials, recipients, database IDs, or personal coordinates in this repository.

| Property | Required | Meaning / default |
| --- | --- | --- |
| `NOTION_TOKEN` | Yes | Your read-only Notion connection token. |
| `NOTION_DATA_SOURCE_ID` | Yes | Data source UUID, with or without hyphens. |
| `EMAIL_TO` | Yes | One recipient address; lists are rejected. |
| `TIME_ZONE` | Yes | An IANA zone such as `Etc/UTC` or `Europe/London`. |
| `LATITUDE` | Yes | Forecast latitude, between -90 and 90. Use city-level coordinates if precision is unnecessary. |
| `LONGITUDE` | Yes | Forecast longitude, between -180 and 180. |
| `LOCATION_LABEL` | No | Display name; default `Your location`. Do not use a street address. |
| `NOTION_DATE_PROPERTY` | No | Case-sensitive Date property name; default `Date`. |
| `NOTION_API_VERSION` | No | Default `2026-03-11`. Change only after checking API compatibility. |
| `SEND_HOUR` | No | Local hour, integer 0–23; default `8`. |
| `SEND_ENABLED` | No | Exactly `true` or `false`; default `false`. |

Script Properties are available to project editors. Share the Apps Script project only with trusted people. A public GitHub repository should contain the reusable code, never your deployed project's private settings.

## Preview and delivery behavior

`previewDigest()` always previews, including when sending is enabled. `sendDailyDigest()` also previews while `SEND_ENABLED=false`. Neither preview path sends email or changes delivery state. The programmatic return value includes `body`, `htmlBody`, `subject`, `date`, and `count` for inspecting the HTML in your own private tooling.

When sending is enabled, delivery state is stored as a `DELIVERY_<hash>` Script Property. The hash separates the recipient, source, time zone, and Date property configuration. The stored value contains only a date and `pending` or `sent` status.

The script reserves `pending` **before** calling MailApp. If MailApp throws, the message may still have been accepted. Automatic retries for that day are blocked to prevent duplicate mail. Check your Sent folder and the recipient's inbox. If you are certain it was not delivered and want to retry, disable sending, delete the relevant `DELIVERY_` property manually, and then enable sending and run again. Deleting state can cause a duplicate if your assumption was wrong. A fresh local day permits a new briefing automatically.

Changing the recipient, source, time zone, or Date property creates a separate delivery identity and may allow another email on the same day. Avoid changing these settings during an active send.

## Date handling

- All-day range end dates are inclusive, matching Notion's date range semantics.
- Timed range end instants are exclusive. An item ending at midnight does not appear on the following day.
- A timed item without an end is shown on the local date of its start.
- Offset timestamps are interpreted as instants and displayed in `TIME_ZONE`. A timestamp without an offset uses the Notion Date property's time zone, falling back to `TIME_ZONE`.
- Archived, trashed, and undated pages are excluded. Empty titles are shown as `Untitled`.

The complete data source is paginated on each run so overlapping ranges are retained. This is suitable for personal and modest team agendas. Large sources may exceed Apps Script runtime quotas; the script stops before delivery when its runtime budget is exhausted. It does not write to Notion.

## Privacy and permissions

The manifest requests external HTTP access, email sending, and trigger management. It does not request Gmail inbox access, Calendar access, or Drive access. Notion receives authorized read requests; Open-Meteo receives your configured coordinates and time zone. Only the configured recipient receives the generated briefing. Preview logs contain agenda text and should not be posted in issues.

There is no telemetry, public webhook, or third-party analytics. Provider error messages are replaced with generic errors rather than logging tokens, request URLs, or response bodies. See [security guidance](安全说明-Security.md).

## Test locally

Install Node.js 22 or 24, then run from the repository directory:

```sh
npm test
```

No dependency installation is needed. Tests execute the actual Apps Script source with simulated Google, Notion, and weather service boundaries. They cover preview safety, dates, HTML escaping, configuration validation, pagination, weather fallback, quotas, delivery failures, and duplicate prevention. GitHub Actions runs them on Windows and Linux. These tests do not send real mail or establish that your personal deployment is configured correctly; complete the setup preview and first delivery check above.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Missing or wrong Date property | Check spelling, case, and that the Notion property is a Date, not a formula or text. |
| Notion HTTP 401/403/404 | Check the token, source ID, and database connection access. |
| Weather unavailable | Check coordinates and time zone; preview again later. Open-Meteo may apply shared-IP rate limits. |
| Email quota error | Wait for Google's quota to recover or check the sending account's Apps Script quota. |
| Today's delivery is `pending` | Inspect Sent mail before considering a manual state reset. |
| No automatic email | Confirm `SEND_ENABLED=true`, the trigger exists, its owner's authorization is valid, and recent executions succeeded. |

MIT licensed. Weather service documentation: [Open-Meteo](https://open-meteo.com/en/docs). Email API: [Google MailApp](https://developers.google.com/apps-script/reference/mail/mail-app).
