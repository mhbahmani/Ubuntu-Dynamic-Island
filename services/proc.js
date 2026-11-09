// Pure functions, intentionally independent of GNOME; testable with Node.

export function parseCpu(text) {
    const row = text.split('\n').find(line => /^cpu\s/.test(line));
    if (!row) throw new Error('Missing aggregate CPU row');
    // guest/guest_nice are already included in user/nice; do not count twice.
    const numbers = row.trim().split(/\s+/).slice(1, 9).map(Number);
    if (numbers.length < 4 || numbers.some(value => !Number.isFinite(value) || value < 0))
        throw new Error('Invalid aggregate CPU counters');
    const idle = (numbers[3] ?? 0) + (numbers[4] ?? 0);
    const total = numbers.reduce((sum, item) => sum + item, 0);
    return {idle, total};
}

export function cpuPercent(previous, current) {
    if (!previous) return null;
    const total = current.total - previous.total;
    const idle = current.idle - previous.idle;
    if (total <= 0) return null;
    return Math.max(0, Math.min(100, 100 * (1 - idle / total)));
}

export function memoryUsage(text) {
    const field = name => {
        const match = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
        return match ? Number(match[1]) : null;
    };
    const total = field('MemTotal');
    const available = field('MemAvailable');
    if (total === null || available === null || total <= 0) return null;
    return {
        usedBytes: Math.max(0, total - available) * 1024, // meminfo reports kB
        percent: Math.max(0, Math.min(100, 100 * (total - available) / total)),
    };
}

export function memoryPercent(text) {
    return memoryUsage(text)?.percent ?? null;
}

// First field of /proc/loadavg: the 1-minute average of runnable tasks.
export function parseLoadAvg(text) {
    const match = String(text).match(/^\s*([0-9]+(?:\.[0-9]+)?)\s/);
    return match ? Number(match[1]) : null;
}

// One cpuN row per logical core; 0 when the text carries only the aggregate.
export function countCores(text) {
    return text.split('\n').filter(line => /^cpu\d+\s/.test(line)).length;
}

export function formatCapacity(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.round(bytes / 1024)} kB`;
}

export function networkBytes(text, iface) {
    const rows = text.split('\n').slice(2);
    for (const row of rows) {
        const match = row.match(/^\s*([^:]+):\s*(.+)$/);
        if (!match || match[1].trim() !== iface) continue;
        const values = match[2].trim().split(/\s+/).map(Number);
        if (values.length < 16) return null;
        return {rx: values[0], tx: values[8]};
    }
    return null;
}

// Picks the default-route interface with the lowest routing metric, so VPN
// tunnels (tun0/wg0 usually at 0) win over the physical link. Rows missing a
// metric column rank last, keeping the classic "first default route" behavior.
export function defaultInterface(text, ipv6 = '') {
    let best = null;
    for (const row of text.split('\n').slice(1)) {
        const fields = row.trim().split(/\s+/);
        if (fields.length < 4 || fields[1] !== '00000000') continue;
        const flags = parseInt(fields[3], 16);
        if (!Number.isFinite(flags) || !(flags & 1)) continue; // interface must be up
        const metric = fields.length > 6 ? Number(fields[6]) : Number.POSITIVE_INFINITY;
        if (!best || metric < best.metric) best = {iface: fields[0], metric};
    }
    // IPv6-only connections have no IPv4 default. Ignore the kernel's reject
    // defaults (including lo) and choose the lowest-metric usable IPv6 route.
    if (!best) for (const row of ipv6.trim().split('\n')) {
        const fields = row.trim().split(/\s+/);
        if (fields.length !== 10 || !/^0{32}$/.test(fields[0]) || fields[1] !== '00' ||
            !/^0{32}$/.test(fields[2]) || fields[3] !== '00' || fields[9] === 'lo') continue;
        const flags = parseInt(fields[8], 16), metric = parseInt(fields[5], 16);
        if (!(flags & 1) || (flags & 0x200) || !Number.isFinite(metric)) continue;
        if (!best || metric < best.metric) best = {iface: fields[9], metric};
    }
    return best ? best.iface : null;
}

export function formatRate(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—';
    if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
    if (bytesPerSecond < 1024 * 1024 * 1024) return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
    return `${(bytesPerSecond / (1024 * 1024 * 1024)).toFixed(1)} GiB/s`;
}
