# GPU Stress Test

GPU Stress Test is a local browser-based workload tool for exercising a discrete GPU through WebGPU compute shaders, with a WebGL2 fallback for systems where WebGPU is unavailable.

Use it for short hardware validation runs, cooling checks, browser GPU acceleration checks, and repeatable local stress sessions. It is not a benchmark suite and does not attempt to compare GPUs across machines.

## Safety

This project intentionally creates sustained GPU load. Watch system temperature, fan behavior, power draw, and stability while running it. Stop the test if the machine becomes unstable, overheats, or shows driver errors.

## Features

- WebGPU compute workload with WebGL2 fallback.
- Configurable target duty cycle, duration, workload intensity, and buffer size.
- Local-only HTTP server for WebGPU secure-context requirements.
- Optional Windows launcher that opens Chrome or Edge with high-performance GPU hints.
- Query-string controls for repeatable runs and automation.

## Quick Start

```powershell
node server.mjs
```

Open the printed local URL in Chrome or Edge. WebGPU usually requires `http://localhost`, `http://127.0.0.1`, or HTTPS.

You can also use the npm script when npm is available:

```powershell
npm start
```

## Windows Launcher

The launcher embeds `index.html`, `app.js`, and `styles.css` into a single Windows executable.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-exe.ps1
```

The generated executable is written to `dist\GPUStressTest.exe`. Build artifacts are ignored by Git and should be attached to releases instead of committed to the repository.

## URL Parameters

Example:

```text
http://127.0.0.1:4173/?duration=180&target=97&engine=auto&intensity=heavy&autostart=1
```

Supported parameters:

- `duration` or `durationSeconds`: run length in seconds.
- `target` or `targetDuty`: desired duty cycle from `50` to `99`.
- `engine` or `engineMode`: `auto`, `webgpu`, or `webgl2`.
- `intensity`: `balanced`, `heavy`, or `max`.
- `buffer` or `bufferSize`: WebGL2 render target size.
- `autostart`: `1` or `true` starts the test after probing.

## Checks

```powershell
node --check app.js
node --check server.mjs
```

## Maintainers

The current core maintainer is `@naivefish0612-ai`. See `MAINTAINERS.md` and `GOVERNANCE.md` for project ownership and decision-making rules.

## License

MIT. See `LICENSE`.
