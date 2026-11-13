# Imported search data: the export formats

What Seekwide reads from the export files people download from Google Search Console and Bing Webmaster Tools, what the official documentation says about them, and what it does not say. The code is in `plugin/server/src/imports/`; how the data is stored and shown is in [ARCHITECTURE.md](ARCHITECTURE.md) 4.17.

Seekwide reads only files the user saved in the project folder. There is no OAuth, no API key and no scraping, and the import sends nothing anywhere.

## What the documentation says (read 2026-11-13)

| Fact | Source |
|---|---|
| Search Console exports a report's table to Google Sheets, Excel or CSV, truncated to 1,000 rows of representative examples; the totals shown in the report are actual totals. Values shown as "~" or "-" are zeros in the downloaded data. | https://support.google.com/webmasters/answer/12919797 |
| The CSV download is a zip of CSV files, one per table (queries, pages, countries, devices, search appearances, dates), with a table or file that records the filters applied. | https://developers.google.com/search/blog/2020/02/data-export (2020) |
| The Performance report's metrics are named Clicks, Impressions, CTR (click-through rate: the click count divided by the impression count) and Average position; the chart shows "total clicks, total impressions, average CTR, and average position". Data grouped by dates is aggregated by property, data grouped by pages by page. | https://support.google.com/webmasters/answer/7576553?hl=en |
| The same page in Turkish names them Tıklama sayısı, Gösterim sayısı, TO (Tıklama oranı) and Ortalama konum, and the chart "toplam tıklama sayısı, toplam gösterim sayısı, ortalama TO'su ve ortalama konumu". | https://support.google.com/webmasters/answer/7576553?hl=tr |
| Bing's Search Performance report is downloaded as CSV. Its Keywords and Pages tables have Impressions, Clicks, Avg. CTR and Avg. position (also written Average Click-Through Rate(CTR) and Average Position); position is available only for web traffic. | https://www.bing.com/webmasters/help/search-performance-c680da36 |
| Search Console's generative AI performance report has an export button; its metric is impressions, by page, country, date and device, with the usual 1,000-row limit. The formats and columns are not stated. | https://support.google.com/webmasters/answer/16984139 |
| Bing's AI Performance report exports CSV and Excel with grounding queries and citation counts, page-level citations and time series. No column is named. | https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c |

## What no official page documents

- **The header row of any export**, in any language. Neither Google nor Microsoft publishes the column names of a downloaded file.
- **Whether and how an export is localized**: its file names, headers, number formats. A Turkish download reportedly names its files `Sorgular.csv`, `Sayfa sayısı.csv`, `Tarihler.csv`, `Filtreler.csv` and so on (a community page, https://ceaksan.com/tr/ga4-gsc-page-analysis, undated), which Seekwide does not rely on.
- **How the CTR and position cells are written**, and how dates are written in the table of dates.
- **The columns of the filters table.**
- **Bing's row limit**, and whether its export records the date range.

## What Seekwide reads, and why that way

Because the headers are not documented, nothing depends on the header of the column that names the pages or dates, on a file name, or on a sheet name.

- **A metric column** is known by the name the tool's help page gives the metric, in English or Turkish (the table above), compared without letter case or accents, with one leading "total", "average", "avg." ("toplam", "ortalama") allowed and a closing part in brackets ignored. A name no help page gives, such as the plural "Tıklamalar", is not read.
- **The table of pages** is the one table with clicks and impressions columns and exactly one other column, every value of which is an address starting with `http://` or `https://`. **The table of dates** is the same with dates written `YYYY-MM-DD` (in an Excel file, also a number formatted as a date). **The filters** are a table of two columns and no metric, read as name and value after its first row. Every other table (queries, countries, devices, search appearance) is counted and not used.
- **Counts** (clicks, impressions) are digits, optionally in groups of three with one separator (`1,234`, `1.234`, `1 234`): a count is a whole number, so a separator in it cannot be a decimal mark. **Position** is digits with at most one decimal mark, a dot or a comma, and never a group separator; 0 and an empty cell mean no position. **CTR is not read**: it is clicks divided by impressions, as both help pages define it, and Seekwide computes it.
- A row with more cells than its header names is refused, even when the extra cell is empty: a decimal comma written without quotes in a comma-separated file splits a number in two and would shift every later column. In an Excel file, empty cells at the end of a row (cells that only carry a style) do not count.
- In an Excel file a number must be written as SpreadsheetML writes one (`1.5E-2`, `-3`); `0x1F` or a padded ` 7 ` is refused, not read as a number. A date cell that is empty is refused.
- A file that does not fit is refused with a message that says what is missing. It is never read in part.

## Formats

| File | Supported | How |
|---|---|---|
| Search Console Performance, CSV download (zip) | Yes | Every `.csv` in the archive is a table; the macOS resource forks `__MACOSX/` and `._*` are skipped |
| Search Console Performance, Excel (`.xlsx`) | Yes | Every sheet is a table; shared strings, inline strings and numbers are read, and a number formatted as a date becomes a date. Formulas are never evaluated: a cell is its stored value |
| Search Console Performance, one table saved as CSV (from Google Sheets or Excel) | Yes, when it is the Pages table | Comma, semicolon or tab separated; UTF-8 or UTF-16 with a byte order mark |
| Bing Search Performance, Pages table (CSV) | Yes | The period is not in the file; the user can state it (`period_start`, `period_end`) |
| Search Console generative AI report | No | Its columns are not documented, and its pages table would differ from a Performance one only by a missing clicks column, which the import refuses |
| Bing AI Performance | No | Its columns are not documented |
| Google Sheets (online) | No | Download it as Excel or CSV first |
| A Search Console or Bing interface in another language than English or Turkish | No | The metric names of other languages have not been checked against their help pages |

## Limits

A file of at most 10 MB; a zip of at most 200 entries, 20 MB unpacked per entry and 40 MB in all, with no encryption and no ZIP64; at most 32 sheets; at most 50,000 rows and 64 columns per table, 4,096 characters per cell and 1,000,000 cells in all; a row of empty cells is not kept. XML with a document type declaration is refused, so no entity is ever defined or expanded. Every reader works in one pass over its input.

## Checking with a real export

The synthetic files in the tests (`test/helpers/exports.js`) follow the table above; the header of the page column, the file names and the number formats in them are stand-ins. A real export from a Search Console account in English and one in Turkish, and a Bing Pages export, settle what this page lists as undocumented. For each: the file as downloaded, the interface language, the report (Performance, search type), the date range and filters chosen, and whether it was the CSV, Excel or Google Sheets option.
