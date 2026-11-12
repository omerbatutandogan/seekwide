# Monorepo fixture

An npm workspaces monorepo. The Next.js App Router site is in `apps/web` and imports its footer from `packages/ui`; the root holds only the workspace settings. Seekwide's tests read its file tree (`test/repo/platform-fixtures.test.js` and `test/repo/workspaces.test.js`); they never install or start it.

To run it by hand, copy it outside the repository, install at the root and start the site's dev server:

```bash
cp -R fixtures/monorepo /tmp/seekwide-monorepo && cd /tmp/seekwide-monorepo && npm install && npm run dev
```

`npm install` puts every dependency in the root `node_modules`; `apps/web` gets none of its own.

An audit started at the root finds no web project there and lists `apps/web` under `workspace_projects`; with `apps/web` as `source_dir`, files are named from the root.

| URL | File | Deliberate problem |
|---|---|---|
| `/` | `apps/web/app/page.jsx` | none |
| `/pricing` | `apps/web/app/pricing/page.jsx` | no description of its own and no canonical |
| `/docs/[...slug]` | `apps/web/app/docs/[...slug]/page.jsx` | `generateMetadata` ignores the address, so both docs pages have the same title |
| every page | `packages/ui/footer.jsx` | a link to `/changelog`, which does not exist; the finding names the page file, as for any component a page imports |
| `/robots.txt` | `apps/web/public/robots.txt` | no `Sitemap:` line, and the site has no sitemap |

The layout sets no Open Graph tags. Audited on 2026-11-12 with Next.js 16.4.6 (`next dev`) through the real server: 22 findings, 20 with a file, each the file and route in the table; the other two (no HTTPS, no sitemap) belong to no file.
