import { SignUp } from "@clerk/nextjs";

export const metadata = { title: "Sign up · Clay" };

export default function Page() {
  return (
    <main className="shell auth-page">
      <p className="muted small">Clerk handles sign-up. Clay itself stores only your account id, not your email address or name. You can try the examples without an account.</p>
      <SignUp />
    </main>
  );
}
