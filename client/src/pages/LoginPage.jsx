import React, { useState } from 'react';
import {
  Card,
  Page,
  Form,
  FormLayout,
  TextField,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Tabs,
} from '@shopify/polaris';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Login page with email/password authentication.
 * Includes tabs for both login and registration.
 */
export default function LoginPage() {
  const { login, register, loading, error: authError } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const tabs = [
    { id: 'login', content: 'Sign In', panelID: 'login-panel' },
    { id: 'register', content: 'Register', panelID: 'register-panel' },
  ];

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please enter both email and password');
      return;
    }

    try {
      setError(null);
      setSubmitting(true);
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    try {
      setError(null);
      setSubmitting(true);
      await register(email, password, name);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  const displayError = error || authError;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--hub-bg)',
      padding: 'var(--hub-space-lg)',
    }}>
      <div style={{ maxWidth: '400px', width: '100%' }}>
        <BlockStack gap="400">
          {/* Logo/Header */}
          <div style={{ textAlign: 'center', marginBottom: 'var(--hub-space-md)' }}>
            <div style={{
              width: '60px',
              height: '60px',
              backgroundColor: 'var(--hub-primary)',
              borderRadius: 'var(--hub-radius-lg)',
              margin: '0 auto var(--hub-space-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text variant="headingLg" as="span" fontWeight="bold">
                <span style={{ color: 'white' }}>IH</span>
              </Text>
            </div>
            <Text variant="headingXl" as="h1">
              Amazon Hub Brain
            </Text>
            <Text variant="bodyMd" tone="subdued">
              Invicta Tools & Fixings
            </Text>
          </div>

          <Card>
            <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab}>
              <div style={{ padding: '16px' }}>
                {displayError && (
                  <div style={{ marginBottom: '16px' }}>
                    <Banner tone="critical" onDismiss={() => setError(null)}>
                      <p>{displayError}</p>
                    </Banner>
                  </div>
                )}

                {activeTab === 0 ? (
                  // Login Form
                  <Form onSubmit={handleLogin}>
                    <FormLayout>
                      <TextField
                        label="Email"
                        type="email"
                        value={email}
                        onChange={setEmail}
                        autoComplete="email"
                        autoFocus
                      />
                      <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={setPassword}
                        autoComplete="current-password"
                      />
                      <Button
                        variant="primary"
                        submit
                        fullWidth
                        loading={submitting}
                      >
                        Sign In
                      </Button>
                    </FormLayout>
                  </Form>
                ) : (
                  // Register Form
                  <Form onSubmit={handleRegister}>
                    <FormLayout>
                      <TextField
                        label="Name"
                        value={name}
                        onChange={setName}
                        autoComplete="name"
                        autoFocus
                      />
                      <TextField
                        label="Email"
                        type="email"
                        value={email}
                        onChange={setEmail}
                        autoComplete="email"
                      />
                      <TextField
                        label="Password"
                        type="password"
                        value={password}
                        onChange={setPassword}
                        autoComplete="new-password"
                        helpText="Minimum 8 characters"
                      />
                      <TextField
                        label="Confirm Password"
                        type="password"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        autoComplete="new-password"
                      />
                      <Button
                        variant="primary"
                        submit
                        fullWidth
                        loading={submitting}
                      >
                        Create Account
                      </Button>
                      <Text variant="bodySm" tone="subdued" alignment="center">
                        The first registered user becomes an administrator.
                        Subsequent users require admin approval.
                      </Text>
                    </FormLayout>
                  </Form>
                )}
              </div>
            </Tabs>
          </Card>

          <Text variant="bodySm" tone="subdued" alignment="center">
            Operational console for daily fulfilment, inventory, and returns.
          </Text>
        </BlockStack>
      </div>
    </div>
  );
}
