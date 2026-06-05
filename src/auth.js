import {
  AdminConfirmSignUpCommand,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  SignUpCommand
} from "@aws-sdk/client-cognito-identity-provider";
import { createPublicKey, verify as verifySignature } from "node:crypto";

const REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";
const CLIENT_ID = process.env.COGNITO_CLIENT_ID || "";
const DEFAULT_PHONE_COUNTRY_CODE = process.env.DEFAULT_PHONE_COUNTRY_CODE || "+91";
const ISSUER = USER_POOL_ID ? `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}` : "";
const JWKS_URL = ISSUER ? `${ISSUER}/.well-known/jwks.json` : "";

const cognito = new CognitoIdentityProviderClient({ region: REGION });
let jwksCache = null;

function sendCognito(command) {
  if (globalThis.__cognitoTestSend) return globalThis.__cognitoTestSend(command);
  return cognito.send(command);
}

function normalizeIdentifier(identifier = "") {
  return String(identifier).trim();
}

function compactPhone(identifier) {
  return String(identifier || "").replace(/[\s().-]/g, "");
}

function isPhoneIdentifier(identifier) {
  return /^\+?[1-9]\d{7,14}$/.test(compactPhone(identifier));
}

function normalizePhone(identifier) {
  const compact = compactPhone(identifier);
  if (/^[6-9]\d{9}$/.test(compact)) return `${DEFAULT_PHONE_COUNTRY_CODE}${compact}`;
  return compact.startsWith("+") ? compact : `+${compact}`;
}

function cognitoUsernameFor(identifier = "") {
  const normalized = normalizeIdentifier(identifier);
  if (isPhoneIdentifier(normalized)) return normalizePhone(normalized);
  return normalized.toLowerCase();
}

function userAttributeFor(identifier) {
  if (isPhoneIdentifier(identifier)) {
    return { Name: "phone_number", Value: normalizePhone(identifier) };
  }
  return { Name: "email", Value: String(identifier).toLowerCase() };
}

export function normalizeAuthIdentifier(identifier) {
  const username = cognitoUsernameFor(identifier);
  if (!username) {
    const error = new Error("Enter an email address or phone number.");
    error.statusCode = 400;
    throw error;
  }
  if (!username.includes("@") && !isPhoneIdentifier(username)) {
    const error = new Error("Use a valid email address or phone number in international format, for example +15551234567.");
    error.statusCode = 400;
    throw error;
  }
  const attribute = userAttributeFor(username);
  return {
    username,
    attribute,
    delivery: attribute.Name === "phone_number" ? "phone" : "email"
  };
}

function assertCredentials(username, password) {
  if (!username) {
    const error = new Error("Enter an email address or phone number.");
    error.statusCode = 400;
    throw error;
  }
  if (!password) {
    const error = new Error("Enter a password.");
    error.statusCode = 400;
    throw error;
  }
}

export function authConfig() {
  return {
    configured: Boolean(USER_POOL_ID && CLIENT_ID),
    region: REGION,
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID
  };
}

function assertConfigured() {
  if (!authConfig().configured) {
    const error = new Error("Cognito is not configured on this server.");
    error.statusCode = 503;
    throw error;
  }
}

export async function signUp({ identifier, email, password }) {
  assertConfigured();
  const username = cognitoUsernameFor(identifier || email);
  assertCredentials(username, password);
  const isPhoneSignup = isPhoneIdentifier(username);
  await sendCognito(new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: username,
    Password: password,
    UserAttributes: [userAttributeFor(username)]
  }));

  if (isPhoneSignup) {
    await sendCognito(new AdminConfirmSignUpCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    }));
    const response = await sendCognito(new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT_ID,
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password
      }
    }));
    return {
      ok: true,
      confirmed: true,
      tokens: response.AuthenticationResult,
      message: "Phone account created. You are signed in."
    };
  }

  return { ok: true, message: "Check your email or phone for the confirmation code." };
}

export async function confirmSignUp({ identifier, email, code }) {
  assertConfigured();
  const username = cognitoUsernameFor(identifier || email);
  if (!username) {
    const error = new Error("Enter the email address or phone number used for signup.");
    error.statusCode = 400;
    throw error;
  }
  if (!String(code || "").trim()) {
    const error = new Error("Enter the confirmation code.");
    error.statusCode = 400;
    throw error;
  }
  await sendCognito(new ConfirmSignUpCommand({
    ClientId: CLIENT_ID,
    Username: username,
    ConfirmationCode: code
  }));
  return { ok: true };
}

export async function resendConfirmationCode({ identifier, email }) {
  assertConfigured();
  const username = cognitoUsernameFor(identifier || email);
  if (!username) {
    const error = new Error("Enter the email address or phone number used for signup.");
    error.statusCode = 400;
    throw error;
  }
  await sendCognito(new ResendConfirmationCodeCommand({
    ClientId: CLIENT_ID,
    Username: username
  }));
  return { ok: true, message: "A new confirmation code was sent." };
}

export async function login({ identifier, email, password }) {
  assertConfigured();
  const username = cognitoUsernameFor(identifier || email);
  assertCredentials(username, password);
  const response = await sendCognito(new InitiateAuthCommand({
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: username,
      PASSWORD: password
    }
  }));
  return {
    ok: Boolean(response.AuthenticationResult),
    tokens: response.AuthenticationResult ?? null,
    challengeName: response.ChallengeName ?? null
  };
}

function base64UrlDecode(value) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function parseJwt(token) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) throw new Error("Invalid token");
  return {
    header: JSON.parse(base64UrlDecode(header).toString("utf8")),
    payload: JSON.parse(base64UrlDecode(payload).toString("utf8")),
    signingInput: `${header}.${payload}`,
    signature: base64UrlDecode(signature)
  };
}

async function getJwks() {
  if (jwksCache) return jwksCache;
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("Unable to load Cognito signing keys");
  jwksCache = await response.json();
  return jwksCache;
}

export async function verifyCognitoToken(token) {
  assertConfigured();
  const jwt = parseJwt(token);
  const jwks = await getJwks();
  const jwk = jwks.keys.find((key) => key.kid === jwt.header.kid);
  if (!jwk) throw new Error("Unknown token signing key");

  const key = createPublicKey({ key: jwk, format: "jwk" });
  const valid = verifySignature("RSA-SHA256", Buffer.from(jwt.signingInput), key, jwt.signature);
  if (!valid) throw new Error("Invalid token signature");

  const now = Math.floor(Date.now() / 1000);
  if (jwt.payload.exp <= now) throw new Error("Token expired");
  if (jwt.payload.iss !== ISSUER) throw new Error("Invalid token issuer");
  if (jwt.payload.aud && jwt.payload.aud !== CLIENT_ID) throw new Error("Invalid token audience");
  if (jwt.payload.client_id && jwt.payload.client_id !== CLIENT_ID) throw new Error("Invalid token client");

  return jwt.payload;
}

export async function requireAuth(req) {
  if (!authConfig().configured) return { sub: "local-dev", email: null };
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }
  return verifyCognitoToken(token);
}
