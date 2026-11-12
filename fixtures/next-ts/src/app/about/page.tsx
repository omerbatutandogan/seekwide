// Deliberate problem: no metadata of its own, so the page shows the layout's
// default title and description, which /products shows too, and it has no
// canonical link.
export default function AboutPage() {
  return (
    <main>
      <h1>About Acme Fixture</h1>
      <p>
        Acme Fixture is not a real company. The about page is here because almost every site has one, and because a
        page that forgets its own title is one of the most common problems an audit finds on a real site.
      </p>
      <p>
        The page relies on the root layout for its title and description. Both are therefore the same as on the
        products page, and an audit reports them as duplicates and names this file as the place to fix them.
      </p>
    </main>
  );
}
