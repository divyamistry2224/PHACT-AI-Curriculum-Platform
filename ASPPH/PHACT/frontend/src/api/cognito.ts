import type { Role, User } from "../types"
import { ApiError, type ApiConfig } from "./types"

/**
 * Cognito sign-in with plain fetch (no Amplify). Uses the user pool app client's USER_PASSWORD_AUTH flow,
 * keeps the session in localStorage, and refreshes the ID token shortly before it expires.
 */

const SESSION_KEY = "phact-session"
const REFRESH_MARGIN_MS = 60_000

interface Session {
  idToken: string
  refreshToken: string
  expiresAt: number
}

interface TokenClaims {
  sub: string
  email?: string
  name?: string
  "cognito:groups"?: string[] | string
}

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function writeSession(session: Session | null) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable: the session lasts until the page reloads */
  }
}

export function decodeClaims(idToken: string): TokenClaims {
  const payload = idToken.split(".")[1] || ""
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=")
  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  )
  return JSON.parse(json) as TokenClaims
}

export function userFromToken(idToken: string): User {
  const claims = decodeClaims(idToken)
  const raw = claims["cognito:groups"] || []
  const groups = Array.isArray(raw) ? raw : String(raw).replace(/[[\]]/g, "").split(/[\s,]+/)
  const role: Role = groups.includes("admin") ? "admin" : "faculty"
  const email = claims.email || ""
  return { userId: claims.sub, email, name: claims.name || email.split("@")[0] || "PHACT user", role }
}

export function createCognitoSession(config: ApiConfig) {
  const endpoint = config.cognitoEndpoint || `https://cognito-idp.${config.region}.amazonaws.com/`

  async function initiateAuth(flow: "USER_PASSWORD_AUTH" | "REFRESH_TOKEN_AUTH", parameters: Record<string, string>) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({ AuthFlow: flow, ClientId: config.userPoolClientId, AuthParameters: parameters }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const type = String(body.__type || "").split("#").pop()
      const message =
        type === "NotAuthorizedException" || type === "UserNotFoundException"
          ? "Incorrect email or password."
          : type === "PasswordResetRequiredException"
            ? "Your password must be reset before you can sign in. Ask an administrator."
            : body.message || "Sign-in failed. Try again."
      throw new ApiError(message, response.status, type || "SIGN_IN_FAILED")
    }
    if (body.ChallengeName) {
      throw new ApiError("This account needs a new password before it can sign in. Ask an administrator to set a permanent password.", 400, body.ChallengeName)
    }
    return body.AuthenticationResult as { IdToken: string; RefreshToken?: string; ExpiresIn: number }
  }

  async function signIn(email: string, password: string): Promise<User> {
    if (!config.userPoolClientId) throw new ApiError("Sign-in isn't configured: VITE_USER_POOL_CLIENT_ID is missing from this build.", 0, "NOT_CONFIGURED")
    const result = await initiateAuth("USER_PASSWORD_AUTH", { USERNAME: email.trim(), PASSWORD: password })
    writeSession({ idToken: result.IdToken, refreshToken: result.RefreshToken || "", expiresAt: Date.now() + result.ExpiresIn * 1000 })
    return userFromToken(result.IdToken)
  }

  function signOut() {
    writeSession(null)
  }

  function currentUser(): User | null {
    const session = readSession()
    if (!session) return null
    // An expired ID token is fine here as long as a refresh token can renew it on the next request.
    if (session.expiresAt < Date.now() && !session.refreshToken) {
      writeSession(null)
      return null
    }
    try {
      return userFromToken(session.idToken)
    } catch {
      writeSession(null)
      return null
    }
  }

  /** A valid ID token for the Authorization header, refreshing it first if it's about to expire. */
  async function idToken(): Promise<string | null> {
    const session = readSession()
    if (!session) return null
    if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.idToken
    if (!session.refreshToken) {
      writeSession(null)
      return null
    }
    try {
      const result = await initiateAuth("REFRESH_TOKEN_AUTH", { REFRESH_TOKEN: session.refreshToken })
      writeSession({ idToken: result.IdToken, refreshToken: session.refreshToken, expiresAt: Date.now() + result.ExpiresIn * 1000 })
      return result.IdToken
    } catch {
      writeSession(null)
      return null
    }
  }

  return { signIn, signOut, currentUser, idToken }
}
