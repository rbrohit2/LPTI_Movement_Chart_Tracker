# LPTI Movement Chart Tracker — MVP v0.3

Browser-only GitHub Pages app for uploading a daily movement-chart PDF and reviewing the extracted movements in an editable table.

## Included
- Drag-and-drop PDF upload
- PDF.js text extraction in the browser
- Coordinate-aware first-pass parser for the LPTI movement chart
- Editable movement table
- Review highlighting
- Add/delete rows
- Browser-local save
- CSV export
- Extraction diagnostics

## Deploy on GitHub Pages
1. Upload all files and folders to the repository root.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**.
5. Save. GitHub will publish the site after the Pages workflow completes.

## Important parser note
PDF tables are positioned text, not true spreadsheet tables. The current parser is an MVP designed to extract likely rows and always expose the result for human review. Test it against multiple real daily charts before operational use.

## Local testing
Because the app uses JavaScript modules, use a small local web server rather than opening `index.html` directly:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Privacy
The PDF is processed locally in the browser. The app has no backend. Saved data stays in browser storage unless exported.

## v0.3 parser fix
Normalizes PDF.js coordinates using the page viewport so the parser correctly handles the source PDF's 90-degree page rotation. Row bands and printed columns are then interpreted separately.
