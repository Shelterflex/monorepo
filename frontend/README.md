# Shelterflex Frontend

Next.js web app for Shelterflex.

## Setup

> **Package manager:** This project uses **npm**. Use `npm install` (not `pnpm` or `yarn`) to match
> the `package-lock.json` lockfile that is committed to the repository.

```bash
npm install
npm run dev
```

## Notes

- This frontend is currently UI-first and uses mock data under `lib/mockData/`.
- Backend integration should be centralized under `lib/` (avoid scattering raw `fetch` calls in components).

## Design System Showcase

- Open `/design-system` in dev to view the component showcase page.
- It demonstrates responsive breakpoints, theme tokens, and button variants (`primary`, `secondary`, `outline`, `ghost`).
