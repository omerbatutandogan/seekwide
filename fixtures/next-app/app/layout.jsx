import Nav from './_components/nav';

export const metadata = {
  title: 'Fixture Co',
  description: 'A small site with deliberate SEO problems, used to test Seekwide.',
};

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
