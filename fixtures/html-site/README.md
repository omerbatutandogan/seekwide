# Plain HTML fixture

A static site with deliberate SEO problems. Seekwide's tests serve these files from a local test server and check that every finding names the right file and line.

To serve it by hand:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory fixtures/html-site
```

| File | Deliberate problem |
|---|---|
| `index.html` | none besides what every page has |
| `about.html` | no `<title>`, no meta description |
| `contact.html` | same title as `services.html`, two `h1` elements, a canonical link outside `<head>` |
| `services.html` | same title as `contact.html`, a link to a page that does not exist, a link without text |
| `blog/index.html` | no `lang` attribute, invalid JSON-LD |

Every page has a relative canonical link and no Open Graph tags, and the site has no sitemap.
