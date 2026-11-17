// Pure URL safety checks for remote artwork; shared with the Node test suite.

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

export function isPrivateIpv4(text) {
    const octets = String(text).split('.');
    if (octets.length !== 4) return false;
    const numbers = octets.map(Number);
    if (numbers.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
    const [a, b] = numbers;
    if (a === 0 || a === 10 || a === 127) return true;      // this-network, RFC1918, loopback
    if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT 100.64/10
    if (a === 169 && b === 254) return true;                // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;       // RFC1918
    if (a === 192 && b === 168) return true;                // RFC1918
    if (a >= 224) return true;                              // multicast and reserved
    return false;
}

export function isPrivateIpv6(text) {
    let value = String(text).toLowerCase().replace(/^\[|\]$/g, '');
    if (value.includes('%')) value = value.slice(0, value.indexOf('%')); // zone index
    if (value === '::' || value === '::1') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;      // fc00::/7 unique local
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true;      // fe80::/10 link-local
    if (/^100::/.test(value)) return true;                  // discard-only range
    const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateIpv4(mapped[1]);
    const tunneled = value.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/); // 6to4 embeds IPv4
    if (tunneled) {
        const high = parseInt(tunneled[1], 16);
        const low = parseInt(tunneled[2], 16);
        const embedded = [(high >> 8) & 255, high & 255, (low >> 8) & 255, low & 255].join('.');
        if (isPrivateIpv4(embedded)) return true;
    }
    return false;
}

// 'block'   refuse without resolving
// 'allow'   safe literal address
// 'resolve' DNS resolution is required before connecting
export function classifyHost(host) {
    if (!host) return 'block';
    const name = host.toLowerCase().replace(/\.$/, '');
    if (name === 'localhost' || BLOCKED_SUFFIXES.some(suffix => name.endsWith(suffix))) return 'block';
    if (name.startsWith('[')) return isPrivateIpv6(name) ? 'block' : 'allow';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(name)) return isPrivateIpv4(name) ? 'block' : 'allow';
    if (name.includes(':')) return isPrivateIpv6(name) ? 'block' : 'allow';
    return 'resolve';
}

// Validates a remote artwork URL before any network activity happens.
export function checkUrl(text) {
    let url;
    try {
        url = new URL(text);
    } catch {
        return {ok: false, reason: 'not a valid URL'};
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
        return {ok: false, reason: `scheme ${url.protocol} is not allowed`};
    if (url.username || url.password) return {ok: false, reason: 'URL contains credentials'};
    const verdict = classifyHost(url.hostname);
    if (verdict === 'block') return {ok: false, reason: `host ${url.hostname} is not allowed`};
    return {ok: true, host: url.hostname, needsDns: verdict === 'resolve'};
}
