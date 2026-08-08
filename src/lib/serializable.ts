/**
 * Serializable types that can safely cross the Server → Client Component boundary.
 *
 * Reference: https://react.dev/reference/rsc/use-client#serializable-types
 */

// 1. JSON-compatible primitives
type JSONPrimitive = string | number | boolean | null | undefined;

// 2. JSON-compatible values (recursive)
type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue };

// 3. Types that are NOT assignable to JSON
type NotAssignableToJson =
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  | Function
  | symbol
  | bigint
  | Date
  | RegExp
  | Map<unknown, unknown>
  | Set<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>
  | Promise<unknown>;

// 4. Deep serializable check - blocks unknown, recurses into objects
type DeepSerializable<T> = unknown extends T
  ? never
  : T extends JSONValue
    ? T
    : T extends NotAssignableToJson
      ? never
      : T extends object
        ? { [K in keyof T]: DeepSerializable<T[K]> }
        : never;

/**
 * Constrains a type to only allow serializable values.
 * Usage: `type Props = AssertSerializable<{ name: string; age: number }>`
 * This will fail at `tsc --noEmit` if any field contains a non-serializable type (e.g. function, class instance).
 */
export type AssertSerializable<T> = DeepSerializable<T> extends never ? never : T;
