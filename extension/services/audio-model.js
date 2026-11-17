// Match physical devices, never aliases (two headsets may have the same name).
export function bluetoothAddress(value) {
    const address = String(value ?? '').replaceAll('_', ':').toUpperCase();
    return /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(address) ? address : null;
}

export function audioBluetoothAddress(streamName) {
    // PipeWire and PulseAudio Bluetooth sink names. Unknown/custom names stay
    // unmatched rather than borrowing another device's battery percentage.
    const match = /^(?:bluez_output|bluez_sink)\.((?:[0-9a-f]{2}[_:]){5}[0-9a-f]{2})(?:\.|$)/i.exec(streamName ?? '');
    return bluetoothAddress(match?.[1]);
}

export function audioWithBatteries(audio, bluetooth) {
    if (!audio) return audio;
    const devices = bluetooth?.available && bluetooth.powered ? bluetooth.devices ?? [] : [];
    return {...audio, outputs: (audio.outputs ?? []).map(output => {
        const address = bluetoothAddress(output.bluetoothAddress);
        const matches = address && output.kind === 'headphones'
            ? devices.filter(device => device.connected && bluetoothAddress(device.address) === address) : [];
        const value = matches.length === 1 ? matches[0].battery : null;
        const battery = Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
        return {...output, battery};
    })};
}
