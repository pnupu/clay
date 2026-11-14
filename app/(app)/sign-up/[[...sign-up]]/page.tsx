import { SignUp } from "@clerk/nextjs";
import { clerkOn } from "@/app/api/respond";

export const metadata = { title: "Sign up · Sorvi" };

export default function Page() {
  if (!clerkOn()) return <main className="shell narrow"><h1>Accounts are off</h1><p>This Sorvi deployment has no sign-in. You can still try the examples.</p></main>;
  return (
    <main className="shell auth-page">
      <p className="muted small">Clerk handles sign-up. Sorvi itself stores only your account id, not your email address or name. You can try the examples without an account.</p>
      <SignUp />
    </main>
  );
}
