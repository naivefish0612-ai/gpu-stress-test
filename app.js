const workerSource = String.raw`
let running = false;
let engine = null;
let sequence = 0;

const WEBGL_INTENSITY = {
  balanced: 112,
  heavy: 224,
  max: 384
};

const WEBGPU_INTENSITY = {
  balanced: { cells: 65536, iterations: 192 },
  heavy: { cells: 131072, iterations: 320 },
  max: { cells: 262144, iterations: 448 }
};

const WEBGPU_PROBE = { cells: 1024, iterations: 8 };

const vertexShaderSource = [
  '#version 300 es',
  'precision highp float;',
  'const vec2 POSITIONS[3] = vec2[3](',
  '  vec2(-1.0, -1.0),',
  '  vec2(3.0, -1.0),',
  '  vec2(-1.0, 3.0)',
  ');',
  'void main() {',
  '  gl_Position = vec4(POSITIONS[gl_VertexID], 0.0, 1.0);',
  '}'
].join('\n');

const fragmentShaderSource = [
  '#version 300 es',
  'precision highp float;',
  'uniform vec2 u_resolution;',
  'uniform float u_time;',
  'uniform int u_inner;',
  'uniform int u_pass;',
  'out vec4 outColor;',
  'float wave(vec2 p, float salt) {',
  '  return sin(dot(p, vec2(12.9898, 78.233)) + salt) * cos(length(p) * 6.28318 + salt);',
  '}',
  'void main() {',
  '  vec2 uv = gl_FragCoord.xy / u_resolution;',
  '  vec2 p = uv * 2.0 - 1.0;',
  '  float t = u_time + float(u_pass) * 0.017;',
  '  vec3 c = vec3(0.12 + uv.x * 0.18, 0.18 + uv.y * 0.22, 0.22);',
  '  float acc = 0.0;',
  '  for (int i = 0; i < 512; i++) {',
  '    if (i >= u_inner) {',
  '      break;',
  '    }',
  '    float fi = float(i) + 1.0;',
  '    vec2 q = p * (1.0 + fi * 0.007) + vec2(sin(t + fi * 0.03), cos(t * 0.7 + fi * 0.05));',
  '    float v = wave(q + acc * 0.011, t + fi * 0.013);',
  '    acc += v * 0.73 + sin(v + fi * 0.021 + acc) * 0.31;',
  '    c += vec3(sin(acc + q.x), cos(acc * 0.7 + q.y), sin(acc * 1.3 + q.x * q.y)) * 0.0018;',
  '  }',
  '  outColor = vec4(fract(c + acc * 0.004), 1.0);',
  '}'
].join('\n');

const computeShaderSource = [
  'struct Params {',
  '  seed: f32,',
  '  iterations: u32,',
  '  cells: u32,',
  '  pass_index: u32,',
  '};',
  '@group(0) @binding(0) var<storage, read_write> data: array<vec4<f32>>;',
  '@group(0) @binding(1) var<uniform> params: Params;',
  'fn churn(v: vec4<f32>, salt: f32) -> vec4<f32> {',
  '  let a = sin(v.yzwx * 1.6180339 + salt);',
  '  let b = cos(v.zwxy * 0.7548777 - salt * 0.37);',
  '  return fract((a + b + v.wxyz * 1.193496) * 0.735 + vec4<f32>(0.17, 0.31, 0.53, 0.79));',
  '}',
  '@compute @workgroup_size(256)',
  'fn main(@builtin(global_invocation_id) id: vec3<u32>) {',
  '  let index = id.x;',
  '  if (index >= params.cells) {',
  '    return;',
  '  }',
  '  var v = vec4<f32>(',
  '    f32(index & 255u) * 0.0039215686 + params.seed,',
  '    f32((index >> 8u) & 255u) * 0.0039215686,',
  '    f32((index >> 16u) & 255u) * 0.0039215686,',
  '    f32(params.pass_index & 1023u) * 0.0009765625',
  '  );',
  '  for (var i = 0u; i < params.iterations; i = i + 1u) {',
  '    let fi = f32(i + 1u);',
  '    v = churn(v + vec4<f32>(fi * 0.00013, fi * 0.00021, fi * 0.00034, fi * 0.00055), params.seed + fi * 0.011);',
  '  }',
  '  data[index] = v;',
  '}'
].join('\n');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSoftwareRenderer(renderer) {
  return /swiftshader|software|llvmpipe|warp/i.test(renderer || '');
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(gl) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function createWebGlEngine(config) {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not available in this browser.');
  }

  const size = config.probe ? 64 : Number(config.bufferSize) || 1536;
  const canvas = new OffscreenCanvas(size, size);
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: false,
    failIfMajorPerformanceCaveat: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    stencil: false
  });

  if (!gl) {
    throw new Error('WebGL2 is not available or GPU acceleration is disabled.');
  }

  const program = createProgram(gl);
  const vao = gl.createVertexArray();
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('GPU framebuffer could not be created.');
  }

  gl.useProgram(program);
  gl.bindVertexArray(vao);
  gl.viewport(0, 0, size, size);

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo
    ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);

  return {
    kind: 'webgl2',
    label: 'WebGL2',
    canvas,
    framebuffer,
    gl,
    innerIterations: config.probe ? 16 : WEBGL_INTENSITY[config.intensity] || WEBGL_INTENSITY.heavy,
    program,
    renderer: renderer || 'WebGL2 renderer',
    size,
    uniforms: {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      inner: gl.getUniformLocation(program, 'u_inner'),
      pass: gl.getUniformLocation(program, 'u_pass')
    },
    vao
  };
}

function describeWebGpuAdapter(adapter) {
  const info = adapter && adapter.info ? adapter.info : {};
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'WebGPU high-performance adapter';
}

async function createWebGpuEngine(config) {
  if (!self.isSecureContext) {
    throw new Error('WebGPU requires http://localhost or HTTPS.');
  }
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    throw new Error('No high-performance WebGPU adapter was returned.');
  }

  const device = await adapter.requestDevice();
  const selected = config.probe
    ? WEBGPU_PROBE
    : WEBGPU_INTENSITY[config.intensity] || WEBGPU_INTENSITY.heavy;
  const cells = selected.cells;
  const iterations = selected.iterations;
  const dataBuffer = device.createBuffer({
    size: cells * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  const uniformBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  });
  const module = device.createShaderModule({ code: computeShaderSource });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' }
      }
    ]
  });
  const pipeline = await device.createComputePipelineAsync({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: {
      module,
      entryPoint: 'main'
    }
  });
  const bindGroup = device.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: { buffer: dataBuffer }
      },
      {
        binding: 1,
        resource: { buffer: uniformBuffer }
      }
    ]
  });

  return {
    kind: 'webgpu',
    label: 'WebGPU',
    bindGroup,
    cells,
    dataBuffer,
    device,
    iterations,
    pipeline,
    renderer: describeWebGpuAdapter(adapter),
    uniformBuffer,
    workgroups: Math.ceil(cells / 256)
  };
}

async function createStressEngine(config) {
  const mode = config.engineMode || 'auto';
  const errors = [];

  if (mode !== 'webgl2') {
    try {
      return await createWebGpuEngine(config);
    } catch (error) {
      errors.push('WebGPU: ' + (error.message || String(error)));
      if (mode === 'webgpu') {
        throw new Error(errors.join(' | '));
      }
    }
  }

  if (mode !== 'webgpu') {
    try {
      return createWebGlEngine(config);
    } catch (error) {
      errors.push('WebGL2: ' + (error.message || String(error)));
    }
  }

  throw new Error(errors.join(' | ') || 'No GPU stress engine is available.');
}

function cleanupEngine() {
  if (!engine) {
    return;
  }

  if (engine.kind === 'webgl2') {
    const loseContext = engine.gl.getExtension('WEBGL_lose_context');
    if (loseContext) {
      loseContext.loseContext();
    }
  }

  if (engine.kind === 'webgpu' && engine.device && typeof engine.device.destroy === 'function') {
    engine.device.destroy();
  }

  engine = null;
}

function runWebGlPasses(passCount, startIndex) {
  const gl = engine.gl;
  gl.useProgram(engine.program);
  gl.bindVertexArray(engine.vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine.framebuffer);
  gl.viewport(0, 0, engine.size, engine.size);
  gl.uniform2f(engine.uniforms.resolution, engine.size, engine.size);
  gl.uniform1i(engine.uniforms.inner, engine.innerIterations);

  const now = performance.now() * 0.001;
  for (let i = 0; i < passCount; i += 1) {
    gl.uniform1f(engine.uniforms.time, now + i * 0.003);
    gl.uniform1i(engine.uniforms.pass, (startIndex + i) % 65535);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.finish();
}

async function runWebGpuPasses(passCount, startIndex) {
  const paramsBuffer = new ArrayBuffer(16);
  const floats = new Float32Array(paramsBuffer);
  const uints = new Uint32Array(paramsBuffer);
  floats[0] = performance.now() * 0.001;
  uints[1] = engine.iterations;
  uints[2] = engine.cells;
  uints[3] = startIndex >>> 0;
  engine.device.queue.writeBuffer(engine.uniformBuffer, 0, paramsBuffer);

  const encoder = engine.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(engine.pipeline);
  pass.setBindGroup(0, engine.bindGroup);
  for (let i = 0; i < passCount; i += 1) {
    pass.dispatchWorkgroups(engine.workgroups);
  }
  pass.end();
  engine.device.queue.submit([encoder.finish()]);
  await engine.device.queue.onSubmittedWorkDone();
}

async function runEnginePasses(passCount, startIndex) {
  if (!engine) {
    throw new Error('GPU engine is not initialized.');
  }
  if (engine.kind === 'webgpu') {
    await runWebGpuPasses(passCount, startIndex);
    return;
  }
  runWebGlPasses(passCount, startIndex);
}

function adjustPassCount(passCount, workMs, chunkGoalMs) {
  if (workMs < chunkGoalMs * 0.55) {
    return Math.min(384, Math.max(passCount + 1, Math.ceil(passCount * 1.25)));
  }
  if (workMs > chunkGoalMs * 1.55 && passCount > 1) {
    return Math.max(1, Math.floor(passCount * 0.72));
  }
  return passCount;
}

async function probe(config) {
  try {
    engine = await createStressEngine({ ...(config || {}), probe: true });
    const renderer = engine.renderer || engine.label;
    const label = engine.label;
    const software = isSoftwareRenderer(renderer);
    cleanupEngine();
    self.postMessage({
      type: 'probe',
      ok: true,
      engine: label,
      renderer,
      software
    });
  } catch (error) {
    cleanupEngine();
    self.postMessage({
      type: 'probe',
      ok: false,
      message: error.message || String(error)
    });
  }
}

async function runStress(config) {
  sequence += 1;
  const runId = sequence;
  running = true;
  cleanupEngine();

  const targetDuty = Math.min(0.99, Math.max(0.5, Number(config.targetDuty) || 0.97));
  const durationMs = Math.max(5000, Number(config.durationSeconds || 180) * 1000);
  const start = performance.now();
  const endAt = start + durationMs;
  let activeMs = 0;
  let lastReport = 0;
  let passCount = 1;
  let passIndex = 0;

  try {
    engine = await createStressEngine(config);
    const chunkGoalMs = engine.kind === 'webgpu' ? 64 : 72;
    self.postMessage({
      type: 'started',
      engine: engine.label,
      renderer: engine.renderer,
      software: isSoftwareRenderer(engine.renderer),
      detail: engine.kind === 'webgpu'
        ? engine.cells + ' cells / ' + engine.iterations + ' iterations'
        : engine.size + ' px / ' + engine.innerIterations + ' iterations'
    });

    while (running && runId === sequence && performance.now() < endAt) {
      const chunkStart = performance.now();
      await runEnginePasses(passCount, passIndex);
      const workMs = performance.now() - chunkStart;
      passIndex += passCount;
      activeMs += workMs;
      passCount = adjustPassCount(passCount, workMs, chunkGoalMs);

      const elapsedAfterWork = performance.now() - start;
      const targetElapsed = activeMs / targetDuty;
      const chunkIdleCap = workMs * (1 / targetDuty - 1);
      const idleMs = Math.max(0, Math.min(chunkIdleCap, targetElapsed - elapsedAfterWork));
      if (idleMs > 0) {
        await sleep(idleMs);
      } else {
        await sleep(0);
      }

      const now = performance.now();
      if (now - lastReport > 180 || now >= endAt) {
        const elapsedMs = Math.min(durationMs, now - start);
        self.postMessage({
          type: 'progress',
          activeMs,
          averageDuty: activeMs / Math.max(1, now - start),
          elapsedMs,
          remainingMs: Math.max(0, endAt - now),
          passCount,
          workMs
        });
        lastReport = now;
      }
    }

    const completed = performance.now() >= endAt;
    running = false;
    cleanupEngine();
    self.postMessage({
      type: completed ? 'complete' : 'stopped',
      elapsedMs: Math.min(durationMs, performance.now() - start)
    });
  } catch (error) {
    running = false;
    cleanupEngine();
    self.postMessage({
      type: 'error',
      message: error.message || String(error)
    });
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'probe') {
    probe(message.config || {});
    return;
  }
  if (message.type === 'start') {
    runStress(message.config || {});
    return;
  }
  if (message.type === 'stop') {
    running = false;
    sequence += 1;
  }
};
`;

