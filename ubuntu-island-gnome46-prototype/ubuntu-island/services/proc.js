// Pure functions, intentionally independent of GNOME; testable with Node.
export function parseCpu(text) {
    const row = text.split('\n').find(line => /^cpu\s/.test(line));
    if (!row) throw new Error('Missing aggregate CPU row');
    const numbers = row.trim().split(/\s+/).slice(1).map(Number);
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

export function memoryPercent(text) {
    const field = name => {
        const match = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
        return match ? Number(match[1]) : null;
    };
    const total = field('MemTotal');
    const available = field('MemAvailable');
    if (total === null || available === null || total <= 0) return null;
    return Math.max(0, Math.min(100, 100 * (total - available) / total));
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

export function defaultInterface(text) {
    for (const row of text.split('\n').slice(1)) {
        const fields = row.trim().split(/\s+/);
        if (fields.length >= 4 && fields[1] === '00000000' &&
            (parseInt(fields[3], 16) & 1)) return fields[0];
    }
    return null;
}

export function formatRate(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—';
    if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MiB/s`;
}
