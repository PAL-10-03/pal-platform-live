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
        <a href="/sign-in" style="font-size: 24px;">Sign In</a>
      </body>
    </html>
  `);
});

// Sign-in redirect to Clerk Account Portal
app.get('/sign-in', (req, res) => {
  // Replace this with your real Clerk Account Portal sign-in URL once you copy it
  const clerkSignIn = process.env.CLERK_SIGN_IN_URL || 'https://accounts.clerk.dev/sign-in';
  res.redirect(clerkSignIn);
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
