# Keyless commute probes

Standalone Python 3 scripts using only the standard library. They are development
probes and require no installation or API key. The extension now also includes
a native Balad adapter; these Python scripts are not used at runtime.
Default endpoints are public Tehran landmarks: Azadi Tower → Milad Tower.
Custom coordinates are sent to each selected remote service; these scripts do not
read saved routes, GNOME location, settings, or credentials. Output omits endpoint
coordinates and raw authenticated URLs. Do not publish private probe output.

```sh
# First: one Balad request
python3 scripts/commute/balad.py

# Sequential comparison: Balad, OSRM baseline, Waze (one request each)
python3 scripts/commute/compare.py

# Optional endpoints, latitude then longitude
python3 scripts/commute/balad.py --origin 35.6997,51.3380 --destination 35.7448,51.3753 --timeout 15

# Offline tests: no provider calls
python3 -m unittest discover -s scripts/commute -p 'test_*.py'
```

Exit status is 0 on success, 1 if a provider fails (including a partial comparison
failure), or 2 for invalid arguments. Each request has a configurable socket
timeout (15 seconds by default, maximum 60), a 1 MiB response cap, and no automatic
retries, polling, browser process, cookies, TLS impersonation, or proxy rotation.
Normal environment proxy settings still apply. Do not repeatedly hammer endpoints.

## Interpretation and sources

Balad and Waze use unofficial interfaces; a successful probe does not establish
uptime, usage permission, coverage or traffic freshness. Balad's probe reports
`traffic_verified: false`. OSRM is a baseline comparison; different routes prevent
attributing the entire ETA difference to traffic. Waze is a diagnostic candidate,
not a verified extension fallback. Do not work around access-control failures.

Endpoint references inspected:

- [Balad community integration](https://github.com/sepehr071/balad-mcp),
  `src/balad_mcp/http.py` and `maps.py`: unofficial `direction.raah.ir`
  driving-traffic URL, longitude/latitude ordering, duration in seconds.
- [pywaze](https://github.com/eifinger/pywaze),
  `src/pywaze/route_calculator.py`: ROW routing host, request parameters,
  segment `crossTime`/`cross_time` and length fields.
- [FOSSGIS public routing](https://routing.openstreetmap.de/about.html):
  OSRM baseline comparison. No live traffic is claimed.

The scripts independently implement small probes from these request formats;
they do not install or execute either community integration. Both Balad and Waze
interfaces are unofficial and may change. The native extension adapter retains bounded requests, clear traffic uncertainty,
and fallback labels inside the opt-in Commute module.
