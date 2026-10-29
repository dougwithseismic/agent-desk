# Vendored code

The mail Worker's only runtime dependency is copied in here, so a project deploys it
with `wrangler` alone and never runs an install.

## postal-mime 4.2.0

- What: the MIME parser the Worker uses to read inbound mail (`src/inbound.js`).
- From: the npm package `postal-mime@4.2.0` (`npm pack postal-mime@4.2.0`), published
  29 Oct 2026. Tarball shasum `82c050419201ef62735ae2f8e4d75464954b392c`, integrity
  `sha512-QG5Rh8wY/zjwFF1lKWcBbwWcAWR5jWodmMPL4gMik43XDLebtWoAAPyG0lrE2kYYZ5IHTASrepGuGO0YIwNKAg==`.
  Source: https://github.com/postalsys/postal-mime
- Licence: MIT-0, by Andris Reinman. `postal-mime/LICENSE.txt` is the package's own.
- Files: `postal-mime/*.js` are the package's published ES module build, `dist/esm/*.js`.
  The package's `src/` is TypeScript, and the kit runs plain JavaScript with no build
  step, so the JavaScript the package itself publishes is what's kept. The one change is
  that each file's last line, a `//# sourceMappingURL=` comment pointing at a map that
  isn't copied, was removed.
- Imported by relative path: `../vendor/postal-mime/postal-mime.js`.

To update it, in an empty scratch folder:

```sh
npm pack postal-mime@latest
tar -xzf postal-mime-*.tgz
for f in package/dist/esm/*.js; do
  grep -v '^//# sourceMappingURL=' "$f" > <kit>/template/desks/kit/mail/vendor/postal-mime/"$(basename "$f")"
done
cp package/LICENSE.txt <kit>/template/desks/kit/mail/vendor/postal-mime/
```

Then delete any file the new version no longer has, update the version, date and
checksums above, and run `pnpm test`.
