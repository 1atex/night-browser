import math
import struct
import zlib
from pathlib import Path


def png(size):
    def pixel(x, y):
        x, y = x * 64 / size - 32, y * 64 / size - 32
        if abs(x) > 20 and abs(y) > 20 and (abs(x) - 20) ** 2 + (abs(y) - 20) ** 2 > 12 ** 2:
            return (0, 0, 0, 0)
        distance = math.hypot(x, y)
        if distance <= 21 and (distance >= 19 or y >= 0):
            return (195, 204, 217, 255)
        return (23, 23, 26, 255)

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            samples = [pixel(x + dx / 4, y + dy / 4) for dx in range(4) for dy in range(4)]
            raw.extend(round(sum(p[channel] for p in samples) / len(samples)) for channel in range(4))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


if __name__ == '__main__':
    target = Path(__file__).resolve().parents[2] / 'src/night/branding'
    sizes = [16, 32, 48, 64, 128, 256]
    icons = [png(size) for size in sizes]
    offset = 6 + 16 * len(sizes)
    directory = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))
    for size, data in zip(sizes, icons):
        (target / f'icon{size}.png').write_bytes(data)
        directory.extend(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    (target / 'night.ico').write_bytes(directory + b''.join(icons))
