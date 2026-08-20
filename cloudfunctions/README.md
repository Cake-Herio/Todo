# Cloud Functions

The `cloudfunctions/` directory contains only deployable CloudBase functions.
Each function keeps a small `index.js` deployment adapter at its root and its
implementation under `src/handler.js`.

| Function | Responsibility | Triggered by |
| --- | --- | --- |
| `sharedSpace` | Rooms, memberships, shared plans, records and tags | Mini program |
| `focusPresence` | Live focus-session presence | Mini program |
| `activitySmith` | ActivitySmith Live Activity sync | Mini program and timer |
| `bark` | Bark device registration and scheduled notifications | Mini program and timer |

CloudBase local metadata is kept under `.cloudbase/` so generated folders do
not sit beside deployable functions. The function names are unchanged, so the
existing client calls and deployed function contracts remain stable.
