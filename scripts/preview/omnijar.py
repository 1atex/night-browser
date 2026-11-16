import io
import struct
import zipfile
from pathlib import Path


def read_jar(path):
    data = Path(path).read_bytes()
    if data[4:8] == b"PK\x01\x02":
        end = data.rfind(b"PK\x05\x06")
        if end < 0:
            raise ValueError("Missing archive directory")
        fields = list(struct.unpack_from("<4s4H2IH", data, end))
        size, offset, comment_size = fields[5:8]
        if offset != 4 or end + 22 + comment_size != len(data):
            raise ValueError("Unsupported optimized archive layout")
        directory = data[offset:offset + size]
        fields[6] = len(data)
        data += directory + struct.pack("<4s4H2IH", *fields) + data[end + 22:]
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("Duplicate archive entries")
        return {name: archive.read(name) for name in names}


def write_jar(path, entries):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    temporary.replace(path)
