#!/usr/bin/env python3
"""One-shot keyless provider comparison; run Balad first, then OSRM and Waze.

Uses public Azadi/Milad Tower coordinates by default. No retries or polling.
Waze request format: https://github.com/eifinger/pywaze
"""
import argparse
from datetime import datetime, timezone
import json
import math
from urllib.parse import urlencode
from balad import point, positive, request_json, summarize


def waze_summary(body):
    if not isinstance(body, dict) or body.get('error'):
        return {'ok': False, 'error': 'unexpected_route_response'}
    responses = [alt.get('response') for alt in body.get('alternatives', []) if isinstance(alt, dict)]
    if not responses:
        response = body.get('response')
        responses = response if isinstance(response, list) else [response]
    routes = []
    for response in responses:
        segments = response.get('results') if isinstance(response, dict) else None
        if not isinstance(segments, list) or not segments:
            continue
        seconds = meters = 0
        for segment in segments:
            if not isinstance(segment, dict):
                break
            duration = segment.get('crossTime', segment.get('cross_time'))
            distance = segment.get('length')
            if not positive(duration, True) or not positive(distance, True):
                break
            seconds += duration
            meters += distance
        else:
            if seconds > 0:
                routes.append({'minutes': round(seconds / 60, 2), 'kilometers': round(meters / 1000, 2)})
    return {'ok': bool(routes), 'routes': routes, 'traffic_verified': False,
            'note': 'Unofficial Waze real-time duration fields; freshness not independently verified'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--origin', type=point, default=point('35.6997,51.3380'))
    parser.add_argument('--destination', type=point, default=point('35.7448,51.3753'))
    parser.add_argument('--timeout', type=float, default=15)
    args = parser.parse_args()
    if not math.isfinite(args.timeout) or not 0 < args.timeout <= 60:
        parser.error('--timeout must be between 0 and 60 seconds')
    path = ';'.join(f'{lon},{lat}' for lat, lon in (args.origin, args.destination))
    origin, destination = args.origin, args.destination
    waze_query = urlencode({'from': f'x:{origin[1]} y:{origin[0]}', 'to': f'x:{destination[1]} y:{destination[0]}',
        'at': 0, 'returnJSON': 'true', 'timeout': 15000, 'nPaths': 1,
        'options': 'AVOID_TRAILS:t,AVOID_TOLL_ROADS:f,AVOID_FERRIES:f', 'subscription': '*'})
    providers = [
        ('balad', 'https://direction.raah.ir/navigation-v7/directions/v5/mapbox/driving-traffic/' + path, summarize),
        ('osrm', 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' + path + '?overview=false&steps=false', summarize),
        ('waze', 'https://routing-livemap-row.waze.com/RoutingManager/routingRequest?' + waze_query, waze_summary),
    ]
    failed = False
    for name, url, normalize in providers:
        result = request_json(url, args.timeout)
        body = result.pop('body', None)
        if result['ok']:
            result.update(normalize(body))
        if name == 'osrm':
            result['note'] = 'Baseline only: no live traffic'
        result.update(provider=name, checked_at=datetime.now(timezone.utc).isoformat())
        print(json.dumps(result, ensure_ascii=False), flush=True)
        failed |= not result['ok']
    return int(failed)


if __name__ == '__main__':
    raise SystemExit(main())