const elements = {
  averageDuty: document.querySelector('#averageDuty'),
  bufferSize: document.querySelector('#bufferSize'),
  durationSeconds: document.querySelector('#durationSeconds'),
  engineMode: document.querySelector('#engineMode'),
  engineName: document.querySelector('#engineName'),
  intensity: document.querySelector('#intensity'),
  meterCanvas: document.querySelector('#meterCanvas'),
  passCount: document.querySelector('#passCount'),
  progressFill: document.querySelector('#progressFill'),
  remainingTime: document.querySelector('#remainingTime'),
  rendererName: document.querySelector('#rendererName'),
  startButton: document.querySelector('#startButton'),
  statusText: document.querySelector('#statusText'),
  stopButton: document.querySelector('#stopButton'),
  targetDuty: document.querySelector('#targetDuty'),
  targetDutyValue: document.querySelector('#targetDutyValue'),
  workChunk: document.querySelector('#workChunk')
};

const state = {
  autoStart: false,
  durationMs: 180000,
  lastDuty: 0,
  lastWorkMs: 0,
  progress: 0,
  ready: false,
  running: false,
  startTime: 0,
  status: 'booting'
};

const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
const visualContext = elements.meterCanvas.getContext('2d');

function setStatus(status, text) {
  state.status = status;
  elements.statusText.textContent = text;
  const strip = elements.statusText.closest('.status-strip');
  strip.classList.remove('ready', 'running', 'error');
  if (status === 'ready' || status === 'complete' || status === 'stopped') {
    strip.classList.add('ready');
  }
  if (status === 'running') {
    strip.classList.add('running');
  }
  if (status === 'error') {
    strip.classList.add('error');
  }
}

