# React + TypeScript + Vite + shadcn/ui

run project
in -ui npm run dev
in -robot npm run dev
in -middlend 

python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000   

## Backend integration

The dashboard loads historical errors from `GET /api/errors` and listens for new
errors on `WS /ws/errors`. Both paths can be overridden with Vite environment
variables:

```env
VITE_API_URL=http://localhost:8000
VITE_ERRORS_ENDPOINT=/api/errors
VITE_ERRORS_WS_PATH=/ws/errors
```

Incidents remain in the history after they are acknowledged, worked on, or
resolved. Selecting an incident opens its evidence panel, where an operator can
review the video and sensor snapshot, add a resolution note, and update its
status. The reset action is intended for clearing demo data; resolving an
incident is the normal operational workflow.

The historical endpoint may return an array or `{ "errors": [...] }` /
`{ "data": [...] }`. Each error should include `id`, `category`, `priority`
(`critical`, `major`, or `minor`), and `description`; `video_url` and
`created_at` are optional. WebSocket messages use the same shape and may also
be wrapped as `{ "error": { ... } }`.

This is a template for a new Vite project with React, TypeScript, and shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```
