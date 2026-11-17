import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {History} from '../extension/services/history.js';

test('history stays bounded and preserves gaps and chronological order', () => {
    const history = new History(3);
    for (let i = 0; i < 10000; i++) history.push(i);
    assert.equal(history.values.length, 3);
    assert.equal(history.count, 3);
    assert.deepEqual([history.at(0), history.at(1), history.at(2)], [9997, 9998, 9999]);
    history.push(null);
    assert(Number.isNaN(history.at(2)));
    history.push(-1);
    assert(Number.isNaN(history.at(2)));
    assert.equal(history.peak(), 9999);
    history.clear();
    assert.equal(history.count, 0);
    assert.equal(history.peak(), 0);
});

test('hidden charts store samples without requesting redraws', () => {
    let redraws = 0, invalidations = 0;
    const source = readFileSync(new URL('../extension/ui/charts.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace('export class ', 'class ');
    const Chart = vm.runInNewContext(`${source}\nHistoryChart`, {History, invalidateBackdrop: () => invalidations++,
        St: {DrawingArea: class {
            mapped = false;
            connect() {}
            queue_repaint() { redraws++; }
        }},
    });
    const chart = new Chart(true);
    for (let i = 0; i < 10000; i++) chart.push(i, i / 2);
    assert.equal(redraws, 0);
    assert.equal(invalidations, 0);
    assert.equal(chart.series[0].count, 60);
    chart.actor.mapped = true;
    chart.push(20, 10);
    assert.equal(redraws, 1);
    assert.equal(invalidations, 1);
    chart.actor.mapped = false;
    chart.push(40, 30);
    assert.equal(redraws, 1);
    assert.equal(invalidations, 1);
});

