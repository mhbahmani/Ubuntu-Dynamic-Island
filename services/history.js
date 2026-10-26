// Fixed-size histories: no timers, I/O, or unbounded storage.
export class History {
    constructor(capacity = 60) {
        this.capacity = capacity;
        this.values = new Float64Array(capacity);
        this.values.fill(NaN);
        this.count = 0;
        this.next = 0;
    }

    push(value) {
        this.values[this.next] = Number.isFinite(value) && value >= 0 ? value : NaN;
        this.next = (this.next + 1) % this.capacity;
        this.count = Math.min(this.count + 1, this.capacity);
    }

    at(index) {
        return this.values[(this.next - this.count + index + this.capacity) % this.capacity];
    }

    clear() {
        this.count = 0;
        this.next = 0;
    }

    peak() {
        let peak = 0;
        for (let i = 0; i < this.count; i++) {
            const value = this.at(i);
            if (Number.isFinite(value)) peak = Math.max(peak, value);
        }
        return peak;
    }
}
