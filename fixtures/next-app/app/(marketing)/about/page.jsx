// Deliberate problems: no metadata export, so the page inherits the layout's
// title and has no description of its own.
export default function AboutPage() {
  return (
    <main>
      <h1>About Fixture Co</h1>
      <p>
        Fixture Co does not exist. This page is here so that an audit can find a page whose title and description
        are inherited from the layout above it instead of being written for the page itself.
      </p>
    </main>
  );
}
