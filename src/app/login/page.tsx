import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { AuthLayout } from '@/components/AuthLayout';

export const metadata = { title: 'Sign in — Researchly' };

export default function LoginPage() {
  return (
    <AuthLayout
      eyebrow="Welcome back"
      heading="Sign in"
      blurb="Your papers, drafts and LinkedIn connection are private to your account."
    >
      <Suspense fallback={null}>
        <AuthForm mode="login" />
      </Suspense>
    </AuthLayout>
  );
}
