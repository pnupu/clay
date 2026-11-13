import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in · Clay" };

export default function Page() {
  return <main className="shell auth-page"><SignIn /></main>;
}
