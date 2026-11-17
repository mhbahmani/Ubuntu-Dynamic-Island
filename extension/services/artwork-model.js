// Round a small decoded cover once. Alpha clipping also works on St's content
// actors, whose CSS border radius only rounds their background, not the image.
export function roundedCover(pixels, width, height, stride, channels) {
    const side = Math.min(width, height);
    const x0 = Math.floor((width - side) / 2), y0 = Math.floor((height - side) / 2);
    const radius = side * 0.115;
    const data = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const source = (y + y0) * stride + (x + x0) * channels, target = (y * side + x) * 4;
        data[target] = pixels[source]; data[target + 1] = pixels[source + 1]; data[target + 2] = pixels[source + 2];
        const dx = Math.max(radius - x - 0.5, x + 0.5 - (side - radius), 0);
        const dy = Math.max(radius - y - 0.5, y + 0.5 - (side - radius), 0);
        const coverage = Math.min(1, Math.max(0, radius - Math.hypot(dx, dy) + 0.5));
        data[target + 3] = Math.round((channels === 4 ? pixels[source + 3] : 255) * coverage);
    }
    return {data, side};
}
