// Two HTML shells for the generated packs. The screen shell is for viewing /
// print-to-PDF; the Word shell adds the MS Office XML header and an @page section
// so Word opens the .doc cleanly (Print view, A4) instead of flagging a
// format-mismatch. Both wrap the same inner content + CSS.

export function screenShell(title: string, css: string, inner: string, autoPrint = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">Save as PDF / Print</button></div>
<div class="page">${inner}</div>
${autoPrint ? "<script>window.addEventListener('load',()=>window.print());</script>" : ""}
</body></html>`;
}

export function wordShell(title: string, css: string, inner: string): string {
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->
<style>@page WordSection1 { size: 21.0cm 29.7cm; margin: 2.0cm; } div.WordSection1 { page: WordSection1; } body { background:#fff; } .page { box-shadow:none; margin:0; max-width:none; padding:0; } .toolbar { display:none; } ${css}</style></head>
<body><div class="WordSection1"><div class="page">${inner}</div></div></body></html>`;
}
