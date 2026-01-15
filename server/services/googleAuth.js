import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const clientId = process.env.GOOGLE_CLIENT_ID;
if (!clientId) {
  throw new Error('GOOGLE_CLIENT_ID is not set in your environment.');
}

const oauthClient = new OAuth2Client(clientId);

/**
 * Verifies a Google id_token issued by the front‑end.  If valid, returns
 * the payload which includes the Google user id (`sub`), email, name and
 * picture.  Throws an error if verification fails.
 *
 * @param {string} idToken
 * @returns {Promise<Object>} Google token payload
 */
export async function verifyIdToken(idToken) {
  // Validate input
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid idToken: token must be a non-empty string');
  }

  // Basic JWT format validation (3 parts separated by dots)
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid idToken: malformed JWT format');
  }

  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: clientId
    });
    const payload = ticket.getPayload();
    return payload;
  } catch (err) {
    // Wrap library errors with context for better debugging
    const error = new Error(`Google token verification failed: ${err.message}`);
    error.originalError = err;
    throw error;
  }
}