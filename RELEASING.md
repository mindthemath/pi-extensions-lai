# Releasing to npm

The intended npm package name is `pi-lightning-ai-provider`; it was unclaimed
when this repository was created. The GitHub organization and npm ownership are
independent: publishing requires an npm account that claims and owns this
unscoped package name.

## First release

1. Create or sign in to an npm account at <https://www.npmjs.com/> and enable
   two-factor authentication.
2. Authenticate this machine:

   ```bash
   npm login --auth-type=web
   npm whoami
   ```

3. Confirm the package name is still available:

   ```bash
   npm view pi-lightning-ai-provider
   ```

   A `404 Not Found` means it has not been claimed.

4. From this repository, inspect the package contents:

   ```bash
   npm pack --dry-run
   npm pack --json --dry-run | jq '.[0].files[].path'
   ```

   The package must contain only:

   - `extensions/lightning-ai.ts`
   - `README.md`
   - `RELEASING.md`
   - `LICENSE`
   - `package.json` (npm always includes it)

   Never continue if `.env`, credentials, debug responses, or unrelated files
   appear.

5. Publish version `0.1.0`:

   ```bash
   npm publish
   ```

   `publishConfig.access` already makes the package public.

6. Verify installation in a temporary directory:

   ```bash
   mkdir -p /tmp/pi-lightning-ai-smoke
   cd /tmp/pi-lightning-ai-smoke
   pi -e npm:pi-lightning-ai-provider --list-models
   ```

7. Tag the exact published commit:

   ```bash
   cd ~/vibes/pi-extensions-lai
   git tag -a v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

## Later releases

Make and commit changes, then choose the appropriate semantic-version bump:

```bash
npm version patch   # fixes: 0.1.0 -> 0.1.1
npm version minor   # backward-compatible features
npm version major   # breaking changes
npm pack --dry-run
npm publish
git push origin main --follow-tags
```

`npm version` updates `package.json`, creates a release commit, and tags it.
Do not reuse a published version; npm versions are immutable.

## Optional scoped package

To publish as `@mindthemath/pi-lightning-ai-provider`, first create or claim the
`mindthemath` organization/scope on npm and grant the publishing npm account
access. Then change `package.json`'s `name`, and publish with:

```bash
npm publish --access public
```

The GitHub repository already lives under `mindthemath`; using an npm scope is
optional and is not required for `pi install`.
