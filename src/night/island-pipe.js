importScripts("resource://gre/modules/subprocess/subprocess_shared.js", "resource://gre/modules/subprocess/subprocess_shared_win.js");

const kernel = ctypes.open("kernel32.dll");
const security = ctypes.open("advapi32.dll");
const user = ctypes.open("user32.dll");
const BOOL = ctypes.int32_t, DWORD = ctypes.uint32_t, HANDLE = ctypes.voidptr_t;
const declare = (library, name, result, ...args) => library.declare(name, ctypes.winapi_abi, result, ...args);
const processId = declare(kernel, "GetNamedPipeServerProcessId", BOOL, HANDLE, DWORD.ptr);
const openProcess = declare(kernel, "OpenProcess", HANDLE, DWORD, BOOL, DWORD);
const queryName = declare(kernel, "QueryFullProcessImageNameW", BOOL, HANDLE, DWORD, ctypes.jschar.ptr, DWORD.ptr);
const openToken = declare(security, "OpenProcessToken", BOOL, HANDLE, DWORD, HANDLE.ptr);
const tokenInformation = declare(security, "GetTokenInformation", BOOL, HANDLE, DWORD, ctypes.voidptr_t, DWORD, DWORD.ptr);
const convertSid = declare(security, "ConvertSidToStringSidW", BOOL, ctypes.voidptr_t, ctypes.jschar.ptr.ptr);
const localFree = declare(kernel, "LocalFree", HANDLE, HANDLE);
const allowForeground = declare(user, "AllowSetForegroundWindow", BOOL, DWORD);
let peerId = 0;
let port = null, pipe = null, running = true, wakeCount = 0, polling = false;
let input = "", readPending = false, writePending = false, writeBuffer = null;
const readOverlapped = win32.OVERLAPPED(), writeOverlapped = win32.OVERLAPPED();
const readBuffer = ctypes.uint8_t.array(4096)();
const queue = [];
const decoder = new TextDecoder("utf-8", {fatal: true});

function failure(reason, code = 0) {
  const error = new Error(reason);
  error.reason = reason;
  error.code = code;
  return error;
}

function sid(process) {
  const token = HANDLE(), needed = DWORD();
  if (!openToken(process, 8, token.address())) throw failure("peer-access", ctypes.winLastError);
  try {
    tokenInformation(token, 1, null, 0, needed.address());
    if (!needed.value || needed.value > 65536) throw failure("peer-identity");
    const buffer = ctypes.uint8_t.array(needed.value)();
    if (!tokenInformation(token, 1, buffer, needed.value, needed.address())) throw failure("peer-access", ctypes.winLastError);
    const value = ctypes.jschar.ptr();
    if (!convertSid(ctypes.cast(buffer.address(), HANDLE.ptr).contents, value.address())) throw failure("peer-identity", ctypes.winLastError);
    try { return value.readString(); } finally { localFree(ctypes.cast(value, HANDLE)); }
  } finally { libc.CloseHandle(token); }
}

function verifyPeer(expectedSid) {
  const pid = DWORD();
  if (!processId(pipe, pid.address())) throw failure("peer-process", ctypes.winLastError);
  const process = openProcess(0x1000, 0, pid.value);
  if (process.isNull()) throw failure("peer-access", ctypes.winLastError);
  try {
    const path = ctypes.jschar.array(32768)(), length = DWORD(32768);
    if (!queryName(process, 0, path, length.address())) throw failure("peer-access", ctypes.winLastError);
    if (sid(process) !== expectedSid) throw failure("peer-identity");
    const name = path.readString().split("\\").pop();
    if (!/^night-island(?: \([1-9]\d{0,5}\))?\.exe$/i.test(name)) throw failure("peer-name");
    peerId = pid.value;
  } finally { libc.CloseHandle(process); }
}

