import { SignIn } from "@clerk/nextjs";
import { clerkOn } from "@/app/api/respond";

export const metadata = { title: "Sign in · Clay" };

export default function Page() {
  if (!clerkOn()) return <main className="shell narrow"><h1>Accounts are off</h1><p>This Clay deployment has no sign-in. You can still try the examples.</p></main>;
  return <main className="shell auth-page"><SignIn /></main>;
}
