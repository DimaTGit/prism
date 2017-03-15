import {Backend} from "../backend";
import {Resource as _Resource} from "../../resource";
import {Root} from "../../action/Root";
import {ReadItem} from "../../action/ReadItem";
import {CreateItem} from "../../action/CreateItem";
import {UpdateItem} from "../../action/UpdateItem";
import {Filter} from "../../action";
import {Condition} from "../../query";
import {Schema, validate} from "../../schema";

import {pick, pathEq, partialRight} from "ramda";
import {hash, compare} from "bcrypt";
import {Request} from "hapi";
import * as Promise from "bluebird";

/**
 * Security backend that performs authentication using a Prism Resource
 */
export class Resource implements Backend {
  protected _options: Options;

  schema: Schema;

  constructor(readonly resource: _Resource, options: Partial<Options> = {}) {
    this._options = {...DEFAULT_OPTIONS, ...options};

    this.schema = {
      $schema: "http://json-schema.org/draft-04/schema#",
      title:   "token",
      type:    "object",

      properties: {
        [this._options.identity]: {type: "string"},
        [this._options.password]: {type: "string"}
      },

      required: [
        this._options.identity,
        this._options.password
      ]
    };
  }

  issue(payload: any): Promise<boolean | Object> {
    let conditions = [{
      field: this._options.identity,
      value: payload[this._options.identity]
    }, ...this._options.scope];

    return validate(payload, this.schema)
      .then(() => this.resource.source.read({
        source: this.resource.name,
        schema: this.schema,
        return: "item",
        conditions
      }))
      .catch(error => {
        if (error.isBoom && error.output && error.output.statusCode === 404) {
          return null;
        }

        throw error;
      })
      .then(result => {
        if (result === null) {
          /**
           * @todo This leads to discovery of valid usernames through a timing
           * attack; make it constant-time
           */
          return false;
        }

        let given  = payload[this._options.password];
        let actual = (result as any)[this._options.password];

        return this._options.compare(given, actual)
          .then(match => {
            if (match === false) {
              return false;
            }

            return {
              [this.resource.name]: pick(this.resource.primaryKeys, result)
            };
          });
      });
  }

  validate(decoded: any, request: Request): Promise<boolean | Object> {
    let conditions = [...this.resource.primaryKeys.map(key => ({
      field: key,
      value: decoded[this.resource.name][key]
    })), ...this._options.scope];

    return this.resource.source.read({
      source: this.resource.name,
      schema: this.schema,
      return: "item",
      conditions
    }).catch(err => false);
  }

  filters = [
    /**
     * Redact the password field when it appears in results from `ReadItem`
     */
    <Filter<ReadItem, "decorate">>{
      type: ReadItem,
      name: "decorate",
      where: pathEq(["resource", "name"], this.resource.name),
      filter: next => (doc, params, request) => {
        next(doc, params, request);

        doc.properties[this._options.password] = this._options.redact;

        return doc;
      }
    },

    /**
     * Hash passwords supplied through `Create` and `Update` forms before
     * persisting
     */
    <Filter<CreateItem, "handle">>{
      type: [CreateItem, UpdateItem],
      name: "handle",
      where: pathEq(["resource", "name"], this.resource.name),
      filter: next => (params, request) => {
        if (!request.payload[this._options.password]) {
          return next(params, request);
        }

        return this._options.hash(request.payload[this._options.password])
          .then(hash => {
            request.payload[this._options.password] = hash;
            return next(params, request);
          });
      }
    },

    <Filter<Root, "decorate">>{
      type: Root,
      name: "decorate",
      filter: (next, self, registry) => (doc, params, request) => {
        doc = next(doc, params, request);

        if (!request.auth || request.auth.error) {
          return doc;
        }

        let read = registry.findActions([ReadItem], pathEq(["resource", "name"], this.resource.name))[0];
        if (!read) {
          return doc;
        }

        doc.links.push({
          rel: this.resource.name,
          name: "identity",
          href: read.path,
          params: pick(this.resource.primaryKeys, request.auth.credentials),
        });

        return doc;
      }
    }
  ];
}

/**
 * Configuration options for the `Resource` security backend
 */
export interface Options {
  /**
   * The resource property that contains a human-readable identity, such as a
   * username or email address
   * @default `"username"`
   */
  identity: string;

  /**
   * The resource property that contains a secret string, ie password
   * @default `"password"`
   */
  password: string;

  /**
   * Automatically replace the value of `password` within Documents that are generated by the bound Resource
   * @default `"**REDACTED**"`
   */
  redact: string;

  /**
   * The comparison function that will be used to check `password` when a token
   * is issued, typically involving some kind of cryptographic hashing strategy.
   *
   * @param given The password that was specified when attempting to issue a
   * token
   * @param actual The actual value that the resource query returned
   * @return Promise that resolves to `true` if `given` matches `actual`,
   * otherwise resolves to `false`
   * @default A Promisified version of `bcrypt.compare`
   */
  compare: (given: string, actual: string) => Promise<boolean>;

  /**
   * The hashing function that will be used to automatically hash passwords when
   * creating or updating a document in the bound `Resource`.
   *
   * @param given The password to be hashed
   * @return Promise that resolves to the hashed value of `password`
   * @default A Promisified version of `bcrypt.hash` using 10 rounds.
   */
  hash: (given: string) => Promise<string>;

  /**
   * Additional `Condition` clauses to apply when performing queries during token
   * issuing and verification
   */
  scope: Condition[];
}

const DEFAULT_OPTIONS: Options = {
  identity: "username",
  password: "password",
  redact:   "**REDACTED**",

  compare: Promise.promisify(compare),
  hash:    partialRight(hash, [4]) as any,

  scope: []
};
