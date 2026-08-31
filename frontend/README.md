# Shelterflex Frontend

Next.js web app for Shelterflex.

## Setup

> **Package manager:** This project uses **pnpm**. Use `pnpm install --frozen-lockfile` (not `npm install`) to match
> the `pnpm-lock.yaml` lockfile that CI uses.

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

- `pnpm-lock.yaml` is the only lockfile for this project; do not use `npm install` here.

## Notes

- Backend integration should be centralized under `lib/` (avoid scattering raw `fetch` calls in components).
- Form validation/error-handling standards: `FORM_VALIDATION_CONVENTION.md`.

## Design System Showcase

- Open `/design-system` in dev to view the component showcase page.
- It demonstrates responsive breakpoints, theme tokens, and button variants (`primary`, `secondary`, `outline`, `ghost`).
