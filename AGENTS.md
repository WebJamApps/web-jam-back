# Gemini Context: web-jam-back

## Tech Stack
- **Runtime:** Node.js v24.18.1
- **Framework:** Express
- **Testing:** Vitest (vitest.config.ts)
- **Linting:** ESLint (eslint.config.mjs)

## Development Workflow
- **Build:** Check package.json for build scripts.
- **Node Engine Version Bumps:** When bumping Node.js in `package.json` `engines.node`, always run `npm install --package-lock-only` (or `npm install`) so `package-lock.json` root engine definition is committed alongside `package.json`.
- **Standards:** Follow existing ESM patterns.
- **Merging:** Gemini is **NOT** allowed to merge PR changes to the `dev` or `main` branches. The user is the reviewer.

## Routes & Verbs
- **Venue Updates (`/venue/:id`)**: `PATCH /venue/:id` is the standard partial-merge update verb. `PUT /venue/:id` is maintained alongside `PATCH` for backward compatibility, both routing to `controller.updateVenue`. Address updates enforce immutability once set (`400: address cannot be removed`).
- **Setlist API Sorting (`GET /setlist` and `GET /setlist/:id`)**: Accepts `?sort=title` (or `sort=artist` / `sort=order`) to return items in alphabetical or specified order. Sorting is read-time view only and strips `sort` from Mongoose query params so stored MongoDB item order is never mutated.
