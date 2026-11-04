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

## Live observations, 2026-11-04, approximately 11:08 UTC

| Provider | HTTP status | ETA | Distance | Request time |
|---|---|---|---|---|
| Balad | 200 | 18.45 min | 9.91 km | 0.33 s |
| FOSSGIS / OSRM | 200 | 13.66 min | 9.70 km | 0.50 s |
| Waze (ROW region) | 403 | Unavailable | Unavailable | Not recorded |

An earlier separate Balad probe also returned 18.45 min / 9.91 km in 0.66 s.
Six offline tests passed. These observations establish that Balad's endpoint
accepted a normal keyless request from this machine. They do not establish
uptime, commercial permission, coverage on other roads, or agreement with actual
driving time. The paths differ, so the ETA difference cannot all be attributed to
traffic. Balad's response had no explicit traffic-freshness field: the probe
reports `traffic_verified: false` even though the endpoint is named
`driving-traffic`. Road restriction zones are not evidence of congestion data.

Waze rejected the ordinary request. No CAPTCHA, fingerprinting, proxy rotation,
or other access-control workaround was attempted. It is not currently verified
as a working backup. A failure here does not prove that every Waze integration
fails everywhere.

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
