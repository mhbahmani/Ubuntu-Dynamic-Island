import assert from 'node:assert/strict';
import test from 'node:test';
import {checkUrl, classifyHost, isPrivateIpv4, isPrivateIpv6} from '../services/urlguard.js';

test('private IPv4 ranges are refused', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255',
        '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255'])
        assert.equal(isPrivateIpv4(host), true, host);
    for (const host of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1'])
        assert.equal(isPrivateIpv4(host), false, host);
    assert.equal(isPrivateIpv4('not-an-ip'), false);
});
test('private IPv6 ranges are refused', () => {
    for (const host of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1',
        '::ffff:127.0.0.1', '::ffff:192.168.0.1', '100::1', '2002:7f00:1::'])
        assert.equal(isPrivateIpv6(host), true, host);
    for (const host of ['2001:db8::1', '2606:4700::1111', '::ffff:1.1.1.1', 'fe00::1'])
        assert.equal(isPrivateIpv6(host), false, host);
});
test('local names are blocked without DNS, public names need resolution', () => {
    assert.equal(classifyHost('localhost'), 'block');
    assert.equal(classifyHost('printer.local'), 'block');
    assert.equal(classifyHost('gitlab.internal'), 'block');
    assert.equal(classifyHost('1.1.1.1'), 'allow');
    assert.equal(classifyHost('192.168.1.5'), 'block');
    assert.equal(classifyHost('example.com.'), 'resolve');
});
test('artwork URLs are validated before any network activity', () => {
    assert.deepEqual(
        {...checkUrl('https://i.scdn.co/image/abc'), ok: true, needsDns: true},
        {ok: true, host: 'i.scdn.co', needsDns: true});
    assert.equal(checkUrl('https://1.2.3.4/cover.png').ok, true);
    assert.equal(checkUrl('https://127.0.0.1/cover.png').ok, false);
    assert.equal(checkUrl('https://192.168.0.5/cover.png').ok, false);
    assert.equal(checkUrl('https://localhost/cover.png').ok, false);
    assert.equal(checkUrl('https://user:pw@example.com/a.png').ok, false);
    assert.equal(checkUrl('file:///etc/passwd').ok, false);
    assert.equal(checkUrl('ftp://example.com/a.png').ok, false);
    assert.equal(checkUrl('not a url').ok, false);
});
