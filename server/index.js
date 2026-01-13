import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

// Load environment variables from .env
dotenv.config();

// Route imports
import authRoutes from './routes/auth.js';
import componentsRoutes from './routes/components.js';
import bomsRoutes from './routes/boms.js';
import listingsRoutes from './routes/listings.js';
import ordersRoutes from './routes/orders.js';
import picklistsRoutes from './routes/picklists.js';
import reviewRoutes from './routes/review.js';

// Create the Express app
const app = express();

// Allow cross‑origin requests for development.  In production you
// should restrict this to your frontend domain.
app.use(cors({ origin: true, credentials: true }));

// Parse JSON request bodies
app.use(express.json());

// Mount unauthenticated auth routes
app.use('/auth', authRoutes);

// JWT authentication middleware.  All routes after this require a
// valid Authorization header in the form "Bearer <token>".  The
// decoded token payload is attached to `req.user` for downstream
// handlers to use.
app.use((req, res, next) => {
  // Skip auth for authentication endpoints
  if (req.path.startsWith('/auth')) {
    return next();
  }
  const header = req.headers['authorization'];
  if (!header) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Invalid Authorization header format' });
  }
  const token = parts[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// Protected routes
app.use('/components', componentsRoutes);
app.use('/boms', bomsRoutes);
app.use('/listings', listingsRoutes);
app.use('/orders', ordersRoutes);
app.use('/picklists', picklistsRoutes);
app.use('/review', reviewRoutes);

// Healthcheck endpoint
app.get('/', (req, res) => {
  res.send('Amazon Hub Brain API is running');
});

// Start listening for incoming requests
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Amazon Hub Brain API listening on port ${port}`);
});