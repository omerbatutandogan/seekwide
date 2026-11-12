# Next.js 16 TypeScript fixture

A small Next.js App Router site in TypeScript, with its routes in `src/app`, metadata made at request time with `generateMetadata`, and dynamic routes. It has deliberate SEO problems. Seekwide's tests read its file tree (`test/repo/platform-fixtures.test.js`); they never install or start it. The `/seekwide:fix` cases of the eval suite run it with `next dev` (`evals/README.md`).

To run it by hand, copy the folder somewhere outside the repository first, so that `node_modules`, `.next` and the `AGENTS.md` that `next dev` may write never land in it:

```bash
cp -R fixtures/next-ts /tmp/seekwide-next-ts && cd /tmp/seekwide-next-ts && npm install && npm run dev
```

The root layout sets `metadataBase` to `https://www.example.com`, so audit it with that address as `site_url`.

| URL | File | Deliberate problem |
|---|---|---|
| `/` | `src/app/page.tsx` | none |
| `/about` | `src/app/about/page.tsx` | no metadata of its own: the layout's title and description, which `/products` shows too, and no canonical |
| `/products` | `src/app/products/page.tsx` | the same as `/about` |
| `/products/[id]` | `src/app/products/[id]/page.tsx` | `generateMetadata` makes the title from the product, but sets no description (the layout's is used on every product) and no canonical |
| `/blog` | `src/app/blog/page.tsx` | a link to a post that does not exist |
| `/blog/[slug]` | `src/app/blog/[slug]/page.tsx` | none: `generateMetadata` sets title, description and canonical |
| `/robots.txt` | `src/app/robots.ts` | no `Sitemap:` line, and the project has no sitemap |
| `/api/health` | `src/app/api/health/route.ts` | a route handler, never linked |

`next.config.ts` adds `seekwide` to `htmlLimitedBots`, as in `fixtures/next-app`. Audited on 2026-11-12 with Next.js 16.4.6 through the real server, with `next dev` and with `next start`: 20 findings, 18 with a file, each the file and route in the table; the other two (no HTTPS, no sitemap) belong to no file.
