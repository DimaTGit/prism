import { Plugin } from "../Plugin";
import { backend } from "../__mocks__/backend";
import { MockServer } from "../../__mocks__/server";
import { request } from "../../action/__mocks__/hapi";

import { Server } from "hapi";
import { Options as JwtOptions } from "hapi-auth-jwt2";

let server: Server;
let plugin: Plugin;

beforeEach(() => {
  server = new MockServer() as any as Server;
  server.plugins["prism"] = {
    registerFilter: jest.fn(),
    registerAction: jest.fn()
  };

  plugin = new Plugin(server, {
    key: "testPrivateKey"
  });
});

describe("when `options.key` is missing", () => {
  it("throws an error when plugin is registered", () => {
    let fn = () => new Plugin(server);
    expect(fn).toThrowError("Private key for token signing/verification was not specified");
  });
});

describe("when a backend has not been registered", () => {
  it("throws an error when server starts", () => {
    let fn = () => server.start();
    expect(fn).toThrowError("No Backend registered");
  });
});

describe("#registerBackend()", () => {
  describe("when called more than once", () => {
    it("throws an error", () => {
      let fn = () => plugin.registerBackend(backend);
      fn();

      expect(fn).toThrowError("A Backend has already been registered");
    });
  });

  it("registers a CreateToken action using backend and default options", () => {
    plugin.registerBackend(backend);
    let createToken = server.plugins["prism"].registerAction.mock.calls[0][0];

    expect(createToken._backend).toBe(backend);
    expect(createToken._options).toEqual({
      key: "testPrivateKey",
      sign: {
        expiresIn: "1d"
      }
    });
  });

  it("registers a CreateToken action using custom options", () => {
    plugin = new Plugin(server, {
      key: "testPrivateKey",
      sign: {
        expiresIn: "12h"
      }
    });
    plugin.registerBackend(backend);

    let createToken = server.plugins["prism"].registerAction.mock.calls[0][0];

    expect(createToken._backend).toBe(backend);
    expect(createToken._options).toEqual({
      key: "testPrivateKey",
      sign: {
        expiresIn: "12h"
      }
    });
  });

  it("registers a CreateToken action using merged custom options", () => {
    plugin = new Plugin(server, {
      key: "testPrivateKey",
      sign: {
        issuer: "testApplication"
      }
    });
    plugin.registerBackend(backend);

    let createToken = server.plugins["prism"].registerAction.mock.calls[0][0];

    expect(createToken._backend).toBe(backend);
    expect(createToken._options).toEqual({
      key: "testPrivateKey",
      sign: {
        issuer: "testApplication",
        expiresIn: "1d"
      }
    });
  });
});

describe("#jwtOptions", () => {
  let options: JwtOptions;
  let validateResult: any;
  let decoded = "decodedToken";
  let next = jest.fn();

  beforeEach(() => {
    plugin.registerBackend(backend);
    options = plugin.jwtOptions();
    (backend.validate as jest.Mock<any>).mockImplementation(() => Promise.resolve(validateResult));
  });

  it("creates a JWT options object", () => {
    expect(options).toEqual({
      key: "testPrivateKey",
      validateFunc: jasmine.any(Function)
    });
  });

  describe(".validateFunc()", () => {
    it("calls `backend.validate`", () => {
      options.validateFunc(decoded, request, next);
      expect(backend.validate).toHaveBeenCalledWith(decoded, request);
    });

    describe("when `backend.validate` resolves to `false`", () => {
      it("calls `next` with `null, false`", async () => {
        validateResult = false;

        await options.validateFunc(decoded, request, next);
        expect(next).toHaveBeenCalledWith(null, false);
      });
    });

    it("calls `next` with `null, true, result`", async () => {
      validateResult = "validationResult";

      await options.validateFunc(decoded, request, next);
      expect(next).toHaveBeenCalledWith(null, true, "validationResult");
    });
  });
});
