# openapi rules



- **Partial-Update vs Creation Schema Separation in OpenAPI Specifications**: When authoring or updating OpenAPI/REST specifications for resource routes, never reuse a creation schema (e.g. `SetlistInput` requiring `name`) for update operations (`PUT /resource/{id}` or `PATCH /resource/{id}`) whose underlying handlers (e.g. `Controller.findByIdAndUpdate` / `contFBIandU`) accept partial payloads without the creation-required fields. Reusing creation schemas causes generated clients and contract validators to reject valid partial updates (such as `{ items: [] }`). Always define a dedicated update schema (e.g. `SetlistUpdateInput`) with optional top-level fields for update routes, while keeping creation-required fields enforced on `*Input` schemas. Test suites verifying API specifications must explicitly assert that creation schemas enforce required fields while update schemas accept partial field subsets.