function shutdown(reason = "connection-closed", code = 0) {
  if (!running) return;
  running = false;
  if (pipe && !pipe.isNull()) {
    libc.CancelIo(pipe);
    while (readPending || writePending) {
      const count = DWORD(), key = win32.ULONG_PTR(), overlapped = win32.OVERLAPPED.ptr();
      const ok = libc.GetQueuedCompletionStatus(port, count.address(), key.address(), overlapped.address(), 0xffffffff);
      if (String(overlapped) === String(readOverlapped.address())) readPending = false;
      if (String(overlapped) === String(writeOverlapped.address())) writePending = false;
      if (!ok && overlapped.isNull()) break;
    }
    libc.CloseHandle(pipe);
  }
  self.postMessage({type: "closed", reason, code});
  self.close();
}

function read() {
  readPending = true;
  if (!libc.ReadFile(pipe, readBuffer, readBuffer.length, null, readOverlapped.address()) && ctypes.winLastError !== 997) { const code = ctypes.winLastError; readPending = false; shutdown("pipe-read", code); }
}

function write() {
  if (!running || writePending || !queue.length) return;
  const bytes = new TextEncoder().encode(queue.shift());
  writeBuffer = ctypes.uint8_t.array(bytes.length)(Array.from(bytes));
  writePending = true;
  if (!libc.WriteFile(pipe, writeBuffer, bytes.length, null, writeOverlapped.address()) && ctypes.winLastError !== 997) { const code = ctypes.winLastError; writePending = false; shutdown("pipe-write", code); }
}

function loop() {
  if (!running) return;
  try {
    const count = DWORD(), key = win32.ULONG_PTR(), overlapped = win32.OVERLAPPED.ptr();
    const ok = libc.GetQueuedCompletionStatus(port, count.address(), key.address(), overlapped.address(), wakeCount > 0 ? 0 : 0xffffffff);
    if (String(overlapped) === String(readOverlapped.address())) readPending = false;
    if (String(overlapped) === String(writeOverlapped.address())) writePending = false;
    if (!ok && ctypes.winLastError === 258) { setTimeout(loop, 0); return; }
    if (parseInt(key.value.toString(), 10) === 1) wakeCount++;
    else if (!ok || overlapped.isNull()) return shutdown();
    else if (String(overlapped) === String(readOverlapped.address())) {
      readPending = false;
      if (!count.value) return shutdown();
      input += decoder.decode(Uint8Array.from({length: count.value}, (_, i) => readBuffer[i]), {stream: true});
      if (input.length > 8192) return shutdown("protocol");
      let end;
      while ((end = input.indexOf("\n")) >= 0) {
        self.postMessage({type: "frame", text: input.slice(0, end)});
        input = input.slice(end + 1);
      }
      read();
    } else {
      writePending = false;
      if (count.value !== writeBuffer.length) return shutdown("pipe-write");
      writeBuffer = null;
      write();
    }
  } catch (error) { return shutdown(error.reason ?? "transport-error", error.code ?? 0); }
  if (running) setTimeout(loop, 0);
}

self.onmessage = ({data}) => {
  wakeCount--;
  try {
    if (data.type === "init") {
      port = ctypes.cast(ctypes.uintptr_t(data.port), HANDLE);
      const owner = sid(libc.GetCurrentProcess());
      pipe = libc.CreateFileW(`\\\\.\\pipe\\NightIsland.Browser.v1.${owner}`, 0xc0000000, 0, null, 3, 0x40000000 | 0x100000, null);
      if (String(pipe) === String(win32.INVALID_HANDLE_VALUE)) {
        const code = ctypes.winLastError;
        pipe = null;
        return shutdown(({2: "not-running", 5: "access-denied", 231: "pipe-busy"})[code] ?? "pipe-open", code);
      }
      verifyPeer(owner);
      if (libc.CreateIoCompletionPort(pipe, port, 2, 1).isNull()) return shutdown("completion-port", ctypes.winLastError);
      self.postMessage({type: "connected"});
      read();
      if (!polling && running) { polling = true; setTimeout(loop, 0); }
    } else if (data.type === "send" && running) {
      if (typeof data.text !== "string" || data.text.length > 32768 || queue.length >= 16) return shutdown("protocol");
      if (data.activate && peerId) allowForeground(peerId);
      queue.push(data.text);
      write();
    } else if (data.type === "close") shutdown();
  } catch (error) { shutdown(error.reason ?? "transport-error", error.code ?? 0); }
};