function formatTime(ms) {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

function isSoftwareRenderer(renderer) {
  return /swiftshader|software|llvmpipe|warp/i.test(renderer || '');
}

function updateTargetLabel() {
  elements.targetDutyValue.value = elements.targetDuty.value + '%';
  elements.targetDutyValue.textContent = elements.targetDuty.value + '%';
}

function applyQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const duration = Number(params.get('duration') || params.get('durationSeconds'));
  const target = Number(params.get('target') || params.get('targetDuty'));
  const engine = params.get('engine') || params.get('engineMode');
  const intensity = params.get('intensity');
  const buffer = params.get('buffer') || params.get('bufferSize');

  if (Number.isFinite(duration) && duration >= 5 && duration <= 1800) {
    elements.durationSeconds.value = String(duration);
  }
  if (Number.isFinite(target) && target >= 50 && target <= 99) {
    elements.targetDuty.value = String(target);
    updateTargetLabel();
  }
  if (engine && Array.from(elements.engineMode.options).some((option) => option.value === engine)) {
    elements.engineMode.value = engine;
  }
  if (intensity && Array.from(elements.intensity.options).some((option) => option.value === intensity)) {
    elements.intensity.value = intensity;
  }
  if (buffer && Array.from(elements.bufferSize.options).some((option) => option.value === buffer)) {
    elements.bufferSize.value = buffer;
  }

  state.autoStart = params.get('autostart') === '1' || params.get('autostart') === 'true';
}

