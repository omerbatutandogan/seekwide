// The stylesheet of the HTML report. No url(), no @import, no external fonts:
// the report is one file and makes no requests when opened.
// Selectors avoid ">" so the stylesheet can never be mistaken for markup.

export const CSS = `
:root{--ink:#1b2430;--mut:#5b6675;--line:#dfe4ea;--soft:#f5f7f9;--acc:#1f4d85}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:860px;margin:0 auto;padding:40px 24px 56px}
.top{border-bottom:2px solid var(--ink);padding-bottom:18px}
.brand{display:flex;align-items:center;gap:14px;margin-bottom:26px;color:var(--mut);font-size:13px}
.brand img{max-height:44px;max-width:180px}
h1{font-size:30px;line-height:1.2;margin:0 0 6px;letter-spacing:-.01em}
h2{font-size:19px;line-height:1.3;margin:38px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line)}
h3{font-size:15px;line-height:1.4;margin:0 0 4px}
p{margin:0 0 10px}
a{color:var(--acc)}
code{font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:3px;overflow-wrap:anywhere}
.sub,.meta,.cap,.src,footer{color:var(--mut)}
.sub{margin:0}
.cap{font-size:12px;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.05em}
.u{overflow-wrap:anywhere;word-break:break-word}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);border-bottom:2px solid var(--line)}
.n{text-align:right;white-space:nowrap}
.nt{min-width:15em;color:var(--mut)}
.bar{display:inline-block;width:90px;height:6px;margin-left:8px;border-radius:3px;background:var(--line);vertical-align:middle;overflow:hidden}
.bar i{display:block;height:100%;background:var(--acc)}
.figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:0}
.fig{background:var(--soft);border-radius:6px;padding:12px 14px}
.fig b{display:block;font-size:24px;line-height:1.15}
.fig span{font-size:12px;color:var(--mut)}
.note,.warn{border-left:3px solid var(--acc);background:var(--soft);padding:9px 14px;margin:0 0 14px;font-size:14px}
.warn{border-left-color:#a14a08;background:#fdf5ec}
dl{display:grid;grid-template-columns:170px 1fr;gap:6px 18px;margin:0;font-size:14px}
dt{color:var(--mut)}
dd{margin:0}
.layers{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.layer{border:1px solid var(--line);border-radius:8px;padding:12px 14px}
.layer p{font-size:14px;margin:6px 0 0}
.on{border-color:var(--acc)}
.pill{display:inline-block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
.on .pill{color:var(--acc)}
.badge{display:inline-block;font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:999px;white-space:nowrap;vertical-align:middle}
.badge.sev-critical{background:#fbe4e4;color:#8a1717}
.badge.sev-high{background:#fde9d6;color:#8a3d05}
.badge.sev-medium{background:#fbf0c4;color:#664d00}
.badge.sev-low{background:#e1ecf9;color:#1d4a80}
.badge.sev-info{background:#e9edf1;color:#46515f}
.likely{background:#fff;border:1px dashed var(--mut);color:var(--mut)}
.confirmed{background:#fff;border:1px solid var(--ink);color:var(--ink)}
.card{border:1px solid var(--line);border-left:4px solid var(--mut);border-radius:8px;padding:14px 16px;margin:0 0 12px;break-inside:avoid-page}
.card.sev-critical{border-left-color:#b42318}
.card.sev-high{border-left-color:#c2570c}
.card.sev-medium{border-left-color:#b08900}
.card.sev-low{border-left-color:#3b78c3}
.card.sev-info{border-left-color:#8a94a1}
.card p{font-size:14px}
.rank{display:inline-block;min-width:22px;color:var(--mut)}
.items{list-style:none;margin:8px 0 0;padding:0}
.items li{padding:8px 0;border-top:1px solid var(--line);font-size:13.5px;break-inside:avoid}
.ev{margin-top:3px;color:var(--mut)}
.k{font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin:0 6px 0 0}
.ev .k+code+.k{margin-left:12px}
.figs+table{margin-top:16px}
.cwv{margin:14px 0 8px}
.rt{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.rt-good{color:#17643a}
.rt-mid{color:#8a5a00}
.rt-poor{color:#8a1717}
#changes h3{margin:18px 0 6px}
.recs{padding-left:20px;margin:0}
.recs li{margin-bottom:14px}
footer{margin-top:44px;padding-top:12px;border-top:1px solid var(--line);font-size:12px}
@page{size:A4;margin:16mm 14mm}
@media (max-width:600px){main{padding:24px 16px 40px}h1{font-size:24px}table{display:block;overflow-x:auto}dl{grid-template-columns:1fr;gap:0 0}dd{margin-bottom:8px}.bar{display:none}}
@media print{
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-size:10.5pt}
main{max-width:none;padding:0}
h2{break-after:avoid-page;margin-top:22pt}
.fig,.layer,.items li,tr{break-inside:avoid-page}
thead{display:table-header-group}
a{color:inherit;text-decoration:none}
}
`;
