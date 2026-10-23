# React + TypeScript + Vite + shadcn/ui

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
## Video clips

Store optional simulator clips in the Vite public directory. The folder name must
match the workstation slug:

```text
hackathon-robot/
  public/
    videos/
      prefilter/
        good.mp4
        bad.mp4
      bottomsheet/
        good.mp4
        bad.mp4
      lightlocalizer/
      driveunit/
      tubeinterface/
      modulecarrier/
      workstation-7/
      workstation-8/
```

The simulator uploads the active workstation's `bad.mp4` to the middleend with
each triggered error. The clips are optional; without them, the error and sensor
data are still sent normally.

The **Reset line** action clears incidents through the middleend and broadcasts
the reset to every connected dashboard. It is therefore a demo-data reset, not
just a local UI reset.

Use exactly `.mp4` once in each filename, for example `good.mp4` and
`bad.mp4`. The simulator only uploads a clip when the response has a video
content type, so a missing clip or Vite fallback page cannot be stored as a
video.
