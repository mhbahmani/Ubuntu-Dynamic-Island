#!/usr/bin/env python3
"""Probe Balad's unofficial, keyless routing endpoint (standard library only).

Default endpoints are public Tehran landmarks: Azadi Tower and Milad Tower.
Coordinates supplied explicitly are sent to Balad; no host settings are read.
Endpoint reference: https://github.com/sepehr071/balad-mcp
"""
import argparse
import json
import math
import socket
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

MAX_BYTES = 1024 * 1024


def point(value):
    try:
        lat, lon = map(float, value.split(','))
        if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError()
        return lat, lon
    except ValueError:
        raise argparse.ArgumentTypeError('Expected latitude,longitude within geographic bounds') from None


def request_json(url, timeout):
    request = Request(url, headers={'User-Agent': 'Ubuntu-Island-Commute-Probe/1.0',
        'Accept': 'application/json', 'Origin': 'https://balad.ir', 'Referer': 'https://balad.ir/'})
    started = time.monotonic()
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_BYTES + 1)
            status = response.status
        if len(raw) > MAX_BYTES:
            return {'ok': False, 'error': 'response_too_large'}
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            return {'ok': False, 'http_status': status, 'error': 'non_json_response'}
        return {'ok': True, 'http_status': status, 'elapsed_seconds': round(time.monotonic() - started, 3), 'body': body}
    except HTTPError as error:
        return {'ok': False, 'http_status': error.code, 'error': 'http_error',
                'retry_after': error.headers.get('Retry-After')}
    except (URLError, TimeoutError, socket.timeout, OSError):
        # Avoid printing a request URL containing private coordinates.
        return {'ok': False, 'error': 'network_or_timeout'}


def positive(value, allow_zero=False):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and (value >= 0 if allow_zero else value > 0)


def summarize(body):
    if not isinstance(body, dict) or body.get('code') != 'Ok' or not isinstance(body.get('routes'), list):
        return {'ok': False, 'error': 'unexpected_route_response'}
    routes = []
    for route in body['routes']:
        if not isinstance(route, dict) or not positive(route.get('duration')) or not positive(route.get('distance'), True):
            continue
        routes.append({'minutes': round(route['duration'] / 60, 2), 'kilometers': round(route['distance'] / 1000, 2),
            'traffic_related_fields': sorted(k for k in route if any(word in k.lower() for word in ('traffic', 'typical', 'congestion', 'delay'))),
            'route_fields': sorted(route)})
    return {'ok': bool(routes), 'routes': routes, 'traffic_verified': False,
            'note': 'driving-traffic endpoint; a successful ETA alone does not prove live traffic freshness'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', type=point, default=point('35.6997,51.3380'))
    parser.add_argument('--destination', type=point, default=point('35.7448,51.3753'))
    parser.add_argument('--timeout', type=float, default=15)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 60:
        parser.error('--timeout must be between 0 and 60 seconds')
    path = ';'.join(f'{lon},{lat}' for lat, lon in (args.origin, args.destination))
    result = request_json('https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/' + path, args.timeout)
    body = result.pop('body', None)
    if result['ok']:
        result.update(summarize(body))
    result.update(provider='balad', checked_at=datetime.now(timezone.utc).isoformat())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
