import assert from "node:assert/strict";
import test from "node:test";

import {
  readCliStreamMethod,
  readCliStreamWrapperProperty,
  writeCliStream,
} from "./cli-streams.mjs";

function fail(code, path, message) {
  const error = new Error(message);
  error.name = "CliStreamsTestError";
  error.code = code;
  error.path = path;
  throw error;
}

function expectStreamsInvalid(fn, path) {
  assert.throws(
    fn,
    (error) => {
      assert.equal(error.name, "CliStreamsTestError");
      assert.equal(error.code, "STREAMS_INVALID");
      assert.equal(error.path, path);
      return true;
    },
  );
}

test("streams wrapper rejects unknown accessor keys without executing getters", () => {
  let getterExecuted = false;
  const stdout = { write() {} };
  const streams = { stdout };
  Object.defineProperty(streams, "privateKey", {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error("getter must not execute");
    },
  });

  expectStreamsInvalid(
    () => readCliStreamWrapperProperty(streams, "stdout", process.stdout, fail),
    "streams.privateKey",
  );
  assert.equal(getterExecuted, false);
});

test("streams wrapper rejects known accessor keys without executing getters", () => {
  let getterExecuted = false;
  const streams = {};
  Object.defineProperty(streams, "stdin", {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error("getter must not execute");
    },
  });

  expectStreamsInvalid(
    () => readCliStreamWrapperProperty(streams, "stdin", process.stdin, fail),
    "streams.stdin",
  );
  assert.equal(getterExecuted, false);
});

test("stream method readers reject accessor methods without executing getters", () => {
  let getterExecuted = false;
  const stdout = {};
  Object.defineProperty(stdout, "write", {
    enumerable: true,
    get() {
      getterExecuted = true;
      throw new Error("getter must not execute");
    },
  });

  expectStreamsInvalid(
    () => writeCliStream(stdout, "payload", "streams.stdout", fail),
    "streams.stdout.write",
  );
  assert.equal(getterExecuted, false);
});

test("streams wrapper rejects symbol keys and non-plain objects", () => {
  const nullPrototypeStreams = Object.assign(Object.create(null), {
    stdout: { write() {} },
  });
  expectStreamsInvalid(
    () => readCliStreamWrapperProperty(nullPrototypeStreams, "stdout", process.stdout, fail),
    "streams",
  );

  const symbolKeyed = { stdout: { write() {} } };
  symbolKeyed[Symbol("secret")] = true;
  expectStreamsInvalid(
    () => readCliStreamWrapperProperty(symbolKeyed, "stdout", process.stdout, fail),
    "streams",
  );

  class CustomStreams {
    stdout = { write() {} };
  }
  expectStreamsInvalid(
    () => readCliStreamWrapperProperty(new CustomStreams(), "stdout", process.stdout, fail),
    "streams",
  );
});

test("process streams remain compatible with bound stream method readers", () => {
  assert.equal(
    readCliStreamWrapperProperty(process, "stdout", process.stdout, fail),
    process.stdout,
  );

  const write = readCliStreamMethod(process.stdout, "write", "streams.stdout", fail, {
    required: true,
  });
  assert.equal(typeof write, "function");
});
