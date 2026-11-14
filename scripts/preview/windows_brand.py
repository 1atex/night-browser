import ctypes
import os
import struct
from pathlib import Path


def align(data):
    return data + b'\0' * (-len(data) % 4)


def block(key, value=b'', children=(), text=False):
    data = align(b'\0' * 6 + (key + '\0').encode('utf-16le'))
    data += value
    for child in children:
        data = align(data) + child
    length = len(value) // 2 if text else len(value)
    return struct.pack('<HHH', len(data), length, int(text)) + data[6:]


def version_info():
    values = {'CompanyName': 'Night', 'FileDescription': 'Night Browser', 'FileVersion': '0.7.0.0',
              'InternalName': 'NightBrowser', 'OriginalFilename': 'NightBrowser.exe',
              'ProductName': 'Night Browser', 'ProductVersion': '0.7.0',
              'LegalCopyright': 'Night contributors; Mozilla contributors. MPL-2.0.'}
    strings = [block(key, (value + '\0').encode('utf-16le'), text=True) for key, value in values.items()]
    table = block('040904B0', children=strings, text=True)
    fixed = struct.pack('<13I', 0xFEEF04BD, 0x10000, 7, 0, 7, 0, 0x3F, 0, 0x40004, 1, 0, 0, 0)
    return block('VS_VERSION_INFO', fixed, [block('StringFileInfo', children=[table], text=True), block('VarFileInfo', children=[block('Translation', struct.pack('<HH', 0x409, 1200))])])


def strip_certificate(file):
    data = bytearray(file.read_bytes())
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    optional = pe + 24
    magic = struct.unpack_from('<H', data, optional)[0]
    directories = optional + (112 if magic == 0x20b else 96)
    offset, size = struct.unpack_from('<II', data, directories + 32)
    struct.pack_into('<II', data, directories + 32, 0, 0)
    if offset and offset + size == len(data):
        data = data[:offset]
    file.write_bytes(data)


def brand_runtime(executable, icon):
    if os.name != 'nt':
        raise RuntimeError('Windows resources must be assembled on Windows')
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [w.LPCWSTR, w.HANDLE, w.DWORD]
    kernel.LoadLibraryExW.restype = w.HMODULE
    kernel.FindResourceW.argtypes = [w.HMODULE, ctypes.c_void_p, ctypes.c_void_p]
    kernel.FindResourceW.restype = w.HRSRC
    kernel.LoadResource.argtypes = [w.HMODULE, w.HRSRC]
    kernel.LoadResource.restype = w.HGLOBAL
    kernel.LockResource.argtypes = [w.HGLOBAL]
    kernel.LockResource.restype = ctypes.c_void_p
    kernel.SizeofResource.argtypes = [w.HMODULE, w.HRSRC]
    kernel.SizeofResource.restype = w.DWORD
    callback_type = ctypes.WINFUNCTYPE(w.BOOL, w.HMODULE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ssize_t)
    kernel.EnumResourceNamesW.argtypes = [w.HMODULE, ctypes.c_void_p, callback_type, ctypes.c_ssize_t]
    kernel.FreeLibrary.argtypes = [w.HMODULE]
    kernel.BeginUpdateResourceW.argtypes = [w.LPCWSTR, w.BOOL]
    kernel.BeginUpdateResourceW.restype = w.HANDLE
    kernel.UpdateResourceW.argtypes = [w.HANDLE, ctypes.c_void_p, ctypes.c_void_p, w.WORD, ctypes.c_void_p, w.DWORD]
    kernel.EndUpdateResourceW.argtypes = [w.HANDLE, w.BOOL]
    strip_certificate(executable)
    module = kernel.LoadLibraryExW(str(executable), None, 2)
    if not module:
        raise ctypes.WinError(ctypes.get_last_error())
    patches = []
    groups = []
    languages = {}
    language_callback = ctypes.WINFUNCTYPE(w.BOOL, w.HMODULE, ctypes.c_void_p, ctypes.c_void_p, w.WORD, ctypes.c_ssize_t)
    kernel.EnumResourceLanguagesW.argtypes = [w.HMODULE, ctypes.c_void_p, ctypes.c_void_p, language_callback, ctypes.c_ssize_t]
    def collect(kind, action):
        def callback(_module, _kind, name, _param):
            if name < 65536:
                resource = kernel.FindResourceW(module, name, kind)
                data = ctypes.string_at(kernel.LockResource(kernel.LoadResource(module, resource)), kernel.SizeofResource(module, resource))
                found = []
                kernel.EnumResourceLanguagesW(module, kind, name, language_callback(lambda _h, _t, _n, lang, _p: found.append(lang) is None), 0)
                languages[(kind, name)] = found or [0x409]
                action(name, data)
            return True
        kernel.EnumResourceNamesW(module, kind, callback_type(callback), 0)
    collect(14, lambda name, _data: groups.append(name))
    def strings(name, data):
        output = bytearray()
        offset = 0
        for _ in range(16):
            length = struct.unpack_from('<H', data, offset)[0]
            offset += 2
            value = data[offset:offset + length * 2].decode('utf-16le')
            offset += length * 2
            value = value.replace('Mozilla Firefox', 'Night Browser').replace('Firefox', 'Night')
            encoded = value.encode('utf-16le')
            output.extend(struct.pack('<H', len(encoded) // 2) + encoded)
        patches.append((6, name, bytes(output)))
    collect(6, strings)
    collect(16, lambda name, _data: patches.append((16, name, version_info())))
    kernel.FreeLibrary(module)
    data = icon.read_bytes()
    count = struct.unpack_from('<H', data, 4)[0]
    group = bytearray(struct.pack('<HHH', 0, 1, count))
    for i in range(count):
        width, height, colors, reserved, planes, bits, size, offset = struct.unpack_from('<BBBBHHII', data, 6 + i * 16)
        resource_id = 7000 + i
        group.extend(struct.pack('<BBBBHHIH', width, height, colors, reserved, planes, bits, size, resource_id))
        patches.append((3, resource_id, data[offset:offset + size]))
    for name in groups or [1]:
        patches.append((14, name, bytes(group)))
    patches.append((16, 1, version_info()))
    update = kernel.BeginUpdateResourceW(str(executable), False)
    if not update:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        for kind, name, content in patches:
            buffer = ctypes.create_string_buffer(content)
            for language in languages.get((kind, name), [0x409]):
                if not kernel.UpdateResourceW(update, kind, name, language, buffer, len(content)):
                    raise ctypes.WinError(ctypes.get_last_error())
    except BaseException:
        kernel.EndUpdateResourceW(update, True)
        raise
    if not kernel.EndUpdateResourceW(update, False):
        raise ctypes.WinError(ctypes.get_last_error())
    strip_certificate(executable)
