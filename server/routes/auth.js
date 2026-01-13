import express from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../services/supabase.js';
import { verifyIdToken } from '../services/googleAuth.js';

const router = express.Router();

/**
 * POST /auth/google
 *
 * Exchange a Google id_token for a backend JWT.  The client obtains
 * the id_token from Google Sign‑In and posts it here.  The backend
 * verifies the token, upserts the user into the `users` table (with
 * a default role of `staff`), then returns a signed JWT containing
 * the user id, email and role.  The client should store this token
 * and send it in the Authorization header for subsequent requests.
 */
router.post('/google', async (req, res) => {
  const { id_token: idToken } = req.body;
  if (!idToken) {
    return res.status(400).json({ error: 'id_token is required' });
  }
  try {
    const payload = await verifyIdToken(idToken);
    const { sub: googleId, email, name, picture } = payload;
    // Upsert the user into the database
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      const { data: insertData, error: insertError } = await supabase
        .from('users')
        .insert({
          google_id: googleId,
          email,
          name,
          picture,
          role: 'staff'
        })
        .select()
        .maybeSingle();
      if (insertError) throw insertError;
      user = insertData;
    }
    // Sign the JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

export default router;