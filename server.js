require('dotenv').config();
const express = require('express');
const { ClerkExpressWithAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk middleware
app.use(ClerkExpressWithAuth({
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  secretKey: process.env.CLERK_SECRET_KEY,
}));

// Public home
app.get('/', (req, res) => {
  res.send(`
    <h1>PAL Business Solutions</h1>
    <p>Public site</p>
    <a href="/sign-in">Sign In</a>
  `);
});

// Protected owner dashboard (you only)
app.get('/owner', ClerkExpressWithAuth(), async (req, res) => {
  if (!req.auth || !req.auth.userId) return res.redirect('/sign-in');
  res.send(`
    <h1>Owner Backend</h1>
    <p>Only you see this. Extract data and run automations here.</p>
    <a href="/">Home</a>
  `);
});

// Tenant portal example (Born Again Air later)
app.get('/portal', ClerkExpressWithAuth(), async (req, res) => {
  if (!req.auth || !req.auth.userId) return res.redirect('/sign-in');
  res.send(`
    <h1>Tenant Portal</h1>
    <p>Companies see only their own modules here.</p>
  `);
});

app.listen(PORT, () => {
  console.log(`PAL running on port ${PORT}`);
});
