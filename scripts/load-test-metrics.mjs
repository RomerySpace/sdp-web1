export function statistics(values) {
  if (!values.length) return { samples: 0, mean: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const rounded = (value) => Math.round(value * 100) / 100;
  return { samples: sorted.length, mean: rounded(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50: rounded(sorted[Math.ceil(sorted.length * 0.5) - 1]),
    p95: rounded(sorted[Math.ceil(sorted.length * 0.95) - 1]), max: rounded(sorted.at(-1)) };
}

export function summarizeResourceMetrics(data) {
  const points = (metric) => (data[metric] || []).flatMap((series) => series.values || []).filter((point) => Number.isFinite(point.value));
  const cpu = points('cpu'), memory = points('memory');
  const cpuLimit = points('cpu-limit').at(-1)?.value;
  const memoryLimit = points('memory-limit').at(-1)?.value;
  return {
    resolutionSeconds: 30, cpuCores: statistics(cpu.map((point) => point.value)),
    cpuPercent: statistics(cpuLimit > 0 ? cpu.map((point) => point.value / cpuLimit * 100) : []),
    memoryMiB: statistics(memory.map((point) => point.value / 1024 ** 2)),
    memoryPercent: statistics(memoryLimit > 0 ? memory.map((point) => point.value / memoryLimit * 100) : []),
    cpuLimitCores: cpuLimit ?? null, memoryLimitMiB: memoryLimit ? Math.round(memoryLimit / 1024 ** 2) : null,
    raw: data,
  };
}

export async function renderMetrics(service, startTime, endTime) {
  const data = {};
  for (const metric of ['cpu', 'cpu-limit', 'memory', 'memory-limit']) {
    const url = new URL(`https://api.render.com/v1/metrics/${metric}`);
    for (const [key, value] of Object.entries({ resource: service, startTime, endTime, resolutionSeconds: '30' })) url.searchParams.set(key, value);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Render ${metric} metrics: HTTP ${response.status}.`);
    data[metric] = await response.json();
  }
  return summarizeResourceMetrics(data);
}
