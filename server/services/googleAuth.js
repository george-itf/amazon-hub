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
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: clientId
  });
  const payload = ticket.getPayload();
  return payload;
}