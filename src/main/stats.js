// System stats (CPU, RAM, GPU) sampled every 2 s while at least one window shows them.
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const INTERVAL = 2000;

// GPU load = busiest adapter's summed 3D engine utilization, like Task Manager.
// Counter paths are English and work on localized Windows too.
const GPU_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Counter -Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -SampleInterval 2 -Continuous | ForEach-Object {
  $by = @{}
  foreach ($s in $_.CounterSamples) {
    if ($s.InstanceName -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)') { $by[$matches[1]] += $s.CookedValue }
  }
  $max = 0
  foreach ($v in $by.Values) { if ($v -gt $max) { $max = $v } }
  [Console]::Out.WriteLine([int][math]::Min(100, [math]::Round($max)))
}`;

let timer = null;
let gpuProc = null;
let gpu = null;
let gpuRestarts = 0;
let prevCpu = cpuTimes();

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

function startGpu() {
  if (process.platform !== 'win32' || gpuProc || gpuRestarts > 3) return;
  const encoded = Buffer.from(GPU_SCRIPT, 'utf16le').toString('base64');
  gpuProc = spawn('powershell.exe', ['-NoProfile', '-NoLogo', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true });
  let buf = '';
  gpuProc.stdout.on('data', d => {
    buf += d;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    const last = lines.filter(Boolean).pop();
    if (last && /^\d+$/.test(last.trim())) gpu = +last.trim();
  });
  const proc = gpuProc;
  proc.on('exit', () => {
    if (gpuProc === proc) gpuProc = null;
    if (timer) { gpuRestarts++; setTimeout(() => { if (timer) startGpu(); }, 5000); }
  });
}

// Linux: AMD exposes a busy percentage in sysfs.
function linuxGpu() {
  try { return +fs.readFileSync('/sys/class/drm/card0/device/gpu_busy_percent', 'utf8'); } catch { return null; }
}

function sample() {
  const now = cpuTimes();
  const dt = now.total - prevCpu.total;
  const cpu = dt > 0 ? (1 - (now.idle - prevCpu.idle) / dt) * 100 : 0;
  prevCpu = now;
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();
  return {
    cpu: Math.round(cpu),
    mem: Math.round((memUsed / memTotal) * 100),
    memUsed,
    memTotal,
    gpu: process.platform === 'win32' ? gpu : linuxGpu()
  };
}

function start(onSample) {
  if (timer) return;
  prevCpu = cpuTimes();
  startGpu();
  timer = setInterval(() => onSample(sample()), INTERVAL);
}

function stop() {
  clearInterval(timer);
  timer = null;
  if (gpuProc) { try { gpuProc.kill(); } catch {} gpuProc = null; }
  gpu = null;
}

module.exports = { start, stop };
