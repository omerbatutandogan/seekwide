# Next.js App Router fixture

A small site with deliberate SEO problems. Seekwide's tests read its file tree to check that findings are mapped to the right source file; they never install or start it.

To run it by hand, copy the folder somewhere outside the repository first, so that `node_modules` and `.next` never land in it:

```bash
cp -R fixtures/next-app /tmp/seekwide-next-app && cd /tmp/seekwide-next-app && npm install && npm run dev
```

| URL | File | Deliberate problem |
|---|---|---|
| `/` | `app/page.jsx` | none |
| `/about` | `app/(marketing)/about/page.jsx` | no metadata of its own, so it shows the layout's title |
| `/pricing` | `app/(marketing)/pricing/page.jsx` | same title as `/about`, no `h1` |
| `/blog` | `app/blog/page.jsx` | a link to a page that does not exist |
| `/blog/[slug]` | `app/blog/[slug]/page.jsx` | title and canonical from `generateMetadata`, so they exist only in the served page |
| `/docs/...` | `app/docs/[[...path]]/page.jsx` | none |
| `/legacy.html` | `public/legacy.html` | no `lang`, no meta description |
| `/robots.txt` | `app/robots.js` | none |
| `/sitemap.xml` | `app/sitemap.js` | lists a URL that answers 404 |

The root layout (`app/layout.jsx`) sets no `lang` attribute, so every page lacks one. Canonical links are relative, because the project sets no `metadataBase`.

`next.config.mjs` adds `seekwide` to `htmlLimitedBots`. Next.js appends metadata to `<body>` for clients it expects to run JavaScript and sends it in `<head>` to crawlers that cannot; Seekwide does not run JavaScript, and this setting tells Next.js so. Without it, the title and canonical of a page can arrive in the body, and the audit reports the canonical as outside the head.
