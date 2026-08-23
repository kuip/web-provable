# Provable Web

The GitHub Pages adapter for Provable. It consumes the same Core browser runtime,
Markdown form renderer, Kayros client, manifests, and packaged WasmX modules as
the Chrome extension.

Platform-specific responsibilities in this directory are limited to the page
shell, browser-local API-key storage, URL-fragment prefilling, and static-site
deployment.

Build with `npm run build:web`; the publishable site is written to `dist/web/`.

## URL prefilling

The site accepts versioned Prove Inclusion values in the URL fragment and never
runs them automatically:

```text
#v=1&app=prove-inclusion&a=hello%20world%20hello&b=hello&n=1
```

After importing the values, the site removes the fragment from the address bar.
