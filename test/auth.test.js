import assert from "node:assert/strict";
import test from "node:test";

const sends = [];

process.env.COGNITO_USER_POOL_ID = "test-pool";
process.env.COGNITO_CLIENT_ID = "test-client";

globalThis.__cognitoTestSend = async (command) => {
  sends.push(command.input);
  return { AuthenticationResult: { IdToken: "id-token" } };
};

const auth = await import("../src/auth.js");

test("phone signup sends a Cognito-compatible E.164 username", async () => {
  sends.length = 0;
  const result = await auth.signUp({ identifier: "98765 43210", password: "TestUser123" });

  assert.equal(sends[0].Username, "+919876543210");
  assert.deepEqual(sends[0].UserAttributes, [
    { Name: "phone_number", Value: "+919876543210" }
  ]);
  assert.equal(sends[1].Username, "+919876543210");
  assert.equal(sends[1].UserPoolId, "test-pool");
  assert.equal(sends[2].AuthParameters.USERNAME, "+919876543210");
  assert.equal(result.confirmed, true);
  assert.equal(result.tokens.IdToken, "id-token");
});

test("phone login uses the same normalized username", async () => {
  sends.length = 0;
  await auth.login({ identifier: "98765 43210", password: "TestUser123" });

  assert.equal(sends[0].AuthParameters.USERNAME, "+919876543210");
});
