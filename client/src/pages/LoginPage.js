import React from 'react';
import { Card, Page, Button } from '@shopify/polaris';
import { useAuth } from '../context/AuthContext.js';

/**
 * Login page that prompts the user to authenticate with Google.  In a
 * production implementation you would integrate the Google Identity
 * Services SDK here to obtain an id_token.  For this proof of
 * concept there is a placeholder button that demonstrates the flow
 * using a prompt for the id_token.
 */
export default function LoginPage() {
  const { login } = useAuth();
  async function handleLogin() {
    // In a real app you would invoke Google Sign‑In to get the
    // id_token.  Here we simply prompt for it for demonstration.
    const idToken = window.prompt('Enter your Google id_token');
    if (!idToken) return;
    try {
      await login(idToken);
    } catch (err) {
      alert(`Login failed: ${err.message}`);
    }
  }
  return (
    <Page title="Amazon Hub Brain – Login">
      <Card sectioned>
        <p>To continue, sign in with your Google account.</p>
        <Button primary onClick={handleLogin}>Sign in with Google</Button>
      </Card>
    </Page>
  );
}