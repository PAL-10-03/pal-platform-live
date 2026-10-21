require('dotenv').config();
const express = require('express');
const { clerkMiddleware, getAuth, requireAuth } = require('@clerk/express');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Clerk middleware
app.use(clerkMiddleware());

// Public home
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 40px;">
        <h1>PAL Business Solutions</h1>
        <p>Public site</p>
        <a href="/sign-in" style="font-size: 24px; margin-right: 20px;">Sign In</a>
        <a href="/sign-up" style="font-size: 24px;">Sign Up</a>
      </body>
    </html>
  `);
});

// Redirect to real Clerk Account Portal
app.get('/sign-in', (req, res) => {
  res.redirect('https://accounts.palbiz.app/sign-in');
});

app.get('/sign-up', (req, res) => {
  res.redirect('https://accounts.palbiz.app/sign-up');
});

// Owner page (protected)
app.get('/owner', requireAuth(), (req, res) => {
  const auth = getAuth(req);
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 40px;">
        <h1>Owner Backend</h1>
        <p>You are signed in. User ID: ${auth.userId}</p>
        <a href="/">Home</a>
      </body>
    </html>
  `);
});

// Portal page (protected)
app.get('/portal', requireAuth(), (req, res) => {
  const auth = getAuth(req);
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 40px;">
        <h1>Tenant Portal</h1>
        <p>Company view. User ID: ${auth.userId}</p>
        <a href="/">Home</a>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log('PAL running on port ' + PORT);
});
