import test from 'node:test';
import assert from 'node:assert/strict';
import {notchOrder, NOTCH_ITEMS} from '../services/notch-model.js';

test('notch order preserves choices and repairs missing or duplicated items', () => {
    assert.deepEqual(notchOrder(['network', 'weather', 'network', 'unknown']),
        ['network', 'weather', 'media', 'cpu', 'bluetooth']);
    assert.deepEqual(notchOrder([]), NOTCH_ITEMS);
});
