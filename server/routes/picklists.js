import express from 'express';
import { generatePicklist } from '../utils/picklist.js';

const router = express.Router();

// GET /picklists
// Generates a picklist for all unresolved orders currently stored.
// The response is an array of components and the quantities required.
router.get('/', async (req, res) => {
  try {
    const pickList = await generatePicklist();
    res.json(pickList);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;