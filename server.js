require('dotenv').config();
const express = require('express');
const path = require('path');
const { clerkMiddleware, getAuth } = require('@clerk/express');
const app = express();
const PORT = process.env.PORT || 10000;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
const allowedOrigins = (process.env.CLERK_AUTHORIZED_PARTIES || 'https://palbiz.app,https://www.palbiz.app').split(',').map(s => s.trim()).filter(Boolean);
app.use(clerkMiddleware({ authorizedParties: allowedOrigins }));
app.use('/assets', express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));
const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || '';
const ownerId = process.env.PAL_OWNER_CLERK_USER_ID || '';
const isOwner = req => Boolean(ownerId && getAuth(req).userId === ownerId);
const isSignedIn = req => Boolean(getAuth(req).userId);
function html(req, view, title) {
  const state = { view, publishableKey, signedIn: isSignedIn(req), owner: isOwner(req) };
  const safeState = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101b30"><title>${title} | PAL Business Solutions</title><link rel="stylesheet" href="/assets/style.css"></head><body><div id="app"></div><script id="pal-state" type="application/json">${safeState}</script><script src="/assets/app.js" defer></script></body></html>`;
}
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/', (req, res) => res.send(html(req, 'home', 'Home')));
app.get(['/login','/sign-in'], (req, res) => res.send(html(req, 'login', 'Sign In')));
app.get(['/register','/sign-up'], (req, res) => res.send(html(req, 'register', 'Sign Up')));
app.get('/owner', (req, res) => {
  if (!isSignedIn(req)) return res.redirect('/login?next=owner');
  if (!isOwner(req)) return res.status(403).send(html(req, 'forbidden', 'Access Denied'));
  res.send(html(req, 'owner', 'Owner Dashboard'));
});
app.get(['/app','/portal'], (req, res) => {
  if (!isSignedIn(req)) return res.redirect('/login?next=app');
  if (isOwner(req)) return res.redirect('/owner');
  res.send(html(req, 'customer', 'Customer Workspace'));
});
app.get('/api/me', (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: 'Sign in required' });
  res.set('Cache-Control', 'no-store');
  res.json({ userId: auth.userId, role: isOwner(req) ? 'pal_owner' : 'unassigned', companyAccess: false });
});
app.use((_req, res) => res.status(404).send('Page not found'));
app.listen(PORT, () => console.log(`PAL listening on ${PORT}`));
