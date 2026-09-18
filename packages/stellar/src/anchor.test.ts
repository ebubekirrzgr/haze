import { test } from "node:test";
import assert from "node:assert/strict";
import { splitTry } from "./anchor.ts";

test("splitTry: limit içindeyse tek parça", () => {
  assert.deepEqual(splitTry(2500), [2500]);
});

test("splitTry: 3000 üstü parçalanır, son parça 50 TRY altına düşmez", () => {
  assert.deepEqual(splitTry(7000), [3000, 3000, 1000]);
  assert.deepEqual(splitTry(3020), [2970, 50]);
  assert.deepEqual(splitTry(6000), [3000, 3000]);
});

test("splitTry: minimum altı hata", () => {
  assert.throws(() => splitTry(20));
});