function setControlsRunning(running) {
  state.running = running;
  elements.startButton.disabled = running || !state.ready;
  elements.stopButton.disabled = !running;
  elements.targetDuty.disabled = running;
  elements.durationSeconds.disabled = running;
  elements.bufferSize.disabled = running;
  elements.engineMode.disabled = running;
  elements.intensity.disabled = running;
}

function resetMetrics() {
  state.durationMs = Math.max(5, Number(elements.durationSeconds.value) || 180) * 1000;
  state.progress = 0;
  state.lastDuty = 0;
  state.lastWorkMs = 0;
  elements.remainingTime.textContent = formatTime(state.durationMs);
  elements.averageDuty.textContent = '0%';
  elements.workChunk.textContent = '0 ms';
  elements.passCount.textContent = '0';
  elements.progressFill.style.width = '0%';
}

function getConfig() {
  return {
    bufferSize: Number(elements.bufferSize.value),
    durationSeconds: Number(elements.durationSeconds.value),
    engineMode: elements.engineMode.value,
    intensity: elements.intensity.value,
    targetDuty: Number(elements.targetDuty.value) / 100
  };
}

function startStress() {
  resetMetrics();
  state.startTime = performance.now();
  setControlsRunning(true);
  setStatus('running', 'Running GPU workload...');
  worker.postMessage({
    type: 'start',
    config: getConfig()
  });
}

