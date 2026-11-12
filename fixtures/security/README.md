# Security fixtures

Two copies of a small café website for the `security` module. `clean/` is an ordinary site; `injected/` is the same site after a hack. `test/integration/security.test.js` serves each folder from a local test server, crawls it with the real crawler and runs the module.

`{origin}` in `sitemap.xml` stands for the address of the test server, which fills it in. To serve a folder by hand, replace it first.

## `clean/`: zero findings

It uses the markup that a careless rule would mistake for a hack:

| Where | What | Why it is not a finding |
|---|---|---|
| every page | A skip link moved off-screen with `left:-9999px` | It goes to `#main`, a link on the site itself |
| every page | A mobile menu with `style="display:none"` holding a link to Instagram | A button names it with `aria-controls`, and the footer links to Instagram visibly |
| every page | Google Tag Manager's `<iframe height="0" width="0" style="display:none">` | It is inside `<noscript>`, which is text for a browser that runs scripts |
| every page | A script from `www.googletagmanager.com` | Every page loads it |
| `about.html` | An accordion answer with the `hidden` attribute and a link to `beans-coop.test` | A button names it with `aria-controls` |
| `about.html` | A `<details>` element with a link to `parcel-partner.test` | Closed `<details>` is content the visitor opens |
| `about.html` | The word "viagra" once, in a joke | One match is below the threshold of two |
| `menu.html` | A tab panel with `style="display:none"` and a link to `oat-milk.test` | A tab names it with `aria-controls` |
| `index.html`, `blog.html` | A YouTube video in an `<iframe>` | Two pages use the host, and the frame is visible |
| `blog.html`, `contact.html` | A newsletter form in an `<iframe>` inside a modal with `style="display:none"` | A link to `#newsletter` opens the modal, and two pages use the host |
| `ja/index.html` | A page in Japanese | Its `lang` attribute is `ja` |

## `injected/`: exactly these findings

| Page | Injected | Finding |
|---|---|---|
| `index.html` | Two links to `cheap-pills.test` in a `<div>` positioned 9999 px off-screen | `security.hidden.external_link`, `security.content.spam_terms` (pharmaceutical) |
| `about.html` | A link to `link-farm.test` on a single hyphen | `security.hidden.external_link` |
| `about.html` | A 1×1 `<iframe>` from `malware.test` with `visibility:hidden` | `security.embeds.hidden_frame`, `security.embeds.rare_host` (info) |
| `promo.html` | A gambling spam page, listed in the sitemap only | `security.content.spam_terms` (gambling) |
| `tokyo-sale.html` | A page of Japanese text with `lang="en"`, listed in the sitemap only | `security.content.foreign_script` |

The header checks do not run on either folder: the test server is on this machine, and its headers say nothing about a deployed site. They are tested with records in `test/checks/security/`.
