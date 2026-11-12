// Dependency/API probe only. No accounts, event contents or credentials are read.
// Run with: gjs -m scripts/calendar-probe.mjs
import GLib from 'gi://GLib';
import System from 'system';

const namespaces = [
    ['ECal', '2.0', 'gir1.2-ecal-2.0'],
    ['EDataServer', '1.2', 'gir1.2-edataserver-1.2'],
    ['ICalGLib', '3.0', 'gir1.2-ical-3.0'],
];
const loop = new GLib.MainLoop(null, false);
let exitCode = 0;
// A hard bound also covers a stalled import; the probe owns no EDS requests.
const deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
    print(JSON.stringify({status: 'timeout'}));
    System.exit(1);
    return GLib.SOURCE_REMOVE;
});
(async () => {
    const loaded = {}, dependencies = [];
    for (const [name, version, packageName] of namespaces) {
        try {
            loaded[name] = (await import(`gi://${name}?version=${version}`)).default;
            dependencies.push({namespace: name, version, package: packageName, available: true});
        } catch {
            // Raw GI errors can expose local paths; output only known labels.
            dependencies.push({namespace: name, version, package: packageName, available: false});
        }
    }
    const available = dependencies.every(item => item.available);
    const apis = available ? {
        registry: typeof loaded.EDataServer.SourceRegistry.new === 'function',
        connect: typeof loaded.ECal.Client.connect === 'function',
        view: typeof loaded.ECal.Client.prototype.get_view === 'function',
        recurrence: typeof loaded.ECal.Client.prototype.generate_instances === 'function',
    } : null;
    exitCode = available ? 0 : 2;
    print(JSON.stringify({status: available ? 'bindings-available' : 'missing-dependencies', dependencies, apis,
        liveAcceptance: 'not-tested'}));
})().catch(() => {
    exitCode = 1;
    print(JSON.stringify({status: 'probe-failed'}));
}).finally(() => { GLib.Source.remove(deadline); loop.quit(); });
loop.run();
System.exit(exitCode);