function stopStress() {
  worker.postMessage({ type: 'stop' });
  setStatus('stopped', 'Stopping workload and releasing GPU context...');
  elements.stopButton.disabled = true;
}

function updateProgress(message) {
  state.lastDuty = message.averageDuty || 0;
  state.lastWorkMs = message.workMs || 0;
  state.progress = Math.min(1, (message.elapsedMs || 0) / state.durationMs);
  elements.remainingTime.textContent = formatTime(message.remainingMs || 0);
  elements.averageDuty.textContent = Math.round(state.lastDuty * 100) + '%';
  elements.workChunk.textContent = Math.round(state.lastWorkMs) + ' ms';
  elements.passCount.textContent = String(message.passCount || 0);
  elements.progressFill.style.width = (state.progress * 100).toFixed(1) + '%';
}

function finishRun(status, text) {
  setControlsRunning(false);
  setStatus(status, text);
  if (status === 'complete') {
    state.progress = 1;
    elements.remainingTime.textContent = '00:00';
    elements.progressFill.style.width = '100%';
  }
}

function markRenderer(engineLabel, renderer) {
  elements.engineName.textContent = engineLabel || 'Auto';
  elements.rendererName.textContent = renderer || 'GPU renderer';
}

worker.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === 'probe') {
    if (message.ok) {
      state.ready = true;
      markRenderer(message.engine, message.renderer);
      setControlsRunning(false);
      setStatus('ready', 'Ready: ' + message.engine + ' GPU context available.');
      if (message.software || isSoftwareRenderer(message.renderer)) {
        setStatus('error', 'Software renderer detected. Hardware GPU acceleration is required.');
        elements.startButton.disabled = true;
      } else if (state.autoStart) {
        state.autoStart = false;
        window.setTimeout(startStress, 250);
      }
    } else {
      state.ready = false;
      markRenderer('Unavailable', message.message || 'GPU context unavailable.');
      setControlsRunning(false);
      setStatus('error', 'GPU stress engine is unavailable.');
      elements.startButton.disabled = true;
    }
    return;
  }
  if (message.type === 'started') {
    markRenderer(message.engine, message.renderer);
    if (message.software || isSoftwareRenderer(message.renderer)) {
      setStatus('error', 'Software renderer detected. Stopping workload.');
      stopStress();
    }
    return;
  }
  if (message.type === 'progress') {
    updateProgress(message);
    return;
  }
  if (message.type === 'complete') {
    finishRun('complete', 'Complete. GPU workload finished.');
    return;
  }
  if (message.type === 'stopped') {
    finishRun('stopped', 'Stopped. GPU context released.');
    return;
  }
  if (message.type === 'error') {
    state.ready = true;
    setControlsRunning(false);
    setStatus('error', 'Error: ' + (message.message || 'GPU workload failed.'));
  }
};

