# Contributing

Thanks for helping improve GPU Stress Test.

## Before You Start

- Open an issue before large behavior, UI, compatibility, or release-process changes.
- Keep pull requests focused on one concern.
- Include manual validation notes when hardware, browser, or GPU-driver behavior is involved.

## Local Development

```powershell
node server.mjs
```

Then open the local URL printed by the server.

Run syntax checks before submitting:

```powershell
node --check app.js
node --check server.mjs
```

## Pull Request Checklist

- The change is focused and documented.
- User-visible behavior is reflected in `README.md` when needed.
- Safety warnings remain visible for workload changes.
- Generated files under `dist/` are not committed.

## Reporting Bugs

When reporting a bug, include:

- Browser and version.
- Operating system.
- GPU model and driver version when available.
- Whether WebGPU or WebGL2 was used.
- Console errors or screenshots when useful.
