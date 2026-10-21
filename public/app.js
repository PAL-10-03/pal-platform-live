const state = JSON.parse(document.getElementById('pal-state').textContent);
const app = document.getElementById('app');
const nav = `<header class="nav"><a href="/" class="logo"><span class="mark">P</span><span>PAL <small>BUSINESS SOLUTIONS</small></span></a><div class="nav-actions"><a href="/">Home</a>${state.signedIn ? `<a href="${state.owner ? '/owner' : '/app'}">Dashboard</a><div id="user-button"></div>` : '<a href="/login">Sign In</a><a class="nav-cta" href="/register">Get Started</a>'}</div></header>`;
const foot = `<footer>© ${new Date().getFullYear()} PAL Business Solutions · Secure business workspaces</footer>`;
const shell = (content) => { app.innerHTML = nav + content + foot; };
function goDashboard() { window.location.replace(state.owner ? '/owner' : '/app'); }
function home() { shell(`<main><section class="hero"><div class="eyebrow">BUSINESS OPERATIONS, SIMPLIFIED</div><h1>One platform.<br><em>More room to grow.</em></h1><p>Welcome to PAL Business Solutions. A secure home for your team, your workflows, and the work that moves your business forward.</p><div class="hero-actions"><a class="button primary" href="${state.signedIn ? (state.owner ? '/owner' : '/app') : '/login'}">${state.signedIn ? 'Open Dashboard' : 'Sign In to Your Workspace'} →</a><a class="button ghost" href="/register">Create an Account</a></div></section><section class="features"><article><div class="feature-icon">▦</div><h3>Dedicated workspaces</h3><p>Each company has its own workspace and access rules.</p></article><article><div class="feature-icon">♧</div><h3>Built for your team</h3><p>Managers and employees see the tools relevant to their roles.</p></article><article><div class="feature-icon">↗</div><h3>Designed to scale</h3><p>A foundation for automation, reporting, and future integrations.</p></article></section></main>`); }
function authPage(kind) { if (state.signedIn) return goDashboard(); const login = kind === 'login'; shell(`<main class="auth-layout"><section class="auth-copy"><div class="eyebrow">PAL BUSINESS SOLUTIONS</div><h1>${login ? 'Welcome back.' : 'Join PAL.'}</h1><p>${login ? 'Sign in to continue to your secure business workspace.' : 'Create your account to begin the onboarding process. Company access requires approval.'}</p><div class="auth-note">🔒 Secure authentication powered by Clerk</div></section><section class="auth-card"><h2>${login ? 'Sign in' : 'Create account'}</h2><p>${login ? 'Use your existing PAL account.' : 'Use your work email to register.'}</p><div id="clerk-mount"><div class="loading">Loading secure sign-in…</div></div><div id="auth-error" role="alert"></div><div class="auth-switch">${login ? 'New to PAL? <a href="/register">Create an account</a>' : 'Already have an account? <a href="/login">Sign in</a>'}</div></section></main>`); initializeClerk(kind); }
function dashboard(owner) { shell(`<main class="dash"><div class="dash-top"><div><div class="eyebrow">${owner ? 'PAL ADMINISTRATION' : 'CUSTOMER WORKSPACE'}</div><h1>${owner ? 'Owner Dashboard' : 'Your Workspace'}</h1><p>${owner ? 'Your private platform administration area.' : 'You are signed in. Your company workspace will appear after an administrator assigns your organization.'}</p></div><div class="status">● Secure session</div></div><div class="dash-grid">${owner ? `<article class="panel"><div class="panel-icon">▣</div><h3>Company Accounts</h3><p>Company management tools will be connected to the backend.</p><span class="pill">Coming next</span></article><article class="panel"><div class="panel-icon">♙</div><h3>User Access</h3><p>Invite and assign managers and employees with verified permissions.</p><span class="pill">Coming next</span></article><article class="panel"><div class="panel-icon">▤</div><h3>Reports & Automation</h3><p>Monitor connected client workflows once backend APIs are ready.</p><span class="pill">Coming next</span></article>` : `<article class="panel wide"><div class="panel-icon">⌁</div><h3>Company access pending</h3><p>Your account is authenticated, but no company membership has been verified yet. Contact your PAL administrator for access. No customer data is shown until backend authorization is connected.</p><span class="pill">Awaiting setup</span></article>`}</div><div class="account-strip">Signed in with Clerk <span id="user-button-inline"></span></div></main>`); initializeClerk('user'); }
function forbidden() { shell(`<main class="notice"><h1>Owner access restricted</h1><p>This account is not authorized as the PAL platform owner. If you are a customer, continue to your workspace.</p><a class="button primary" href="/app">Customer Workspace →</a></main>`); initializeClerk('user'); }
function clerkDomains() { const encoded = state.publishableKey.split('_')[2]; if (!encoded) throw new Error('Missing Clerk publishable key.'); return atob(encoded).replace(/\$$/, ''); }
async function initializeClerk(kind) {
  const err = document.getElementById('auth-error');
  try {
    const domain = clerkDomains();
    await loadScript(`https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(`https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': state.publishableKey });
    if (!window.Clerk) throw new Error('Clerk did not initialize.');
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    const button = document.getElementById('user-button') || document.getElementById('user-button-inline');
    if (button && window.Clerk.isSignedIn) window.Clerk.mountUserButton(button, { afterSignOutUrl: '/' });
    if (kind === 'user') return;
    if (window.Clerk.isSignedIn) return goDashboard();
    const mount = document.getElementById('clerk-mount');
    mount.innerHTML = '';
    const options = { routing: 'hash', signInUrl: '/login', signUpUrl: '/register', fallbackRedirectUrl: '/app', signInFallbackRedirectUrl: '/app', signUpFallbackRedirectUrl: '/app' };
    if (kind === 'login') window.Clerk.mountSignIn(mount, options);
    else window.Clerk.mountSignUp(mount, options);
  } catch (e) {
    if (err) err.textContent = 'Unable to load secure login. Check your Clerk settings and try refreshing. Details: ' + e.message;
    const mount = document.getElementById('clerk-mount'); if (mount) mount.innerHTML = '';
    console.error('PAL Clerk initialization:', e);
  }
}
function loadScript(src, attributes = {}) { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.crossOrigin = 'anonymous'; script.async = true; for (const [key, val] of Object.entries(attributes)) script.setAttribute(key, val); script.onload = resolve; script.onerror = () => reject(new Error('Cannot load ' + src)); document.head.appendChild(script); }); }
if (state.view === 'home') home(); else if (state.view === 'login' || state.view === 'register') authPage(state.view); else if (state.view === 'owner') dashboard(true); else if (state.view === 'customer') dashboard(false); else forbidden();