worker.onerror = (error) => {
  state.ready = false;
  setControlsRunning(false);
  setStatus('error', 'Worker failed: ' + (error.message || 'Unknown error.'));
};

function drawVisualizer(time) {
  const canvas = elements.meterCanvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const nextWidth = Math.max(320, Math.floor(rect.width * dpr));
  const nextHeight = Math.max(240, Math.floor(rect.height * dpr));
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }

  const ctx = visualContext;
  const width = canvas.width;
  const height = canvas.height;
  const target = Number(elements.targetDuty.value) / 100;
  const duty = state.running ? Math.max(state.lastDuty, target * 0.88) : state.lastDuty;
  const pulse = state.running ? 0.55 + Math.sin(time * 0.012) * 0.45 : 0.18;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#101820';
  ctx.fillRect(0, 0, width, height);

  const grid = 34 * dpr;
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const barCount = 34;
  const gap = 4 * dpr;
  const pad = 28 * dpr;
  const barWidth = (width - pad * 2 - gap * (barCount - 1)) / barCount;
  const maxHeight = height - pad * 2;
  for (let i = 0; i < barCount; i += 1) {
    const phase = time * 0.004 + i * 0.43;
    const energy = state.running
      ? 0.42 + duty * 0.5 + Math.sin(phase) * 0.07 + Math.cos(phase * 0.37) * 0.04
      : 0.18 + Math.sin(phase) * 0.04;
    const h = Math.max(8 * dpr, Math.min(maxHeight, maxHeight * energy));
    const x = pad + i * (barWidth + gap);
    const y = height - pad - h;
    const mix = i / Math.max(1, barCount - 1);
    ctx.fillStyle = mix < 0.5
      ? 'rgba(20, 184, 166, ' + (0.58 + pulse * 0.28) + ')'
      : mix < 0.78
        ? 'rgba(37, 99, 235, ' + (0.54 + pulse * 0.26) + ')'
        : 'rgba(245, 158, 11, ' + (0.58 + pulse * 0.28) + ')';
    ctx.fillRect(x, y, barWidth, h);
  }

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = Math.round(18 * dpr) + 'px "Segoe UI", sans-serif';
  ctx.fillText('Target ' + Math.round(target * 100) + '%', pad, pad + 8 * dpr);
  ctx.font = Math.round(46 * dpr) + 'px "Segoe UI", sans-serif';
  ctx.fillText(Math.round((state.running ? duty : state.lastDuty) * 100) + '%', pad, pad + 62 * dpr);
  ctx.font = Math.round(14 * dpr) + 'px "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.64)';
  ctx.fillText(state.running ? 'GPU workload active' : 'Standby', pad, pad + 92 * dpr);

  requestAnimationFrame(drawVisualizer);
}

elements.startButton.addEventListener('click', startStress);
elements.stopButton.addEventListener('click', stopStress);
elements.targetDuty.addEventListener('input', updateTargetLabel);
elements.durationSeconds.addEventListener('input', resetMetrics);
elements.engineMode.addEventListener('change', () => {
  state.ready = false;
  setControlsRunning(false);
  setStatus('booting', 'Probing engine: ' + elements.engineMode.options[elements.engineMode.selectedIndex].text);
  worker.postMessage({ type: 'probe', config: getConfig() });
});

window.addEventListener('beforeunload', () => {
  worker.postMessage({ type: 'stop' });
});

applyQueryParams();
updateTargetLabel();
resetMetrics();
setStatus('booting', 'Preparing GPU context...');
worker.postMessage({ type: 'probe', config: getConfig() });
requestAnimationFrame(drawVisualizer);
