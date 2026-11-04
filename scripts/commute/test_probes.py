"""Offline validation: do not make network requests from the test suite."""
import argparse
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from balad import MAX_BYTES, point, request_json, summarize
from compare import waze_summary


class ProbeTests(unittest.TestCase):
    def test_balad_seconds_and_meters(self):
        result = summarize({'code': 'Ok', 'routes': [{'duration': 1107, 'distance': 9910}]})
        self.assertEqual(result['routes'][0]['minutes'], 18.45)
        self.assertEqual(result['routes'][0]['kilometers'], 9.91)
        self.assertFalse(result['traffic_verified'])

    def test_malformed_routes_never_become_zero_minute_eta(self):
        for body in (None, [], {}, {'code': 'NoRoute'}, {'code': 'Ok', 'routes': []},
                     {'code': 'Ok', 'routes': [{'duration': True, 'distance': 2}]},
                     {'code': 'Ok', 'routes': [{'duration': float('nan'), 'distance': 2}]}):
            self.assertFalse(summarize(body)['ok'])

    def test_reject_invalid_coordinates(self):
        for value in ('nan,51', '91,51', '35,181', '35', 'a,b'):
            with self.assertRaises(argparse.ArgumentTypeError):
                point(value)

    def test_waze_both_field_formats(self):
        for key in ('crossTime', 'cross_time'):
            result = waze_summary({'response': {'results': [{key: 60, 'length': 1000}, {key: 90, 'length': 500}]}})
            self.assertEqual(result['routes'][0], {'minutes': 2.5, 'kilometers': 1.5})
        self.assertFalse(waze_summary({'response': {'results': [{'length': 4}]}})['ok'])

    def test_http_failure_not_retried(self):
        with patch('balad.urlopen', side_effect=HTTPError('https://example.invalid', 403, '', {}, None)) as send:
            self.assertEqual(request_json('https://example.invalid', 1)['http_status'], 403)
            self.assertEqual(send.call_count, 1)

    def test_response_size_cap(self):
        with patch('balad.urlopen') as send:
            send.return_value.__enter__.return_value.read.return_value = b'x' * (MAX_BYTES + 1)
            self.assertEqual(request_json('https://example.invalid', 1)['error'], 'response_too_large')


if __name__ == '__main__':
    unittest.main()
