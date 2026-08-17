import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { AuthLayout } from '@/components/AuthLayout';

export const metadata = { title: 'Create an account — Researchly' };

export default function SignupPage() {
  return (
    <AuthLayout
      eyebrow="Get started"
      heading="Create your account"
      blurb="One workspace per researcher. Nothing you add here is visible to anyone else."
    >
      <Suspense fallback={null}>
        <AuthForm mode="signup" />
      </Suspense>
    </AuthLayout>
  );
}
