# Web Form Automator — Chrome Extension

Config-driven automation for web forms. Upload a JSON file, use a saved payload, or pick a template — the extension fills form fields in your configured order, clicks buttons, handles dialogs, and waits for your confirmation before submitting.

## Installation

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select the extension folder.
4. The extension icon appears in the toolbar.

## Configuration (Options Page)

Right-click the extension icon → **Options** (or go to `chrome://extensions` → Details → Extension options).

### Target Domain

Enter the domain of your target site (e.g. `mycompany.example.com`). The extension checks the active tab URL against this before running. Leave blank to allow any site.

### Form Field Configuration

This is the core of the extension. Each field on the target form is represented as an entry with:

| Property       | Description                                                                                   |
|----------------|-----------------------------------------------------------------------------------------------|
| **Key**        | Maps to a property in the JSON payload                                                        |
| **Display Name** | Human-readable name shown in logs                                                          |
| **Label Match** | Comma-separated text fragments to match against visible labels on the target page             |
| **Field Type** | `typeahead` (type + pick from dropdown), `text` (plain input), `choice` (native select), `button`, `expand`, or `dialog` |
| **AJAX Wait**  | Milliseconds to wait after typing before looking for dropdown suggestions                     |
| **Enabled**    | Toggle to skip a field without deleting it                                                    |

Fields are filled **in the exact order shown** in the list. Use the arrow buttons to reorder.

### Templates

Save a payload configuration as a named template. Templates persist until you delete them. Useful for recurring form submissions.

### Flows

Chain multiple templates together for multi-page or batch automation. Each flow defines a start URL, error handling strategy, and an ordered list of templates to execute.

## JSON Input Format

Create a `.json` file with key-value pairs matching your field configuration keys:

```json
{
  "fieldKey1": "value1",
  "fieldKey2": ["multi", "value", "list"],
  "fieldKey3": "value3"
}
```

| Field   | Type               | Description                     |
|---------|--------------------|---------------------------------|
| Keys    | `string` or `string[]` | Must match the **Key** property in your field configuration |

A sample file is included at `sample-input.json`.

## Usage

1. Open the target form page in your browser.
2. Click the extension icon (opens the side panel).
3. Choose an input mode:
   - **Upload JSON** — select a `.json` file
   - **Template** — pick a saved template from the dropdown
   - **Flow** — select a flow and upload a data JSON (array of requests)
4. Click **Run Automation**.
5. The extension fills fields in the configured order and clicks buttons as configured.

## How Field Matching Works

For each configured field, the extension:

1. Scans all visible labels on the page for any of the **Label Match** fragments.
2. From the matching label, reads the `for` attribute to locate the associated input element.
3. Keeps track of which elements have already been used, so no two fields target the same input.
4. Fills the value using the handler for the configured **Field Type**.

If a field can't be found, the extension stops with a detailed error showing the label match text and field type — so you know exactly what to fix in Options.

## Adjusting Label Matches

If a field isn't being found correctly:

1. Open the target page and inspect the text near the field (use browser DevTools, F12).
2. Copy a unique fragment of the label text.
3. Go to Options → Field Configuration → update the **Label Match** for that field.
4. Save and retry.

Use short, unique fragments. For example, `"business justification"` is better than the full sentence.

## Adjusting AJAX Wait

Typeahead fields may make AJAX calls to fetch suggestions. If the dropdown doesn't appear in time:

1. Go to Options → Field Configuration.
2. Increase the **AJAX Wait** for the slow field (e.g. try 10000ms).
3. Save and retry.

## Dialog Handling

The extension can intercept native browser dialogs (alert, confirm, prompt) during automation:

- **Alert** — automatically dismissed
- **Confirm** — returns true or false as configured
- **Prompt** — returns the configured text value

Configure dialog fields in the template's field configuration with the `dialog` field type.

## Status Log

The side panel shows a real-time status log:
- Blue — in progress
- Green — success
- Red — error
- Yellow — awaiting confirmation

## Project Structure

```
├── manifest.json            # Chrome MV3 manifest
├── sample-input.json        # Example input file
├── README.md
├── docs/                    # Feature documentation
│   ├── upcomingFeatures.md
│   └── migration-dashboard.md
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── src/
    ├── storage-defaults.js  # Shared storage schema, keys, defaults, migration
    ├── background.js        # Service worker — routes messages, orchestrates runs
    ├── content-script.js    # Injected into target page — config-driven field filling
    ├── dialog-interceptor.js # MAIN world script — intercepts native dialogs
    ├── selectors.js         # Label-based DOM field finder
    ├── export-import.js     # Share/import logic for templates and flows
    ├── section-icons.js     # SVG icon injection for section headings
    ├── schema.js            # JSON input validation
    ├── sidepanel.html       # Side panel UI
    ├── sidepanel.js         # Side panel logic with 3 input modes
    ├── sidepanel.css        # Side panel styles
    ├── popup.html           # Popup UI (fallback)
    ├── popup.js             # Popup logic
    ├── popup.css            # Popup styles
    ├── variables.css        # CSS custom properties (design tokens)
    ├── options.html         # Full settings page
    ├── options.js           # Options logic (field editor, templates, flows)
    └── options.css          # Options styles
```

## Upcoming Features

See [docs/upcomingFeatures.md](docs/upcomingFeatures.md) for planned features and detailed design documents.

## Troubleshooting

- **"No active tab found"** — Make sure the target page is the focused tab.
- **"Active tab does not match configured domain"** — Check the domain in Options.
- **"Could not find field: ..."** — The label match text doesn't match any label on the page. Update it in Options.
- **Dropdown not matching** — Increase AJAX Wait in Options. Check the browser console (F12) for `[AutoFill]` logs.
- **Field targeting wrong input** — Reorder fields in Options so the correct one is processed first. The extension tracks used elements to prevent duplicates.
