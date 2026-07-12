function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

const ALLOWED_CLI_STREAM_KEYS = new Set(["stdin", "stdout", "stderr"]);

export function readCliStreamWrapperProperty(streams, key, fallback, fail) {
  if (streams === process) {
    return fallback;
  }
  if (streams === undefined || streams === null) {
    return fallback;
  }
  if (!isRecord(streams)) {
    fail("STREAMS_INVALID", "streams", "streams 必须是对象或 process");
  }
  const prototype = Object.getPrototypeOf(streams);
  if (prototype !== Object.prototype) {
    fail("STREAMS_INVALID", "streams", "streams 必须是 plain object 或 process");
  }
  if (Object.getOwnPropertySymbols(streams).length !== 0) {
    fail("STREAMS_INVALID", "streams", "streams 不得包含 symbol key");
  }
  const descriptors = Object.getOwnPropertyDescriptors(streams);
  for (const ownKey of Object.keys(descriptors)) {
    if (!ALLOWED_CLI_STREAM_KEYS.has(ownKey)) {
      fail("STREAMS_INVALID", `streams.${ownKey}`, "streams 只能包含 stdin、stdout、stderr");
    }
  }
  const descriptor = descriptors[key];
  if (!descriptor) {
    return fallback;
  }
  if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
    fail("STREAMS_INVALID", `streams.${key}`, `streams.${key} 必须是可枚举 data property`);
  }
  return descriptor.value ?? fallback;
}

export function readCliStreamMethod(stream, methodName, path, fail, { required = false } = {}) {
  if (stream === process.stdin || stream === process.stdout || stream === process.stderr) {
    const method = stream[methodName];
    if (typeof method === "function") {
      return method.bind(stream);
    }
    if (required) {
      fail("STREAMS_INVALID", `${path}.${methodName}`, `${path}.${methodName} 必须是函数`);
    }
    return undefined;
  }
  if (!isRecord(stream)) {
    if (required) {
      fail("STREAMS_INVALID", path, `${path} 必须是 stream-like 对象`);
    }
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(stream, methodName);
  if (!descriptor) {
    if (required) {
      fail("STREAMS_INVALID", `${path}.${methodName}`, `${path}.${methodName} 必须是函数`);
    }
    return undefined;
  }
  if (!descriptor.enumerable || !hasOwn(descriptor, "value")) {
    fail("STREAMS_INVALID", `${path}.${methodName}`, `${path}.${methodName} 必须是可枚举 data property`);
  }
  if (descriptor.value === undefined || descriptor.value === null) {
    if (required) {
      fail("STREAMS_INVALID", `${path}.${methodName}`, `${path}.${methodName} 必须是函数`);
    }
    return undefined;
  }
  if (typeof descriptor.value !== "function") {
    fail("STREAMS_INVALID", `${path}.${methodName}`, `${path}.${methodName} 必须是函数`);
  }
  return descriptor.value.bind(stream);
}

export function writeCliStream(stream, chunk, path, fail) {
  const write = readCliStreamMethod(stream, "write", path, fail, { required: true });
  write(chunk);
}

export function readCliStdin(stream, fail) {
  return new Promise((resolve, reject) => {
    let text = "";
    const setEncoding = readCliStreamMethod(stream, "setEncoding", "streams.stdin", fail);
    const on = readCliStreamMethod(stream, "on", "streams.stdin", fail, { required: true });
    setEncoding?.("utf8");
    on("data", (chunk) => {
      text += chunk;
    });
    on("end", () => resolve(text));
    on("error", reject);
  });
}
