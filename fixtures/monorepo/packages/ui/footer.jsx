// Deliberate problem: a link to a page that does not exist. It appears on
// every page of the site, but the file is in this package, not in apps/web.
export function Footer() {
  return (
    <footer>
      <a href="/">Home</a> <a href="/changelog">Changelog</a>
    </footer>
  );
}
